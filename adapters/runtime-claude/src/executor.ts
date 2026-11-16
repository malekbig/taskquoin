import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalizeGrants } from '@taskquoin/domain';
import { HOME_SECRET_GLOBS, PROTECTED_WRITE_GLOBS, SECRET_READ_GLOBS } from '@taskquoin/rules';
import { scanWorkspace, type WorkspaceScan } from '@taskquoin/local-tool';
import { assertTicket, invocationDigest, type BinarySpec, type RunRequest, type RunResult, type RuntimeExecutor } from '@taskquoin/application';
import { runProcess, verifyBinaryVersion } from '@taskquoin/process-runner';
import { ensureTrustedDir } from '@taskquoin/store-fs';
import { buildClaudeCommand } from './command.ts';
import { claudePermissionsFor } from './permissions.ts';
import { parseClaudeStream } from './stream.ts';

export interface ClaudeHookOptions {
  /** Absolute node binary and hook entry (adapters/hooks-claude/src/main.ts). */
  nodeBin: string; entry: string;
  /** Trusted directory outside the workspace (control store `policies/`). */
  policyDir: string;
  /** Physical control-store root, denied to the agent. */
  controlStore: string;
}
/** The hook is MANDATORY (Codex R3 #1/#3): no governed Claude run without it. */
export interface ClaudeExecutorOptions { hook: ClaudeHookOptions }

/** ADR-0010 no-leak: telemetry, error reporting, auto-update and other non-essential traffic off for every run. */
export const CLAUDE_NO_LEAK_ENV: Readonly<Record<string, string>> = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1',
  // pilot 1: test output was truncated at the 30 000-char default; 128 000 is the documented maximum
  BASH_MAX_OUTPUT_LENGTH: '128000',
};

/** fs.write globs → sandbox write roots. Only `**` and `<dir>/**` map to a directory; other globs grant no subprocess writes. */
export function sandboxWriteRoots(cwd: string, globs: readonly string[]): string[] {
  const roots = new Set<string>();
  for (const g0 of globs) {
    const g = g0.replace(/^\.\//, '');
    if (g === '**') roots.add(cwd);
    else { const m = /^([^*?[\]]+)\/\*\*$/.exec(g); if (m && !m[1].split('/').includes('..')) roots.add(`${cwd}/${m[1]}`); }
  }
  return [...roots];
}

/** Globs → concrete paths for the OS sandbox (which takes paths): keep entries whose prefix before `/**` is literal. */
function literalPaths(root: string, globs: readonly string[]): string[] {
  return globs.map(g => g.replace(/\/\*\*$/, '')).filter(g => !/[*?[\]]/.test(g)).map(g => `${root}/${g}`);
}
/** The scan lives in @taskquoin/local-tool (shared with Verify); re-exported for callers of this adapter. */
export { scanWorkspace, type WorkspaceScan } from '@taskquoin/local-tool';
/**
 * Protected configuration, the control store, .git (always — agents never commit, ADR-0011) and every nested
 * instruction file found by the scan: never writable by sandboxed subprocesses. Files created during the run are caught
 * by the workflow's landing gate (never committed).
 */
export function sandboxDenyWrite(cwd: string, controlStore: string | undefined, scan: WorkspaceScan): string[] {
  return [...new Set([...literalPaths(cwd, PROTECTED_WRITE_GLOBS), ...scan.instructionFiles, ...(controlStore ? [controlStore] : [])])];
}
/** Secret files (project + HOME) and control store, never readable by sandboxed subprocesses. */
export function sandboxDenyRead(cwd: string, home: string, controlStore: string | undefined, scan: WorkspaceScan): string[] {
  const homeSecrets = literalPaths(home, HOME_SECRET_GLOBS);
  // A symlinked secret dir (WSL: ~/.aws → /mnt/c/…) is denied at both the link and its real target.
  const targets = homeSecrets.flatMap(p => { try { const r = realpathSync(p); return r !== p ? [r] : []; } catch { return []; } });
  // symlinks leading outside the workspace are denied too (their targets were not scanned — Codex R4 N10), and so is
  // what a secret-NAMED symlink points to (`.env -> credentials.txt`, Codex CR2 #3)
  const secretTargets = scan.secretLinks.flatMap(l => { try { return [realpathSync(l)]; } catch { return []; } });
  return [...new Set([...literalPaths(cwd, SECRET_READ_GLOBS), ...scan.secretFiles, ...secretTargets, ...scan.externalLinks, ...homeSecrets, ...targets, ...(controlStore ? [controlStore] : [])])];
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export class ClaudeExecutor implements RuntimeExecutor {
  readonly runtime = 'claude' as const;
  private readonly binary: BinarySpec;
  private readonly opts: ClaudeExecutorOptions;
  private version?: Promise<string>;
  constructor(binary: BinarySpec, opts: ClaudeExecutorOptions) {
    if (!opts?.hook) throw new Error('ClaudeExecutor requires the Taskquoin PreToolUse hook (ADR-0003)');
    for (const [k, v] of Object.entries({ nodeBin: opts.hook.nodeBin, entry: opts.hook.entry, policyDir: opts.hook.policyDir, controlStore: opts.hook.controlStore })) {
      if (!isAbsolute(v)) throw new Error(`hook.${k} must be an absolute path`);
    }
    if (!existsSync(opts.hook.nodeBin) || !existsSync(opts.hook.entry)) throw new Error('hook node binary or entry not found');
    this.binary = binary; this.opts = opts;
  }

  /** Verified once: the binary's real version must equal the declared one (Codex R3: facts bound to execution). */
  private async checkVersion(env: Record<string, string>): Promise<string> {
    this.version ??= verifyBinaryVersion(this.binary.bin, this.binary.prefixArgs, env);
    const v = await this.version;
    if (v !== this.binary.version) throw new Error(`claude binary is ${v}, declared ${this.binary.version}`);
    return v;
  }

  async run(req: RunRequest, signal?: AbortSignal): Promise<RunResult> {
    const grants = normalizeGrants(req.agent.capabilities);
    const hook = this.opts.hook;
    const verified = await this.checkVersion(req.env);
    assertTicket(req.ticket, 'claude', verified, req.agent.capabilities, req.agent.id);
    const ws = realpathSync(req.cwd);
    const entryReal = realpathSync(hook.entry);
    if (entryReal === ws || entryReal.startsWith(ws + sep)) throw new Error('refusing: the hook code is inside the workspace the agent can write (it could disable its own guard)');
    ensureTrustedDir(hook.policyDir, ws);
    const frozen = (req.frozenPaths ?? []).map(f => {
      const real = existsSync(f) ? realpathSync(f) : f;
      if (!real.startsWith(ws + sep)) throw new Error(`refusing: frozen path outside the workspace (${f})`);
      return real;
    });
    const scan = scanWorkspace(ws);
    if (!scan.complete) throw new Error(`workspace scan incomplete (${scan.problem}); refusing — sandbox deny lists would be partial`);
    let policyRunDir: string | undefined;
    const cleanupErrors: string[] = [];
    try {
      let hookCommand: string | undefined;
      {
        policyRunDir = mkdtempSync(join(hook.policyDir, 'run-'));
        const policyFile = join(policyRunDir, 'policy.json');
        const policy = {
          projectRoot: realpathSync(req.cwd), home: req.env.HOME ?? homedir(),
          writeGlobs: grants['fs.write'] ?? [], vcs: { commit: !!grants['vcs.commit'], push: !!grants['vcs.push'] }, controlStore: hook.controlStore,
          ...(frozen.length ? { frozenRoots: frozen } : {}),
        };
        writeFileSync(policyFile, JSON.stringify(policy), { mode: 0o600, flag: 'wx' });
        hookCommand = `${q(hook.nodeBin)} ${q(hook.entry)} --policy ${q(policyFile)}`;
      }
      const permissions = claudePermissionsFor(grants, { controlStore: hook.controlStore });
      const cmd = buildClaudeCommand({
        agent: { id: req.agent.id, description: req.agent.description, prompt: req.agent.prompt, model: req.agent.model },
        task: req.task, cwd: req.cwd, permissions, maxTurns: req.agent.maxTurns ?? 20, ...(hookCommand ? { hookCommand } : {}),
        sandboxWriteRoots: sandboxWriteRoots(ws, grants['fs.write'] ?? []),
        sandboxDenyWrite: [...sandboxDenyWrite(ws, hook.controlStore, scan), ...frozen],
        sandboxDenyRead: sandboxDenyRead(ws, req.env.HOME ?? homedir(), hook.controlStore, scan),
      });
      const env = { ...req.env, ...CLAUDE_NO_LEAK_ENV };
      const args = [...(this.binary.prefixArgs ?? []), ...cmd.args];
      const p = await runProcess({ bin: this.binary.bin, args, cwd: req.cwd, env, timeoutMs: req.timeoutMs, maxOutputBytes: req.maxOutputBytes, stdin: cmd.stdin }, signal);
      const s = parseClaudeStream(p.stdout.split('\n'));
      const status: RunResult['status'] = p.status === 'timeout' || p.status === 'cancelled' ? p.status
        : p.status === 'failed' ? 'failed' : s.terminal.status;
      return {
        status, runtime: 'claude', runtimeVersion: this.binary.version, exitCode: p.exitCode,
        terminalMessage: s.terminal.resultText, usage: { costUsd: s.terminal.costUsd, numTurns: s.terminal.numTurns },
        command: { bin: this.binary.bin, args, cwd: req.cwd }, effectiveConfigDigest: invocationDigest(this.binary.bin, args, env),
        inventory: s.inventory, toolCalls: s.toolCalls, permissionDenials: s.terminal.permissionDenials, unsupported: [],
        ...(cleanupErrors.length ? { cleanupErrors } : {}),
        stdoutTruncated: p.truncated, stderr: p.stderr, durationMs: p.durationMs,
      };
    } finally {
      if (policyRunDir) { try { rmSync(policyRunDir, { recursive: true, force: true }); } catch { /* reported best-effort */ } }
    }
  }
}
