/**
 * Map a Claude Code 2.1.325 PreToolUse payload to rule inputs. Untrusted input: a write/read tool whose path is
 * missing or not a string throws (⇒ the hook fails closed).
 */
export type Mapped = { kind: 'write' | 'read'; rawPaths: string[] } | { kind: 'shell'; command: string } | { kind: 'none' };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
function str(input: Record<string, unknown>, key: string, tool: string): string {
  const v = input[key];
  if (typeof v !== 'string' || v === '') throw new Error(`${tool}: tool_input.${key} missing or not a string`);
  return v;
}

export function mapPayload(payload: unknown): { cwd: string; tool: string; mapped: Mapped } {
  if (!isObj(payload)) throw new Error('payload is not an object');
  if (typeof payload.tool_name !== 'string') throw new Error('payload.tool_name missing');
  if (typeof payload.cwd !== 'string' || !payload.cwd.startsWith('/')) throw new Error('payload.cwd missing or not absolute');
  const tool = payload.tool_name; const input = isObj(payload.tool_input) ? payload.tool_input : {};
  let mapped: Mapped;
  switch (tool) {
    case 'Write': case 'Edit': case 'MultiEdit': mapped = { kind: 'write', rawPaths: [str(input, 'file_path', tool)] }; break;
    case 'NotebookEdit': mapped = { kind: 'write', rawPaths: [str(input, 'notebook_path', tool)] }; break;
    case 'Read': mapped = { kind: 'read', rawPaths: [str(input, 'file_path', tool)] }; break;
    case 'Grep': case 'Glob': mapped = { kind: 'read', rawPaths: [typeof input.path === 'string' && input.path ? input.path : payload.cwd] }; break;
    case 'Bash': mapped = { kind: 'shell', command: str(input, 'command', tool) }; break;
    default: mapped = { kind: 'none' };
  }
  return { cwd: payload.cwd, tool, mapped };
}
