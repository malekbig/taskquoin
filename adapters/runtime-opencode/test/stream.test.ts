/**
 * PROVES: real OpenCode 1.19.5 NDJSON runs (recorded in Task 1, sanitized) become a run outcome: completion, tool
 * calls, usage, permission denials, provider errors; a truncated final line never crashes (Review Focus 5).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseOpenCodeStream } from '../src/stream.ts';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}.ndjson`, import.meta.url), 'utf8').split('\n');

test('run-ok: completed, the apply_patch call, usage summed over steps, no error, no model reported', () => {
  const s = parseOpenCodeStream(fx('run-ok'));
  assert.equal(s.completed, true); assert.equal(s.error, undefined); assert.equal(s.model, undefined);
  assert.equal(s.toolCalls.length, 1); assert.equal(s.toolCalls[0].name, 'apply_patch'); assert.equal(s.toolCalls[0].isError, false);
  assert.ok(s.usage && s.usage.inputTokens! > 0 && s.usage.outputTokens! > 0);
  assert.deepEqual(s.denials, []);
});

test('run-denied: the refused reads are permission denials; the final text reports them', () => {
  const s = parseOpenCodeStream(fx('run-denied'));
  assert.equal(s.completed, true); assert.equal(s.denials.length, 2); assert.ok(s.denials.every(d => d.tool === 'read'));
  assert.match(s.text ?? '', /Refused|refused|no shell/);
});

test('run-error: the provider error is reported with its status; never completed', () => {
  const s = parseOpenCodeStream(fx('run-error'));
  assert.equal(s.completed, false); assert.match(s.error ?? '', /400/); assert.match(s.error ?? '', /not supported when using Codex with a ChatGPT account/);
});

test('a truncated final line or garbage never crashes; a reported model is surfaced', () => {
  const lines = fx('run-ok').filter(Boolean); const last = lines.pop()!;
  const s = parseOpenCodeStream([...lines, last.slice(0, 40), 'not json']);
  assert.equal(s.completed, false); assert.equal(s.toolCalls.length, 1);
  const m = parseOpenCodeStream([JSON.stringify({ type: 'step_start', part: { type: 'step-start', providerID: 'openai', modelID: 'gpt-other' } })]);
  assert.equal(m.model, 'openai/gpt-other');
});
