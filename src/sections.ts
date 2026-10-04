/**
 * Markdown section and frontmatter extraction.
 *
 * Context files are prose written by humans, so the parsing here is tolerant:
 * headings match case-insensitively, a heading with a parenthetical suffix
 * still matches its base name ("## Who I Am (In My Own Words)" matches
 * "who i am"), and a missing section returns null instead of throwing.
 */

/** Result of splitting a file into frontmatter and body. */
export interface ParsedFrontmatter {
  frontmatter: Record<string, string>;
  body: string;
}

const HEADING = /^(#{1,6})\s+(.*)$/;

/**
 * Extract the content under a `##`-level heading.
 *
 * Capture runs from the line after the matched heading to the line before the
 * next heading at the same or shallower depth, so a section keeps its own
 * `###` subsections. Leading and trailing blank lines are trimmed.
 *
 * @returns the section body, or null if no heading matched
 */
export function extractSection(markdown: string, headingName: string): string | null {
  const target = headingName.trim().toLowerCase();
  const lines = markdown.split('\n');
  const collected: string[] = [];
  let capturing = false;
  let captureDepth = 0;

  for (const line of lines) {
    const match = HEADING.exec(line);

    if (match) {
      const depth = (match[1] ?? '').length;
      const heading = (match[2] ?? '').trim().toLowerCase();

      if (capturing) {
        // A heading at the same or shallower depth closes the section.
        if (depth <= captureDepth) break;
        collected.push(line);
        continue;
      }

      if (headingMatches(heading, target)) {
        capturing = true;
        captureDepth = depth;
      }
      continue;
    }

    if (capturing) collected.push(line);
  }

  if (!capturing) return null;
  return trimTrailingRules(trimBlankEdges(collected)).join('\n') || null;
}

/** Matches a markdown thematic break: ---, ***, ___ (three or more). */
const THEMATIC_BREAK = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;

/**
 * Drop trailing thematic breaks from an extracted section.
 *
 * These files separate sections with `---`, so a rule at the end of a section
 * is a divider that belonged to the document, not content that belonged to the
 * section. Left in place it collides with whatever separator the caller joins
 * with and produces a doubled rule in the assembled output.
 */
function trimTrailingRules(lines: readonly string[]): string[] {
  let end = lines.length;
  while (end > 0) {
    const line = lines[end - 1] ?? '';
    if (line.trim() === '' || THEMATIC_BREAK.test(line)) {
      end--;
      continue;
    }
    break;
  }
  return lines.slice(0, end);
}

/**
 * Match a heading against a target name.
 *
 * Exact match, or the heading begins with the target followed by a separator.
 * This lets "## Standing Positions" and "## Standing Positions (2026)" both
 * answer to "standing positions" without "## Standing Position Review"
 * matching "standing position".
 */
function headingMatches(heading: string, target: string): boolean {
  if (heading === target) return true;
  if (!heading.startsWith(target)) return false;
  const next = heading.charAt(target.length);
  return next === ' ' || next === '(' || next === ':' || next === '-' || next === '—';
}

/** Extract several sections in order, skipping any that are absent. */
export function extractSections(
  markdown: string,
  headingNames: readonly string[],
): Array<{ heading: string; body: string }> {
  const out: Array<{ heading: string; body: string }> = [];
  for (const name of headingNames) {
    const body = extractSection(markdown, name);
    if (body !== null) out.push({ heading: name, body });
  }
  return out;
}

/**
 * Split optional YAML frontmatter from the body.
 *
 * Handles `key: value` pairs and block scalars introduced by `>` or `|`,
 * which is the shape these files use in practice. It is not a YAML parser and
 * does not pretend to be: nested maps and sequences are not supported. A file
 * with no frontmatter returns an empty map and the original text.
 */
export function parseFrontmatter(markdown: string): ParsedFrontmatter {
  const trimmed = markdown.replace(/^﻿/, '').trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: markdown };
  }

  const afterOpen = trimmed.slice(3);
  const closeIndex = afterOpen.indexOf('\n---');
  if (closeIndex === -1) {
    return { frontmatter: {}, body: markdown };
  }

  const block = afterOpen.slice(0, closeIndex);
  const body = afterOpen.slice(closeIndex + 4).replace(/^[^\n]*\n?/, '').trimStart();

  const frontmatter: Record<string, string> = {};
  let key = '';
  let buffer: string[] = [];
  let inBlock = false;

  const flush = (): void => {
    if (inBlock && key) frontmatter[key] = buffer.join(' ').trim();
    inBlock = false;
    buffer = [];
  };

  for (const line of block.split('\n')) {
    if (inBlock) {
      // A new top-level key ends the block scalar.
      if (/^\S/.test(line) && /^[\w][\w.-]*\s*:/.test(line)) {
        flush();
      } else {
        buffer.push(line.trim());
        continue;
      }
    }

    const match = /^([\w][\w.-]*)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;

    key = match[1] ?? '';
    const value = (match[2] ?? '').trim();

    if (value === '>' || value === '|' || value === '>-' || value === '|-') {
      inBlock = true;
      buffer = [];
    } else {
      frontmatter[key] = stripQuotes(value);
    }
  }

  flush();
  return { frontmatter, body };
}

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value.charAt(0);
    const last = value.charAt(value.length - 1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/** Drop leading and trailing blank lines. */
export function trimBlankEdges(lines: readonly string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? '').trim() === '') start++;
  while (end > start && (lines[end - 1] ?? '').trim() === '') end--;
  return lines.slice(start, end);
}

/**
 * Clamp text to a line count.
 *
 * @returns the clamped text and whether anything was dropped
 */
export function clampLines(text: string, maxLines?: number): { text: string; clamped: boolean } {
  if (maxLines === undefined || maxLines < 0) return { text, clamped: false };
  const lines = text.split('\n');
  if (lines.length <= maxLines) return { text, clamped: false };
  return { text: lines.slice(0, maxLines).join('\n'), clamped: true };
}
