import { resolve, sep } from 'node:path';

/**
 * Thrown when a requested path escapes the assembler's declared root.
 */
export class PathContainmentError extends Error {
  readonly requested: string;
  readonly root: string;

  constructor(requested: string, root: string) {
    super(
      `Path escapes the configured root and was refused.\n`
      + `  requested: ${requested}\n`
      + `  root:      ${root}\n`
      + 'Pass a root that contains every file you intend the assembler to read.',
    );
    this.name = 'PathContainmentError';
    this.requested = requested;
    this.root = root;
  }
}

/**
 * Resolve `candidate` and confirm it sits inside `root`.
 *
 * Context files are named by callers, and callers are sometimes handed names
 * by something less trustworthy than themselves. An assembler that will read
 * any path it is given is a file-disclosure primitive. This one will not:
 * every read resolves against a declared root and is refused if it lands
 * outside, including via `..` traversal or an absolute path.
 *
 * `root` itself is accepted; a sibling directory sharing a name prefix is not
 * (`/srv/agents-backup` does not satisfy a root of `/srv/agents`).
 *
 * @throws {PathContainmentError} when the resolved path is outside `root`
 */
export function containPath(candidate: string, root: string): string {
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, candidate);

  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + sep)) {
    throw new PathContainmentError(candidate, resolvedRoot);
  }

  return resolved;
}

/** Non-throwing variant. Returns null instead of raising. */
export function tryContainPath(candidate: string, root: string): string | null {
  try {
    return containPath(candidate, root);
  } catch {
    return null;
  }
}
