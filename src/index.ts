/**
 * agent-context-tiering
 *
 * Tiered context assembly and pre-flight token budgeting for multi-agent
 * systems. Load the cheapest context that still does the job, and know what a
 * fan-out costs before you pay for it.
 */

export {
  ContextAssembler,
  createAssembler,
  SourceNotFoundError,
  UnknownTierError,
  type AssemblerOptions,
} from './assembler.js';

export { FileCache, type FileCacheOptions } from './cache.js';

export { DEFAULT_TIERS, indexTiers } from './tiers.js';

export { DEFAULT_CHARS_PER_TOKEN, estimateTokens } from './tokens.js';

export {
  clampLines,
  extractSection,
  extractSections,
  parseFrontmatter,
  trimBlankEdges,
  type ParsedFrontmatter,
} from './sections.js';

export { containPath, tryContainPath, PathContainmentError } from './paths.js';

export type {
  AgentSource,
  AssembledContext,
  BudgetLine,
  BudgetReport,
  FitResult,
  FittedAssignment,
  MemorySelection,
  PersonaSelection,
  TierSpec,
} from './types.js';
