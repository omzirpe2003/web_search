// Persistent, dated conversation memory. Plain JSON file: zero infrastructure, human-readable,
// and the whole history fits in one context window for realistic usage (see DESIGN.md).

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { daysAgo, rel, stamp } from "./dates.js";

export interface Source { url: string; title?: string }
export interface Msg { role: "user" | "assistant"; text: string; at: string; sources?: Source[] }
export interface Session { id: string; startedAt: string; messages: Msg[] }
export interface Store { version: 1; sessions: Session[] }

export class Memory {
  private constructor(private file: string, private store: Store) {}

  static async open(file: string) {
    try {
      return new Memory(file, JSON.parse(await fs.readFile(file, "utf8")) as Store);
    } catch {
      return new Memory(file, { version: 1, sessions: [] });
    }
  }

  /** Sessions are only persisted once they contain a message (no empty clutter). */
  newSession(): Session {
    return { id: randomUUID(), startedAt: new Date().toISOString(), messages: [] };
  }

  async append(session: Session, ...msgs: Msg[]) {
    session.messages.push(...msgs);
    if (!this.store.sessions.some((s) => s.id === session.id)) this.store.sessions.push(session);
    // write-then-rename so a crash mid-write can't corrupt the history
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.store, null, 2));
    await fs.rename(tmp, this.file);
  }

  async wipe() {
    this.store.sessions = [];
    await fs.rm(this.file, { force: true });
  }

  /** Render earlier conversations as a dated transcript, newest kept first when over budget. */
  renderPast(currentId: string, now: Date, tz: string, budget: number): string {
    const past = this.store.sessions.filter((s) => s.id !== currentId && s.messages.length);
    if (!past.length) return "(No earlier conversations are on record. This is the first one.)";

    const blocks: string[] = [];
    let used = 0;
    let omitted = 0;
    for (const s of [...past].reverse()) {
      const started = new Date(s.startedAt);
      const head = `=== Conversation started ${stamp(started, tz)} (${rel(daysAgo(started, now, tz))}) ===`;
      const body = s.messages.map((m) => {
        const t = m.role === "assistant" && m.text.length > 2500 ? m.text.slice(0, 2500) + " …[truncated]" : m.text;
        const src = m.sources?.length
          ? `\n   (sources you used: ${m.sources.slice(0, 6).map((x) => x.url).join(", ")})`
          : "";
        return `[${stamp(new Date(m.at), tz)}] ${m.role === "user" ? "USER" : "YOU"}: ${t}${src}`;
      });
      const block = [head, ...body].join("\n");
      if (used + block.length > budget) { omitted++; continue; }
      used += block.length;
      blocks.unshift(block); // restore chronological order
    }
    const note = omitted ? `(${omitted} older conversation(s) omitted for length.)\n\n` : "";
    return note + blocks.join("\n\n");
  }
}
