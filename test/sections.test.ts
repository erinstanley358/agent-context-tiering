import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampLines,
  extractSection,
  extractSections,
  parseFrontmatter,
} from '../src/sections.js';

const DOC = [
  '# Title',
  '',
  '## Who I Am (In My Own Words)',
  '',
  'First line.',
  'Second line.',
  '',
  '### A subsection',
  '',
  'Belongs to Who I Am.',
  '',
  '## Standing Positions',
  '',
  '1. One.',
  '2. Two.',
  '',
  '## Standing Position Review',
  '',
  'A different section with a prefix-colliding name.',
  '',
].join('\n');

describe('extractSection', () => {
  test('matches a heading with a parenthetical suffix', () => {
    const body = extractSection(DOC, 'who i am');
    assert.ok(body);
    assert.match(body, /First line\./);
  });

  test('keeps deeper subsections inside the section', () => {
    const body = extractSection(DOC, 'who i am');
    assert.ok(body);
    assert.match(body, /### A subsection/);
    assert.match(body, /Belongs to Who I Am\./);
  });

  test('stops at the next heading of equal depth', () => {
    const body = extractSection(DOC, 'who i am');
    assert.ok(body);
    assert.doesNotMatch(body, /Standing Positions/);
  });

  test('does not match a longer heading that merely shares a prefix', () => {
    const body = extractSection(DOC, 'standing positions');
    assert.ok(body);
    assert.match(body, /1\. One\./);
    assert.doesNotMatch(body, /prefix-colliding/);
  });

  test('is case insensitive', () => {
    assert.ok(extractSection(DOC, 'STANDING POSITIONS'));
  });

  test('returns null for an absent section', () => {
    assert.equal(extractSection(DOC, 'nonexistent'), null);
  });

  test('trims blank edges', () => {
    const body = extractSection(DOC, 'standing positions');
    assert.ok(body);
    assert.equal(body, body.trim());
  });

  test('drops a trailing thematic break that belonged to the document', () => {
    const doc = '## S\n\ncontent line\n\n---\n\n## Next\n\nother\n';
    const body = extractSection(doc, 's');
    assert.equal(body, 'content line');
  });

  test('drops trailing breaks written with asterisks or underscores', () => {
    assert.equal(extractSection('## S\n\nx\n\n***\n', 's'), 'x');
    assert.equal(extractSection('## S\n\nx\n\n___\n', 's'), 'x');
  });

  test('keeps a thematic break that sits between content', () => {
    const body = extractSection('## S\n\nfirst\n\n---\n\nsecond\n', 's');
    assert.ok(body);
    assert.match(body, /first/);
    assert.match(body, /---/);
    assert.match(body, /second/);
  });

  test('does not mistake a setext underline for a break', () => {
    // "--" is only two characters, below the thematic-break threshold.
    const body = extractSection('## S\n\nkeep\n--\n', 's');
    assert.ok(body);
    assert.match(body, /--/);
  });
});

describe('extractSections', () => {
  test('returns matches in requested order and skips absent ones', () => {
    const found = extractSections(DOC, ['standing positions', 'nope', 'who i am']);
    assert.equal(found.length, 2);
    assert.equal(found[0]?.heading, 'standing positions');
    assert.equal(found[1]?.heading, 'who i am');
  });
});

describe('parseFrontmatter', () => {
  test('parses simple key-value pairs', () => {
    const { frontmatter, body } = parseFrontmatter('---\nid: x\nn: 3\n---\n# Body\n');
    assert.equal(frontmatter.id, 'x');
    assert.equal(frontmatter.n, '3');
    assert.match(body, /^# Body/);
  });

  test('parses a folded block scalar into one line', () => {
    const raw = ['---', 'summary: >', '  line one', '  line two', 'id: y', '---', 'body'].join('\n');
    const { frontmatter } = parseFrontmatter(raw);
    assert.equal(frontmatter.summary, 'line one line two');
    assert.equal(frontmatter.id, 'y');
  });

  test('strips surrounding quotes', () => {
    const { frontmatter } = parseFrontmatter('---\na: "quoted"\nb: \'single\'\n---\n');
    assert.equal(frontmatter.a, 'quoted');
    assert.equal(frontmatter.b, 'single');
  });

  test('returns the original text when there is no frontmatter', () => {
    const input = '# Just a document\n';
    const { frontmatter, body } = parseFrontmatter(input);
    assert.deepEqual(frontmatter, {});
    assert.equal(body, input);
  });

  test('returns the original text when frontmatter is unterminated', () => {
    const input = '---\nid: x\nno closing fence\n';
    const { frontmatter, body } = parseFrontmatter(input);
    assert.deepEqual(frontmatter, {});
    assert.equal(body, input);
  });

  test('does not treat a horizontal rule in the body as frontmatter', () => {
    const { frontmatter } = parseFrontmatter('# Title\n\n---\n\nmore\n');
    assert.deepEqual(frontmatter, {});
  });
});

describe('clampLines', () => {
  test('reports no clamp when under the limit', () => {
    const result = clampLines('a\nb', 5);
    assert.equal(result.clamped, false);
    assert.equal(result.text, 'a\nb');
  });

  test('clamps and reports when over the limit', () => {
    const result = clampLines('a\nb\nc\nd', 2);
    assert.equal(result.clamped, true);
    assert.equal(result.text, 'a\nb');
  });

  test('passes text through when no limit is given', () => {
    const result = clampLines('a\nb\nc');
    assert.equal(result.clamped, false);
    assert.equal(result.text, 'a\nb\nc');
  });
});
