/**
 * PROVES: the suite leaves nothing in the system temp directory. Every test file runs with its own TMPDIR
 * (tests/support/tmp-cleanup.mjs, loaded with --import by `npm test` and `npm run test:ci`), removed when the file's
 * process exits — even after a failure, even with unreadable sub-directories (258 MB of leftovers measured on
 * 2026-11-16 after a day of runs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const scripts = JSON.parse(readFileSync(root + 'package.json', 'utf8')).scripts as Record<string, string>;
// A `node --test` started from inside a test inherits NODE_TEST_CONTEXT and would run as a child (no files).
const topLevel = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT'));

test('npm test and test:ci load the temp cleanup module', () => {
  for (const s of ['test', 'test:ci']) assert.match(scripts[s], /^node --test --import \.\/tests\/support\/tmp-cleanup\.mjs /, s);
});

test('a failing test file that leaves temp dirs (even unreadable ones) leaves nothing once it has run', () => {
  const before = new Set(readdirSync(tmpdir()));
  const r = spawnSync(process.execPath, ['--test', '--import', './tests/support/tmp-cleanup.mjs', 'tests/architecture/fixtures/leaky.fixture.mjs'],
    { cwd: root, encoding: 'utf8', timeout: 60_000, env: { ...topLevel, TQ_LEAK_PREFIX: `tq-leakcheck-${process.pid}-` } });
  assert.match(r.stdout + r.stderr, /LEAKY-FIXTURE-RAN/, 'the fixture must actually run');
  assert.notEqual(r.status, 0);
  assert.deepEqual(readdirSync(tmpdir()).filter(n => !before.has(n)), []);
});
