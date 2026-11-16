/**
 * Run a repository-controlled command (e.g. the project's test suite during Verify) under bubblewrap:
 * whole filesystem read-only, ONE writable root (the repository), private /tmp, no network, HOME credential and
 * agent-state directories masked. Refuses if bubblewrap is unavailable (fail closed, ADR-0010).
 */
import { existsSync, lstatSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { HOME_SECRET_GLOBS } from '@taskquoin/rules';
import { runProcess, type ProcessRequest, type ProcessResult } from '@taskquoin/process-runner';

const BWRAP = ['/usr/bin/bwrap', '/bin/bwrap'].find(p => existsSync(p));
/** Agent and memory state are as sensitive as credentials (transcripts, memories, approvals). */
const EXTRA_HOME_MASKS = ['.claude', '.codex', '.claude-mem', '.gnupg', '.local/state/taskquoin', '.config/gh'];

export async function sandboxedToolAvailable(): Promise<boolean> {
  if (!BWRAP || process.platform !== 'linux') return false;
  const r = await runProcess({ bin: BWRAP, args: ['--ro-bind', '/', '/', '--unshare-net', '--dev', '/dev', '/bin/true'], cwd: '/', env: {}, timeoutMs: 10_000, maxOutputBytes: 1000 });
  return r.status === 'completed';
}

/** Service socket directories: a read-only bind does NOT prevent connect() on a Unix socket (Codex R3). */
export function defaultMaskDirs(): string[] {
  const c = ['/run', '/var/run', process.env.XDG_RUNTIME_DIR].filter((x): x is string => !!x && existsSync(x)).map(x => realpathSync(x));
  return [...new Set(c)];
}

export interface SandboxProfile {
  writableRoot: string; home: string;
  /** Extra directories replaced by an empty tmpfs (default: /run, /var/run, $XDG_RUNTIME_DIR). */
  maskDirs?: string[];
  /** Paths re-mounted read-only inside the writable root (e.g. <repo>/.git — Codex R4 N1). */
  readOnly?: string[];
  /** Files replaced by /dev/null (e.g. project secret files found by the scan). */
  hideFiles?: string[];
  /** Replace the whole HOME with an empty tmpfs (the writable root stays mounted even if it lives under HOME). */
  hideHome?: boolean;
  /**
   * Clean room (ADR-0014): mount `writableRoot` at this path instead of its own, hiding what is really there (the
   * working directory). `readOnly` sources are still host paths, so the real `.git` and inherited dependency
   * directories can be bound back over the room. Masks are decided on this visible path, not on the source.
   */
  mountAt?: string;
}

export function bwrapArgs(o: SandboxProfile & { cwd: string }): string[] {
  // Own PID namespace + --die-with-parent: every descendant (even setsid()) dies with the sandbox (Codex R4 N6).
  const a = ['--die-with-parent', '--unshare-net', '--unshare-ipc', '--unshare-uts', '--unshare-pid', '--new-session',
    '--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp'];
  if (o.hideHome && existsSync(o.home)) a.push('--tmpfs', realpathSync(o.home));
  const visible = o.mountAt ?? o.writableRoot;
  a.push('--bind', o.writableRoot, visible);
  for (const p of o.readOnly ?? []) if (existsSync(p)) a.push('--ro-bind', p, p);
  const masks = o.hideHome ? [] : [...new Set([...HOME_SECRET_GLOBS.map(g => g.replace(/\/\*\*$/, '')), ...EXTRA_HOME_MASKS])];
  for (const rel of masks) {
    let p = join(o.home, rel);
    if (!existsSync(p)) continue;
    // bubblewrap cannot mount over a symlink (WSL: ~/.aws → /mnt/c/…): mask its real target instead.
    if (lstatSync(p).isSymbolicLink()) {
      p = realpathSync(p);
      if (p === '/tmp' || p.startsWith('/tmp/')) continue; // target already hidden by the private /tmp
    }
    if (p === visible || visible.startsWith(p + '/')) continue;
    if (statSync(p).isDirectory()) a.push('--tmpfs', p); else a.push('--ro-bind', '/dev/null', p);
  }
  for (const d of o.maskDirs ?? defaultMaskDirs()) {
    if (d === visible || visible.startsWith(d + '/') || !existsSync(d)) continue;
    a.push('--tmpfs', d);
  }
  // hideFiles are VISIBLE paths: under the clean-room mount (and not under a read-only bind from the host) the file
  // lives in the room, so that is where its existence is checked (Codex CR3 #1).
  const under = (f: string, d: string) => f === d || f.startsWith(d + '/');
  const hostOf = (f: string) => (o.mountAt && under(f, visible) && !(o.readOnly ?? []).some(ro => under(f, ro)) ? join(o.writableRoot, f.slice(visible.length)) : f);
  for (const f of o.hideFiles ?? []) { const h = hostOf(f); if (existsSync(h) && statSync(h).isFile()) a.push('--ro-bind', '/dev/null', f); }
  a.push('--chdir', o.cwd);
  return a;
}

export async function runSandboxedTool(req: ProcessRequest, o: SandboxProfile, signal?: AbortSignal): Promise<ProcessResult> {
  if (!isAbsolute(req.bin)) throw new Error(`binary "${req.bin}" must be an absolute path`);
  if (!isAbsolute(o.writableRoot)) throw new Error(`writable root "${o.writableRoot}" must be an absolute path`);
  if (o.mountAt !== undefined && !isAbsolute(o.mountAt)) throw new Error(`mount point "${o.mountAt}" must be an absolute path`);
  if (!(await sandboxedToolAvailable())) throw new Error('bubblewrap unavailable; refusing to run a repository command unsandboxed (ADR-0010)');
  return runProcess({ ...req, bin: BWRAP!, args: [...bwrapArgs({ ...o, cwd: req.cwd }), '--', req.bin, ...req.args] }, signal);
}
