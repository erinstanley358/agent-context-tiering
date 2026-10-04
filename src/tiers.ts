import type { TierSpec } from './types.js';

/**
 * A reference tier ladder.
 *
 * These are a starting point, not a standard. The section names below are the
 * ones that happened to matter in the system this was extracted from; yours
 * will differ. Define your own ladder and pass it to `createAssembler`.
 *
 * The shape worth copying is the ladder itself: a small number of named levels
 * where each one is a deliberate statement about what can be dropped. Most of
 * the saving comes from the memory file, not the definition file, because
 * memory grows without bound and definitions do not.
 */
export const DEFAULT_TIERS: readonly TierSpec[] = [
  {
    name: 'full',
    persona: 'full',
    memory: 'full',
    modelHint: 'large',
    description: 'Everything. For work where the agent needs its whole history.',
  },
  {
    name: 'standard',
    persona: 'full',
    memory: {
      frontmatterKeys: ['summary'],
      sections: ['who i am', 'standing positions', 'open questions'],
    },
    modelHint: 'mid',
    description:
      'Whole definition, memory reduced to identity and commitments. The default.',
  },
  {
    name: 'compact',
    persona: { sections: ['quick identity'] },
    memory: { frontmatterKeys: ['summary'], maxLines: 12 },
    modelHint: 'small',
    description: 'Identity only. For routing, roll-calls, and wide fan-out.',
  },
];

/** Index a tier list by name, rejecting duplicates. */
export function indexTiers(tiers: readonly TierSpec[]): Map<string, TierSpec> {
  const map = new Map<string, TierSpec>();
  for (const tier of tiers) {
    if (map.has(tier.name)) {
      throw new Error(`Duplicate tier name: "${tier.name}"`);
    }
    map.set(tier.name, tier);
  }
  if (map.size === 0) {
    throw new Error('At least one tier must be defined.');
  }
  return map;
}
