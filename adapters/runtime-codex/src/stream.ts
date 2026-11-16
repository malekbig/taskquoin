/**
 * Parse `codex exec --json` lines (shape observed on 0.157.1). Untrusted input: type-checked, malformed ignored.
 * Measured (R3): `aggregated_output` is UNRELIABLE — empty or missing lines in about 1/3 of runs. Command records are
 * for observability only; never use their output as evidence (exit codes and command strings were reliable).
 */
export interface CodexCommandExecution { command: string; exitCode: number | null; status: string; output: string }
export interface CodexStream { commandExecutions: CodexCommandExecution[]; turnCompleted: boolean; turnFailed: boolean; usage?: { inputTokens?: number; outputTokens?: number } }

const MAX_OUTPUT = 64 * 1024;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function parseCodexStream(lines: readonly string[]): CodexStream {
  const commandExecutions: CodexCommandExecution[] = [];
  let turnCompleted = false; let turnFailed = false; let usage: CodexStream['usage'];
  for (const line of lines) {
    let ev: unknown;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!isObj(ev)) continue;
    if (ev.type === 'item.completed' && isObj(ev.item) && ev.item.type === 'command_execution' && typeof ev.item.command === 'string') {
      const it = ev.item;
      commandExecutions.push({
        command: it.command as string, exitCode: typeof it.exit_code === 'number' ? it.exit_code : null,
        status: typeof it.status === 'string' ? it.status : 'unknown',
        output: typeof it.aggregated_output === 'string' ? it.aggregated_output.slice(0, MAX_OUTPUT) : '',
      });
    } else if (ev.type === 'turn.completed') {
      turnCompleted = true;
      if (isObj(ev.usage)) usage = {
        ...(typeof ev.usage.input_tokens === 'number' ? { inputTokens: ev.usage.input_tokens } : {}),
        ...(typeof ev.usage.output_tokens === 'number' ? { outputTokens: ev.usage.output_tokens } : {}),
      };
    } else if (ev.type === 'turn.failed' || ev.type === 'error') {
      turnFailed = true;
    }
  }
  return { commandExecutions, turnCompleted, turnFailed, usage };
}
