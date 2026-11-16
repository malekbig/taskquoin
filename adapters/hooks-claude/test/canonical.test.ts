/**
 * PROVES: physicalPath resolves a possibly non-existent path the way the kernel would for a write:
 * symlinked directories and a symlinked final component are followed, `..` is applied AFTER resolving the
 * preceding component (so `link/..` is the link target's parent, not lexical), loops are detected.
 * DOES NOT PROVE: race-freedom (a path can change between check and use — same-user out of scope, ADR-0007).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { physicalPath } from '../src/canonical.ts';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'tq-canon-')));
mkdirSync(join(root, 'p/allowed'), { recursive: true }); mkdirSync(join(root, 'p/.claude'), { recursive: true });
mkdirSync(join(root, 'elsewhere/deep'), { recursive: true });
writeFileSync(join(root, 'p/.claude/settings.json'), '{}');
symlinkSync('../.claude/settings.json', join(root, 'p/allowed/link.json'));
symlinkSync(join(root, 'elsewhere/deep'), join(root, 'p/allowed/dirlink'));
symlinkSync('loop2', join(root, 'p/loop1')); symlinkSync('loop1', join(root, 'p/loop2'));

test('final symlink component is followed', () => {
  assert.equal(physicalPath(join(root, 'p/allowed/link.json')), join(root, 'p/.claude/settings.json'));
});

test('symlinked directory with a non-existent tail', () => {
  assert.equal(physicalPath(join(root, 'p/allowed/dirlink/new/file.txt')), join(root, 'elsewhere/deep/new/file.txt'));
});

test('.. after a symlinked directory is physical, not lexical', () => {
  // lexically p/allowed/dirlink/.. = p/allowed ; physically = elsewhere
  assert.equal(physicalPath(`${root}/p/allowed/dirlink/../x.txt`), join(root, 'elsewhere/x.txt')); // no join(): it would normalise lexically
});

test('relative input is resolved against cwd; plain paths unchanged', () => {
  assert.equal(physicalPath('allowed/a.txt', join(root, 'p')), join(root, 'p/allowed/a.txt'));
  assert.equal(physicalPath(join(root, 'p/allowed/../allowed/a.txt')), join(root, 'p/allowed/a.txt'));
});

test('symlink loops throw', () => {
  assert.throws(() => physicalPath(join(root, 'p/loop1')), /symlink loop/);
});

test('errors other than "does not exist" fail closed (no silent lexical fallback)', async () => {
  const { chmodSync, mkdirSync: md } = await import('node:fs');
  const locked = join(root, 'locked'); md(join(locked, 'inner'), { recursive: true }); chmodSync(locked, 0o000);
  try {
    if (process.getuid?.() === 0) return; // root ignores permissions
    assert.throws(() => physicalPath(join(locked, 'inner', 'x')), /cannot resolve/);
  } finally { chmodSync(locked, 0o755); }
});
