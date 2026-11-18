/**
 * The `taskquoin` shortcut (owner's request: "l'alias doit se faire automatiquement"). A user-level symlink
 * ~/.local/bin/taskquoin → this repository's launcher — no sudo, no global install, works in every shell and script.
 * Never overwrites a file Taskquoin did not create; if ~/.local/bin is not on PATH, adds ONE marked block to ~/.bashrc.
 * `taskquoin setup --remove` removes exactly what was created and records the opt-out (the automatic setup stops).
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { t } from './i18n/index.ts';

export interface ShortcutEnv { home: string; launcher: string; pathEnv: string; stateDir: string }
export interface ShortcutResult { status: 'installed' | 'already' | 'conflict' | 'opted-out'; link: string; pathAdded: boolean; message: string }
interface MachineManifest { shortcut?: string; launcher?: string; bashrcBlock?: boolean; optedOut?: boolean }

const BEGIN = '# >>> taskquoin >>>', END = '# <<< taskquoin <<<';
const BLOCK = `${BEGIN}\n# added by Taskquoin so that ~/.local/bin/taskquoin is found — removed by: taskquoin setup --remove\nexport PATH="$HOME/.local/bin:$PATH"\n${END}\n`;
const linkOf = (e: ShortcutEnv) => join(e.home, '.local', 'bin', 'taskquoin');
const manifestOf = (e: ShortcutEnv) => join(e.stateDir, 'machine.json');
const read = (e: ShortcutEnv): MachineManifest => { try { return JSON.parse(readFileSync(manifestOf(e), 'utf8')); } catch { return {}; } };
const write = (e: ShortcutEnv, m: MachineManifest) => { mkdirSync(e.stateDir, { recursive: true, mode: 0o700 }); writeFileSync(manifestOf(e), JSON.stringify(m, null, 2) + '\n', { mode: 0o600 }); };
const ours = (e: ShortcutEnv) => { try { return lstatSync(linkOf(e)).isSymbolicLink() && readlinkSync(linkOf(e)) === e.launcher; } catch { return false; } };

/** `auto`: the silent first-run setup — it respects a previous `setup --remove`. */
export function installShortcut(e: ShortcutEnv, o: { auto: boolean }): ShortcutResult {
  const link = linkOf(e); const m = read(e);
  if (o.auto && m.optedOut) return { status: 'opted-out', link, pathAdded: false, message: t('shortcut.optedOut') };
  if (ours(e)) return { status: 'already', link, pathAdded: false, message: t('shortcut.already', { link }) };
  let exists = false; try { lstatSync(link); exists = true; } catch { /* free */ }
  if (exists) return { status: 'conflict', link, pathAdded: false, message: t('shortcut.conflict', { link }) };
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(e.launcher, link);
  const binDir = dirname(link);
  let pathAdded = false;
  if (!e.pathEnv.split(':').includes(binDir)) {
    const rc = join(e.home, '.bashrc'); const cur = existsSync(rc) ? readFileSync(rc, 'utf8') : '';
    if (!cur.includes(BEGIN)) { writeFileSync(rc, cur + (cur && !cur.endsWith('\n') ? '\n' : '') + BLOCK); pathAdded = true; }
  }
  write(e, { shortcut: link, launcher: e.launcher, bashrcBlock: pathAdded || !!m.bashrcBlock, optedOut: false });
  return { status: 'installed', link, pathAdded,
    message: t('shortcut.installed', { link, path: pathAdded ? t('shortcut.pathAdded') : '' }) };
}

export function removeShortcut(e: ShortcutEnv): { removed: boolean; message: string } {
  const m = read(e); let removed = false; const notes: string[] = [];
  if (ours(e)) { unlinkSync(linkOf(e)); removed = true; notes.push(t('shortcut.linkRemoved', { link: linkOf(e) })); }
  else if (existsSync(linkOf(e))) notes.push(t('shortcut.notOurs', { link: linkOf(e) }));
  const rc = join(e.home, '.bashrc');
  if (m.bashrcBlock && existsSync(rc)) {
    const cur = readFileSync(rc, 'utf8'); const i = cur.indexOf(BEGIN), j = cur.indexOf(END);
    if (i >= 0 && j > i) { writeFileSync(rc, cur.slice(0, i) + cur.slice(j + END.length).replace(/^\n/, '')); notes.push(t('shortcut.blockRemoved')); }
  }
  write(e, { optedOut: true });
  return { removed, message: notes.join(t('shortcut.sep')) || t('shortcut.nothing') };
}
