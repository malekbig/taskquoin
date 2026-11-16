/**
 * Metadata fingerprints of ignored files (ADR-0014). An entry is `ino:size:mode:ctimeNs`: an unprivileged process can
 * forge mtime (`touch -d`) but not ctime, and replacing a file changes the inode. Symlinks are recorded, never
 * followed. Nothing is read: cost is one lstat per entry (~230 ms for 43k entries, measured).
 */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, type BigIntStats } from 'node:fs';
import { join } from 'node:path';

const fp = (s: BigIntStats) => `${s.ino}:${s.size}:${s.mode}:${s.ctimeNs}`;
const stat = (p: string): BigIntStats | undefined => { try { return lstatSync(p, { bigint: true }); } catch { return undefined; } };

/** Every path under `rel` (itself included) → fingerprint, depth-first, sorted; symlinks are leaves. */
function walk(root: string, rel: string, out: Record<string, string>, exclude: string[] = []): void {
  if (exclude.some(x => rel === x || rel.startsWith(x + '/'))) return;
  const s = stat(join(root, rel)); if (!s) return;
  out[rel] = fp(s);
  if (!s.isDirectory()) return;
  for (const name of readdirSync(join(root, rel)).sort()) walk(root, `${rel}/${name}`, out, exclude);
}

/** Fingerprint of each entry (files) or of everything under it (directories), keyed by repository-relative path;
 * `exclude` = sub-paths covered elsewhere (inherited roots nested in an ignored directory). */
export function fingerprintEntries(root: string, entries: { path: string; dir: boolean }[], exclude: string[] = []): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) walk(root, e.path, out, exclude);
  return out;
}

/** Dependency roots → one digest per first-level child (and the root itself): small, and names what changed. */
export function dependencyDigests(root: string, roots: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of roots) {
    const s = stat(join(root, r));
    if (!s) { out[r] = 'absent'; continue; }
    out[r] = fp(s);
    if (!s.isDirectory()) continue;
    for (const name of readdirSync(join(root, r)).sort()) {
      const all: Record<string, string> = {}; walk(root, `${r}/${name}`, all);
      out[`${r}/${name}`] = createHash('sha256').update(Object.entries(all).map(([p, f]) => `${p}\0${f}`).join('\n')).digest('hex');
    }
  }
  return out;
}
