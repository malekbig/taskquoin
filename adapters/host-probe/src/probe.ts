/**
 * Host facts gathered OUTSIDE any model (doctor / preflight): absolute runtime binaries and versions, Claude Bash
 * sandbox availability (bubblewrap + socat usable), local-tool network isolation, git root. Never reads secrets.
 */
import { accessSync, constants, existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, join, isAbsolute } from 'node:path';
import { runProcess } from '@taskquoin/process-runner';
import { localToolIsolationAvailable, sandboxedToolAvailable } from '@taskquoin/local-tool';

export function findOnPath(name: string, PATH: string): string | undefined {
  for (const dir of PATH.split(delimiter)) {
    if (!dir.startsWith('/')) continue; // relative PATH entries are ignored (a repository could shadow binaries)
    const p = join(dir, name);
    try { if (statSync(p).isFile()) { accessSync(p, constants.X_OK); return realpathSync(p); } } catch { /* next */ }
  }
  return undefined;
}

export async function binaryVersion(bin: string, PATH: string, HOME: string): Promise<string | undefined> {
  const r = await runProcess({ bin, args: ['--version'], cwd: '/', env: { PATH, HOME }, timeoutMs: 15_000, maxOutputBytes: 10_000 });
  if (r.status !== 'completed') return undefined; // a failing binary has no trustworthy version (Codex R3)
  return /\b(\d+\.\d+\.\d+)\b/.exec(r.stdout)?.[1];
}

/** bubblewrap + socat present on PATH and bwrap can create an unprivileged network namespace. */
export async function bashSandboxAvailable(PATH: string): Promise<boolean> {
  const bwrap = findOnPath('bwrap', PATH); const socat = findOnPath('socat', PATH);
  if (!bwrap || !socat) return false;
  const r = await runProcess({ bin: bwrap, args: ['--ro-bind', '/', '/', '--unshare-net', '--dev', '/dev', '/bin/true'], cwd: '/', env: { PATH }, timeoutMs: 10_000, maxOutputBytes: 1000 });
  return r.status === 'completed';
}

/** Where Claude's native installer keeps every version it downloaded. */
export const claudeVersionsDir = (HOME: string) => join(HOME, '.local/share/claude/versions');

/** Same shape as `Selection` in apps/cli (an adapter never imports the app). */
type ClaudeSelection = 'auto' | 'path';

/** Why the measured file is not used: a trust check failed, its `--version` lies, or the machine chose PATH only. */
export type UntrustedReason = 'missing' | 'link' | 'not a file' | 'parent not a directory' | 'not executable' | 'not owned' | 'writable by others' | 'unreadable';
export type CandidateReason = Exclude<UntrustedReason, 'missing'> | 'version mismatch' | 'selection path';
type LstatLike = (p: string) => { isSymbolicLink(): boolean; isFile(): boolean; isDirectory(): boolean; mode: number; uid: number };

/**
 * Why a file may not be run as the measured runtime; `undefined` = trusted. lstat, never stat: a link is refused,
 * and the file and its directory must be ours and closed to group and others (nobody else can swap the binary).
 * Only a path that is not there is `missing`; any other error (permissions, a loop) is `unreadable`.
 */
export function untrustedReason(file: string, uid: number, lstat: LstatLike = lstatSync): UntrustedReason | undefined {
  try {
    const f = lstat(file);
    if (f.isSymbolicLink()) return 'link';
    if (!f.isFile()) return 'not a file';
    if ((f.mode & 0o100) === 0) return 'not executable';
    const d = lstat(dirname(file));
    if (d.isSymbolicLink()) return 'link';
    if (!d.isDirectory()) return 'parent not a directory';
    if (f.uid !== uid || d.uid !== uid) return 'not owned';
    if ((f.mode & 0o022) !== 0 || (d.mode & 0o022) !== 0) return 'writable by others';
    return undefined;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unreadable';
  }
}

export interface RuntimeProbe { bin: string; version?: string; /** The PATH binary, set only when the probe chose another one. */ installed?: { bin: string; version?: string } }
export interface HostReport {
  runtimes: { claude?: RuntimeProbe; codex?: RuntimeProbe; opencode?: RuntimeProbe };
  bashSandbox: boolean; localIsolation: boolean; node: string; git?: string; gitRoot?: string;
  /** Taskquoin's own bubblewrap profile is usable (Verify, OpenCode agents). */
  fileSandbox: boolean;
  /**
   * The measured Claude Code file of the native installer when it is there but NOT used, and why (kept even when no
   * `claude` is on the PATH, so doctor, the banner and /upgrade can say it instead of "not installed").
   */
  claudeCandidate?: { bin: string; reason: CandidateReason };
}

export async function probeHost(o: { cwd: string; PATH: string; HOME: string; claude?: { measured: string; selection: ClaudeSelection } }): Promise<HostReport> {
  const runtimes: HostReport['runtimes'] = {};
  for (const name of ['claude', 'codex', 'opencode'] as const) {
    const bin = findOnPath(name, o.PATH);
    if (bin) runtimes[name] = { bin, version: await binaryVersion(bin, o.PATH, o.HOME) };
  }
  const c = o.claude; const uid = process.getuid?.();
  let claudeCandidate: HostReport['claudeCandidate'];
  if (c && uid !== undefined && isAbsolute(o.HOME) && runtimes.claude?.version !== c.measured) {
    const cand = join(claudeVersionsDir(o.HOME), c.measured);
    const untrusted = untrustedReason(cand, uid);
    if (untrusted !== 'missing') {
      // Trust and version first: with `path`, switching to `auto` must be the remedy only when it would really help.
      const reason: CandidateReason | undefined = untrusted
        ?? (await binaryVersion(cand, o.PATH, o.HOME) !== c.measured ? 'version mismatch' : c.selection === 'path' ? 'selection path' : undefined);
      if (reason === undefined) {
        const path = runtimes.claude;
        runtimes.claude = { bin: cand, version: c.measured, ...(path ? { installed: path } : {}) };
      } else claudeCandidate = { bin: cand, reason };
    }
  }
  const git = findOnPath('git', o.PATH);
  let gitRoot: string | undefined;
  if (git) {
    const r = await runProcess({ bin: git, args: ['rev-parse', '--show-toplevel'], cwd: o.cwd, env: { PATH: o.PATH, HOME: o.HOME }, timeoutMs: 10_000, maxOutputBytes: 10_000 });
    if (r.status === 'completed') { const t = r.stdout.trim(); if (t && existsSync(t)) gitRoot = realpathSync(t); }
  }
  return { runtimes, bashSandbox: await bashSandboxAvailable(o.PATH), localIsolation: await localToolIsolationAvailable(), fileSandbox: await sandboxedToolAvailable(), node: process.execPath, git, gitRoot, ...(claudeCandidate ? { claudeCandidate } : {}) };
}
