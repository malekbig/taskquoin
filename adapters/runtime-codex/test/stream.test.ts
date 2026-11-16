/**
 * PROVES: parseCodexStream extracts command executions (command, exit code, bounded output), turn completion/failure
 * and token usage from `codex exec --json` lines (shape observed on 0.157.1); malformed lines are ignored.
 * DOES NOT PROVE: the event shape on other versions.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCodexStream } from '../src/stream.ts';

const cmd = { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: "/bin/bash -lc 'sh probe.sh'", aggregated_output: 'PROBE a 0\n', exit_code: 0, status: 'completed' } };
const started = { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: 'x', aggregated_output: '', exit_code: null, status: 'in_progress' } };
const done = { type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 7 } };

test('command executions, completion and usage', () => {
  const s = parseCodexStream([JSON.stringify(started), JSON.stringify(cmd), 'garbage', 'null', JSON.stringify(done)]);
  assert.deepEqual(s.commandExecutions, [{ command: "/bin/bash -lc 'sh probe.sh'", exitCode: 0, status: 'completed', output: 'PROBE a 0\n' }]);
  assert.equal(s.turnCompleted, true);
  assert.equal(s.turnFailed, false);
  assert.deepEqual(s.usage, { inputTokens: 100, outputTokens: 7 });
});

test('turn.failed or error event ⇒ turnFailed', () => {
  assert.equal(parseCodexStream([JSON.stringify({ type: 'turn.failed', error: { message: 'x' } })]).turnFailed, true);
  assert.equal(parseCodexStream([JSON.stringify({ type: 'error', message: 'x' })]).turnFailed, true);
  assert.equal(parseCodexStream([]).turnCompleted, false);
});
