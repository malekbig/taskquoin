import { lstatSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { ensureTrustedDir } from '@taskquoin/store-fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Default trusted base for per-run scratch dirs: never inside a repository. */
export function defaultScratchBase(): string {
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'taskquoin', 'scratch');
}


/**
 * Create a per-run scratch dir under `base` (Codex R1.1 P1: never follow repository-controlled paths).
 * Refuses a symlinked base, a base not owned by the current user, or a base inside the workspace.
 */
export function createScratch(base: string, workspace: string): { dir: string; remove: () => string | undefined } {
  const realBase = ensureTrustedDir(base, workspace); // symlink / owner / permissions / inside-workspace checks
  const dir = mkdtempSync(join(base, 'run-'));
  return {
    dir,
    /** Never throws; returns a description of the problem, if any. */
    remove: () => {
      try {
        const b = lstatSync(base);
        if (b.isSymbolicLink() || realpathSync(base) !== realBase) return `scratch base ${base} changed during the run; not removing ${dir}`;
        rmSync(dir, { recursive: true, force: true });
        return undefined;
      } catch (e) { return `scratch cleanup failed: ${(e as Error).message}`; }
    },
  };
}
