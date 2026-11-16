/**
 * PROVES: scanWorkspace is complete or says it is not (Codex R4 N10): unreadable directories make it INCOMPLETE (never
 * silently skipped), symlinks pointing outside the workspace are reported, secret and nested instruction files found
 * everywhere except .git, entry limit enforced.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanWorkspace } from '../src/index.ts';

test('finds secrets and nested instructions; reports external symlinks; entry limit', () => {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'tq-scan2-'))); const out = realpathSync(mkdtempSync(join(tmpdir(), 'tq-out-')));
  mkdirSync(join(ws, 'a/b'), { recursive: true }); mkdirSync(join(ws, '.git'));
  writeFileSync(join(ws, 'a/b/AGENTS.md'), 'x'); writeFileSync(join(ws, 'a/.env.local'), 'x'); writeFileSync(join(ws, '.git/AGENTS.md'), 'x');
  symlinkSync(out, join(ws, 'linked'));
  const s = scanWorkspace(ws);
  assert.equal(s.complete, true);
  assert.deepEqual(s.instructionFiles, [join(ws, 'a/b/AGENTS.md')]);
  assert.deepEqual(s.secretFiles, [join(ws, 'a/.env.local')]);
  assert.deepEqual(s.externalLinks, [join(ws, 'linked')]);
  assert.equal(scanWorkspace(ws, 2).complete, false);
});

test('an unreadable directory makes the scan incomplete', () => {
  if (process.getuid?.() === 0) return;
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'tq-scan3-'))); mkdirSync(join(ws, 'locked'));
  chmodSync(join(ws, 'locked'), 0o311); // traversable, not listable
  try {
    const s = scanWorkspace(ws);
    assert.equal(s.complete, false); assert.match(s.problem ?? '', /locked/);
  } finally { chmodSync(join(ws, 'locked'), 0o755); }
});

test('secret-named symlinks are reported (their target must be masked); inherited dirs can be scanned INCLUDING their .git (Codex CR2 #3)', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tq-scan-sec-')));
  writeFileSync(join(root, 'credentials.txt'), 'S'); symlinkSync('credentials.txt', join(root, '.env'));
  mkdirSync(join(root, '.git')); writeFileSync(join(root, '.git', '.env'), 'G');
  const repoScan = scanWorkspace(root);
  assert.deepEqual(repoScan.secretLinks, [join(root, '.env')]);
  assert.ok(!repoScan.secretFiles.includes(join(root, '.git', '.env')), 'a repository scan skips its own .git');
  const depScan = scanWorkspace(root, 200_000, { includeRootGit: true });
  assert.ok(depScan.secretFiles.includes(join(root, '.git', '.env')), 'an inherited dir is not a repository: its .git is scanned');
});
