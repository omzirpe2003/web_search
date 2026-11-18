import "dotenv/config";
import readline from "node:readline/promises";
import { Agent } from "./agent.js";
import { Memory } from "./memory.js";
import { defaultTZ, stamp } from "./dates.js";

if (!process.env.OPENAI_API_KEY) {
  console.error("Missing OPENAI_API_KEY. Copy .env.example to .env and fill it in.");
  process.exit(1);
}

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;

const tz = defaultTZ();
const memory = await Memory.open(process.env.MEMORY_PATH || "./data/memory.json");
const agent = new Agent(memory, tz);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log(bold("Web research agent") + dim(`  ${stamp(new Date(), tz)} (${tz})`));
console.log(dim("Commands: /new new conversation (old ones stay in memory), /forget wipe memory, /exit\n"));

rl.on("close", () => process.exit(0));

while (true) {
  const input = (await rl.question(bold("you > "))).trim();
  if (!input) 
    continue;
  if (input === "/exit") 
    break;
  if (input === "/new") { 
    agent.newSession(); 
    console.log(dim("Started a new conversation.\n")); 
    continue; 
  }
  if (input === "/forget") { 
    await memory.wipe(); 
    agent.newSession(); 
    console.log(dim("Memory wiped.\n")); 
    continue; 
  }


  try {
    const { sources } = await agent.turn(input, {
      onText: (d) => process.stdout.write(d),
      onSearch: (q) => process.stdout.write(dim(`\n  [searching: ${q}]\n`)),
    });
    if (sources.length) {
      console.log(dim("\n\nSources:"));
      sources.forEach((s, i) => console.log(dim(`  ${i + 1}. ${s.title ?? ""} ${s.url}`)));
    }
    console.log("\n");
  } catch (err) {
    console.log("\n" + `Error: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
rl.close();
