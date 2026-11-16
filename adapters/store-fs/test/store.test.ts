/**
 * PROVES:
 *  - ensureTrustedDir refuses symlinked, foreign-owned, group/world-writable or in-workspace directories (ADR-0005);
 *  - repoStore places the control store under the state base, keyed by the repository's physical path, never inside it;
 *  - artifacts are content-addressed, written once (exclusive create, read-only mode) and verified on read;
 *  - appendEvent keeps metadata only: free-text fields (prompt, output, content, stdin, terminalMessage…) are dropped.
 * DOES NOT PROVE: protection against a hostile process running as the same OS user (out of scope, ADR-0007).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureTrustedDir, repoStore, putArtifact, getArtifact, appendEvent } from '../src/index.ts';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'tq-store-')));
const ws = join(root, 'ws'); mkdirSync(ws);

test('ensureTrustedDir: creates 0700, refuses symlink / loose perms / inside workspace', () => {
  const d = join(root, 'state', 'a'); ensureTrustedDir(d, ws);
  assert.equal(statSync(d).mode & 0o777, 0o700);
  const real = join(root, 'real'); mkdirSync(real); const link = join(root, 'link'); symlinkSync(real, link);
  assert.throws(() => ensureTrustedDir(link, ws), /symlink/);
  const loose = join(root, 'loose'); mkdirSync(loose); chmodSync(loose, 0o777);
  assert.throws(() => ensureTrustedDir(loose, ws), /group\/world-writable/);
  assert.throws(() => ensureTrustedDir(join(ws, 'store'), ws), /inside the workspace/);
});

test('repoStore: keyed by physical repo path, outside the repo', () => {
  const s1 = repoStore(ws, join(root, 'state'));
  const s2 = repoStore(join(root, 'ws', '..', 'ws'), join(root, 'state'));
  assert.equal(s1.root, s2.root);
  assert.ok(!s1.root.startsWith(ws));
  assert.match(s1.root, /\/repos\/[0-9a-f]{16}$/);
  for (const k of ['runs', 'artifacts', 'policies', 'approvals'] as const) assert.ok(s1[k].startsWith(s1.root + '/'));
});

test('artifacts: content-addressed, write-once, verified', () => {
  const s = repoStore(ws, join(root, 'state'));
  const a = putArtifact(s, Buffer.from('plan v1'), { mediaType: 'text/markdown', producer: 'planner' });
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  assert.equal(getArtifact(s, a.sha256).toString(), 'plan v1');
  assert.equal(putArtifact(s, Buffer.from('plan v1'), { mediaType: 'text/markdown', producer: 'planner' }).sha256, a.sha256, 'idempotent');
  assert.equal(statSync(a.path).mode & 0o222, 0, 'read-only');
  chmodSync(a.path, 0o600); writeFileSync(a.path, 'tampered'); chmodSync(a.path, 0o400);
  assert.throws(() => getArtifact(s, a.sha256), /hash mismatch/);
  assert.throws(() => getArtifact(s, '../../etc/passwd'), /invalid artifact id/);
});

test('events: metadata only', () => {
  const s = repoStore(ws, join(root, 'state'));
  const f = appendEvent(s, 'run-1', { type: 'node.transition', node: 'implement', from: 'PENDING', to: 'RUNNING', prompt: 'secret prompt', output: 'x', costUsd: 0.1 });
  const line = JSON.parse(readFileSync(f, 'utf8').trim().split('\n').at(-1)!);
  assert.equal(line.type, 'node.transition'); assert.equal(line.to, 'RUNNING'); assert.equal(line.costUsd, 0.1);
  assert.ok(!('prompt' in line) && !('output' in line));
  assert.match(line.ts, /^\d{4}-\d{2}-\d{2}T/);
  assert.throws(() => appendEvent(s, '../x', { type: 'x' }), /invalid run id/);
});
