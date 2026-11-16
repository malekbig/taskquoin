/**
 * Codex headless invocation. Flags verified on codex-cli 0.157.1 (2026-11-15, `codex exec --help`, `codex features list`,
 * config keys present in the binary): exec, --json, --sandbox {read-only,workspace-write}, -C, -o, -c key=value (TOML),
 * --ignore-user-config (skip $CODEX_HOME/config.toml; auth still from CODEX_HOME), --ignore-rules (skip execpolicy .rules),
 * --ephemeral, --disable <feature>, prompt "-" ⇒ stdin.
 * Never: --profile (global file), danger-full-access, any --dangerously-* flag.
 */
export type CodexSandbox = 'read-only' | 'workspace-write';
export interface CodexCommandRequest {
  agentPrompt: string; task: string; cwd: string; sandbox: CodexSandbox; lastMessageFile: string; model?: string;
  /** Required for workspace-write: per-run scratch dir outside the repository (becomes TMPDIR and the only extra writable root). */
  scratchDir?: string;
}
export interface Command { bin: string; args: string[]; cwd: string; stdin: string }

/** Model-side tools/features that act outside the OS sandbox or install code. */
export const CODEX_DISABLED_FEATURES: readonly string[] = [
  'plugins', 'apps', 'remote_plugin', 'browser_use', 'browser_use_external', 'computer_use', 'in_app_browser',
  'image_generation', 'skill_mcp_dependency_install', 'tool_suggest', 'goals', 'multi_agent',
];
const MODEL_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const SAFE_PATH_RE = /^\/[^"\\\u0000-\u001f]*$/;

/** Codex has no per-run system prompt flag that we trust; role instructions travel with the task on stdin. */
export function codexStdin(agentPrompt: string, task: string): string {
  return agentPrompt.trim() ? `<agent-instructions>\n${agentPrompt}\n</agent-instructions>\n\n<task>\n${task}\n</task>\n` : task;
}

export function buildCodexCommand(r: CodexCommandRequest): Command {
  if (r.sandbox !== 'read-only' && r.sandbox !== 'workspace-write') {
    throw new Error(`refusing sandbox "${String(r.sandbox)}": only read-only|workspace-write are allowed (danger-full-access is never used)`);
  }
  if (r.model !== undefined && !MODEL_RE.test(r.model)) throw new Error(`invalid model name ${JSON.stringify(r.model)}`);
  // --strict-config: an unknown/misspelt -c key fails the run instead of being silently ignored (verified on 0.157.1).
  const args = ['exec', '--strict-config', '--json', '--ignore-user-config', '--ignore-rules', '--ephemeral',
    '--sandbox', r.sandbox, '-C', r.cwd, '-o', r.lastMessageFile,
    '-c', 'approval_policy="never"', '-c', 'web_search="disabled"',
    '-c', 'project_doc_max_bytes=0', '-c', 'skills.include_instructions=false',
    // ADR-0010 no-leak: no product analytics, no OpenTelemetry export.
    '-c', 'analytics.enabled=false', '-c', 'otel.exporter="none"'];
  if (r.sandbox === 'workspace-write') {
    if (!r.scratchDir || !SAFE_PATH_RE.test(r.scratchDir)) throw new Error(`workspace-write requires an absolute, TOML-safe scratchDir (got ${JSON.stringify(r.scratchDir)})`);
    args.push('-c', 'sandbox_workspace_write.network_access=false',
      '-c', 'sandbox_workspace_write.exclude_slash_tmp=true', '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true',
      '-c', `sandbox_workspace_write.writable_roots=[${JSON.stringify(r.scratchDir)}]`);
  }
  for (const f of CODEX_DISABLED_FEATURES) args.push('--disable', f);
  if (r.model) args.push('-c', `model="${r.model}"`);
  args.push('-');
  return { bin: 'codex', args, cwd: r.cwd, stdin: codexStdin(r.agentPrompt, r.task) };
}
