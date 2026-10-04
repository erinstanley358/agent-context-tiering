import { FileCache } from './cache.js';
import { containPath } from './paths.js';
import {
  clampLines,
  extractSection,
  extractSections,
  parseFrontmatter,
} from './sections.js';
import { DEFAULT_TIERS, indexTiers } from './tiers.js';
import { DEFAULT_CHARS_PER_TOKEN, estimateTokens } from './tokens.js';
import type {
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

export interface AssemblerOptions {
  /**
   * Directory that contains every context file the assembler may read.
   * Every path is resolved against it and refused if it lands outside.
   */
  root: string;
  /** Tier ladder. Defaults to `DEFAULT_TIERS`. */
  tiers?: readonly TierSpec[];
  /** Characters per token for estimation. */
  charsPerToken?: number;
  /** Separator placed between persona and memory in `text`. */
  separator?: string;
  /** Pass `false` to disable caching, or supply your own cache. */
  cache?: FileCache | false;
}

/** Raised when an agent's required definition file cannot be read. */
export class SourceNotFoundError extends Error {
  readonly id: string;
  readonly path: string;

  constructor(id: string, path: string) {
    super(`Definition file for agent "${id}" could not be read: ${path}`);
    this.name = 'SourceNotFoundError';
    this.id = id;
    this.path = path;
  }
}

/** Raised when a tier name is not in the configured ladder. */
export class UnknownTierError extends Error {
  constructor(name: string, available: readonly string[]) {
    super(`Unknown tier "${name}". Configured tiers: ${available.join(', ')}`);
    this.name = 'UnknownTierError';
  }
}

export class ContextAssembler {
  private readonly root: string;
  private readonly tiers: Map<string, TierSpec>;
  private readonly order: string[];
  private readonly charsPerToken: number;
  private readonly separator: string;
  private readonly cache: FileCache | null;

  constructor(options: AssemblerOptions) {
    if (!options.root) {
      throw new Error('AssemblerOptions.root is required.');
    }
    const ladder = options.tiers ?? DEFAULT_TIERS;
    this.root = options.root;
    this.tiers = indexTiers(ladder);
    this.order = ladder.map((t) => t.name);
    this.charsPerToken = options.charsPerToken ?? DEFAULT_CHARS_PER_TOKEN;
    this.separator = options.separator ?? '\n\n---\n\n';
    this.cache = options.cache === false ? null : options.cache ?? new FileCache();
  }

  /** Tier names in the order they were configured, most complete first. */
  tierNames(): string[] {
    return [...this.order];
  }

  getTier(name: string): TierSpec | undefined {
    return this.tiers.get(name);
  }

  /** Assemble one agent's context at one tier. */
  async assemble(source: AgentSource, tierName: string): Promise<AssembledContext> {
    const tier = this.tiers.get(tierName);
    if (!tier) throw new UnknownTierError(tierName, this.order);

    const personaPath = containPath(source.personaPath, this.root);
    const rawPersona = await this.read(personaPath);
    if (rawPersona === null) throw new SourceNotFoundError(source.id, personaPath);

    let rawMemory: string | null = null;
    if (source.memoryPath) {
      rawMemory = await this.read(containPath(source.memoryPath, this.root));
    }

    const personaResult = selectPersona(rawPersona, tier.persona);
    const memoryResult =
      rawMemory === null ? { text: '', clamped: false } : selectMemory(rawMemory, tier.memory);

    const parts = [personaResult.text, memoryResult.text].filter((p) => p.length > 0);
    const text = parts.join(this.separator);

    const context: AssembledContext = {
      id: source.id,
      tier: tier.name,
      persona: personaResult.text,
      memory: memoryResult.text,
      text,
      estimatedTokens: estimateTokens(text, this.charsPerToken),
      memoryPresent: rawMemory !== null,
      clamped: personaResult.clamped || memoryResult.clamped,
    };
    if (tier.modelHint !== undefined) context.modelHint = tier.modelHint;
    if (source.meta !== undefined) context.meta = source.meta;
    return context;
  }

  /** Assemble several agents at the same tier. */
  async assembleMany(
    sources: readonly AgentSource[],
    tierName: string,
  ): Promise<AssembledContext[]> {
    const out: AssembledContext[] = [];
    for (const source of sources) {
      out.push(await this.assemble(source, tierName));
    }
    return out;
  }

  /**
   * Report what a group would cost at a given tier, before loading it.
   *
   * This is the call that makes a wide fan-out a decision rather than a
   * surprise. It reads the files but returns only sizes, so you can ask the
   * question cheaply and then choose.
   */
  async budget(
    sources: readonly AgentSource[],
    tierName: string,
    options: { limit?: number } = {},
  ): Promise<BudgetReport> {
    const contexts = await this.assembleMany(sources, tierName);
    const lines: BudgetLine[] = contexts.map((c) => {
      const line: BudgetLine = {
        id: c.id,
        tier: c.tier,
        estimatedTokens: c.estimatedTokens,
        memoryPresent: c.memoryPresent,
        clamped: c.clamped,
      };
      if (c.modelHint !== undefined) line.modelHint = c.modelHint;
      return line;
    });

    const totalTokens = lines.reduce((sum, l) => sum + l.estimatedTokens, 0);
    const limit = options.limit;

    const report: BudgetReport = {
      lines,
      totalTokens,
      withinLimit: limit === undefined ? null : totalTokens <= limit,
      overBy: limit === undefined ? 0 : Math.max(0, totalTokens - limit),
    };
    if (limit !== undefined) report.limit = limit;
    return report;
  }

  /**
   * Choose a tier per agent so the group fits under a token ceiling.
   *
   * Everyone starts at the most preferred tier. While the total exceeds the
   * ceiling, the agent whose next downgrade frees the most tokens is stepped
   * down, and that repeats until the group fits or every agent sits at the
   * cheapest tier available to it.
   *
   * Greedy by largest saving, which is not provably optimal but is
   * explainable, stable, and spends the reduction where the bytes actually
   * are: one agent with a long history gets trimmed before five short ones.
   */
  async fitToBudget(
    sources: readonly AgentSource[],
    options: { limit: number; preference?: readonly string[] },
  ): Promise<FitResult> {
    const preference = options.preference ?? this.order;
    for (const name of preference) {
      if (!this.tiers.has(name)) throw new UnknownTierError(name, this.order);
    }
    if (preference.length === 0) {
      throw new Error('fitToBudget requires at least one tier in `preference`.');
    }

    // Cost every agent at every tier in the preference ladder.
    const costs = new Map<string, number[]>();
    for (const source of sources) {
      const row: number[] = [];
      for (const tierName of preference) {
        const context = await this.assemble(source, tierName);
        row.push(context.estimatedTokens);
      }
      costs.set(source.id, row);
    }

    // Everyone begins at index 0, the most preferred tier.
    const level = new Map<string, number>();
    for (const source of sources) level.set(source.id, 0);

    const totalAt = (): number => {
      let sum = 0;
      for (const source of sources) {
        const row = costs.get(source.id) ?? [];
        sum += row[level.get(source.id) ?? 0] ?? 0;
      }
      return sum;
    };

    let total = totalAt();

    while (total > options.limit) {
      let bestId: string | null = null;
      let bestSaving = 0;

      for (const source of sources) {
        const row = costs.get(source.id) ?? [];
        const current = level.get(source.id) ?? 0;
        const next = current + 1;
        if (next >= preference.length) continue;

        const saving = (row[current] ?? 0) - (row[next] ?? 0);
        if (saving > bestSaving) {
          bestSaving = saving;
          bestId = source.id;
        }
      }

      // No downgrade left that frees anything.
      if (bestId === null || bestSaving <= 0) break;

      level.set(bestId, (level.get(bestId) ?? 0) + 1);
      total = totalAt();
    }

    const assignments: FittedAssignment[] = sources.map((source) => {
      const index = level.get(source.id) ?? 0;
      const row = costs.get(source.id) ?? [];
      return {
        id: source.id,
        tier: preference[index] ?? (preference[0] as string),
        estimatedTokens: row[index] ?? 0,
        downgraded: index > 0,
      };
    });

    const fits = total <= options.limit;
    const result: FitResult = {
      assignments,
      totalTokens: total,
      limit: options.limit,
      fits,
      downgradedIds: assignments.filter((a) => a.downgraded).map((a) => a.id),
    };
    if (!fits) result.shortfall = total - options.limit;
    return result;
  }

  /** Cache statistics, or null when caching is disabled. */
  cacheStats(): ReturnType<FileCache['stats']> | null {
    return this.cache ? this.cache.stats() : null;
  }

  private async read(absolutePath: string): Promise<string | null> {
    if (this.cache) return this.cache.read(absolutePath);
    const { readFile } = await import('node:fs/promises');
    try {
      return await readFile(absolutePath, 'utf-8');
    } catch {
      return null;
    }
  }
}

/** Convenience factory. */
export function createAssembler(options: AssemblerOptions): ContextAssembler {
  return new ContextAssembler(options);
}

// ── Selection ────────────────────────────────────────────

function selectPersona(
  raw: string,
  selection: 'full' | PersonaSelection,
): { text: string; clamped: boolean } {
  if (selection === 'full') return { text: raw.trim(), clamped: false };

  const found = extractSections(raw, selection.sections);
  if (found.length === 0) {
    // A tier that selects sections none of which exist would otherwise return
    // nothing, which silently produces an agent with no definition. Falling
    // back to the whole file is the safer failure: too much context beats an
    // agent invoked with none.
    return clampLines(raw.trim(), selection.maxLines);
  }

  const text = found.map((s) => `## ${titleCase(s.heading)}\n${s.body}`).join('\n\n');
  return clampLines(text, selection.maxLines);
}

function selectMemory(
  raw: string,
  selection: 'full' | MemorySelection,
): { text: string; clamped: boolean } {
  if (selection === 'full') return { text: raw.trim(), clamped: false };

  const { frontmatter, body } = parseFrontmatter(raw);
  const parts: string[] = [];

  for (const key of selection.frontmatterKeys ?? []) {
    const value = frontmatter[key];
    if (value) parts.push(`**${titleCase(key)}:** ${value}`);
  }

  for (const name of selection.sections ?? []) {
    const section = extractSection(body, name);
    if (section !== null) parts.push(`## ${titleCase(name)}\n${section}`);
  }

  if (parts.length === 0) {
    // Nothing matched. Return the head of the body rather than the whole file:
    // memory is the unbounded half, so a miss here must not silently restore
    // full cost to a tier the caller chose in order to avoid it.
    const fallbackLines = selection.maxLines ?? 12;
    return clampLines(body.trim(), fallbackLines);
  }

  return clampLines(parts.join('\n\n'), selection.maxLines);
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => (word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}
