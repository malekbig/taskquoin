import { lstatSync, readlinkSync } from 'node:fs';
import { dirname, isAbsolute, normalize } from 'node:path';

const MAX_HOPS = 40;

/**
 * Resolve `input` to the physical path a write would reach: symlinks are followed component by component (including
 * the final one), `..` applies to the already-resolved prefix (kernel semantics), a non-existent tail is appended
 * lexically. Throws on symlink loops. Never touches file contents.
 */
export function physicalPath(input: string, cwd: string = process.cwd()): string {
  return walk(isAbsolute(input) ? input : `${cwd}/${input}`, 0);
}

function walk(abs: string, hops: number): string {
  const parts = abs.split('/').filter(p => p !== '');
  let cur = '/';
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === '.') continue;
    if (part === '..') { cur = dirname(cur); continue; }
    const next = cur === '/' ? `/${part}` : `${cur}/${part}`;
    let isLink: boolean;
    try { isLink = lstatSync(next).isSymbolicLink(); }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return normalize([next, ...parts.slice(i + 1)].join('/')); // non-existent: rest is lexical
      throw new Error(`cannot resolve ${next}: ${code}`); // EACCES, ELOOP… ⇒ caller fails closed
    }
    if (isLink) {
      if (hops + 1 > MAX_HOPS) throw new Error(`symlink loop at ${next}`);
      const target = readlinkSync(next);
      const resolved = isAbsolute(target) ? target : `${cur}/${target}`;
      const rest = parts.slice(i + 1).join('/');
      return walk(rest ? `${resolved}/${rest}` : resolved, hops + 1);
    }
    cur = next;
  }
  return cur;
}
