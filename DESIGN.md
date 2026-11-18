# DESIGN

## What it is
A terminal chat agent (TypeScript/Node) with **one tool: web search**, and a persistent, **dated** memory of every past conversation. Run: `npm install && cp .env.example .env && npm run dev`.

## Key insight
The sample questions ("Has any of them changed pricing *since Monday*?", "What did I ask on 3 November, is it still correct?", "Last Tuesday I asked about Postgres hosting...") are not really search problems. They are **time + memory** problems that end in a search. Three things must be right, in order: (1) know what today is, (2) know what was said on the referenced day, (3) re-verify against the live web and report the delta. Most "chat + search" agents only do (3).

index.ts
  └─► agent.turn(input, hooks)
        │
        ├─ 1. now = new Date()
        │
        ├─ 2. memory.renderPast(sessionId, now, tz, budget)
        │       → string: dated transcript of OLD sessions
        │
        ├─ 3. buildSystem(now, tz, thatString, maxSearches)
        │       └─ calendarBlock(now, tz)  → "last Monday = 16 November…"
        │       → big instructions string
        │
        ├─ 4. input = [ this session's earlier messages…, your new message ]
        │
        ├─ 5. client.responses.create({ instructions, input,
        │        tools:[web_search], stream:true })
        │       │
        │       │   OpenAI runs the searches itself, streams events back:
        │       ├─ output_text.delta     → hooks.onText()   (prints words live)
        │       ├─ output_item.done      → hooks.onSearch() (prints [searching: …])
        │       └─ response.completed    → keep the final response object
        │
        ├─ 6. read url_citation annotations from the final response → sources
        │
        ├─ 7. memory.append(session, userMsg, assistantMsg)
        │       → writes data/memory.json  (only now!)
        │
        └─ 8. return { text, sources }  → index.ts prints the "Sources:" list



1. **System prompt rebuilt every turn**: current time, a code-generated calendar ("last Tuesday = 17 Nov 2026"), and a dated transcript of earlier conversations (incl. URLs used).
2. The model resolves references against that table, finds the original exchange, and follows an explicit *re-verification procedure* (extract items -> search each separately, primary sources first -> report CHANGED / NO CHANGE FOUND / COULD NOT VERIFY).
3. If the record has nothing for that date it must say so rather than invent a shortlist.
4. Answers stream; cited sources are printed; the turn is saved only on success (atomic write-then-rename).

## Why this way
- **Calendar in code, not in the model.** LLMs are unreliable at "last Tuesday". A lookup table removes that failure class. Unit-tested (`npm test`), including timezone edge cases.
- **Memory is injected, not a tool.** The brief says one tool. Also, an agent that must *decide* to call a recall tool can forget to; always-in-context memory can't. Cost is tokens, capped by `MEMORY_CHAR_BUDGET` (newest kept).
- **Store URLs with each answer.** "Is your answer still correct?" needs the baseline claim, its date and where it came from.
- **Provider-hosted search (OpenAI Responses API `web_search`).** One key, one streaming request, the model decides when/what to search, and every claim comes back with `url_citation` annotations we store as sources. No scraping or ranking code to maintain. We strip the `utm_source=openai` tracking param so URLs are clean and dedupe.
- **JSON file store.** Zero setup, inspectable, atomic. Fits `npm install && npm run dev`.
- **Text-only replay inside a session.** Drops bulky tool blocks between turns; sources kept as URLs.
- **Honesty rules in the prompt**: "no change found" is not "no change"; the earlier answer may itself have been wrong; prices must state basis (per seat, billing period) and source date.

## Considered and rejected
- **Tavily/Serper + own tool loop**: more control over ranking and fetching, but a second key, more code, worse citations. Worth it only if search quality proves to be the bottleneck.
- **Vector DB / embeddings for memory**: overkill for one user; retrieval misses are exactly the failure ("what did I ask on 3 Nov") that a full dated transcript avoids.
- **Memory-recall tool**: see above; also violates the one-tool constraint.
- **LangChain/LangGraph**: abstraction with no benefit for a single loop; harder to explain every line.
- **Web UI**: not needed to evaluate behavior; time went to correctness.

## Known limits
- Whole-history-in-context won't scale past a few hundred conversations (oldest are dropped with a visible note).
- Single user, single device. Sessions are per process start or `/new`.
- Date understanding covers weekday/day-month forms; "the week before Diwali" would rely on model judgment.
- Provider search can't be tuned (domains, freshness) per query in this setup.

## With another week
1. **Eval harness**: scripted multi-day transcripts (fake clock + seeded memory) for the three sample question types, graded on correct baseline retrieval and delta accuracy.
2. **Hierarchical memory**: per-conversation summaries + structured "claims ledger" (entity, claim, date, source) so follow-ups diff against structured facts, and long histories scale.
3. **Scheduled watch**: user says "watch these 5"; nightly job re-checks and stores diffs, so "what changed?" is answered from a log plus a fresh search.
4. **Prompt-cache-friendly ordering** (static instructions first, memory next, volatile calendar last) so OpenAI's automatic caching cuts cost; higher reasoning effort for multi-entity comparisons.
5. **Search upgrades**: domain allow-lists for pricing pages, direct fetch of pricing/changelog URLs, snapshot hashes for change detection.
6. **Web/Slack front-end**, per-user auth, encrypted storage.
