import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';

export interface ProcessRequest {
  /** Absolute path of the binary — never resolved through PATH (a repository could shadow it). */
  bin: string;
  args: string[];
  cwd: string;
  /** Only ALLOWED_ENV_KEYS (and TQ_FAKE_* for test doubles) are accepted; nothing is inherited. */
  env: Record<string, string>;
  timeoutMs: number;
  /** One budget shared by stdout + stderr, in bytes. */
  maxOutputBytes: number;
  stdin?: string;
  /** Delay between SIGTERM and SIGKILL. */
  killGraceMs?: number;
}
export type ProcessStatus = 'completed' | 'failed' | 'timeout' | 'cancelled';
export interface ProcessResult {
  status: ProcessStatus; exitCode: number | null; signal: NodeJS.Signals | null;
  stdout: string; stderr: string; truncated: boolean; durationMs: number;
}

/**
 * Environment keys a runtime CLI may receive. Credentials for connectors, loader hooks
 * (LD_PRELOAD, NODE_OPTIONS, BASH_ENV…) and endpoint overrides (ANTHROPIC_BASE_URL…) are refused.
 * Runtime auth relies on HOME (OAuth/keychain files), not on env tokens.
 */
export const ALLOWED_ENV_KEYS: readonly string[] = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'TZ', 'TMPDIR',
  // traffic-reducing switches only (ADR-0010)
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_TELEMETRY', 'DISABLE_ERROR_REPORTING', 'DISABLE_AUTOUPDATER', 'BASH_MAX_OUTPUT_LENGTH',
  // set by the orchestrator's git adapter only (temporary index), never passed to agents
  'GIT_INDEX_FILE'];
const TEST_DOUBLE_PREFIX = 'TQ_FAKE_';

function validate(req: ProcessRequest): void {
  if (!isAbsolute(req.bin)) throw new Error(`binary "${req.bin}" must be an absolute path (resolved by doctor, never via PATH at run time)`);
  for (const k of Object.keys(req.env)) {
    if (!ALLOWED_ENV_KEYS.includes(k) && !k.startsWith(TEST_DOUBLE_PREFIX)) throw new Error(`env key "${k}" is not allowed (allowlist: ${ALLOWED_ENV_KEYS.join(', ')})`);
  }
}

/** Drop a trailing incomplete UTF-8 sequence so decoding never yields U+FFFD from our own truncation. */
function trimUtf8(buf: Buffer): Buffer {
  let i = buf.length - 1; let cont = 0;
  while (i >= 0 && cont < 3 && (buf[i] & 0xc0) === 0x80) { i--; cont++; }
  if (i < 0) return buf;
  const lead = buf[i];
  const need = lead >= 0xf0 ? 3 : lead >= 0xe0 ? 2 : lead >= 0xc0 ? 1 : 0;
  return need > cont ? buf.subarray(0, i) : buf;
}

/**
 * Spawn in its own process group with a validated environment, a hard timeout and cancellation that
 * both escalate SIGTERM → SIGKILL on the whole group, and a shared output byte budget.
 * The group is SIGKILLed after the child exits too, so same-group orphans do not survive.
 * Rejects only for invalid requests; child failures are reported in the result.
 */
export async function runProcess(req: ProcessRequest, signal?: AbortSignal): Promise<ProcessResult> {
  validate(req);
  const started = Date.now();
  if (signal?.aborted) return { status: 'cancelled', exitCode: null, signal: null, stdout: '', stderr: '', truncated: false, durationMs: 0 };

  return new Promise((resolve) => {
    const posix = process.platform !== 'win32';
    const child = spawn(req.bin, req.args, { cwd: req.cwd, env: req.env, detached: posix, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = []; const err: Buffer[] = [];
    let used = 0; let truncated = false; let reason: 'timeout' | 'cancelled' | undefined; let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;

    const take = (sink: Buffer[]) => (chunk: Buffer) => {
      const room = req.maxOutputBytes - used;
      if (room <= 0) { truncated = true; return; }
      const part = chunk.length > room ? chunk.subarray(0, room) : chunk;
      if (part.length < chunk.length) truncated = true;
      sink.push(part); used += part.length;
    };
    child.stdout.on('data', take(out));
    child.stderr.on('data', take(err));

    const killGroup = (sig: NodeJS.Signals) => {
      try { if (posix && child.pid) process.kill(-child.pid, sig); else child.kill(sig); } catch { /* group already gone */ }
    };
    const terminate = (why: 'timeout' | 'cancelled') => {
      if (reason) return;
      reason = why;
      killGroup('SIGTERM');
      graceTimer = setTimeout(() => killGroup('SIGKILL'), req.killGraceMs ?? 500);
    };
    const timer = setTimeout(() => terminate('timeout'), req.timeoutMs);
    const onAbort = () => terminate('cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (exitCode: number | null, sig: NodeJS.Signals | null) => {
      if (settled) return; settled = true;
      clearTimeout(timer); if (graceTimer) clearTimeout(graceTimer);
      signal?.removeEventListener('abort', onAbort);
      killGroup('SIGKILL'); // reap anything left in the group, whether or not we initiated termination
      const status: ProcessStatus = reason ?? (exitCode === 0 ? 'completed' : 'failed');
      resolve({
        status, exitCode, signal: sig,
        stdout: trimUtf8(Buffer.concat(out)).toString('utf8'), stderr: trimUtf8(Buffer.concat(err)).toString('utf8'),
        truncated, durationMs: Date.now() - started,
      });
    };
    child.on('error', (e) => { take(err)(Buffer.from(String(e))); finish(null, null); });
    child.on('close', finish);
    child.stdin.on('error', () => { /* child closed stdin early (EPIPE): not our failure */ });
    child.stdin.end(req.stdin ?? '');
  });
}

/** Run `<bin> [prefix] --version` and return the first x.y.z, only if the process succeeded (Codex R3: ignore failures). */
export async function verifyBinaryVersion(bin: string, prefixArgs: string[] = [], env: Record<string, string> = {}): Promise<string> {
  const r = await runProcess({ bin, args: [...prefixArgs, '--version'], cwd: '/', env: { PATH: env.PATH ?? '', ...(env.HOME ? { HOME: env.HOME } : {}) }, timeoutMs: 15_000, maxOutputBytes: 10_000 });
  const v = /\b(\d+\.\d+\.\d+)\b/.exec(r.stdout)?.[1];
  if (r.status !== 'completed' || !v) throw new Error(`cannot verify the version of ${bin} (status ${r.status})`);
  return v;
}
