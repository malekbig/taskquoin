/**
 * Claude Code headless invocation. Flags verified on 2.1.325 (2026-11-15, `claude --help`):
 * -p (prompt read from stdin), --agents <json>, --agent, --settings <json>, --setting-sources "" (load no
 * user/project/local settings ⇒ no user hooks/plugins, no repo-supplied hooks), --tools, --permission-mode dontAsk,
 * --output-format stream-json (+ --verbose), --max-turns, --strict-mcp-config, --no-session-persistence.
 * Never: --bare (skips the hooks we will rely on in R2), bypassPermissions, --dangerously-skip-permissions.
 * Measured 2026-11-15: default headless run on this machine loaded 12 plugins, 13 MCP servers and
 * SessionStart/UserPromptSubmit/Stop hooks; with --setting-sources "" → 0 hooks, 0 MCP (S3).
 */
import type { ClaudePermissions } from './permissions.ts';

export interface ClaudeAgentDef { id: string; description: string; prompt: string; model?: string }
export interface ClaudeCommandRequest {
  agent: ClaudeAgentDef; task: string; cwd: string; permissions: ClaudePermissions; maxTurns: number;
  /** Shell command line of the Taskquoin PreToolUse hook (already quoted). Absent ⇒ no hook. */
  hookCommand?: string;
  /** Absolute directories Bash subprocesses may write (native sandbox). Only used when Bash is available. */
  sandboxWriteRoots?: string[];
  /** Absolute paths Bash subprocesses may never write / read (protected config, secrets, control store). */
  sandboxDenyWrite?: string[];
  sandboxDenyRead?: string[];
  // No MCP configuration before R6: connector scope must be reviewed and brokered first (Codex R1.1 P1).
}
export interface Command { bin: string; args: string[]; cwd: string; stdin: string }

/** Every built-in tool that reads, writes or runs commands. */
export const HOOK_MATCHER = 'Write|Edit|MultiEdit|NotebookEdit|Read|Grep|Glob|Bash';
const AGENT_ID_RE = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function buildClaudeCommand(r: ClaudeCommandRequest): Command {
  if (!AGENT_ID_RE.test(r.agent.id)) throw new Error(`invalid agent id ${JSON.stringify(r.agent.id)} (expected [a-z0-9-], max 48)`);
  const name = `af-${r.agent.id}`;
  const agents = { [name]: { description: r.agent.description, prompt: r.agent.prompt, tools: r.permissions.tools, ...(r.agent.model ? { model: r.agent.model } : {}) } };
  const settings = {
    permissions: { allow: r.permissions.allow, deny: r.permissions.deny, defaultMode: 'dontAsk' },
    // ADR-0010: when the agent can run commands, they run in Claude Code's native OS sandbox (bubblewrap on Linux):
    // no network (empty allowlist), no unsandboxed escape hatch, run FAILS if the sandbox is unavailable. NOTE: allowWrite
    // is additive — the workspace stays writable for subprocesses (measured R2.1); denyWrite/denyRead carve out paths.
    ...(r.permissions.tools.includes('Bash') ? { sandbox: {
      enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false,
      network: { allowedDomains: [], allowLocalBinding: false, allowUnixSockets: [] },
      filesystem: { allowWrite: r.sandboxWriteRoots ?? [], denyWrite: r.sandboxDenyWrite ?? [], denyRead: r.sandboxDenyRead ?? [] },
    } } : {}),
    ...(r.hookCommand ? { hooks: { PreToolUse: [{ matcher: HOOK_MATCHER, hooks: [{ type: 'command', command: r.hookCommand, timeout: 15, onFailure: 'block' }] }] } } : {}),
  };
  const args = [
    '-p',
    '--setting-sources', '',
    '--settings', JSON.stringify(settings),
    '--agents', JSON.stringify(agents), '--agent', name,
    '--tools', r.permissions.tools.join(','),
    '--permission-mode', 'dontAsk',
    '--output-format', 'stream-json', '--verbose',
    '--max-turns', String(r.maxTurns),
    '--no-session-persistence',
    '--strict-mcp-config',
  ];
  return { bin: 'claude', args, cwd: r.cwd, stdin: r.task };
}

