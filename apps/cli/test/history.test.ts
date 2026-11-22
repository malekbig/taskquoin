import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendHistory, loadHistory, scrubReadlineHistory } from '../src/history.ts';
import { promptFor } from '../src/console.ts';
import { displayWidth } from '../src/i18n/width.ts';

const store = () => ({ root: mkdtempSync(join(tmpdir(), 'tq-hist-')) }) as never;

test('only / commands are kept: a name or a retyped hash is not', () => {
  const s = store();
  for (const l of ['/run x', 'alice', 'ab12cd34ef56', '/status', 'free text', '   ']) appendHistory(s, l);
  assert.deepEqual(loadHistory(s), ['/run x', '/status']);
});

test('600 commands keep the last 500, file mode 0600', () => {
  const s = store();
  for (let i = 0; i < 600; i++) appendHistory(s, `/run n${i}`);
  const h = loadHistory(s);
  assert.equal(h.length, 500); assert.equal(h[0], '/run n100'); assert.equal(h[499], '/run n599');
  assert.equal(statSync(join((s as { root: string }).root, 'console-history')).mode & 0o777, 0o600);
});

test('a missing or odd file loads as empty / skips control characters', () => {
  const s = store();
  assert.deepEqual(loadHistory(s), []);
  appendHistory(s, '/run a\x1b[31m'); appendHistory(s, '/ok');
  assert.deepEqual(loadHistory(s), ['/ok']);
  assert.ok(!readFileSync(join((s as { root: string }).root, 'console-history'), 'utf8').includes('\x1b'));
});

test('readline in-memory history drops a line that is not a command', () => {
  const rl = { history: ['alice', '/status'] };
  scrubReadlineHistory(rl, 'alice'); assert.deepEqual(rl.history, ['/status']);
  scrubReadlineHistory(rl, '/status'); assert.deepEqual(rl.history, ['/status']);
  const h = { history: ['ab12cd34ef56'] }; scrubReadlineHistory(h, 'ab12cd34ef56'); assert.deepEqual(h.history, []);
});

test('the prompt shows the run and a waiting approval; its width ignores nothing visible', () => {
  assert.equal(promptFor(), 'taskquoin › ');
  assert.equal(promptFor('run-xxab12cd'), 'taskquoin [ab12cd] › ');
  assert.equal(promptFor('run-xxab12cd', 'commit'), 'taskquoin [ab12cd ◆ commit] › ');
  assert.equal(promptFor('run-xxab12cd', 'plan'), 'taskquoin [ab12cd ◆ plan] › ');
  assert.equal(displayWidth(promptFor('run-xxab12cd', 'commit')), 'taskquoin [ab12cd ◆ commit] › '.length);
});

test('the prompt shows a hostile run id as visible markers, never raw (the id came from outside)', () => {
  const p = promptFor('run-xx\x1b[2Jab', 'plan');
  assert.ok(!p.includes('\x1b'), JSON.stringify(p));
  assert.equal(p, 'taskquoin [‹ESC›[2Jab ◆ plan] › ');
});
