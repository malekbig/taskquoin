/**
 * Shared helpers for LIVE contract tests. These tests measure RUNTIME boundaries, not the gate, so `gated()` attaches a
 * ticket built from the request's own capabilities and the verified binary version. Production code obtains tickets
 * only from prepareRun.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { capabilitiesDigest, type RunRequest, type RunResult, type RuntimeExecutor } from '@taskquoin/application';
import { ClaudeExecutor } from '@taskquoin/runtime-claude';
import { CodexExecutor } from '@taskquoin/runtime-codex';
import { ensureTrustedDir } from '@taskquoin/store-fs';

export const abs = (b: string) => execFileSync('sh', ['-c', `command -v ${b}`], { encoding: 'utf8' }).trim();
export const semver = (b: string) => /\b(\d+\.\d+\.\d+)\b/.exec(execFileSync(b, ['--version'], { encoding: 'utf8' }))![1];
export const HOOK_ENTRY = new URL('../adapters/hooks-claude/src/main.ts', import.meta.url).pathname;

function liveState(): { policyDir: string; controlStore: string } {
  const base = join(homedir(), '.cache', 'taskquoin-live'); mkdirSync(base, { recursive: true });
  const st = mkdtempSync(join(base, 'state-'));
  return { policyDir: ensureTrustedDir(join(st, 'policies')), controlStore: ensureTrustedDir(st) };
}

export function gated(ex: RuntimeExecutor, version: string): RuntimeExecutor {
  return { runtime: ex.runtime, run: (req: RunRequest, signal?: AbortSignal): Promise<RunResult> => ex.run({ ...req,
    ticket: { kind: 'taskquoin.gate-ticket.v1', agentId: req.agent.id, runtime: ex.runtime, runtimeVersion: version, capabilitiesDigest: capabilitiesDigest(req.agent.capabilities), issuedAt: new Date().toISOString() } }, signal) };
}

export function liveClaude(hookEntry = HOOK_ENTRY): RuntimeExecutor {
  const v = semver('claude');
  return gated(new ClaudeExecutor({ bin: abs('claude'), version: v }, { hook: { nodeBin: process.execPath, entry: hookEntry, ...liveState() } }), v);
}
export function liveCodex(): RuntimeExecutor {
  const v = semver('codex');
  return gated(new CodexExecutor({ bin: abs('codex'), version: v }), v);
}
