/**
 * Runnable example.
 *
 *   npm run build
 *   npx tsx examples/basic.ts
 *
 * Or compile it with the test config and run the output:
 *
 *   npx tsc -p tsconfig.test.json && node .tmp-test/examples/basic.js
 *
 * Uses the test fixtures as a small two-agent system.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createAssembler, type AgentSource } from '../src/index.js';

/**
 * Walk up from this file to find the fixtures directory, so the example runs
 * the same whether it is executed from source via tsx or from compiled output.
 */
function findFixtures(): string {
  let dir = import.meta.dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, 'test', 'fixtures', 'agents');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate test/fixtures/agents from ' + import.meta.dirname);
}

const ROOT = findFixtures();

const sources: AgentSource[] = [
  {
    id: 'researcher',
    personaPath: 'researcher.md',
    memoryPath: 'researcher.memory.md',
    meta: { team: 'verification' },
  },
  {
    id: 'reviewer',
    personaPath: 'reviewer.md',
    memoryPath: 'reviewer.memory.md',
    meta: { team: 'editorial' },
  },
];

const agents = createAssembler({ root: ROOT });

async function main(): Promise<void> {
  const line = '-'.repeat(68);

  // 1. What does each tier cost for this group?
  console.log('COST BY TIER');
  console.log(line);
  for (const tier of agents.tierNames()) {
    const report = await agents.budget(sources, tier);
    const detail = report.lines
      .map((l) => `${l.id}=${l.estimatedTokens}`)
      .join('  ');
    console.log(`${tier.padEnd(10)} total ${String(report.totalTokens).padStart(5)}   ${detail}`);
  }

  // 2. Check a group against a ceiling.
  const full = await agents.budget(sources, 'full', { limit: 600 });
  console.log(`\nAt 'full' against a 600-token ceiling: within=${full.withinLimit}, over by ${full.overBy}`);

  // 3. Let the library choose tiers that fit.
  const limit = 592;
  const fit = await agents.fitToBudget(sources, { limit });

  console.log(`\nFIT TO ${limit} TOKENS`);
  console.log(line);
  console.log(`fits: ${fit.fits}   total: ${fit.totalTokens}`);
  for (const a of fit.assignments) {
    const flag = a.downgraded ? '  (downgraded)' : '';
    console.log(`  ${a.id.padEnd(12)} ${a.tier.padEnd(10)} ${String(a.estimatedTokens).padStart(4)} tokens${flag}`);
  }

  // 4. Assemble at the assigned tier and show what a caller would send.
  const byId = new Map(sources.map((s) => [s.id, s]));
  const first = fit.assignments[0];
  if (first) {
    const source = byId.get(first.id);
    if (source) {
      const ctx = await agents.assemble(source, first.tier);
      console.log(`\nASSEMBLED: ${ctx.id} @ ${ctx.tier}`);
      console.log(line);
      console.log(`tokens: ${ctx.estimatedTokens}   memory present: ${ctx.memoryPresent}   clamped: ${ctx.clamped}`);
      console.log(`\n${ctx.text}`);
    }
  }

  const stats = agents.cacheStats();
  if (stats) {
    console.log(`\n${line}`);
    console.log(
      `cache: ${stats.size} entries, ${stats.hits} hits, ${stats.misses} misses, `
      + `hit rate ${(stats.hitRate * 100).toFixed(0)}%`,
    );
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
