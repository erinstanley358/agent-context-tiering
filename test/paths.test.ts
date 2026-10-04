import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { containPath, tryContainPath, PathContainmentError } from '../src/paths.js';

const ROOT = resolve('/srv/agents');

describe('containPath', () => {
  test('accepts a relative path inside the root', () => {
    assert.equal(containPath('team/researcher.md', ROOT), resolve(ROOT, 'team/researcher.md'));
  });

  test('accepts the root itself', () => {
    assert.equal(containPath('.', ROOT), ROOT);
  });

  test('refuses parent traversal', () => {
    assert.throws(() => containPath('../secrets.env', ROOT), PathContainmentError);
  });

  test('refuses traversal that re-enters by a different name', () => {
    assert.throws(() => containPath('team/../../etc/passwd', ROOT), PathContainmentError);
  });

  test('refuses an absolute path outside the root', () => {
    assert.throws(() => containPath('/etc/passwd', ROOT), PathContainmentError);
  });

  test('refuses a sibling directory sharing a name prefix', () => {
    // /srv/agents-backup must not satisfy a root of /srv/agents
    assert.throws(() => containPath(resolve('/srv/agents-backup/x.md'), ROOT), PathContainmentError);
  });

  test('normalizes an absolute path that is inside the root', () => {
    const inside = resolve(ROOT, 'a/b.md');
    assert.equal(containPath(inside, ROOT), inside);
  });

  test('error names both the request and the root', () => {
    try {
      containPath('../x', ROOT);
      assert.fail('expected a throw');
    } catch (err) {
      assert.ok(err instanceof PathContainmentError);
      assert.equal(err.root, ROOT);
      assert.match(err.message, /refused/);
    }
  });
});

describe('tryContainPath', () => {
  test('returns the resolved path when contained', () => {
    assert.equal(tryContainPath('a.md', ROOT), resolve(ROOT, 'a.md'));
  });

  test('returns null instead of throwing', () => {
    assert.equal(tryContainPath('../a.md', ROOT), null);
  });
});
