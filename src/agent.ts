import OpenAI from "openai";
import { Memory, Session, Source } from "./memory.js";
import { buildSystem } from "./prompt.js";

const MODEL = process.env.MODEL || "gpt-5";
const MEMORY_BUDGET = Number(process.env.MEMORY_CHAR_BUDGET || 60_000);
const MAX_SEARCHES = Number(process.env.MAX_SEARCHES || 8);

export interface Hooks {
  onText(delta: string): void;
  onSearch(query: string): void;
}

// OpenAI appends "?utm_source=openai" to cited URLs; strip it so URLs are clean (and dedupe properly).
function cleanUrl(u: string) {
  try {
    const x = new URL(u);
    x.searchParams.delete("utm_source");
    return x.toString();
  } catch {
    return u;
  }
}

export class Agent {
  private client = new OpenAI(); // reads OPENAI_API_KEY from env
  session: Session;

  constructor(private memory: Memory, private tz: string) {
    this.session = memory.newSession();
  }

  newSession() {
    this.session = this.memory.newSession();
  }

  async turn(userText: string, hooks: Hooks): Promise<{ text: string; sources: Source[] }> {
    const now = new Date();

    // Rebuilt every turn: fresh clock + fresh memory.
    const instructions = buildSystem(
      now,
      this.tz,
      this.memory.renderPast(this.session.id, now, this.tz, MEMORY_BUDGET),
      MAX_SEARCHES,
    );

    // Within a session we replay text only; tool calls are dropped between turns to keep context small.
    // The URLs we used are kept in memory.json instead.
    const input = [
      ...this.session.messages.map((m) => ({ role: m.role, content: m.text })),
      { role: "user" as const, content: userText },
    ];

    // Hosted web search: OpenAI runs the searches server-side inside this single request.
    const stream = await this.client.responses.create({
      model: MODEL,
      instructions,
      input,
      tools: [{ type: "web_search" }],
      stream: true,
    });

    let text = "";
    let final: OpenAI.Responses.Response | undefined;

    for await (const ev of stream) {
      switch (ev.type) {
        case "response.output_text.delta":
          text += ev.delta;
          hooks.onText(ev.delta);
          break;
        case "response.output_item.done": {
          // The query is only complete once the search item is done.
          const item = ev.item as { type: string; action?: { query?: string } };
          if (item.type === "web_search_call" && item.action?.query) hooks.onSearch(item.action.query);
          break;
        }
        case "response.completed":
          final = ev.response;
          break;
        case "response.failed":
          throw new Error(ev.response.error?.message ?? "Response failed");
        case "error":
          throw new Error(ev.message);
      }
    }

    // Citations live on the final response as url_citation annotations.
    const sources = new Map<string, Source>();
    for (const item of final?.output ?? []) {
      if (item.type !== "message") continue;
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        for (const a of part.annotations ?? []) {
          if (a.type === "url_citation") {
            const url = cleanUrl(a.url);
            sources.set(url, { url, title: a.title || undefined });
          }
        }
      }
    }

    text = text.trim() || "(I couldn't produce an answer. Please try rephrasing.)";
    const list = [...sources.values()];

    // Persist only after a successful turn, so a failed request never leaves a dangling half-turn.
    await this.memory.append(
      this.session,
      { role: "user", text: userText, at: now.toISOString() },
      { role: "assistant", text, at: new Date().toISOString(), sources: list },
    );
    return { text, sources: list };
  }
}
