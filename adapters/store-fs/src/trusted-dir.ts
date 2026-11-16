import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { sep } from 'node:path';

const inside = (child: string, parent: string) => child === parent || child.startsWith(parent + sep);

/**
 * Create (0700) or validate a directory Taskquoin trusts for control state or scratch: not a symlink, a directory,
 * owned by the current user, not group/world-writable, not inside `workspace` (ADR-0005, Codex R1.1 P1).
 * Returns its physical path.
 */
export function ensureTrustedDir(dir: string, workspace?: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new Error(`${dir} is a symlink or not a directory; refusing`);
  if ((st.mode & 0o022) !== 0) throw new Error(`${dir} is group/world-writable; refusing`);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new Error(`${dir} is not owned by the current user; refusing`);
  const real = realpathSync(dir);
  if (workspace && inside(real, realpathSync(workspace))) throw new Error(`${dir} is inside the workspace; refusing`);
  return real;
}
