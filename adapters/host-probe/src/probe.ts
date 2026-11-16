/**
 * Host facts gathered OUTSIDE any model (doctor / preflight): absolute runtime binaries and versions, Claude Bash
 * sandbox availability (bubblewrap + socat usable), local-tool network isolation, git root. Never reads secrets.
 */
import { accessSync, constants, existsSync, realpathSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
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

export interface RuntimeProbe { bin: string; version?: string }
export interface HostReport {
  runtimes: { claude?: RuntimeProbe; codex?: RuntimeProbe; opencode?: RuntimeProbe };
  bashSandbox: boolean; localIsolation: boolean; node: string; git?: string; gitRoot?: string;
  /** Taskquoin's own bubblewrap profile is usable (Verify, OpenCode agents). */
  fileSandbox: boolean;
}

export async function probeHost(o: { cwd: string; PATH: string; HOME: string }): Promise<HostReport> {
  const runtimes: HostReport['runtimes'] = {};
  for (const name of ['claude', 'codex', 'opencode'] as const) {
    const bin = findOnPath(name, o.PATH);
    if (bin) runtimes[name] = { bin, version: await binaryVersion(bin, o.PATH, o.HOME) };
  }
  const git = findOnPath('git', o.PATH);
  let gitRoot: string | undefined;
  if (git) {
    const r = await runProcess({ bin: git, args: ['rev-parse', '--show-toplevel'], cwd: o.cwd, env: { PATH: o.PATH, HOME: o.HOME }, timeoutMs: 10_000, maxOutputBytes: 10_000 });
    if (r.status === 'completed') { const t = r.stdout.trim(); if (t && existsSync(t)) gitRoot = realpathSync(t); }
  }
  return { runtimes, bashSandbox: await bashSandboxAvailable(o.PATH), localIsolation: await localToolIsolationAvailable(), fileSandbox: await sandboxedToolAvailable(), node: process.execPath, git, gitRoot };
}
