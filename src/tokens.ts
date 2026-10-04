/**
 * Default characters-per-token ratio.
 *
 * Roughly right for English prose across current BPE tokenizers. It is an
 * estimate for budgeting, not an accounting figure: use it to decide what to
 * load, not to reconcile a bill.
 */
export const DEFAULT_CHARS_PER_TOKEN = 3.5;

/**
 * Estimate the token count of a string.
 *
 * Deliberately dependency-free and synchronous. If you need exact counts,
 * swap in a real tokenizer at the call site; the point of this function is
 * that it is cheap enough to run across every agent before loading any.
 */
export function estimateTokens(
  text: string,
  charsPerToken: number = DEFAULT_CHARS_PER_TOKEN,
): number {
  if (charsPerToken <= 0) {
    throw new RangeError(`charsPerToken must be greater than 0, received ${charsPerToken}`);
  }
  if (text.length === 0) return 0;
  return Math.ceil(text.length / charsPerToken);
}
