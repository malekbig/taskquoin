/**
 * PROVES: renderTimeline draws the 9 steps of a RunView with a glyph + word per state (ASCII fallback included), nests a
 * retry under its step, never prints a percentage or a bar, shows `?` for an unknown time (never a date made of ''),
 * keeps every line within the terminal width at 40..200 columns in en, fr, ja and ar, emits no escape without colour,
 * and neutralises agent, runtime, model, outcome and artifact names; timelineLine gives one inert line per progress event.
 * DOES NOT PROVE: that the run's real events produce these views (RunView's own tests) nor the console wiring (cli.test.ts, features).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectRun, type RunView, type StepId } from '@taskquoin/application';
import { setLanguage, t } from '../src/i18n/index.ts';
import { displayWidth } from '../src/i18n/width.ts';
import type { Caps } from '../src/tui/caps.ts';
import { renderTimeline, timelineLine } from '../src/tui/components/timeline.ts';

process.env.TZ = 'UTC';
const caps = (o: Partial<Caps> = {}): Caps => ({ interactive: false, cursor: false, colorDepth: 0, charset: 'utf8', theme: 'dark', motion: false, plain: false, columns: 100, rows: 24, ...o });
const IDS: StepId[] = ['planning', 'critique', 'plan-approval', 'implementation', 'verify', 'red-proof', 'review', 'commit-approval', 'commit'];
const T = (hms: string) => `2026-11-22T${hms}.000Z`;
/** A run waiting at the plan gate: planning and critique done, the rest pending. */
function atPlanGate(): RunView {
  return { runId: 'run-20261122T101500-ab12cd', status: 'waiting-approval', current: 'approve-plan', attempts: 0, branch: 'taskquoin/run-20261122T101500-ab12cd', startedAt: T('10:15:00'),
    pending: { gate: 'plan', binding: 'a'.repeat(64) },
    steps: IDS.map((id, i): RunView['steps'][number] => i === 0 ? { id, state: 'done', startedAt: T('10:15:00'), endedAt: T('10:16:40'), durationMs: 98_000, agent: 'planner', runtime: 'claude', attempts: [], artifacts: ['plan'] }
      : i === 1 ? { id, state: 'done', startedAt: T('10:16:40'), endedAt: T('10:17:30'), durationMs: 49_000, agent: 'challenger', runtime: 'codex', attempts: [], artifacts: ['challenge'] }
      : i === 2 ? { id, state: 'waiting', startedAt: T('10:17:30'), attempts: [], artifacts: [] }
      : { id, state: 'pending', attempts: [], artifacts: [] }) };
}
const NOW = Date.parse(T('10:21:30'));

test('a run at the plan gate: 9 steps, the right glyphs and words, no percentage', () => {
  setLanguage('en');
  const lines = renderTimeline(atPlanGate(), caps(), NOW);
  assert.equal(lines.length, 9);
  assert.match(lines[0], /^  ✔ Planning\s+done\s+planner · claude\s+10:16:40\s+1 min 38 s\s+\/show plan$/);
  assert.match(lines[1], /^  ✔ Adversarial critique\s+done\s+challenger · codex\s+10:17:30\s+49 s\s+\/show challenge$/);
  assert.match(lines[2], /^  ◆ Plan approval\s+waiting\s+4 min 0 s\s+aaaaaaaaaaaa$/);
  for (const l of lines.slice(3)) assert.match(l, /^  · \S.*\s+pending$/);
  assert.ok(lines.every(l => !/%|█|▓|░/.test(l)), 'no percentage, no bar');
});

test('the hint names the step\'s main artifact even when it has several', () => {
  setLanguage('en');
  const v = atPlanGate(); v.steps[0].artifacts = ['memory', 'plan']; v.steps[1].artifacts = ['challenge', 'challenge-challenger'];
  const lines = renderTimeline(v, caps(), NOW);
  assert.match(lines[0], /\/show plan$/); assert.match(lines[1], /\/show challenge$/);
});

test('ASCII charset: the fallback glyphs, and no colour code without colour', () => {
  setLanguage('en');
  const lines = renderTimeline(atPlanGate(), caps({ charset: 'ascii' }), NOW);
  assert.match(lines[0], /^  \[v\] Planning/); assert.match(lines[2], /^  \[!\] Plan approval/); assert.match(lines[3], /^  \[ \] Implementation/);
  assert.ok(lines.every(l => !l.includes('\x1b')));
  assert.ok(renderTimeline(atPlanGate(), caps({ colorDepth: 24 }), NOW).some(l => l.includes('\x1b[')), 'colour only when the terminal has it');
});

/** Implementation running its 2nd attempt after a failed Verify. */
function retrying(): RunView {
  const v = atPlanGate();
  v.status = 'running'; v.current = 'implement'; v.attempts = 2; delete v.pending;
  v.steps[2] = { id: 'plan-approval', state: 'done', startedAt: T('10:17:30'), endedAt: T('10:20:00'), durationMs: 150_000, attempts: [], artifacts: [] };
  v.steps[3] = { id: 'implementation', state: 'running', startedAt: T('10:25:00'), agent: 'implementer', runtime: 'claude', attempts: [
    { n: 1, outcome: 'tests-red:rework', endedAt: T('10:24:00') }, { n: 2, outcome: 'running' }], artifacts: [] };
  v.steps[4] = { id: 'verify', state: 'done', startedAt: T('10:22:00'), endedAt: T('10:24:00'), durationMs: 60_000, attempts: [{ n: 1, outcome: 'tests-red:rework', endedAt: T('10:24:00'), artifact: 'verify-1' }], artifacts: ['verify-1'] };
  return v;
}
test('a retry is nested under its step; the running step shows its elapsed time; the plan approval is not agent time', () => {
  setLanguage('en');
  const lines = renderTimeline(retrying(), caps(), Date.parse(T('10:29:12')));
  const i = lines.findIndex(l => /Implementation/.test(l));
  assert.match(lines[i], /^  ◉ Implementation\s+running\s+implementer · claude\s+4 min 12 s\s+attempt 2$/);
  assert.match(lines[i + 1], /^    │ ✖ attempt 1\s+failed\s+tests-red:rework$/);
  assert.match(lines[2], /^  ✔ Plan approval\s+done\s+10:20:00\s+2 min 30 s$/, 'no agent named on a human gate');
  assert.equal(lines.filter(l => /attempt 1/.test(l)).length, 1, 'a single pass is the step line itself, not nested');
  assert.match(lines.find(l => /Clean-room/.test(l))!, /^  ✔ Clean-room Verify\s+done\s+10:24:00\s+1 min 0 s\s+\/show verify-1$/);
  assert.match(renderTimeline(retrying(), caps({ charset: 'ascii' }), NOW).join('\n'), /\|\s+\[x\] attempt 1/);
});

test('an unknown start is `?`, never a date; a failed or interrupted step says so in words', () => {
  setLanguage('en');
  const v = retrying(); v.startedAt = ''; v.steps[3].startedAt = undefined;
  assert.match(renderTimeline(v, caps(), NOW)[3], /running\s+implementer · claude\s+\?/);
  const w = atPlanGate(); w.steps[0].endedAt = undefined; w.steps[0].durationMs = undefined;
  assert.match(renderTimeline(w, caps(), NOW)[0], /\?\s+\?/);
  assert.ok(renderTimeline(w, caps(), NOW).every(l => !/1970|NaN|Invalid/.test(l)));
  const f = retrying(); f.status = 'interrupted'; f.steps[3].state = 'failed'; f.steps[3].attempts[1].outcome = 'interrupted';
  assert.match(renderTimeline(f, caps(), NOW)[3], /‖ Implementation.*interrupted/);
  f.status = 'needs-human'; assert.match(renderTimeline(f, caps(), NOW)[3], /✖ Implementation.*needs a human/);
});

test('every line fits 40..200 columns in en, fr, ja and ar', () => {
  for (const lang of ['en', 'fr', 'ja', 'ar']) {
    setLanguage(lang);
    for (const view of [atPlanGate(), retrying()]) for (const columns of [40, 60, 80, 100, 120, 200]) for (const charset of ['utf8', 'ascii'] as const) {
      for (const l of renderTimeline(view, caps({ columns, charset }), NOW)) assert.ok(displayWidth(l) <= columns, `${lang} ${columns}: ${displayWidth(l)} ${l}`);
    }
  }
  setLanguage('en');
});

/** Every state a step can be in, with long names: pending, done, running, waiting, failed, interrupted, needs-human. */
function allStates(): { view: RunView; words: string[] }[] {
  const long = 'a-very-long-agent-name-that-overflows-a-narrow-terminal';
  const out: { view: RunView; words: string[] }[] = [];
  const mk = (v: RunView, st: Record<number, string>) => { v.steps.forEach(x => { x.agent ??= long; x.runtime ??= long; }); return { view: v, words: v.steps.map((x, i) => st[i] ?? t(`timeline.state.${x.state}` as 'timeline.state.done')) }; };
  out.push(mk(atPlanGate(), {})); out.push(mk(retrying(), {}));
  const f = retrying(); f.status = 'failed'; f.steps[3].state = 'failed'; out.push(mk(f, { 3: t('timeline.state.failed') }));
  const i = retrying(); i.status = 'interrupted'; i.steps[3].state = 'failed'; out.push(mk(i, { 3: t('timeline.state.interrupted') }));
  const h = retrying(); h.status = 'needs-human'; h.steps[3].state = 'failed'; out.push(mk(h, { 3: t('timeline.state.needsHuman') }));
  return out;
}
test('the state word of every step and retry line survives at 40..200 columns in en, fr, ja and ar, colour off', () => {
  for (const lang of ['en', 'fr', 'ja', 'ar']) {
    setLanguage(lang);
    for (const { view, words } of allStates()) for (const columns of [40, 60, 80, 100, 120, 200]) for (const charset of ['utf8', 'ascii'] as const) {
      const lines = renderTimeline(view, caps({ columns, charset, colorDepth: 0 }), NOW);
      const steps = lines.filter(l => !l.startsWith('    '));
      assert.equal(steps.length, 9);
      steps.forEach((l, k) => { assert.ok(l.includes(`  ${words[k]}`) || l.endsWith(words[k]), `${lang} ${columns}: step ${k} lost "${words[k]}": ${l}`); assert.ok(displayWidth(l) <= columns, l); });
      for (const l of lines.filter(x => x.startsWith('    '))) assert.ok([t('timeline.state.failed'), t('timeline.state.done'), t('timeline.state.running')].some(w => l.includes(w)), `${lang} ${columns}: nested line lost its word: ${l}`);
    }
  }
  setLanguage('en');
});
test('every state has its own word: pending and done included', () => {
  setLanguage('en');
  const lines = renderTimeline(retrying(), caps(), NOW);
  assert.match(lines[0], /✔ Planning\s+done/); assert.match(lines.at(-1)!, /· Commit\s+pending$/);
});

test('hostile agent, runtime, model, outcome and artifact names are made inert, and cut after that', () => {
  setLanguage('en');
  const v = retrying(); const ESC = String.fromCharCode(27);
  v.steps[3].agent = `x${ESC}[2Jy`; v.steps[3].runtime = `${ESC}]0;own\u0007`; v.steps[3].attempts[0].outcome = `bad${ESC}[31m`; v.steps[4].attempts[0].artifact = `a${ESC}b`;
  for (const columns of [40, 100]) for (const l of renderTimeline(v, caps({ columns }), NOW)) { assert.ok(!l.includes(ESC) && !l.includes('\u0007'), l); assert.ok(displayWidth(l) <= columns); }
  assert.match(renderTimeline(v, caps(), NOW).join('\n'), /x‹ESC›\[2Jy/);
});

test('works on a real projection: a fresh run at its first node', () => {
  setLanguage('en');
  const state = { runId: 'run-20261122T101500-ab12cd', request: 'x', status: 'running', current: 'recall', attempts: 0, history: [], artifacts: {}, approvals: {}, branch: 'b' } as never;
  const lines = renderTimeline(projectRun(state, []), caps(), Date.parse('2026-11-22T10:15:30Z'));
  assert.match(lines[0], /^  ◉ Planning\s+running\s+30 s$/);
  assert.equal(lines.length, 9);
});

test('timelineLine: one inert line per progress event, nothing for the others', () => {
  setLanguage('en');
  const c = caps(); const ts = T('10:16:40');
  assert.equal(timelineLine({ type: 'node.transition', ts, node: 'plan', outcome: 'planned', next: 'challenge' }, c), '  ✔ 10:16:40  plan  planned  →  challenge');
  assert.equal(timelineLine({ type: 'agent.started', ts, agent: 'planner', runtime: 'claude' }, c), '  ◉ 10:16:40  started: planner · claude');
  assert.equal(timelineLine({ type: 'agent.finished', ts, agent: 'planner', runtime: 'claude', status: 'completed', durationMs: 98_000, model: 'opus' }, c), '  ✔ 10:16:40  finished: planner · claude  1 min 38 s · opus');
  assert.match(timelineLine({ type: 'agent.finished', agent: 'a', runtime: 'r', status: 'failed', durationMs: 1000 }, c)!, /^  ✖ ended without success \(failed\): a · r  1 s$/);
  assert.equal(timelineLine({ type: 'verify.result', ts, attempt: 1, passed: false, exitCode: 1 }, c), '  ✖ 10:16:40  Verify attempt 1: not passed (exit 1)');
  assert.match(timelineLine({ type: 'verify.result', attempt: 2, passed: true, exitCode: 0 }, c)!, /✔ Verify attempt 2: passed/);
  assert.match(timelineLine({ type: 'red.result', attempt: 1, redFailed: true }, c)!, /✔ RED proof attempt 1: proven/);
  assert.match(timelineLine({ type: 'red.result', attempt: 1, redFailed: null }, c)!, /\? RED proof attempt 1: inconclusive/);
  assert.equal(timelineLine({ type: 'approval', node: 'approve-plan' }, c), undefined);
  assert.equal(timelineLine({ type: 'risk.accepted' }, c), undefined);
  assert.match(timelineLine({ type: 'agent.started', agent: 'p', runtime: 'c' }, caps({ charset: 'ascii' }))!, /^  \[>\] started/);
  const ESC = String.fromCharCode(27);
  const hostile = timelineLine({ type: 'agent.started', agent: `p${ESC}[2J`, runtime: 'c' }, caps({ columns: 30 }))!;
  assert.ok(!hostile.includes(ESC) && displayWidth(hostile) <= 30, hostile);
  // The model of an agent.finished is untrusted too, and the line is cut to the width AFTER neutralising.
  const model = timelineLine({ type: 'agent.finished', agent: 'p', runtime: 'c', status: 'completed', durationMs: 1000, model: `m${ESC}[2J\u202e` }, caps({ columns: 100 }))!;
  assert.ok(!model.includes(ESC) && !model.includes('\u202e'), model); assert.match(model, /m‹ESC›\[2J‹U\+202E›$/);
  for (const lang of ['en', 'ja']) {
    setLanguage(lang);
    const long = 'エージェント'.repeat(12);
    for (const ev of [{ type: 'agent.finished', agent: long, runtime: long, status: 'completed', durationMs: 5000, model: long }, { type: 'agent.started', agent: long, runtime: long }, { type: 'node.transition', ts, node: long, outcome: long, next: long }]) {
      for (const columns of [40, 60]) { const l = timelineLine(ev, caps({ columns }))!; assert.ok(displayWidth(l) <= columns, `${lang} ${columns}: ${displayWidth(l)} ${l}`); }
    }
  }
  setLanguage('en');
  assert.ok(!timelineLine({ type: 'node.transition', node: 'a', outcome: 'b', next: 'c' }, caps({ colorDepth: 0 }))!.includes(ESC));
});
