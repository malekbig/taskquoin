/**
 * PROVES: shownRun is the one place a RunView becomes printable — every free-text field (run id, branch, reason,
 * binding, agent / runtime / model, outcomes, times, artifact names) neutralised once with the one-line strict
 * profile, the number of marked characters returned with it, enum words, numbers and the shape unchanged, the input
 * untouched; a raw RunView<string> is refused where a RunView<Neutral> is expected (type test: `npm run typecheck`).
 * shownSquad says roles and note codes in the user's language and neutralises only the raw parts (console.test.ts
 * proves a translated ZWNJ is kept), counts the marks a screen prints (role, who, note), never cuts a risk note, and
 * treats a member without a code as all raw; a raw SquadMember<string> is refused where a neutral one is expected.
 * DOES NOT PROVE: that the console and the dashboard call it where they read the store (their own tests).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRun, projectRun, projectSquad, type RunState, type RunView, type SquadMember } from '@taskquoin/application';
import type { Neutral } from '../src/tui/neutral.ts';
import { shownRun, shownSquad } from '../src/tui/view.ts';

const CH = (c: number) => String.fromCodePoint(c);
const ESC = CH(0x1b), BEL = CH(7), RLO = CH(0x202e), LF = '\n';
const MK = (name: string) => `‹${name}›`;
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u;
const strings = (v: unknown): string[] => typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings)
  : v !== null && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

/** A view with something hostile in every kind of free-text field (as a forged store or a hostile agent could). */
const hostile = (): RunView<string> => ({
  runId: 'run-20261122T101500-ab12cd', status: 'failed', current: 'implement', attempts: 1, branch: `taskquoin/b${ESC}[2J`,
  startedAt: '2026-11-22T10:15:00.000Z', reason: `agent ended${ESC}]52;c;ZXZpbA==${BEL}`,
  pending: { gate: 'commit', binding: `f${RLO}f` },
  steps: [
    { id: 'planning', state: 'done', startedAt: '2026-11-22T10:15:00.000Z', endedAt: '2026-11-22T10:15:20.000Z', durationMs: 20_000,
      agent: `plan${ESC}ner`, runtime: 'claude', model: `m${LF}x`, attempts: [], artifacts: ['plan'],
      runs: [{ agent: 'planner', runtime: 'claude', model: `g${RLO}pt`, durationMs: 7_000 }] },
    { id: 'implementation', state: 'failed', attempts: [{ n: 1, outcome: `out${RLO}come`, endedAt: '2026-11-22T10:16:00.000Z', artifact: `implement${BEL}-1` }],
      artifacts: [`a${ESC}`, 'workspace-baseline'], outcome: `approved-by:o${BEL}` },
  ],
});

test('shownRun: every free-text field marked, the count exact, enums, numbers and shape unchanged, the input untouched', () => {
  const raw = hostile(), before = structuredClone(raw);
  const { view, marked } = shownRun(raw);
  assert.deepEqual(view, {
    runId: 'run-20261122T101500-ab12cd', status: 'failed', current: 'implement', attempts: 1, branch: `taskquoin/b${MK('ESC')}[2J`,
    startedAt: '2026-11-22T10:15:00.000Z', reason: `agent ended${MK('ESC')}]52;c;ZXZpbA==${MK('BEL')}`,
    pending: { gate: 'commit', binding: `f${MK('U+202E')}f` },
    steps: [
      { id: 'planning', state: 'done', startedAt: '2026-11-22T10:15:00.000Z', endedAt: '2026-11-22T10:15:20.000Z', durationMs: 20_000,
        agent: `plan${MK('ESC')}ner`, runtime: 'claude', model: `m${MK('LF')}x`, attempts: [], artifacts: ['plan'],
        runs: [{ agent: 'planner', runtime: 'claude', model: `g${MK('U+202E')}pt`, durationMs: 7_000 }] },
      { id: 'implementation', state: 'failed', attempts: [{ n: 1, outcome: `out${MK('U+202E')}come`, endedAt: '2026-11-22T10:16:00.000Z', artifact: `implement${MK('BEL')}-1` }],
        artifacts: [`a${MK('ESC')}`, 'workspace-baseline'], outcome: `approved-by:o${MK('BEL')}` },
    ],
  });
  assert.equal(marked, 11, 'branch, reason (2), binding, agent, model, attempt outcome, artifact, artifact name, step outcome, a judge\'s model');
  assert.deepEqual(raw, before, 'the projection handed in is not modified');
  assert.equal(shownRun(view).marked, 0, 'idempotent: a neutral view comes out the same, nothing counted twice');
});

test('shownRun over the real projection of a hostile stored run: no forbidden character left in any string', () => {
  const state: RunState = { ...newRun('run-20261122T101500-ab12cd', 'add x'), status: 'failed', current: 'implement', attempts: 1,
    branch: `taskquoin/${ESC}[31mx`, reason: `implement: boom${ESC}[2J${RLO}`,
    history: [{ node: 'recall', outcome: 'no-memory', at: '2026-11-22T10:15:10.000Z' }, { node: 'plan', outcome: 'planned', at: '2026-11-22T10:15:20.000Z' },
      { node: 'challenge', outcome: 'challenged:APPROVE', at: '2026-11-22T10:15:30.000Z' }, { node: 'approve-plan', outcome: `approved-by:ow${RLO}ner${ESC}[8m`, at: '2026-11-22T10:15:40.000Z' },
      { node: 'implement', outcome: 'failed', at: '2026-11-22T10:15:50.000Z' }],
    artifacts: { plan: 'p', [`implement-1${ESC}`]: 'i' } };
  const events = [{ type: 'agent.started', agent: `impl${ESC}]0;t${BEL}`, runtime: `cl${RLO}aude` },
    { type: 'agent.finished', agent: `impl${ESC}]0;t${BEL}`, runtime: `cl${RLO}aude`, model: `m${ESC}[5m`, durationMs: 5 }, { type: 'run.failed', node: 'implement' }];
  const raw = projectRun(state, events);
  assert.ok(strings(raw).some(s => FORBIDDEN.test(s)), 'the projection is raw');
  const { view, marked } = shownRun(raw);
  assert.deepEqual(strings(view).filter(s => FORBIDDEN.test(s)), []);
  assert.ok(marked > 0);
  assert.equal(view.reason, `implement: boom${MK('ESC')}[2J${MK('U+202E')}`);
});

test('a renderer that takes RunView<Neutral> refuses a raw projection (type test, checked by the typecheck)', () => {
  const renderer = (v: RunView<Neutral>): number => v.steps.length;
  const raw = projectRun(newRun('run-20261122T101500-ab12cd', 'add x'), []);
  // @ts-expect-error a RunView<string> straight from projectRun is not a neutral view: it must go through shownRun
  renderer(raw);
  assert.equal(renderer(shownRun(raw).view), 9);
  const old: RunView = shownRun(raw).view; // a neutral view still reads as the raw type: existing callers keep compiling
  assert.equal(old.steps.length, 9);
});

test('shownSquad: a hostile agent id and risky capability are marked and counted as printed; a risk note is never cut', () => {
  const caps = `${'x'.repeat(80)}${BEL}`;
  const raw = projectSquad({ [`a${ESC}`]: { runtime: 'claude' } }, () => ({ ok: true, runtimeFound: true, failures: [], acceptedRisks: [{ capability: caps }] }), true);
  const { view, marked } = shownSquad(raw);
  assert.deepEqual(view[0], { role: `A${MK('ESC')}`, who: `a${MK('ESC')} \u00b7 claude`, state: 'risk', agent: `a${MK('ESC')}`, runtime: 'claude', note: `${'x'.repeat(80)}${MK('BEL')}`, noteKind: 'risks' });
  assert.deepEqual(view[1], { role: 'Tester', who: 'verify \u00b7 bubblewrap', state: 'ready', runtime: 'bubblewrap' });
  assert.equal(marked, 3, 'role, who and note: what a screen prints');
});

test('shownSquad keeps each member\'s runtime (neutralised): the dashboard\'s Agents panel shows the runtime and its version, never `? ?`', async () => {
  const { agentRows } = await import('../src/dashboard-data.ts');
  const raw = projectSquad({ planner: { runtime: 'claude' }, judge: { runtime: `co${RLO}dex` } }, () => ({ ok: true, runtimeFound: true, failures: [], acceptedRisks: [] }), true);
  const { view } = shownSquad(raw);
  assert.deepEqual(view.map((m) => m.runtime), ['claude', `co${MK('U+202E')}dex`, 'bubblewrap']);
  const rows = agentRows({ version: '1', repo: 'r', acceptedRisks: [], squad: view, runtimeVersions: { claude: '2.1.330', bubblewrap: '0.6.1' }, checkedAt: '' });
  assert.deepEqual(rows.map((r) => r.runtime), ['claude 2.1.330', `co${MK('U+202E')}dex ?`, 'bubblewrap 0.6.1']);
});

test('shownSquad: a member without a code (built by hand) is all raw — its note neutralised, and cut when blocked', () => {
  const { view, marked } = shownSquad([{ role: 'r', who: `w${RLO}`, state: 'blocked', agent: 'judge', note: `${'n'.repeat(75)}${ESC}` }]);
  assert.deepEqual(view, [{ role: 'Judge', who: `w${MK('U+202E')}`, state: 'blocked', agent: 'judge', note: `${'n'.repeat(69)}\u2026` }]);
  assert.equal(marked, 2);
});

test('a renderer that takes SquadMember<Neutral> refuses the raw projection (type test, checked by the typecheck)', () => {
  const renderer = (squad: readonly SquadMember<Neutral>[]): number => squad.length;
  const raw = projectSquad({}, () => ({ ok: true, runtimeFound: true, failures: [], acceptedRisks: [] }), true);
  // @ts-expect-error a SquadMember<string> straight from projectSquad is not neutral: it must go through shownSquad
  renderer(raw);
  assert.equal(renderer(shownSquad(raw).view), 1);
});
