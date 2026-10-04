import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  createAssembler,
  SourceNotFoundError,
  UnknownTierError,
  PathContainmentError,
  type AgentSource,
  type TierSpec,
} from '../src/index.js';

// Fixtures live in the source tree, not the compiled output.
const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const ROOT = resolve(REPO_ROOT, 'test', 'fixtures', 'agents');

const RESEARCHER: AgentSource = {
  id: 'researcher',
  personaPath: 'researcher.md',
  memoryPath: 'researcher.memory.md',
  meta: { team: 'verification' },
};

const REVIEWER: AgentSource = {
  id: 'reviewer',
  personaPath: 'reviewer.md',
  memoryPath: 'reviewer.memory.md',
};

const NO_MEMORY: AgentSource = {
  id: 'persona-only',
  personaPath: 'reviewer.md',
};

function assembler(tiers?: readonly TierSpec[]) {
  return createAssembler(tiers ? { root: ROOT, tiers } : { root: ROOT });
}

describe('assemble', () => {
  test('full tier returns the whole definition and the whole memory', async () => {
    const ctx = await assembler().assemble(RESEARCHER, 'full');
    assert.match(ctx.persona, /## Boundaries/);
    assert.match(ctx.memory, /## Session Log/);
    assert.equal(ctx.memoryPresent, true);
    assert.equal(ctx.clamped, false);
  });

  test('standard tier drops the session log but keeps commitments', async () => {
    const ctx = await assembler().assemble(RESEARCHER, 'standard');
    assert.match(ctx.memory, /Standing Positions/);
    assert.match(ctx.memory, /Open Questions/);
    assert.doesNotMatch(ctx.memory, /Session Log/);
    // Persona is unreduced at standard: the saving comes from memory.
    assert.match(ctx.persona, /## Boundaries/);
  });

  test('standard tier surfaces the frontmatter summary', async () => {
    const ctx = await assembler().assemble(RESEARCHER, 'standard');
    assert.match(ctx.memory, /\*\*Summary:\*\*/);
    assert.match(ctx.memory, /primary sources/);
  });

  test('compact tier reduces the definition to Quick Identity', async () => {
    const ctx = await assembler().assemble(RESEARCHER, 'compact');
    assert.match(ctx.persona, /I am the Researcher/);
    assert.doesNotMatch(ctx.persona, /## Boundaries/);
  });

  test('tiers are strictly cheaper as they descend', async () => {
    const a = assembler();
    const full = await a.assemble(RESEARCHER, 'full');
    const standard = await a.assemble(RESEARCHER, 'standard');
    const compact = await a.assemble(RESEARCHER, 'compact');

    assert.ok(
      full.estimatedTokens > standard.estimatedTokens,
      `full (${full.estimatedTokens}) should exceed standard (${standard.estimatedTokens})`,
    );
    assert.ok(
      standard.estimatedTokens > compact.estimatedTokens,
      `standard (${standard.estimatedTokens}) should exceed compact (${compact.estimatedTokens})`,
    );
  });

  test('falls back to the whole definition when selected sections are absent', async () => {
    // reviewer.md has no Quick Identity section.
    const ctx = await assembler().assemble(REVIEWER, 'compact');
    assert.match(ctx.persona, /Draft critique/);
    assert.notEqual(ctx.persona.length, 0);
  });

  test('handles an agent with no memory file', async () => {
    const ctx = await assembler().assemble(NO_MEMORY, 'full');
    assert.equal(ctx.memoryPresent, false);
    assert.equal(ctx.memory, '');
    assert.ok(ctx.persona.length > 0);
    assert.equal(ctx.text, ctx.persona);
  });

  test('carries meta through to the result', async () => {
    const ctx = await assembler().assemble(RESEARCHER, 'compact');
    assert.deepEqual(ctx.meta, { team: 'verification' });
  });

  test('text joins persona and memory with the separator', async () => {
    const ctx = await assembler().assemble(RESEARCHER, 'standard');
    assert.ok(ctx.text.includes('\n\n---\n\n'));
    assert.ok(ctx.text.startsWith(ctx.persona));
    assert.ok(ctx.text.endsWith(ctx.memory));
  });

  test('reports a clamp when maxLines drops content', async () => {
    const tiers: TierSpec[] = [
      { name: 'tiny', persona: { sections: ['quick identity'], maxLines: 2 }, memory: 'full' },
    ];
    const ctx = await assembler(tiers).assemble(RESEARCHER, 'tiny');
    assert.equal(ctx.clamped, true);
    assert.equal(ctx.persona.split('\n').length, 2);
  });

  test('rejects an unknown tier', async () => {
    await assert.rejects(() => assembler().assemble(RESEARCHER, 'nope'), UnknownTierError);
  });

  test('rejects a missing definition file', async () => {
    await assert.rejects(
      () => assembler().assemble({ id: 'ghost', personaPath: 'ghost.md' }, 'full'),
      SourceNotFoundError,
    );
  });

  test('refuses a path outside the root', async () => {
    await assert.rejects(
      () => assembler().assemble({ id: 'escape', personaPath: '../../../etc/passwd' }, 'full'),
      PathContainmentError,
    );
  });
});

describe('budget', () => {
  test('sums the group and lists every agent', async () => {
    const report = await assembler().budget([RESEARCHER, REVIEWER], 'standard');
    assert.equal(report.lines.length, 2);
    const sum = report.lines.reduce((n, l) => n + l.estimatedTokens, 0);
    assert.equal(report.totalTokens, sum);
  });

  test('withinLimit is null when no limit is supplied', async () => {
    const report = await assembler().budget([RESEARCHER], 'full');
    assert.equal(report.withinLimit, null);
    assert.equal(report.overBy, 0);
    assert.equal(report.limit, undefined);
  });

  test('reports being over a limit', async () => {
    const report = await assembler().budget([RESEARCHER, REVIEWER], 'full', { limit: 10 });
    assert.equal(report.withinLimit, false);
    assert.equal(report.overBy, report.totalTokens - 10);
  });

  test('reports being within a generous limit', async () => {
    const report = await assembler().budget([RESEARCHER], 'compact', { limit: 1_000_000 });
    assert.equal(report.withinLimit, true);
    assert.equal(report.overBy, 0);
  });
});

describe('fitToBudget', () => {
  test('keeps everyone at the top tier when the ceiling allows', async () => {
    const result = await assembler().fitToBudget([RESEARCHER, REVIEWER], { limit: 1_000_000 });
    assert.equal(result.fits, true);
    assert.deepEqual(result.downgradedIds, []);
    assert.ok(result.assignments.every((a) => a.tier === 'full'));
  });

  test('downgrades to fit a tight ceiling', async () => {
    const a = assembler();
    const atFull = await a.budget([RESEARCHER, REVIEWER], 'full');
    const limit = Math.floor(atFull.totalTokens * 0.6);

    const result = await a.fitToBudget([RESEARCHER, REVIEWER], { limit });
    assert.equal(result.fits, true);
    assert.ok(result.totalTokens <= limit);
    assert.ok(result.downgradedIds.length > 0);
  });

  test('spends the first downgrade on the most expensive agent', async () => {
    const a = assembler();
    const atFull = await a.budget([RESEARCHER, REVIEWER], 'full');
    // A ceiling just under the full total forces exactly one downgrade.
    const limit = atFull.totalTokens - 1;

    const result = await a.fitToBudget([RESEARCHER, REVIEWER], { limit });
    assert.equal(result.downgradedIds.length, 1);
    // The researcher has the longer memory, so it frees the most tokens.
    assert.deepEqual(result.downgradedIds, ['researcher']);
  });

  test('reports a shortfall when even the cheapest tier does not fit', async () => {
    const result = await assembler().fitToBudget([RESEARCHER, REVIEWER], { limit: 1 });
    assert.equal(result.fits, false);
    assert.ok((result.shortfall ?? 0) > 0);
    // Everyone ended at the cheapest available tier.
    assert.ok(result.assignments.every((a) => a.tier === 'compact'));
  });

  test('honors a custom preference ladder', async () => {
    const result = await assembler().fitToBudget([RESEARCHER], {
      limit: 1_000_000,
      preference: ['compact', 'standard'],
    });
    assert.equal(result.assignments[0]?.tier, 'compact');
  });

  test('rejects an unknown tier in the preference ladder', async () => {
    await assert.rejects(
      () => assembler().fitToBudget([RESEARCHER], { limit: 100, preference: ['nope'] }),
      UnknownTierError,
    );
  });

  test('handles an empty source list', async () => {
    const result = await assembler().fitToBudget([], { limit: 100 });
    assert.equal(result.fits, true);
    assert.equal(result.totalTokens, 0);
    assert.deepEqual(result.assignments, []);
  });
});

describe('configuration', () => {
  test('exposes configured tier names in order', () => {
    assert.deepEqual(assembler().tierNames(), ['full', 'standard', 'compact']);
  });

  test('rejects duplicate tier names', () => {
    assert.throws(
      () =>
        createAssembler({
          root: ROOT,
          tiers: [
            { name: 'a', persona: 'full', memory: 'full' },
            { name: 'a', persona: 'full', memory: 'full' },
          ],
        }),
      /Duplicate tier name/,
    );
  });

  test('rejects an empty tier ladder', () => {
    assert.throws(() => createAssembler({ root: ROOT, tiers: [] }), /At least one tier/);
  });

  test('requires a root', () => {
    assert.throws(() => createAssembler({ root: '' }), /root is required/);
  });

  test('reports cache hits on repeated reads', async () => {
    const a = assembler();
    await a.assemble(RESEARCHER, 'full');
    await a.assemble(RESEARCHER, 'standard');
    const stats = a.cacheStats();
    assert.ok(stats);
    assert.ok(stats.hits > 0, 'second assembly should hit the cache');
  });

  test('works with caching disabled', async () => {
    const a = createAssembler({ root: ROOT, cache: false });
    const ctx = await a.assemble(RESEARCHER, 'standard');
    assert.ok(ctx.estimatedTokens > 0);
    assert.equal(a.cacheStats(), null);
  });
});
