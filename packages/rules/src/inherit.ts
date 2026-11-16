/**
 * ADR-0014: which ignored paths Verify inherits (read-only) and agents may not write. Pure.
 * - an ignored entry as git reports it (collapsed at the ignored directory) whose path matches an inherit glob;
 * - a LITERAL owner path (no wildcard) that exists strictly inside an ignored directory (`build/deps` under `build/`,
 *   Codex CR #4) — wildcards are only matched against the collapsed entries;
 * - never a tracked path (it would shadow the tree's version with the working directory's), nested roots merged.
 */
import { matchGlob } from './glob.ts';

export function selectInheritedRoots(entries: { path: string; dir: boolean }[], globs: string[], exists: (rel: string) => boolean): string[] {
  const picked = new Set(entries.filter(e => globs.some(g => matchGlob(g, e.path))).map(e => e.path));
  for (const g of globs) {
    if (/[*?[\]{}]/.test(g) || picked.has(g)) continue;
    if (entries.some(e => e.dir && g.startsWith(e.path + '/')) && exists(g)) picked.add(g);
  }
  const all = [...picked].sort();
  return all.filter(p => !all.some(q => q !== p && p.startsWith(q + '/')));
}
