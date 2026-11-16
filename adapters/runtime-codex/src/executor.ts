import { closeSync, mkdtempSync, openSync, readSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeGrants, type CapabilityGrants } from '@taskquoin/domain';
import { assertTicket, invocationDigest, type BinarySpec, type RunRequest, type RunResult, type RuntimeExecutor } from '@taskquoin/application';
import { runProcess, verifyBinaryVersion } from '@taskquoin/process-runner';
import { buildCodexCommand } from './command.ts';
import { parseCodexStream } from './stream.ts';
import { createScratch, defaultScratchBase } from './scratch.ts';

const MAX_LAST_MESSAGE = 1024 * 1024;

function readBounded(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  const fd = openSync(file, 'r');
  try { const buf = Buffer.alloc(MAX_LAST_MESSAGE); const n = readSync(fd, buf, 0, MAX_LAST_MESSAGE, 0); return buf.subarray(0, n).toString('utf8'); }
  finally { closeSync(fd); }
}

export interface CodexExecutorOptions { scratchBase?: string }

/** Single source of truth for the sandbox mode — used by the executor AND to build HostFacts (review H2). */
export function codexSandboxFor(grants: CapabilityGrants): 'read-only' | 'workspace-write' {
  return normalizeGrants(grants)['fs.write'] ? 'workspace-write' : 'read-only';
}

export class CodexExecutor implements RuntimeExecutor {
  readonly runtime = 'codex' as const;
  private readonly binary: BinarySpec;
  private readonly scratchBase: string;
  private version?: Promise<string>;
  constructor(binary: BinarySpec, opts: CodexExecutorOptions = {}) { this.binary = binary; this.scratchBase = opts.scratchBase ?? defaultScratchBase(); }

  async run(req: RunRequest, signal?: AbortSignal): Promise<RunResult> {
    this.version ??= verifyBinaryVersion(this.binary.bin, this.binary.prefixArgs, req.env);
    const verified = await this.version;
    if (verified !== this.binary.version) throw new Error(`codex binary is ${verified}, declared ${this.binary.version}`);
    assertTicket(req.ticket, 'codex', verified, req.agent.capabilities, req.agent.id);
    const sandbox = codexSandboxFor(req.agent.capabilities);
    // ADR-0014: Codex's workspace-write sandbox has no per-path deny — it cannot keep inherited dependencies read-only.
    if (req.frozenPaths?.length && sandbox !== 'read-only') throw new Error('refusing: codex workspace-write cannot keep frozen paths read-only (ADR-0014) — use a read-only Codex role or a Claude implementer');
    const scratch = createScratch(this.scratchBase, req.cwd);
    const cleanupErrors: string[] = [];
    let lastMessageDir: string | undefined;
    let result: RunResult;
    try {
      // Sibling of the run dir, NOT inside it: the scratch dir is a writable root, the message must not be forgeable by the agent.
      lastMessageDir = mkdtempSync(join(this.scratchBase, 'msg-'));
      const lastMessageFile = join(lastMessageDir, 'last-message.md');
      const cmd = buildCodexCommand({ agentPrompt: req.agent.prompt, task: req.task, cwd: req.cwd, sandbox, lastMessageFile, model: req.agent.model,
        ...(sandbox === 'workspace-write' ? { scratchDir: scratch.dir } : {}) });
      const env = sandbox === 'workspace-write' ? { ...req.env, TMPDIR: scratch.dir } : req.env;
      const args = [...(this.binary.prefixArgs ?? []), ...cmd.args];
      const p = await runProcess({ bin: this.binary.bin, args, cwd: req.cwd, env, timeoutMs: req.timeoutMs, maxOutputBytes: req.maxOutputBytes, stdin: cmd.stdin }, signal);
      const s = parseCodexStream(p.stdout.split('\n'));
      const message = readBounded(lastMessageFile);
      const status: RunResult['status'] = p.status === 'timeout' || p.status === 'cancelled' ? p.status
        : p.status === 'failed' || s.turnFailed ? 'failed'
        : s.turnCompleted && message && message.trim() ? 'completed' : 'unknown';
      result = {
        status, runtime: 'codex', runtimeVersion: this.binary.version, exitCode: p.exitCode, terminalMessage: message,
        usage: s.usage, command: { bin: this.binary.bin, args, cwd: req.cwd }, effectiveConfigDigest: invocationDigest(this.binary.bin, args, env),
        commandExecutions: s.commandExecutions, unsupported: req.agent.maxTurns !== undefined ? ['maxTurns'] : [],
        stdoutTruncated: p.truncated, stderr: p.stderr, durationMs: p.durationMs,
      };
    } finally {
      if (lastMessageDir) { try { rmSync(lastMessageDir, { recursive: true, force: true }); } catch (e) { cleanupErrors.push(`message dir cleanup failed: ${(e as Error).message}`); } }
      const err = scratch.remove(); if (err) cleanupErrors.push(err);
    }
    return cleanupErrors.length ? { ...result, cleanupErrors } : result;
  }
}
