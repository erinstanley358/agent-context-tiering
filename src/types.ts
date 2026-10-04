/**
 * One agent's context files on disk.
 *
 * The library is deliberately ignorant of what an "agent" is in your system.
 * It needs an id and the paths to the markdown that describes it.
 */
export interface AgentSource {
  /** Stable identifier used in reports and errors. */
  id: string;
  /** Path to the agent's definition file. Required. */
  personaPath: string;
  /** Path to the agent's accumulated notes or memory file, if it has one. */
  memoryPath?: string;
  /** Arbitrary labels carried through to reports (team, role, owner, ...). */
  meta?: Record<string, string>;
}

/** How much of a memory file a tier keeps. */
export interface MemorySelection {
  /** Frontmatter keys to surface, in order, as `**key:** value` lines. */
  frontmatterKeys?: string[];
  /** `##` section headings to extract, in order. Matched case-insensitively. */
  sections?: string[];
  /** Hard clamp on line count after selection. Omit for no clamp. */
  maxLines?: number;
}

/** How much of a persona file a tier keeps. */
export interface PersonaSelection {
  /** `##` section headings to extract, in order. Matched case-insensitively. */
  sections: string[];
  /** Hard clamp on line count after selection. Omit for no clamp. */
  maxLines?: number;
}

/**
 * A named context level.
 *
 * A tier is a declarative statement of what to keep. It carries no model
 * requirement of its own; `modelHint` is advice you can route on.
 */
export interface TierSpec {
  /** Tier name, used as the lookup key. */
  name: string;
  /** `'full'` keeps the whole persona file; otherwise keep selected sections. */
  persona: 'full' | PersonaSelection;
  /** `'full'` keeps the whole memory file; otherwise keep the selection. */
  memory: 'full' | MemorySelection;
  /** Free-form routing hint, e.g. a model name or size class. */
  modelHint?: string;
  /** Human-readable description for docs and tool output. */
  description?: string;
}

/** The result of assembling one agent at one tier. */
export interface AssembledContext {
  id: string;
  tier: string;
  /** Selected persona text. */
  persona: string;
  /** Selected memory text. Empty string when the agent has no memory file. */
  memory: string;
  /** `persona` and `memory` joined by the assembler's separator. */
  text: string;
  /** Estimated tokens for `text`. */
  estimatedTokens: number;
  modelHint?: string;
  /** False when `memoryPath` was absent or unreadable. */
  memoryPresent: boolean;
  /** True when a `maxLines` clamp dropped content. */
  clamped: boolean;
  meta?: Record<string, string>;
}

/** One row of a budget report. */
export interface BudgetLine {
  id: string;
  tier: string;
  estimatedTokens: number;
  modelHint?: string;
  memoryPresent: boolean;
  clamped: boolean;
}

/** What a group of agents would cost before you load any of them. */
export interface BudgetReport {
  lines: BudgetLine[];
  totalTokens: number;
  /** The ceiling you passed, if any. */
  limit?: number;
  /** `null` when no limit was supplied. */
  withinLimit: boolean | null;
  /** Tokens over the ceiling, or 0. */
  overBy: number;
}

/** A per-agent tier choice produced by `fitToBudget`. */
export interface FittedAssignment {
  id: string;
  tier: string;
  estimatedTokens: number;
  /** True when this agent was moved below the most preferred tier. */
  downgraded: boolean;
}

/** The outcome of fitting a group of agents under a token ceiling. */
export interface FitResult {
  assignments: FittedAssignment[];
  totalTokens: number;
  limit: number;
  /** False when even the cheapest tier for every agent exceeds the ceiling. */
  fits: boolean;
  /** Agents that had to drop below the top preference. */
  downgradedIds: string[];
  /** Present only when `fits` is false. */
  shortfall?: number;
}
