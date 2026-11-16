/** ExecutionContract v1.1 (architecture.md §6). Owned by the application layer. */
import type { CapabilityGrants, RuntimeId } from '@taskquoin/domain';
import type { GateTicket } from '../use-cases/prepare-run.ts';

export interface AgentSpec {
  id: string; description: string;
  /** Role instructions. Passed to every runtime (Claude: agent prompt; Codex: prepended on stdin). */
  prompt: string;
  /** Granted capabilities with scope. Absent or empty ⇒ not granted. */
  capabilities: CapabilityGrants;
  model?: string;
  /** Claude only; Codex has no turn limit (bounded by timeoutMs) — reported as unsupported in RunResult. */
  maxTurns?: number;
}

export interface RunRequest {
  agent: AgentSpec;
  task: string;
  cwd: string;
  /** Validated against the runner's env allowlist; nothing is inherited. */
  env: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
  /** Issued by prepareRun; executors refuse without a matching ticket. */
  ticket?: GateTicket;
  /**
   * Absolute paths inside `cwd` the agent must never write (ADR-0014: dependency directories Verify inherits).
   * Executors that cannot enforce them refuse the run; read-only runtimes satisfy them by construction.
   */
  frozenPaths?: string[];
  // No connector/MCP configuration before R6 (Codex R1.1 P1: "read-scoped MCP" was only a comment).
}

export type RunStatus = 'completed' | 'failed' | 'timeout' | 'cancelled' | 'unknown';

/** What the runtime reported it actually loaded (Claude init event). Absent ⇒ isolation cannot be shown. */
export interface RuntimeInventory { tools: string[]; mcpServers: string[]; plugins: string[]; skills: string[]; agents: string[]; model?: string; permissionMode?: string }
export interface ToolCallRecord { id: string; name: string; input: unknown; isError?: boolean; output?: string }
export interface CommandExecutionRecord { command: string; exitCode: number | null; status: string; output: string }

export interface RunResult {
  status: RunStatus;
  runtime: RuntimeId;
  runtimeVersion: string;
  exitCode: number | null;
  terminalMessage?: string;
  usage?: { costUsd?: number; numTurns?: number; inputTokens?: number; outputTokens?: number };
  /** Exact command issued; the prompt travelled on stdin and is not repeated here. */
  command: { bin: string; args: string[]; cwd: string };
  /** sha256 over bin, args and env (key=value): identifies the effective invocation for the run manifest. */
  effectiveConfigDigest: string;
  inventory?: RuntimeInventory;
  toolCalls?: ToolCallRecord[];
  commandExecutions?: CommandExecutionRecord[];
  permissionDenials?: { tool: string; input: unknown }[];
  /** Contract fields the runtime could not honour (e.g. maxTurns on Codex). */
  unsupported: string[];
  /** Cleanup problems (never thrown: they must not replace the run result). */
  cleanupErrors?: string[];
  stdoutTruncated: boolean;
  stderr: string;
  durationMs: number;
}

export interface RuntimeExecutor {
  readonly runtime: RuntimeId;
  run(req: RunRequest, signal?: AbortSignal): Promise<RunResult>;
}

/** How to reach the runtime binary; `bin` must be absolute. Tests inject a fake. */
export interface BinarySpec { bin: string; prefixArgs?: string[]; version: string }
