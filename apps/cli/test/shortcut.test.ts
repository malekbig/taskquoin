/**
 * PROVES (temp HOME): the `taskquoin` shortcut is a symlink ~/.local/bin/taskquoin → the repo launcher, created
 * automatically and idempotently; a file Taskquoin did not create is never overwritten; when ~/.local/bin is not on
 * PATH a marked ~/.bashrc block is added once; `setup --remove` removes only what Taskquoin created and records the
 * opt-out (the automatic setup never comes back).
 * DOES NOT PROVE: what an interactive shell does with PATH (login shells read ~/.profile).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setLanguage } from '../src/i18n/index.ts';
import { installShortcut, removeShortcut } from '../src/shortcut.ts';

function env(onPath = true) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'tq-home-')));
  const launcher = join(home, 'taskquoin', 'bin', 'taskquoin'); mkdirSync(join(home, 'taskquoin', 'bin'), { recursive: true }); writeFileSync(launcher, '#!/bin/sh\n');
  writeFileSync(join(home, '.bashrc'), '# user stuff\nalias ll="ls -l"\n');
  return { home, launcher, pathEnv: onPath ? `/usr/bin:${join(home, '.local', 'bin')}` : '/usr/bin', stateDir: join(home, '.local', 'state', 'taskquoin') };
}
const link = (h: string) => join(h, '.local', 'bin', 'taskquoin');

test('automatic install: a symlink to the launcher, idempotent; nothing added to ~/.bashrc when ~/.local/bin is on PATH', () => {
  const e = env();
  const r = installShortcut(e, { auto: true });
  assert.equal(r.status, 'installed'); assert.equal(r.pathAdded, false);
  assert.ok(lstatSync(link(e.home)).isSymbolicLink()); assert.equal(readlinkSync(link(e.home)), e.launcher);
  assert.equal(installShortcut(e, { auto: true }).status, 'already');
  assert.equal(readFileSync(join(e.home, '.bashrc'), 'utf8'), '# user stuff\nalias ll="ls -l"\n', '~/.bashrc untouched');
});

test('a file Taskquoin did not create is never overwritten', () => {
  const e = env(); mkdirSync(join(e.home, '.local', 'bin'), { recursive: true }); writeFileSync(link(e.home), 'someone else');
  const r = installShortcut(e, { auto: false });
  assert.equal(r.status, 'conflict'); assert.match(r.message, /is not Taskquoin's: left untouched/);
  assert.equal(readFileSync(link(e.home), 'utf8'), 'someone else');
  try { setLanguage('fr'); assert.match(installShortcut(e, { auto: false }).message, /pas celui de Taskquoin/); } finally { setLanguage('en'); }
});

test('~/.local/bin not on PATH: one marked ~/.bashrc block, added once, removed by setup --remove', () => {
  const e = env(false);
  assert.equal(installShortcut(e, { auto: true }).pathAdded, true);
  installShortcut(e, { auto: true });
  const rc = readFileSync(join(e.home, '.bashrc'), 'utf8');
  assert.equal(rc.match(/# >>> taskquoin >>>/g)?.length, 1, 'added once');
  assert.match(rc, /export PATH="\$HOME\/\.local\/bin:\$PATH"/);
  const r = removeShortcut(e);
  assert.equal(r.removed, true); assert.equal(existsSync(link(e.home)), false);
  assert.equal(readFileSync(join(e.home, '.bashrc'), 'utf8'), '# user stuff\nalias ll="ls -l"\n', 'block removed, the rest untouched');
});

test('setup --remove is remembered: the automatic setup does not come back, an explicit setup does', () => {
  const e = env(); installShortcut(e, { auto: true }); removeShortcut(e);
  assert.equal(installShortcut(e, { auto: true }).status, 'opted-out'); assert.equal(existsSync(link(e.home)), false);
  assert.equal(installShortcut(e, { auto: false }).status, 'installed', 'taskquoin setup reinstalls on purpose');
  const other = env(); mkdirSync(join(other.home, '.local', 'bin'), { recursive: true }); writeFileSync(link(other.home), 'x');
  assert.equal(removeShortcut(other).removed, false, 'never removes a file that is not ours');
  assert.equal(readFileSync(link(other.home), 'utf8'), 'x');
});
