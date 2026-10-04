import { readFile, stat } from 'node:fs/promises';

interface CacheEntry {
  content: string;
  mtimeMs: number;
  cachedAt: number;
}

export interface FileCacheOptions {
  /** Maximum entries retained before least-recently-used eviction. */
  maxEntries?: number;
  /** Time-to-live in milliseconds. */
  ttlMs?: number;
}

/**
 * An LRU file cache keyed by absolute path, invalidated on mtime change.
 *
 * Context files are read repeatedly within a single fan-out and edited between
 * runs, so a time-only cache serves stale text and no cache re-reads the same
 * file once per agent. This checks mtime on hit: a file edited on disk is
 * re-read on the next access even inside the TTL.
 *
 * It caches absence as a miss, not as a null entry. A file that appears later
 * is picked up without a manual invalidation.
 */
export class FileCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private hits = 0;
  private misses = 0;

  constructor(options: FileCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? 200;
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  }

  /** Read a file, serving a fresh cache entry when one exists. */
  async read(absolutePath: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.entries.get(absolutePath);

    if (cached) {
      const expired = now - cached.cachedAt > this.ttlMs;
      if (!expired) {
        const mtimeMs = await this.mtime(absolutePath);
        if (mtimeMs !== null && mtimeMs === cached.mtimeMs) {
          // Refresh recency.
          this.entries.delete(absolutePath);
          this.entries.set(absolutePath, cached);
          this.hits++;
          return cached.content;
        }
      }
      this.entries.delete(absolutePath);
    }

    this.misses++;
    let content: string;
    try {
      content = await readFile(absolutePath, 'utf-8');
    } catch {
      return null;
    }

    const mtimeMs = await this.mtime(absolutePath);
    if (mtimeMs !== null) {
      if (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.keys().next();
        if (!oldest.done) this.entries.delete(oldest.value);
      }
      this.entries.set(absolutePath, { content, mtimeMs, cachedAt: Date.now() });
    }

    return content;
  }

  private async mtime(absolutePath: string): Promise<number | null> {
    try {
      return (await stat(absolutePath)).mtimeMs;
    } catch {
      return null;
    }
  }

  invalidate(absolutePath: string): void {
    this.entries.delete(absolutePath);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Cache effectiveness, useful when tuning a fan-out. */
  stats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.entries.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
    };
  }
}
