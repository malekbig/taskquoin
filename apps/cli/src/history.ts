/**
 * Per-repository console history (↑/↓): `<repo store>/console-history`, mode 0600, the last 500 lines.
 * Only `/` commands are ever kept: a name typed at the approval name prompt, a retyped hash and free text never are.
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoStore } from '@taskquoin/store-fs';

const MAX = 500;
const CONTROL = /[\x00-\x1f\x7f]/;
const keep = (l: string) => l.startsWith('/') && !CONTROL.test(l);
const fileOf = (store: RepoStore) => join(store.root, 'console-history');

/** Oldest first. A missing or unreadable file is an empty history. */
export function loadHistory(store: RepoStore): string[] {
  try { return existsSync(fileOf(store)) ? readFileSync(fileOf(store), 'utf8').split('\n').filter(keep).slice(-MAX) : []; } catch { return []; }
}

export function appendHistory(store: RepoStore, line: string): void {
  const l = line.trim();
  if (!keep(l)) return;
  try {
    const f = fileOf(store);
    writeFileSync(f, [...loadHistory(store), l].slice(-MAX).join('\n') + '\n', { mode: 0o600 });
    chmodSync(f, 0o600);
  } catch { /* history is a convenience: never breaks the console */ }
}

/** readline records every line it reads (the newest first) before emitting it: take back what is not a command. */
export function scrubReadlineHistory(rl: { history?: string[] }, line: string): void {
  if (!keep(line.trim()) && rl.history?.[0] === line) rl.history.shift();
}
