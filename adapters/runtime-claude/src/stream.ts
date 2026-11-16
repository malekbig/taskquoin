/**
 * Parse Claude Code 2.1.325 `--output-format stream-json --verbose` lines. Untrusted input: every field
 * is type-checked; anything malformed is ignored; only a schema-valid `result` event is terminal evidence.
 */
export interface RuntimeInventory { tools: string[]; mcpServers: string[]; plugins: string[]; skills: string[]; agents: string[]; model?: string; permissionMode?: string }
export interface ToolCall { id: string; name: string; input: unknown; isError?: boolean; output?: string }
export interface PermissionDenial { tool: string; input: unknown }
export interface Terminal { status: 'completed' | 'failed' | 'unknown'; subtype?: string; costUsd?: number; numTurns?: number; resultText?: string; permissionDenials: PermissionDenial[] }
export interface ClaudeStream { inventory?: RuntimeInventory; toolCalls: ToolCall[]; terminal: Terminal }

const MAX_TOOL_OUTPUT = 64 * 1024;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const strs = (x: unknown): string[] => Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [];
const names = (x: unknown): string[] => Array.isArray(x) ? x.map(v => (isObj(v) && typeof v.name === 'string' ? v.name : typeof v === 'string' ? v : undefined)).filter((v): v is string => !!v) : [];
const text = (c: unknown): string => {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(b => (isObj(b) && typeof b.text === 'string' ? b.text : '')).join('');
  return '';
};

export function parseClaudeStream(lines: readonly string[]): ClaudeStream {
  let inventory: RuntimeInventory | undefined;
  const calls = new Map<string, ToolCall>();
  let terminal: Terminal = { status: 'unknown', permissionDenials: [] };

  for (const line of lines) {
    let ev: unknown;
    try { ev = JSON.parse(line); } catch { continue; }
    if (!isObj(ev)) continue;
    if (ev.type === 'system' && ev.subtype === 'init') {
      inventory = {
        tools: strs(ev.tools), mcpServers: names(ev.mcp_servers), plugins: names(ev.plugins), skills: names(ev.skills), agents: names(ev.agents),
        ...(typeof ev.model === 'string' ? { model: ev.model } : {}),
        ...(typeof ev.permissionMode === 'string' ? { permissionMode: ev.permissionMode } : {}),
      };
    } else if ((ev.type === 'assistant' || ev.type === 'user') && isObj(ev.message) && Array.isArray(ev.message.content)) {
      for (const b of ev.message.content) {
        if (!isObj(b)) continue;
        if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') calls.set(b.id, { id: b.id, name: b.name, input: b.input });
        if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
          const c = calls.get(b.tool_use_id);
          if (c) { c.isError = b.is_error === true; c.output = text(b.content).slice(0, MAX_TOOL_OUTPUT); }
        }
      }
    } else if (ev.type === 'result' && typeof ev.subtype === 'string' && typeof ev.is_error === 'boolean') {
      terminal = {
        status: ev.is_error ? 'failed' : 'completed', subtype: ev.subtype,
        costUsd: typeof ev.total_cost_usd === 'number' ? ev.total_cost_usd : undefined,
        numTurns: typeof ev.num_turns === 'number' ? ev.num_turns : undefined,
        resultText: typeof ev.result === 'string' ? ev.result : undefined,
        permissionDenials: Array.isArray(ev.permission_denials)
          ? ev.permission_denials.filter(isObj).map(d => ({ tool: String(d.tool_name), input: d.tool_input })) : [],
      };
    }
  }
  return { inventory, toolCalls: [...calls.values()], terminal };
}
