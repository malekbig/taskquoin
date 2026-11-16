/**
 * PROVES: CI runs exactly the files `npm test` runs (only the reporters differ), and every failed test becomes a
 * GitHub error annotation naming the test and its message — readable through the public checks API, without the
 * job log (which GitHub only shows to the repository's admins).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scripts = JSON.parse(readFileSync(root + 'package.json', 'utf8')).scripts as Record<string, string>;
// A `node --test` started from inside a test inherits NODE_TEST_CONTEXT and would run as a child (no reporters, no files).
const topLevel = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));
const globs = (cmd: string) => [...cmd.matchAll(/'([^']+)'/g)].map(m => m[1]);

test('test:ci runs the same test files as `npm test`, with the GitHub annotations reporter', () => {
  assert.ok(scripts['test:ci'], 'package.json has no test:ci script');
  assert.deepEqual(globs(scripts['test:ci']), globs(scripts.test));
  assert.match(scripts['test:ci'], /--experimental-test-module-mocks/);
  assert.match(scripts['test:ci'], /--test-reporter=\.\/\.github\/node-test-annotations\.mjs --test-reporter-destination=stdout/);
});

test('the annotations reporter turns a failed test (not its suite) into one escaped ::error line', () => {
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=./.github/node-test-annotations.mjs', '--test-reporter-destination=stdout',
    'tests/architecture/fixtures/failing.fixture.mjs'], { cwd: root, encoding: 'utf8', timeout: 60_000, env: topLevel });
  const lines = r.stdout.split('\n').filter(l => l.startsWith('::error'));
  assert.equal(lines.length, 1, r.stdout + r.stderr);
  assert.match(lines[0], /^::error file=tests\/architecture\/fixtures\/failing\.fixture\.mjs,line=6,title=Scénario%3A le lanceur%2C avec%3A deux-points::command failed:%0A%0Aexec: node: not found/);
});
