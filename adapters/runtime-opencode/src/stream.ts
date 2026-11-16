/**
 * OpenCode 1.19.5 `run --format json` events (NDJSON, measured — docs/reports/opencode-interface-1.19.5.md) → outcome.
 * Unparseable lines (a truncated last line) are skipped; completion = the last step finished with reason `stop`.
 */
import type { RunResult, ToolCallRecord } from '@taskquoin/application';
import { DENIAL_TEXT } from './facts.ts';

export interface OpenCodeStream {
  text?: string; toolCalls: ToolCallRecord[]; denials: { tool: string; input: unknown }[];
  usage?: RunResult['usage']; model?: string; error?: string; completed: boolean;
}
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : 0);
const MAX_TOOL_OUTPUT = 4000;

export function parseOpenCodeStream(lines: string[]): OpenCodeStream {
  const s: OpenCodeStream = { toolCalls: [], denials: [], completed: false };
  const texts: string[] = []; let input = 0, output = 0, cost = 0, steps = 0;
  for (const line of lines) {
    let e: unknown; try { e = JSON.parse(line); } catch { continue; }
    if (!isObj(e)) continue;
    const part: Obj = isObj(e.part) ? e.part : {};
    if (typeof part.modelID === 'string') s.model = `${typeof part.providerID === 'string' ? `${part.providerID}/` : ''}${part.modelID}`;
    switch (e.type) {
      case 'step_start': s.completed = false; break;
      case 'tool_use': {
        const st: Obj = isObj(part.state) ? part.state : {};
        const err = typeof st.error === 'string' ? st.error : undefined;
        s.toolCalls.push({ id: String(part.callID ?? part.id ?? ''), name: String(part.tool ?? ''), input: st.input, isError: st.status === 'error',
          output: (err ?? (typeof st.output === 'string' ? st.output : '')).slice(0, MAX_TOOL_OUTPUT) });
        if (st.status === 'error' && err?.startsWith(DENIAL_TEXT)) s.denials.push({ tool: String(part.tool ?? ''), input: st.input });
        s.completed = false; break;
      }
      case 'text': if (typeof part.text === 'string' && part.text.trim()) texts.push(part.text); break;
      case 'step_finish': {
        const t: Obj = isObj(part.tokens) ? part.tokens : {};
        steps++; input += num(t.input); output += num(t.output); cost += num(part.cost); s.completed = part.reason === 'stop'; break;
      }
      case 'error': {
        const er: Obj = isObj(e.error) ? e.error : {}; const d: Obj = isObj(er.data) ? er.data : {};
        s.error = `${String(er.name ?? 'error')}${typeof d.statusCode === 'number' ? ` ${d.statusCode}` : ''}: ${String(d.message ?? er.message ?? 'unknown error').slice(0, 500)}`;
        s.completed = false; break;
      }
    }
  }
  if (texts.length) s.text = texts[texts.length - 1];
  if (steps) s.usage = { inputTokens: input, outputTokens: output, numTurns: steps, ...(cost ? { costUsd: cost } : {}) };
  return s;
}
