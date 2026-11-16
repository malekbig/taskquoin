/**
 * Complete workspace scan (Codex R3/R4 N10): every directory except the top-level .git is walked (dependency trees
 * included), symlinks are never followed, any directory that cannot be listed makes the scan INCOMPLETE (callers fail
 * closed), symlinks whose target is outside the workspace are reported. Produces concrete paths because OS sandboxes
 * take paths, not globs.
 */
import { readdirSync, realpathSync } from 'node:fs';
import { matchGlob, SECRET_READ_GLOBS } from '@taskquoin/rules';

const INSTRUCTION_FILES = new Set(['CLAUDE.md', 'AGENTS.md']);
export interface WorkspaceScan { complete: boolean; instructionFiles: string[]; secretFiles: string[]; externalLinks: string[];
  /** Every symlink found (absolute host paths), dangling ones included. */
  links: string[];
  /** Symlinks whose NAME is a secret name (`.env -> credentials.txt`): what they point to must be masked too. */
  secretLinks: string[]; entries: number; problem?: string }

/** `includeRootGit`: scanning an inherited dependency dir, not a repository — its `.git` is ordinary content. */
export function scanWorkspace(root: string, limit = 200_000, o: { includeRootGit?: boolean } = {}): WorkspaceScan {
  const r: WorkspaceScan = { complete: true, instructionFiles: [], secretFiles: [], externalLinks: [], links: [], secretLinks: [], entries: 0 };
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let list;
    try { list = readdirSync(dir, { withFileTypes: true }); }
    catch (e) { return { ...r, complete: false, problem: `cannot list ${dir} (${(e as NodeJS.ErrnoException).code})` }; }
    for (const e of list) {
      if (++r.entries > limit) return { ...r, complete: false, problem: `more than ${limit} entries` };
      const p = `${dir}/${e.name}`; const rel = p.slice(root.length + 1);
      if (e.isSymbolicLink()) {
        r.links.push(p);
        if (SECRET_READ_GLOBS.some(g => matchGlob(g, rel))) r.secretLinks.push(p);
        try { const t = realpathSync(p); if (t !== root && !t.startsWith(root + '/')) r.externalLinks.push(p); } catch { /* dangling: nothing reachable */ }
        continue;
      }
      if (e.isDirectory()) { if (o.includeRootGit || !(dir === root && e.name === '.git')) stack.push(p); continue; }
      if (INSTRUCTION_FILES.has(e.name) && dir !== root) r.instructionFiles.push(p);
      if (SECRET_READ_GLOBS.some(g => matchGlob(g, rel))) r.secretFiles.push(p);
    }
  }
  return r;
}

