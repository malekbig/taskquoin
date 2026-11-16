/**
 * PROVES (real filesystem): the ADR-0014 fingerprint detects a content change even when mtime is forged back
 * (ctime), a replaced file (inode), new and deleted entries; it is stable when nothing changes; it never follows
 * symlinks (an outside directory linked inside is not walked); dependency digests are per first-level child.
 * DOES NOT PROVE: protection against a privileged process (root can set ctime via the clock).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dependencyDigests, fingerprintEntries } from '../src/index.ts';

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), 'tq-fp-')));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

test('fingerprintEntries: forged mtime, replaced file, new and deleted entries are all visible; stable otherwise', async () => {
  const root = fresh(); mkdirSync(join(root, 'dist')); writeFileSync(join(root, 'dist', 'a.js'), 'a'); writeFileSync(join(root, '.env'), 's');
  const entries = [{ path: 'dist', dir: true }, { path: '.env', dir: false }];
  const a = fingerprintEntries(root, entries);
  assert.deepEqual(Object.keys(a).sort(), ['.env', 'dist', 'dist/a.js']);
  assert.deepEqual(fingerprintEntries(root, entries), a, 'stable');
  await sleep(20); writeFileSync(join(root, 'dist', 'a.js'), 'b'); utimesSync(join(root, 'dist', 'a.js'), new Date('2020-01-01'), new Date('2020-01-01'));
  const b = fingerprintEntries(root, entries);
  assert.notEqual(b['dist/a.js'], a['dist/a.js'], 'content change seen through ctime despite the forged mtime');
  writeFileSync(join(root, 'tmp'), 'b'); renameSync(join(root, 'tmp'), join(root, '.env'));
  assert.notEqual(fingerprintEntries(root, entries)['.env'], a['.env'], 'replaced file (new inode)');
  writeFileSync(join(root, 'dist', 'new.js'), 'n'); rmSync(join(root, 'dist', 'a.js'));
  const c = fingerprintEntries(root, entries);
  assert.ok('dist/new.js' in c); assert.ok(!('dist/a.js' in c));
});

test('dependencyDigests: one digest per first-level child; symlinks never followed', async () => {
  const root = fresh(); const outside = fresh(); writeFileSync(join(outside, 'x.js'), 'outside');
  mkdirSync(join(root, 'node_modules', 'yaml'), { recursive: true }); mkdirSync(join(root, 'node_modules', '@s', 'p'), { recursive: true });
  writeFileSync(join(root, 'node_modules', 'yaml', 'index.js'), 'y'); writeFileSync(join(root, 'node_modules', '@s', 'p', 'i.js'), 'p');
  symlinkSync(outside, join(root, 'node_modules', 'linked'));
  const a = dependencyDigests(root, ['node_modules']);
  assert.deepEqual(Object.keys(a).sort(), ['node_modules', 'node_modules/@s', 'node_modules/linked', 'node_modules/yaml']);
  await sleep(20); writeFileSync(join(outside, 'x.js'), 'changed outside');
  assert.deepEqual(dependencyDigests(root, ['node_modules']), a, 'the linked outside directory is not walked');
  writeFileSync(join(root, 'node_modules', 'yaml', 'index.js'), 'tampered');
  const b = dependencyDigests(root, ['node_modules']);
  assert.notEqual(b['node_modules/yaml'], a['node_modules/yaml']); assert.equal(b['node_modules/@s'], a['node_modules/@s']);
  assert.deepEqual(dependencyDigests(root, ['missing']), { missing: 'absent' });
});

test('fingerprintEntries can exclude inherited sub-roots (they are covered by the dependency digests)', () => {
  const root = fresh(); mkdirSync(join(root, 'build', 'deps'), { recursive: true }); writeFileSync(join(root, 'build', 'deps', 'd.js'), 'd'); writeFileSync(join(root, 'build', 'out.js'), 'o');
  assert.deepEqual(Object.keys(fingerprintEntries(root, [{ path: 'build', dir: true }], ['build/deps'])).sort(), ['build', 'build/out.js']);
});
