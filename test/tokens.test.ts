import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, DEFAULT_CHARS_PER_TOKEN } from '../src/tokens.js';

describe('estimateTokens', () => {
  test('returns 0 for empty input', () => {
    assert.equal(estimateTokens(''), 0);
  });

  test('rounds up a partial token', () => {
    // 4 chars at 3.5 chars/token is 1.14 tokens, which must not round to 1.
    assert.equal(estimateTokens('abcd'), 2);
  });

  test('scales with the configured ratio', () => {
    assert.equal(estimateTokens('a'.repeat(100), 4), 25);
    assert.equal(estimateTokens('a'.repeat(100), 2), 50);
  });

  test('uses the documented default', () => {
    assert.equal(estimateTokens('a'.repeat(35)), Math.ceil(35 / DEFAULT_CHARS_PER_TOKEN));
  });

  test('rejects a non-positive ratio', () => {
    assert.throws(() => estimateTokens('abc', 0), RangeError);
    assert.throws(() => estimateTokens('abc', -1), RangeError);
  });

  test('is monotonic in input length', () => {
    assert.ok(estimateTokens('a'.repeat(1000)) > estimateTokens('a'.repeat(100)));
  });
});
