/**
 * PROVES: parseClaudeStream extracts, from stream-json lines, (a) the effective runtime inventory from the
 * init event (tools, MCP servers, plugins, skills, agents), (b) tool calls with their outcome, and (c) a terminal
 * result only when the result event has a valid schema. Malformed JSON, `null`, or a bare {"type":"result"} never
 * count as completion (Codex R1 N5).
 * DOES NOT PROVE: that Claude emits these fields on other versions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseClaudeStream } from '../src/stream.ts';

const init = { type: 'system', subtype: 'init', tools: ['Read', 'Edit'], mcp_servers: [{ name: 'gh', status: 'connected' }], plugins: [{ name: 'p1', path: '/x' }], skills: ['s1'], agents: ['af-x'], model: 'm', permissionMode: 'dontAsk' };
const toolUse = { type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'sh probe.sh' } }] } };
const toolRes = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: [{ type: 'text', text: 'PROBE a 0' }] }] } };
const result = { type: 'result', subtype: 'success', is_error: false, num_turns: 2, total_cost_usd: 0.01, result: 'done', permission_denials: [{ tool_name: 'Edit', tool_input: { file_path: 'x' } }] };
const L = (...o: unknown[]) => o.map(x => typeof x === 'string' ? x : JSON.stringify(x));

test('inventory from init event', () => {
  const s = parseClaudeStream(L(init, result));
  assert.deepEqual(s.inventory, { tools: ['Read', 'Edit'], mcpServers: ['gh'], plugins: ['p1'], skills: ['s1'], agents: ['af-x'], model: 'm', permissionMode: 'dontAsk' });
});

test('tool calls joined with their results (string or block content)', () => {
  const s = parseClaudeStream(L(init, toolUse, toolRes, result));
  assert.deepEqual(s.toolCalls, [{ id: 't1', name: 'Bash', input: { command: 'sh probe.sh' }, isError: false, output: 'PROBE a 0' }]);
});

test('terminal: valid result ⇒ completed with denials; is_error ⇒ failed', () => {
  const s = parseClaudeStream(L(init, result));
  assert.equal(s.terminal.status, 'completed');
  assert.deepEqual(s.terminal.permissionDenials, [{ tool: 'Edit', input: { file_path: 'x' } }]);
  assert.equal(parseClaudeStream(L({ ...result, is_error: true, subtype: 'error_max_turns' })).terminal.status, 'failed');
});

test('malformed terminal evidence never counts as completion', () => {
  for (const lines of [[], ['null'], ['not json'], ['{"type":"result"}'], [JSON.stringify({ type: 'result', subtype: 1, is_error: false })], [JSON.stringify({ type: 'result', subtype: 'success', is_error: 'no' })]]) {
    assert.equal(parseClaudeStream(lines).terminal.status, 'unknown', JSON.stringify(lines));
  }
});

test('missing init ⇒ inventory undefined (cannot claim isolation)', () => {
  assert.equal(parseClaudeStream(L(result)).inventory, undefined);
});
