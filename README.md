# agent-context-tiering

Tiered context assembly and pre-flight token budgeting for multi-agent systems.

Load the cheapest context that still does the job, and know what a fan-out costs before you pay for it.

Zero runtime dependencies. TypeScript, ESM, Node 20+.

---

## The problem

You have a lot of agents. Each one is defined by a file, and the useful ones accumulate a second file of notes that grows every session.

At some point you want to ask twelve of them a question, and you discover two things at once. The first is that loading twelve complete definitions plus twelve complete histories costs more than the answer is worth. The second is that you had no way to find that out except by doing it and reading the bill.

Most of the cost is in the notes, not the definitions. Definitions are written once and stay roughly the same size. Notes grow without bound. So the useful question is not "how do I compress an agent" but "which parts of which agents does this particular job actually need."

This library answers that question declaratively, and lets you ask what it costs first.

## Install

```sh
npm install agent-context-tiering
```

## Thirty seconds

```ts
import { createAssembler } from 'agent-context-tiering';

const agents = createAssembler({ root: './agents' });

const sources = [
  { id: 'researcher', personaPath: 'researcher.md', memoryPath: 'researcher.memory.md' },
  { id: 'reviewer',   personaPath: 'reviewer.md',   memoryPath: 'reviewer.memory.md' },
];

// What would this cost?
const report = await agents.budget(sources, 'full');
console.log(report.totalTokens); // 988

// Too much. Fit it under a ceiling instead.
const fit = await agents.fitToBudget(sources, { limit: 592 });
console.log(fit.fits, fit.totalTokens); // true 423

// Then assemble each agent at the tier it was assigned.
const byId = new Map(sources.map((s) => [s.id, s]));

for (const assignment of fit.assignments) {
  const source = byId.get(assignment.id);
  if (!source) continue;
  const ctx = await agents.assemble(source, assignment.tier);
  // ctx.text is the prompt-ready string
}
```

A runnable version is in [`examples/basic.ts`](examples/basic.ts).

Those numbers are from the fixtures in `test/fixtures/agents`, measured, not illustrative:

| tier | researcher | reviewer | total |
|---|---|---|---|
| `full` | 676 | 312 | **988** |
| `standard` | 534 | 292 | **826** |
| `compact` | 111 | 179 | **290** |

The researcher has a session log and the reviewer does not, which is why the researcher is the one that gets trimmed first and why the gap between tiers is uneven. That asymmetry is the whole point: a uniform compression ratio would have taken the same proportion from both.

## Tiers are declarations, not functions

A tier says what to keep. It does not contain logic, so a tier ladder is reviewable by someone who does not read TypeScript.

```ts
const tiers = [
  {
    name: 'full',
    persona: 'full',
    memory: 'full',
    modelHint: 'large',
  },
  {
    name: 'standard',
    persona: 'full',
    memory: {
      frontmatterKeys: ['summary'],
      sections: ['who i am', 'standing positions', 'open questions'],
    },
    modelHint: 'mid',
  },
  {
    name: 'compact',
    persona: { sections: ['quick identity'] },
    memory: { frontmatterKeys: ['summary'], maxLines: 12 },
    modelHint: 'small',
  },
];

const agents = createAssembler({ root: './agents', tiers });
```

`DEFAULT_TIERS` ships this ladder as a starting point. The section names are the ones that mattered in the system this came out of; yours will be different. Replace them.

Heading matching is deliberately tolerant, because these files are written by people: `## Who I Am (In My Own Words)` answers to `'who i am'`, matching is case-insensitive, and a section keeps its own `###` subsections. A heading that merely shares a prefix does not match, so `## Standing Position Review` is not picked up by `'standing positions'`.

## Budgeting

`budget` tells you what a group costs at one tier. `fitToBudget` chooses a tier per agent so the group fits under a ceiling.

```ts
const fit = await agents.fitToBudget(sources, {
  limit: 20_000,
  preference: ['full', 'standard', 'compact'], // most wanted first
});

fit.fits;           // false if even the cheapest ladder rung overflows
fit.totalTokens;    // what the assignment actually costs
fit.shortfall;      // present only when fits === false
fit.downgradedIds;  // who had to drop below the top preference
```

Everyone starts at the most preferred tier. While the total is over the ceiling, the agent whose next downgrade frees the most tokens is stepped down, repeatedly, until the group fits or every agent is at its cheapest rung.

That is greedy by largest saving. It is not provably optimal and the library does not claim otherwise, but it is explainable, stable across runs, and it spends the reduction where the bytes actually are. One agent with a long history gets trimmed before five short ones do.

## The assembler refuses to read outside its root

`root` is required, and every path resolves against it. A path that lands outside is refused, including by `..` traversal, by an absolute path, and by a sibling directory that shares a name prefix.

```ts
const agents = createAssembler({ root: '/srv/agents' });

await agents.assemble({ id: 'x', personaPath: '../../etc/passwd' }, 'full');
// throws PathContainmentError
```

Context file names often arrive from a registry, a config file, or a request. An assembler that reads any path it is handed is a file-disclosure primitive with a friendly API. This one is not, and the containment is tested rather than asserted.

## Caching

Reads go through an LRU cache invalidated on mtime, not on time alone. A file edited on disk is re-read on next access even inside the TTL, and a file that does not exist yet is a miss rather than a cached absence, so it gets picked up when it appears.

```ts
createAssembler({ root: './agents', cache: new FileCache({ maxEntries: 500, ttlMs: 60_000 }) });
createAssembler({ root: './agents', cache: false }); // always read through

agents.cacheStats(); // { size, hits, misses, hitRate }
```

Within a single fan-out the same definition is often read several times at different tiers, which is where the hit rate comes from.

## Failure behavior, stated plainly

Two fallbacks exist, and they fail in opposite directions on purpose.

**A definition whose selected sections are all absent falls back to the whole file.** An agent invoked with no definition at all is worse than an agent invoked with too much context, so this one fails expensive.

**Memory whose selected sections are all absent falls back to the head of the body**, clamped. Memory is the unbounded half, so a selection miss must not silently restore full cost to a tier the caller chose specifically to avoid it. This one fails cheap.

`AssembledContext.clamped` is true whenever a `maxLines` limit dropped content, so a caller can tell the difference between a tier that fit and a tier that was cut off.

A missing definition file throws `SourceNotFoundError`. A missing memory file does not throw: `memoryPresent` comes back false and `memory` is an empty string, because an agent with no history yet is a normal state.

## Token estimates are estimates

`estimateTokens` divides character count by a ratio, defaulting to 3.5. It is roughly right for English prose across current BPE tokenizers and it is wrong for code, for dense punctuation, and for most non-Latin scripts.

It is built to be cheap enough to run across every agent before loading any of them. Use it to decide what to load. Do not use it to reconcile a bill. If you need exact counts, pass a real tokenizer's output in at the call site and keep the rest of the library.

## API

| Export | Purpose |
|---|---|
| `createAssembler(options)` | Build an assembler. `root` required |
| `.assemble(source, tier)` | One agent, one tier |
| `.assembleMany(sources, tier)` | Several agents, one tier |
| `.budget(sources, tier, { limit? })` | What a group costs, before loading |
| `.fitToBudget(sources, { limit, preference? })` | Choose tiers to fit a ceiling |
| `.tierNames()` / `.getTier(name)` | Inspect the configured ladder |
| `.cacheStats()` | Hit rate, or null when caching is off |
| `estimateTokens(text, charsPerToken?)` | Standalone estimate |
| `extractSection` / `extractSections` | Markdown section extraction |
| `parseFrontmatter` | Frontmatter split, including folded scalars |
| `containPath` / `tryContainPath` | Path containment against a root |
| `DEFAULT_TIERS` | The reference ladder |

Errors: `SourceNotFoundError`, `UnknownTierError`, `PathContainmentError`.

## What this is not

It does not call a model, and it has no opinion about which one you call. `modelHint` is a string you can route on and nothing reads it.

It does not manage agent state, write files, or orchestrate anything. It reads markdown and returns strings.

It is not a tokenizer.

## Development

```sh
npm install
npm run build
npm test        # 67 tests, node:test, no test framework dependency
npm run typecheck
```

## License

MIT. Copyright 2026 Erin Stanley.
