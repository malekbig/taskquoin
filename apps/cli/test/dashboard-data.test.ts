/**
 * PROVES: the dashboard's read-only watcher (spec §6, AC-4, AC-10, AC-13, AC-14) over a real control store on disk:
 *  - what it shows: runs newest first (at most 50), a state that does not parse is an `unreadable` row and the others
 *    stay listed, a missing `runs/` is an empty list, a hostile directory name is skipped, the selected run's view is
 *    exactly the console's `projectRun`, events newest first (at most 1 000, `cut` when older ones exist), partial and
 *    malformed lines counted in `skipped`;
 *  - how it stays honest: a state.json overwritten with garbage keeps the previous selection and sets `readError`, a
 *    removed run directory is `gone`, liveness comes from the lock's pid only (an integer above 0; a waiting run reads
 *    no lock), every hostile string of the CORPUS arrives neutral and `marked` counts it;
 *  - that it is read-only and cheap: after many polls the store is byte-identical (contents, sizes, mtimes, entries),
 *    an unchanged store gives `poll() === false` and the same model object, and the heap stays bounded.
 * DOES NOT PROVE: the 500 ms cadence (the loop of Task 5 owns the timer), nor that a real process holds a real lock
 * (a lock file is written by the test), nor `node --permission` (Task 5).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { projectRun, type RunState, type RunView } from '@taskquoin/application';
import { putArtifact, readEvents, repoStore, type RepoStore } from '@taskquoin/store-fs';
import { agentRows, artifactSha, createWatcher, eventLine, freshPending, loadDocs, type DashStatic, type SelectedRun } from '../src/dashboard-data.ts';
import { neutralize } from '../src/tui/neutral.ts';
import { CORPUS, FORBIDDEN } from './support/tui-fixtures.ts';

const root = mkdtempSync(join(tmpdir(), 'tq-dash-data-'));
after(() => rmSync(root, { recursive: true, force: true }));

const fresh = (): RepoStore => repoStore(mkdtempSync(join(root, 'repo-')), mkdtempSync(join(root, 'state-')));
const RID = 'run-20261122T101500-ab12cd';
const at = (k: number) => new Date(Date.parse('2026-11-22T10:15:00.000Z') + k * 10_000).toISOString();
const state = (id: string, o: Record<string, unknown> = {}) => ({
  runId: id, workflow: 'feature-governed', request: 'add a sum function', status: 'running', current: 'implement', revision: 1, attempts: 1,
  artifacts: {}, approvals: {}, history: [{ node: 'recall', outcome: 'ok', at: at(1) }, { node: 'plan', outcome: 'planned', at: at(2) }], ...o,
});
const put = (s: RepoStore, id: string, st: unknown, events: unknown[] = []): string => {
  const dir = join(s.runs, id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), typeof st === 'string' ? st : JSON.stringify(st));
  writeFileSync(join(dir, 'events.jsonl'), events.map(e => (typeof e === 'string' ? e : JSON.stringify(e)) + '\n').join(''));
  return dir;
};
const ev = (type: string, o: Record<string, unknown> = {}) => ({ type, ts: at(3), runId: RID, ...o });
const fixed: DashStatic = { version: '1.0.0', repo: 'demo', acceptedRisks: [], squad: [], runtimeVersions: {}, checkedAt: at(0) };
const clock = () => new Date(at(5));
const watch = (s: RepoStore, runId?: string, isAlive?: (pid: number) => boolean | undefined) => createWatcher(s, fixed, { ...(runId ? { runId } : {}), now: clock, ...(isAlive ? { isAlive } : {}) });
const strings = (v: unknown, out: string[] = []): string[] => {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => strings(x, out));
  else if (v !== null && typeof v === 'object') Object.values(v).forEach(x => strings(x, out));
  return out;
};
/** Every entry of a tree: kind, size, mode, mtime and the bytes' text — what a write of any kind would change. */
function snapshot(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name), st = lstatSync(p);
    out[relative(base, p)] = `${d.isDirectory() ? 'd' : 'f'} ${st.size} ${st.mode} ${st.mtimeMs} ${d.isFile() ? readFileSync(p, 'latin1') : ''}`;
    if (d.isDirectory()) snapshot(p, base, out);
  }
  return out;
}

test('a partial last line and a malformed line: the events are kept, skipped is 2 (AC-14), newest first', () => {
  const s = fresh();
  put(s, RID, state(RID), [ev('node.transition', { node: 'recall', outcome: 'ok', next: 'plan' }), 'not json', ev('agent.started', { agent: 'planner', runtime: 'claude' })]);
  appendFileSync(join(s.runs, RID, 'events.jsonl'), '{"type":"verify.res');
  const sel = watch(s, RID).model().selected!;
  assert.equal(sel.skipped, 2);
  assert.equal(sel.events.length, 2);
  assert.equal(sel.events[0]!.subject, 'planner'); // newest first
  assert.equal(sel.events[1]!.subject, 'recall');
  assert.equal(sel.cut, false);
});

test('a state.json overwritten with garbage keeps the previous selection and sets readError; fixing it clears it', () => {
  const s = fresh(); put(s, RID, state(RID));
  const w = watch(s, RID);
  const before = w.model().selected!;
  assert.equal(w.model().readError, undefined);
  writeFileSync(join(s.runs, RID, 'state.json'), '{"status":');
  assert.equal(w.poll(), true);
  assert.deepEqual(w.model().selected, before);
  assert.ok(w.model().readError);
  assert.equal(w.poll(), false);
  writeFileSync(join(s.runs, RID, 'state.json'), JSON.stringify(state(RID, { request: 'second' })));
  assert.equal(w.poll(), true);
  assert.equal(w.model().readError, undefined);
  assert.equal(w.model().selected!.request, 'second');
});

test('a run whose state is [] is an unreadable row; the others stay listed', () => {
  const s = fresh(); put(s, RID, state(RID));
  put(s, 'run-20261122T101600-bad000', '[]');
  put(s, 'run-20261122T101700-bad001', '{"status":7}');
  put(s, 'run-20261122T101800-bad002', '{"status":"banana"}');
  const runs = watch(s).model().runs;
  assert.deepEqual(runs.map(r => r.status), ['unreadable', 'unreadable', 'unreadable', 'running']);
  assert.equal(runs[3]!.runId, RID);
  assert.equal(runs[3]!.request, 'add a sum function');
});

test('nothing changed: poll() is false and model() is the same object; an appended event: poll() is true and it comes first', () => {
  const s = fresh(); put(s, RID, state(RID), [ev('agent.started', { agent: 'planner', runtime: 'claude' })]);
  const w = watch(s, RID);
  const m0 = w.model();
  for (let i = 0; i < 5; i++) assert.equal(w.poll(), false);
  assert.equal(w.model(), m0);
  appendFileSync(join(s.runs, RID, 'events.jsonl'), JSON.stringify(ev('verify.result', { passed: true, attempt: 1 })) + '\n');
  assert.equal(w.poll(), true);
  assert.notEqual(w.model(), m0);
  assert.equal(w.model().selected!.events[0]!.subject, 'verify.result');
  assert.equal(w.model().selected!.events.length, 2);
  assert.equal(w.poll(), false);
});

test('a state change alone (a new run appears) is a change', () => {
  const s = fresh(); put(s, RID, state(RID));
  const w = watch(s, RID);
  put(s, 'run-20261122T120000-000001', state('run-20261122T120000-000001'));
  assert.equal(w.poll(), true);
  assert.equal(w.model().runs.length, 2);
  assert.equal(w.model().runs[0]!.runId, 'run-20261122T120000-000001');
});

test('100 000 event lines: the model holds the last 1 000, cut is true', () => {
  const s = fresh();
  const lines = Array.from({ length: 100_000 }, (_, i) => JSON.stringify({ type: 'agent.started', ts: at(3), agent: 'planner', runtime: 'claude', i }));
  const dir = put(s, RID, state(RID));
  writeFileSync(join(dir, 'events.jsonl'), lines.join('\n') + '\n');
  const sel = watch(s, RID).model().selected!;
  assert.equal(sel.events.length, 1000);
  assert.equal(sel.cut, true);
});

test('heap probe (AC-13): 100 000 event lines, 50 polls with appends, growth under 20 MB and at most 1 000 events', () => {
  const s = fresh();
  const dir = put(s, RID, state(RID));
  writeFileSync(join(dir, 'events.jsonl'), Array.from({ length: 100_000 }, (_, i) => JSON.stringify({ type: 'agent.started', ts: at(3), agent: 'planner', runtime: 'claude', i })).join('\n') + '\n');
  const r = spawnSync(process.execPath, ['--expose-gc', new URL('./support/heap-events.ts', import.meta.url).pathname, join(dir, 'events.jsonl')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const m = /heap growth (-?[\d.]+) MB, (\d+) events/.exec(r.stdout);
  assert.ok(m, r.stdout);
  assert.ok(Number(m[1]) < 20, r.stdout);
  assert.ok(Number(m[2]) > 0 && Number(m[2]) <= 1000, r.stdout);
});

test('liveness: an exited child pid is none, our own pid is live, no lock is none, an unknown answer is unknown', () => {
  const s = fresh(); const dir = put(s, RID, state(RID));
  const child = spawnSync(process.execPath, ['-e', '']); assert.equal(child.status, 0);
  assert.ok(child.pid > 0);
  writeFileSync(join(dir, 'lock'), String(child.pid));
  assert.equal(watch(s, RID).model().selected!.liveness, 'none');
  writeFileSync(join(dir, 'lock'), String(process.pid));
  assert.equal(watch(s, RID).model().selected!.liveness, 'live');
  assert.equal(watch(s, RID).model().runs[0]!.liveness, 'live');
  rmSync(join(dir, 'lock'));
  assert.equal(watch(s, RID).model().selected!.liveness, 'none');
  writeFileSync(join(dir, 'lock'), '4242');
  assert.equal(watch(s, RID, () => undefined).model().selected!.liveness, 'unknown');
  // the default probe: EPERM means the process exists (pid 1 belongs to another user for us), ESRCH it does not
  const w = watch(s, RID, (pid) => { assert.equal(pid, 4242); return false; });
  assert.equal(w.model().selected!.liveness, 'none');
});

test('liveness follows the process: it dying alone is a change', () => {
  const s = fresh(); const dir = put(s, RID, state(RID));
  writeFileSync(join(dir, 'lock'), '4242');
  let alive = true;
  const w = watch(s, RID, () => alive);
  assert.equal(w.model().selected!.liveness, 'live');
  assert.equal(w.poll(), false);
  alive = false;
  assert.equal(w.poll(), true);
  assert.equal(w.model().selected!.liveness, 'none');
  assert.equal(w.model().runs[0]!.liveness, 'live'); // rows refresh with their state.json, not on each poll
});

test('a lock that is not a pid above 0 is none and the process is never probed (kill(0) would signal our group)', () => {
  const s = fresh(); const dir = put(s, RID, state(RID));
  for (const text of ['', 'abc', '0', '-5', '1.5', '12 34', '99999999999', ' \n', '1e3']) {
    writeFileSync(join(dir, 'lock'), text);
    let probed = 0;
    const w = watch(s, RID, () => { probed++; return true; });
    assert.equal(w.model().selected!.liveness, 'none', JSON.stringify(text));
    assert.equal(probed, 0, JSON.stringify(text));
  }
  // a lock that is a directory or a link is no lock either
  rmSync(join(dir, 'lock')); mkdirSync(join(dir, 'lock'));
  let probed = 0;
  assert.equal(watch(s, RID, () => { probed++; return true; }).model().selected!.liveness, 'none');
  assert.equal(probed, 0);
});

test('a waiting run reads no lock: no probe, liveness none', () => {
  const s = fresh();
  const dir = put(s, RID, state(RID, { status: 'waiting-approval', current: 'approve-plan', artifacts: { plan: 'a'.repeat(64) } }));
  writeFileSync(join(dir, 'lock'), String(process.pid));
  let probed = 0;
  const m = watch(s, RID, () => { probed++; return true; }).model();
  assert.equal(probed, 0);
  assert.equal(m.selected!.liveness, 'none');
  assert.equal(m.runs[0]!.liveness, undefined);
  assert.equal(m.runs[0]!.waiting, 'plan');
});

test('a row says which gate waits', () => {
  const s = fresh();
  put(s, RID, state(RID, { status: 'waiting-approval', current: 'approve-commit', reviewedTree: 'b'.repeat(40) }));
  put(s, 'run-20261122T101600-000002', state('run-20261122T101600-000002', { status: 'waiting-approval', current: 'approve-commit' })); // no reviewed tree: nothing is approvable
  const runs = watch(s).model().runs;
  assert.equal(runs.find(r => r.runId === RID)!.waiting, 'commit');
  assert.equal(runs.find(r => r.runId === 'run-20261122T101600-000002')!.waiting, undefined);
});

test('every CORPUS string as request, reason, event agent / outcome / label and approvedBy: inert in the model, counted in marked', () => {
  for (const c of CORPUS) {
    const per = neutralize(c, { singleLine: true }).marked;
    assert.ok(per > 0, c);
    const s = fresh();
    put(s, RID, state(RID, { request: c, status: 'failed', current: 'plan', reason: c, history: [] }), [
      ev('agent.started', { agent: c, runtime: 'claude', label: c }),
      ev('approval', { node: 'approve-plan', approvedBy: c }),
      ev('node.transition', { node: 'plan', outcome: c, next: 'challenge' }),
    ]);
    const m = watch(s, RID).model();
    for (const str of strings(m)) assert.ok(!FORBIDDEN.test(str), JSON.stringify(str));
    // request 1, reason 1 (in the view), agent.started agent + label 2, approval approvedBy 1, transition outcome 1
    assert.equal(m.selected!.marked, 6 * per, JSON.stringify(c));
    assert.equal(m.selected!.events.reduce((a, e) => a + e.marked, 0), 4 * per);
  }
});

test('eventLine: every known type through its key, the unknown one by name, at from ts or empty', () => {
  const l = (e: Record<string, unknown>) => eventLine(e);
  assert.deepEqual(l({ type: 'node.transition', ts: 'T', node: 'plan', outcome: 'planned', next: 'challenge' }), { at: 'T', subject: 'plan', text: 'planned, next challenge', marked: 0 });
  assert.equal(l({ type: 'agent.started', agent: 'planner', runtime: 'claude', label: 'claude' }).text, 'started on claude');
  assert.equal(l({ type: 'agent.started', agent: 'planner', runtime: 'codex' }).text, 'started on codex');
  assert.equal(l({ type: 'agent.finished', agent: 'planner', label: 'claude', status: 'completed' }).text, 'finished on claude: completed');
  assert.deepEqual([l({ type: 'verify.result', passed: true, attempt: 2 }).text, l({ type: 'verify.result', passed: true, attempt: 2 }).tone], ['tests passed (attempt 2)', 'green']);
  assert.deepEqual([l({ type: 'verify.result', passed: false, attempt: 1, exitCode: 1 }).text, l({ type: 'verify.result', passed: false, exitCode: 1 }).tone], ['tests failed, exit 1 (attempt 1)', 'red']);
  assert.equal(l({ type: 'verify.result', passed: false, attempt: 1, exitCode: null }).text, 'tests failed, exit ? (attempt 1)');
  assert.equal(l({ type: 'red.result', redFailed: true, attempt: 1 }).tone, 'green');
  assert.equal(l({ type: 'red.result', redFailed: false, attempt: 1 }).tone, 'red');
  assert.equal(l({ type: 'red.result', redFailed: null, inconclusive: true, attempt: 1 }).tone, 'amber');
  assert.deepEqual(l({ type: 'approval', node: 'approve-plan', approvedBy: 'alice' }), { at: '', subject: 'approve-plan', text: 'approved by alice', tone: 'green', marked: 0 });
  assert.equal(l({ type: 'risk.accepted', agent: 'implementer', capability: 'shell.run', approvedBy: 'bob' }).text, 'risk accepted: shell.run, by bob');
  assert.deepEqual(l({ type: 'run.failed', node: 'verify' }), { at: '', subject: 'run', text: 'run failed at verify', tone: 'red', marked: 0 });
  assert.equal(l({ type: 'run.waiting-approval', node: 'approve-plan' }).tone, 'amber');
  assert.equal(l({ type: 'run.completed', node: 'done' }).tone, 'green');
  assert.deepEqual(l({ type: 'something.new', ts: 5 }), { at: '', subject: '', text: 'something.new', marked: 0 });
  assert.equal(l({}).text, '?');
});

test('the selected run\'s directory removed: gone, and the list is refreshed without it', () => {
  const s = fresh(); const dir = put(s, RID, state(RID));
  put(s, 'run-20261122T101600-000002', state('run-20261122T101600-000002'));
  const w = watch(s, RID);
  assert.equal(w.model().runs.length, 2);
  rmSync(dir, { recursive: true });
  assert.equal(w.poll(), true);
  assert.equal(w.model().selected!.gone, true);
  assert.equal(w.model().selected!.runId, RID); // what was last read stays on screen
  assert.deepEqual(w.model().runs.map(r => r.runId), ['run-20261122T101600-000002']);
  assert.equal(w.poll(), false);
});

test('an initialised store without runs/: runs is empty and the tree is untouched by the polls', () => {
  const s = fresh();
  rmSync(s.runs, { recursive: true });
  const before = snapshot(s.root);
  const w = watch(s);
  for (let i = 0; i < 10; i++) w.poll();
  assert.deepEqual(w.model().runs, []);
  assert.equal(w.model().selected, undefined);
  assert.deepEqual(snapshot(s.root), before);
  assert.ok(!Object.keys(snapshot(s.root)).includes('runs'));
});

test('60 runs: the 50 newest, newest first', () => {
  const s = fresh();
  for (let m = 0; m < 60; m++) { const id = `run-20261122T10${String(m).padStart(2, '0')}00-abcdef`; put(s, id, state(id)); }
  const runs = watch(s).model().runs;
  assert.equal(runs.length, 50);
  assert.equal(runs[0]!.runId, 'run-20261122T105900-abcdef');
  assert.equal(runs[49]!.runId, 'run-20261122T101000-abcdef');
});

test('startedAt and short: a timestamped id gives its UTC time and its last segment; run-a gives an empty startedAt', () => {
  const s = fresh(); put(s, RID, state(RID)); put(s, 'run-a', state('run-a')); put(s, 'plain', state('plain'));
  const by = new Map(watch(s).model().runs.map(r => [r.runId, r]));
  assert.equal(by.get(RID)!.startedAt, '2026-11-22T10:15:00.000Z');
  assert.equal(by.get(RID)!.short, 'ab12cd');
  assert.equal(by.get('run-a')!.startedAt, '');
  assert.equal(by.get('run-a')!.short, 'a');
  assert.equal(by.get('plain')!.short, 'plain');
});

test('a hostile directory name is skipped, selecting it does not crash, and the other runs are listed', () => {
  const s = fresh(); put(s, RID, state(RID));
  const evil = 'run-\u001b[31m-x';
  put(s, evil, state(evil));
  put(s, 'a b', state('a b'));
  const w = watch(s);
  assert.deepEqual(w.model().runs.map(r => r.runId), [RID]);
  assert.doesNotThrow(() => w.select(evil));
  assert.equal(w.model().selected, undefined);
  assert.doesNotThrow(() => w.poll());
  w.select(RID);
  assert.equal(w.model().selected!.runId, RID);
});

test('state.json as a symlink is an unreadable row, never followed', () => {
  const s = fresh(); put(s, RID, state(RID));
  const id = 'run-20261122T101600-000002';
  const dir = join(s.runs, id); mkdirSync(dir);
  writeFileSync(join(root, 'elsewhere.json'), JSON.stringify(state(id)));
  symlinkSync(join(root, 'elsewhere.json'), join(dir, 'state.json'));
  const runs = watch(s).model().runs;
  assert.equal(runs.find(r => r.runId === id)!.status, 'unreadable');
});

test('the selected view is exactly the console\'s projection of the same state and events (spec §6)', () => {
  const s = fresh();
  const st = state(RID, { current: 'verify', history: [{ node: 'recall', outcome: 'ok', at: at(1) }, { node: 'plan', outcome: 'planned', at: at(2) }, { node: 'challenge', outcome: 'challenged:APPROVE', at: at(3) }], branch: 'taskquoin/x' });
  put(s, RID, st, [ev('agent.started', { agent: 'planner', runtime: 'claude' }), ev('agent.finished', { agent: 'planner', runtime: 'claude', model: 'opus', status: 'completed', durationMs: 1500 }), ev('node.transition', { node: 'plan', outcome: 'planned', next: 'challenge' })]);
  const sel = watch(s, RID).model().selected!;
  assert.deepEqual(sel.view, projectRun(JSON.parse(readFileSync(join(s.runs, RID, 'state.json'), 'utf8')) as RunState, readEvents(s, RID).events));
  assert.equal(sel.marked, 0);
  assert.equal(sel.request, 'add a sum function');
});

test('the request is its first line only', () => {
  const s = fresh(); put(s, RID, state(RID, { request: 'first line\nsecond line' }));
  const m = watch(s, RID).model();
  assert.equal(m.runs[0]!.request, 'first line');
  assert.equal(m.selected!.request, 'first line');
});

test('select() switches the selected run and the model changes', () => {
  const s = fresh(); put(s, RID, state(RID, { request: 'one' })); const id2 = 'run-20261122T101600-000002'; put(s, id2, state(id2, { request: 'two' }));
  const w = watch(s, RID);
  assert.equal(w.model().selected!.request, 'one');
  const m0 = w.model();
  w.select(id2);
  assert.notEqual(w.model(), m0);
  assert.equal(w.model().selected!.request, 'two');
  assert.equal(w.poll(), false);
});

test('without a run id the newest run is selected', () => {
  const s = fresh(); put(s, RID, state(RID)); const id2 = 'run-20261122T101600-000002'; put(s, id2, state(id2));
  assert.equal(watch(s).model().selected!.runId, id2);
});

test('READ-ONLY: after many polls (selected run live, locked, events growing in the test) the store is byte-identical and nothing was created', () => {
  const s = fresh();
  const dir = put(s, RID, state(RID), [ev('agent.started', { agent: 'planner', runtime: 'claude' })]);
  put(s, 'run-20261122T101600-000002', state('run-20261122T101600-000002', { status: 'completed' }));
  put(s, 'run-20261122T101700-000003', '{"status":');
  writeFileSync(join(dir, 'lock'), String(process.pid));
  const before = snapshot(s.root);
  const w = watch(s, RID);
  for (let i = 0; i < 40; i++) w.poll();
  w.select('run-20261122T101600-000002'); w.select(RID);
  for (let i = 0; i < 40; i++) w.poll();
  assert.deepEqual(snapshot(s.root), before);
  assert.deepEqual(Object.keys(snapshot(s.root)).sort(), Object.keys(before).sort());
});

test('agentRows: runtime with its version or ?, the latest model of the agent, Tester null, workingSince only when live', () => {
  const squad: DashStatic['squad'] = [
    { role: 'Developer', who: 'implementer · claude', state: 'ready', agent: 'implementer', runtime: 'claude' },
    { role: 'Reviewer', who: 'challenger · codex', state: 'risk', note: 'shell.run', agent: 'challenger', runtime: 'codex' },
    { role: 'Tester', who: 'verify · bubblewrap', state: 'ready', runtime: 'bubblewrap' },
  ];
  const f: DashStatic = { ...fixed, squad, runtimeVersions: { claude: '2.1.327', bubblewrap: '0.9' } };
  const view = { steps: [
    { id: 'planning', state: 'done', agent: 'implementer', model: 'old-model', attempts: [], artifacts: [] },
    { id: 'implementation', state: 'running', startedAt: '2026-11-22T10:16:00.000Z', agent: 'implementer', model: 'new-model', attempts: [], artifacts: [] },
  ] } as unknown as RunView<never>;
  const sel = (liveness: SelectedRun['liveness']): SelectedRun => ({ runId: RID, view, request: '', marked: 0, events: [], skipped: 0, cut: false, liveness });
  const live = agentRows(f, sel('live'));
  assert.deepEqual(live[0], { id: 'implementer', role: 'Developer', runtime: 'claude 2.1.327', model: 'new-model', state: 'ready', workingSince: '2026-11-22T10:16:00.000Z' });
  assert.equal(live[1]!.runtime, 'codex ?');
  assert.equal(live[1]!.model, undefined);
  assert.equal(live[1]!.workingSince, undefined);
  assert.equal(live[1]!.note, 'shell.run');
  assert.equal(live[2]!.model, null);
  assert.equal(live[2]!.runtime, 'bubblewrap 0.9');
  assert.equal(live[2]!.id, undefined);
  for (const l of ['none', 'unknown'] as const) assert.equal(agentRows(f, sel(l))[0]!.workingSince, undefined, l);
  assert.equal(agentRows(f)[0]!.model, undefined);
  // a judge that is not the step's last one still shows its own model
  const judges = { steps: [{ id: 'review', state: 'done', agent: 'challenger', model: 'm2', attempts: [], artifacts: [], runs: [{ agent: 'implementer', model: 'm1' }, { agent: 'challenger', model: 'm2' }] }] } as unknown as RunView<never>;
  assert.equal(agentRows(f, { ...sel('none'), view: judges })[0]!.model, 'm1');
});

// ---- loadDocs, freshPending ----------------------------------------------------------------------------------------

const art = (s: RepoStore, name: string, text: string | Buffer): string => putArtifact(s, Buffer.isBuffer(text) ? text : Buffer.from(text), { mediaType: 'text/plain', producer: name }).sha256;
const DIFF = ['diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -1 +1 @@', '-x', '+y', ''].join('\n');
const names = (r: ReturnType<typeof loadDocs>): string[] => ('error' in r ? [`error: ${r.error}`] : r.docs.map((d) => d.name));

test('loadDocs review: plan and challenge at the plan gate or before any diff, else the highest diff-N (numerically)', () => {
  const s = fresh();
  put(s, RID, state(RID, { status: 'waiting-approval', current: 'approve-plan', artifacts: { plan: art(s, 'plan', 'P'), challenge: art(s, 'challenge', 'C'), 'diff-2': art(s, 'd2', DIFF) } }));
  assert.deepEqual(names(loadDocs(s, RID, 'review')), ['plan', 'challenge'], 'at the plan gate even with an older diff');
  const t = fresh();
  put(t, RID, state(RID, { current: 'implement', artifacts: { plan: art(t, 'plan', 'P'), challenge: art(t, 'challenge', 'C') } }));
  const r = loadDocs(t, RID, 'review');
  assert.deepEqual(names(r), ['plan', 'challenge']);
  assert.ok(!('error' in r) && r.artifact === 'plan' && r.sha === art(t, 'plan', 'P') && /^Plan/.test(r.title));
  const u = fresh();
  put(u, RID, state(RID, { status: 'waiting-approval', current: 'approve-commit', attempts: 10, reviewedTree: 'c'.repeat(40), artifacts: { plan: art(u, 'p', 'P'), 'diff-2': art(u, 'd2', 'two'), 'diff-10': art(u, 'd10', DIFF) } }));
  const d = loadDocs(u, RID, 'review');
  assert.deepEqual(names(d), ['a.js']);
  assert.ok(!('error' in d) && d.artifact === 'diff-10' && d.binding === 'c'.repeat(40) && /^Diff/.test(d.title));
  const w = fresh();
  put(w, RID, state(RID, { status: 'waiting-approval', current: 'approve-commit', attempts: 3, reviewedTree: 'c'.repeat(40), artifacts: { 'diff-2': art(w, 'd2', DIFF) } }));
  assert.equal((loadDocs(w, RID, 'review') as { binding?: string }).binding, undefined, 'not diff-<attempts>: no binding');
});

test('loadDocs verify: the highest verify-N and its red-N; none yet is a plain message', () => {
  const s = fresh();
  put(s, RID, state(RID, { artifacts: { 'verify-1': art(s, 'a', 'one'), 'verify-2': art(s, 'b', 'two'), 'red-2': art(s, 'c', 'red'), 'red-1': art(s, 'd', 'old') } }));
  assert.deepEqual(names(loadDocs(s, RID, 'verify')), ['verify-2', 'red-2']);
  const e = fresh(); put(e, RID, state(RID));
  assert.match(names(loadDocs(e, RID, 'verify'))[0]!, /^error: nothing to show/);
  assert.match(names(loadDocs(e, RID, 'review'))[0]!, /^error: nothing to show/);
});

test('loadDocs: bytes that do not match the hash, a missing file, a bad state and a hostile id are errors, never throws', () => {
  const s = fresh();
  const bad = 'e'.repeat(64);
  writeFileSync(join(s.artifacts, bad), 'tampered');
  put(s, RID, state(RID, { artifacts: { plan: bad } }));
  assert.match((loadDocs(s, RID, 'review') as { error: string }).error, /does not match its hash/);
  put(s, 'run-b', state('run-b', { artifacts: { plan: 'a'.repeat(64) } }));
  assert.match((loadDocs(s, 'run-b', 'review') as { error: string }).error, /cannot be read/);
  put(s, 'run-c', 'not json');
  assert.ok('error' in loadDocs(s, 'run-c', 'review'));
  assert.ok('error' in loadDocs(s, 'nope', 'review'));
  assert.ok('error' in loadDocs(s, '../../etc', 'review'));
  put(s, 'run-d', state('run-d', { artifacts: { plan: '../../x' } }));
  assert.ok('error' in loadDocs(s, 'run-d', 'review'));
});

test('loadDocs refuses an artifact over 4 MiB by its size alone: it is never read (its bytes would not match its name)', () => {
  const s = fresh();
  const big = '9'.repeat(64);
  writeFileSync(join(s.artifacts, big), Buffer.alloc(5 * 1024 * 1024, 0x61));
  put(s, RID, state(RID, { artifacts: { plan: big } }));
  const r = loadDocs(s, RID, 'review') as { error: string };
  assert.match(r.error, /plan is 5\.0 MiB/);
  assert.ok(r.error.endsWith(`taskquoin show ${RID} plan`), r.error);
  assert.ok(!/does not match/.test(r.error));
  const ok = fresh();
  put(ok, RID, state(RID, { artifacts: { plan: art(ok, 'p', Buffer.alloc(4 * 1024 * 1024, 0x61)) } }));
  assert.ok(!('error' in loadDocs(ok, RID, 'review')), 'exactly 4 MiB is shown');
});

test('loadDocs: a hostile diff arrives neutral, with the marks counted per file', () => {
  const s = fresh();
  const E = String.fromCharCode(0x1b);
  const text = `diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+${E}[31mred \u202e${E}]52;c;QQ==\u0007\n`;
  put(s, RID, state(RID, { artifacts: { 'diff-1': art(s, 'd', text) } }));
  const r = loadDocs(s, RID, 'review');
  assert.ok(!('error' in r));
  const doc = (r as { docs: { marked: number; lines: { text: string }[] }[] }).docs[0]!;
  assert.ok(doc.marked >= 4);
  for (const str of strings(r)) assert.ok(!FORBIDDEN.test(str));
});

test('freshPending reads state.json now: the gate and binding, or nothing; artifactSha likewise', () => {
  const s = fresh();
  put(s, RID, state(RID, { status: 'waiting-approval', current: 'approve-commit', reviewedTree: 'c'.repeat(40), artifacts: { 'diff-1': 'f'.repeat(64) } }));
  assert.deepEqual(freshPending(s, RID), { gate: 'commit', binding: 'c'.repeat(40) });
  assert.equal(artifactSha(s, RID, 'diff-1'), 'f'.repeat(64));
  assert.equal(artifactSha(s, RID, 'nope'), undefined);
  put(s, RID, state(RID, { status: 'waiting-approval', current: 'approve-plan', artifacts: { plan: 'a'.repeat(64) } }));
  assert.deepEqual(freshPending(s, RID), { gate: 'plan', binding: 'a'.repeat(64) });
  put(s, RID, state(RID));
  assert.equal(freshPending(s, RID), undefined);
  assert.equal(freshPending(s, 'missing'), undefined);
  assert.equal(freshPending(s, '..'), undefined);
});

test('loading documents leaves the control store unchanged', () => {
  const s = fresh();
  put(s, RID, state(RID, { artifacts: { plan: art(s, 'p', 'P'), 'verify-1': art(s, 'v', 'V') } }));
  const before = snapshot(s.root);
  loadDocs(s, RID, 'review'); loadDocs(s, RID, 'verify'); freshPending(s, RID);
  assert.deepEqual(snapshot(s.root), before);
});
