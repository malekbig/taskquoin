/**
 * PROVES: matchGlob implements the subset used by Taskquoin policies — `**` (any number of segments, incl. zero),
 * `*` (within one segment, not `/`), `?` (one char), literal dots — anchored to the whole relative path.
 * DOES NOT PROVE: parity with Claude Code's own matcher (rules and runtime are checked independently).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchGlob } from '../src/glob.ts';

test('** spans segments, including zero', () => {
  assert.ok(matchGlob('src/**', 'src/a/b.ts'));
  assert.ok(matchGlob('src/**', 'src/a.ts'));
  assert.ok(matchGlob('**/CLAUDE.md', 'CLAUDE.md'));
  assert.ok(matchGlob('**/CLAUDE.md', 'pkg/x/CLAUDE.md'));
  assert.ok(matchGlob('**', 'anything/at/all'));
  assert.ok(!matchGlob('src/**', 'srcx/a.ts'));
  assert.ok(!matchGlob('src/**', 'lib/src/a.ts'));
});

test('* stays inside a segment; ? is one char; dots are literal', () => {
  assert.ok(matchGlob('*.md', 'README.md'));
  assert.ok(!matchGlob('*.md', 'docs/README.md'));
  assert.ok(matchGlob('.env.*', '.env.local'));
  assert.ok(!matchGlob('.env.*', '.envXlocal'));
  assert.ok(matchGlob('a?c', 'abc') && !matchGlob('a?c', 'a/c'));
});

test('./ prefix is ignored on both sides; regex metacharacters are literal', () => {
  assert.ok(matchGlob('./src/**', 'src/x'));
  assert.ok(matchGlob('src/**', './src/x'));
  assert.ok(matchGlob('a+b(c).txt', 'a+b(c).txt'));
  assert.ok(!matchGlob('a+b.txt', 'aab.txt'));
});

test('a newline in a path never defeats a pattern (Codex CR4: secret, protected and test globs)', () => {
  assert.equal(matchGlob('**/.env', 'build/line\nbreak/deps/.env'), true);
  assert.equal(matchGlob('**/AGENTS.md', 'pkg\nx/AGENTS.md'), true);
  assert.equal(matchGlob('.github/**', '.github/workflows/a\nb.yml'), true);
  assert.equal(matchGlob('**', 'a\nb'), true);
  assert.equal(matchGlob('**/*.test.*', 'src\nx/a.test.js'), true);
  assert.equal(matchGlob('*.md', 'a\nb.md'), true, '* spans a newline inside a segment');
  assert.equal(matchGlob('*.md', 'a/b.md'), false, '* still stops at /');
  assert.equal(matchGlob('.env', '.env\n'), false, 'anchored: a trailing newline is part of the name');
});
