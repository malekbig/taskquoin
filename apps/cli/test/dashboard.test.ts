/**
 * PROVES: the dashboard's key table in lower and upper case (focus, tab, Tab / Shift+Tab cycle, cursor, ends, pages,
 * help, Esc, Ctrl+C, q), that `y`, `Y`, Enter and Space never yield an effect and that a paste is ignored; that
 * `q` resolves 0 with the terminal given back (RESTORE last, raw mode off) and every timer cleared; the initial
 * selection (the given run, else the newest running or waiting, else the newest); the Runs cursor selects; a bare Esc
 * is delivered by the 50 ms flush; AC-15: a static store writes nothing in 5 000 ms after its first frame and a live
 * running run writes at most 5 frames in 5 000 ms, each one `write` of changed rows only; a resize shows the too-small
 * message, then rewrites every row once; an appended event is on screen within one 500 ms poll; AC-12: with a writer
 * appending an event every 10 ms, 100 keys 20 ms apart reach the screen with p95 < 50 ms; AC-10: under
 * `node --permission --allow-fs-read=*` the real loop browses every run, every panel and the help over a seeded store
 * and exits 0 with the control store's tree unchanged.
 * R4: `p` opens the approval center only alone in its chunk, for a waiting gate, when the dashboard can approve; the
 * typed hash goes to one `taskquoin approve` (fake spawn); the store's approval, not the exit code, says approved; a
 * refusal shows the child's neutralised output and "nothing was approved"; a gate approved elsewhere opens as no
 * longer waiting; a changed tree refuses; keys typed while the terminal is too small are dropped and the field
 * survives the resize; quitting while the process runs asks, and stderr names the pid and the log afterwards; the
 * read-only driver run opens and cancels the centre with the store byte-identical and no process attempted.
 * DOES NOT PROVE: a real terminal's bytes (screen tests, the PTY harness); the real child (cli.test.ts end to end).
 */
import { test, mock, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, writeSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { putArtifact, repoStore, type RepoStore } from '@taskquoin/store-fs';
import { onKey, runDashboard, type DashDeps } from '../src/dashboard.ts';
import type { DashboardModel, DashStatic } from '../src/dashboard-data.ts';
import { initialUi, type UiState } from '../src/tui/components/dashboard-frame.ts';
import { KEY_TABLE } from '../src/tui/components/help-panel.ts';
import { keyDecoder, type KeyChunk } from '../src/tui/keys.ts';
import { RESTORE } from '../src/tui/screen.ts';
import { caps as mkCaps, fakeSignals, fakeTty, FORBIDDEN, SGR, type FakeTty } from './support/tui-fixtures.ts';

process.env.TZ = 'UTC';
const root = mkdtempSync(join(tmpdir(), 'tq-dash-loop-'));
after(() => rmSync(root, { recursive: true, force: true }));

// ---- the key table ------------------------------------------------------------------------------------------------

const keys = (s: string): KeyChunk => { const d = keyDecoder(); return [...d.feed(s), ...d.flush()].reduce((a, c) => ({ keys: [...a.keys, ...c.keys], multi: a.multi || c.multi || a.keys.length + c.keys.length > 1 }), { keys: [], multi: false } as KeyChunk); };
const run = (id: string, status = 'completed') => ({ runId: id, short: id.slice(-6), status, request: 'x', startedAt: '' });
const synthetic = (): DashboardModel => ({
  fixed: { squad: [{}, {}, {}] } as unknown as DashStatic,
  runs: Array.from({ length: 25 }, (_, i) => run(`run-${String(i).padStart(2, '0')}`)) as DashboardModel['runs'],
  selected: { runId: 'run-00', events: Array.from({ length: 30 }, () => ({})) } as unknown as DashboardModel['selected'],
  lastChange: '',
});
const ui0 = (o: Partial<UiState> = {}): UiState => ({ ...initialUi(), ...o });
const press = (ui: UiState, s: string, m = synthetic()) => onKey(ui, keys(s), m);

test('r a l p focus the panel (and tab for the tabbed ones), upper case the same', () => {
  for (const [k, focus, tab] of [['r', 'runs', 'runs'], ['a', 'agents', 'agents'], ['l', 'events', 'events'], ['p', 'approvals', 'runs']] as const) {
    for (const key of [k, k.toUpperCase()]) {
      const r = press(ui0({ tab: 'runs' }), key);
      assert.equal(r.ui.focus, focus, key);
      assert.equal(r.ui.tab, tab, key);
      assert.deepEqual(r.effects, []);
    }
  }
});

test('Tab cycles pipeline, approvals, runs, agents, events and back; Shift+Tab goes the other way; the tab follows', () => {
  let ui = ui0();
  const seen: string[] = [];
  for (let i = 0; i < 6; i++) { ui = press(ui, '\t').ui; seen.push(`${ui.focus}/${ui.tab}`); }
  assert.deepEqual(seen, ['approvals/runs', 'runs/runs', 'agents/agents', 'events/events', 'pipeline/events', 'approvals/events']);
  const back: string[] = [];
  ui = ui0();
  for (let i = 0; i < 3; i++) { ui = press(ui, '\x1b[Z').ui; back.push(ui.focus); }
  assert.deepEqual(back, ['events', 'agents', 'runs']);
});

test('j k and the arrows move the cursor, g G Home End jump, PgUp PgDn go by 10, all clamped; only Runs selects', () => {
  const m = synthetic();
  let r = press(ui0({ focus: 'runs' }), 'j', m);
  assert.equal(r.ui.pos.runs, 1);
  assert.deepEqual(r.effects, [{ kind: 'select', runId: 'run-01' }]);
  r = press(r.ui, '\x1b[B', m); assert.equal(r.ui.pos.runs, 2);
  r = press(r.ui, 'k', m); assert.equal(r.ui.pos.runs, 1);
  r = press(r.ui, '\x1b[A', m); assert.equal(r.ui.pos.runs, 0);
  r = press(r.ui, 'k', m); assert.equal(r.ui.pos.runs, 0); assert.deepEqual(r.effects, [], 'at the top nothing moves, nothing is selected');
  r = press(r.ui, 'G', m); assert.equal(r.ui.pos.runs, 24); assert.deepEqual(r.effects, [{ kind: 'select', runId: 'run-24' }]);
  r = press(r.ui, 'j', m); assert.equal(r.ui.pos.runs, 24);
  r = press(r.ui, 'g', m); assert.equal(r.ui.pos.runs, 0);
  r = press(r.ui, '\x1b[6~', m); assert.equal(r.ui.pos.runs, 10);
  r = press(r.ui, '\x1b[6~', m); r = press(r.ui, '\x1b[6~', m); assert.equal(r.ui.pos.runs, 24);
  r = press(r.ui, '\x1b[5~', m); assert.equal(r.ui.pos.runs, 14);
  r = press(r.ui, '\x1b[F', m); assert.equal(r.ui.pos.runs, 24);
  r = press(r.ui, '\x1b[H', m); assert.equal(r.ui.pos.runs, 0);
  r = press(r.ui, 'g', m); assert.equal(r.ui.pos.runs, 0);
  // upper case equals lower case except G: J K move, but G is the end and g the start
  assert.equal(press(ui0({ focus: 'runs' }), 'J', m).ui.pos.runs, 1);
  assert.equal(press(ui0({ focus: 'runs', pos: { ...ui0().pos, runs: 5 } }), 'K', m).ui.pos.runs, 4);
  // Agents and Events scroll without selecting; Pipeline and Approvals have nothing to move
  for (const [focus, max] of [['agents', 2], ['events', 29]] as const) {
    const a = press(ui0({ focus }), 'G', m);
    assert.equal(a.ui.pos[focus], max); assert.deepEqual(a.effects, []);
  }
  for (const focus of ['pipeline', 'approvals'] as const) { const a = press(ui0({ focus }), 'jG', m); assert.deepEqual(a.ui.pos, ui0().pos); assert.deepEqual(a.effects, []); }
});

test('? toggles help; Esc closes it and clears the notice; Ctrl+C closes help, else quits; q and Q quit', () => {
  let r = press(ui0(), '?'); assert.equal(r.ui.help, true);
  assert.equal(press(r.ui, '?').ui.help, false);
  r = press({ ...r.ui, notice: 'something' }, '\x1b'); assert.equal(r.ui.help, false); assert.equal(r.ui.notice, undefined);
  assert.equal(press({ ...ui0(), notice: 'n' }, '\x1b').ui.notice, undefined);
  const open = ui0({ help: true });
  r = press(open, '\x03'); assert.equal(r.ui.help, false); assert.deepEqual(r.effects, [], 'Ctrl+C with help open only closes it');
  assert.deepEqual(press(ui0(), '\x03').effects, [{ kind: 'quit' }]);
  assert.deepEqual(press(ui0(), 'q').effects, [{ kind: 'quit' }]);
  assert.deepEqual(press(ui0(), 'Q').effects, [{ kind: 'quit' }]);
  assert.deepEqual(press(open, 'q').effects, [{ kind: 'quit' }]);
  // the overlay owns the keyboard
  assert.deepEqual(press(open, 'jr\t').ui, open);
});

test('y, Y, Enter, Space and unknown keys give no effect and change nothing; a paste is ignored', () => {
  for (const k of ['y', 'Y', '\r', '\n', ' ', 'x', '\x1b[99~', '\x1bx', '\u202e', 'é', '\x04']) {
    for (const ui of [ui0(), ui0({ focus: 'approvals' }), ui0({ focus: 'runs' }), ui0({ help: true })]) {
      const r = press(ui, k);
      assert.deepEqual(r.effects, [], JSON.stringify(k));
      assert.deepEqual(r.ui, ui, JSON.stringify(k));
    }
  }
  const p = press(ui0(), '\x1b[200~qjra\x1b[201~');
  assert.deepEqual(p.effects, []); assert.deepEqual(p.ui, ui0());
});

test('a chunk of several keys applies them in order; a quit ends the chunk', () => {
  const r = press(ui0(), 'rjj');
  assert.equal(r.ui.focus, 'runs'); assert.equal(r.ui.pos.runs, 2);
  assert.deepEqual(r.effects.map((e) => e.kind), ['select', 'select']);
  const q = press(ui0(), 'jqr');
  assert.deepEqual(q.effects, [{ kind: 'quit' }]); assert.equal(q.ui.focus, 'pipeline');
  assert.equal(press(ui0(), 'pq').ui.focus, 'approvals');
});

test('help names exactly the keys the loop acts on (the table is the one source)', () => {
  const flat = KEY_TABLE.map((e) => e.keys).join(' ');
  for (const k of ['r', 'a', 'l', 'p', '?', 'q', 'Tab', 'Shift+Tab', 'j', 'k', 'g', 'G', 'PgUp', 'PgDn', 'Esc']) assert.ok(flat.split(' ').includes(k), k);
});

// ---- the loop ------------------------------------------------------------------------------------------------------

const at = (k: number) => new Date(Date.parse('2026-11-22T10:15:00.000Z') + k * 10_000).toISOString();
const fixed: DashStatic = {
  version: '1.0.0', repo: 'demo', branch: 'main', acceptedRisks: [], checkedAt: at(0), runtimeVersions: { claude: '2.1.330' },
  squad: [{ role: 'Planner', who: 'planner · claude', state: 'ready', agent: 'planner', runtime: 'claude' }, { role: 'Implementer', who: 'implementer · claude', state: 'ready', agent: 'implementer', runtime: 'claude' }],
};
const state = (id: string, o: Record<string, unknown> = {}) => ({
  runId: id, workflow: 'feature-governed', request: 'add a sum function', status: 'running', current: 'implement', revision: 1, attempts: 1,
  artifacts: {}, approvals: {}, history: [{ node: 'recall', outcome: 'ok', at: at(1) }, { node: 'plan', outcome: 'planned', at: at(2) }], ...o,
});
const put = (s: RepoStore, id: string, st: unknown, events: unknown[] = [], lock?: number): void => {
  const dir = join(s.runs, id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(st));
  writeFileSync(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e) + '\n').join(''));
  if (lock !== undefined) writeFileSync(join(dir, 'lock'), String(lock));
};
const mk = (): { repo: string; base: string; store: RepoStore } => {
  const repo = mkdtempSync(join(root, 'repo-')), base = mkdtempSync(join(root, 'state-'));
  return { repo, base, store: repoStore(repo, base) };
};
const ev = (type: string, o: Record<string, unknown> = {}) => ({ type, ts: at(3), ...o });
const ID = (k: number) => `run-20261122T10${String(10 + k).padStart(2, '0')}00-ab12c${k}`;

const clean = (s: string): string => s.replace(SGR, '');
const send = (tty: FakeTty, s: string): void => { for (const f of [...tty.dataHandlers]) f(s); };
const rowsWritten = (w: string): number[] => [...w.matchAll(/\x1b\[(\d+);1H\x1b\[2K/g)].map((m) => Number(m[1]));
const screenText = (tty: FakeTty): string => clean(tty.text());

interface Started { tty: FakeTty; sig: ReturnType<typeof fakeSignals>; done: Promise<number>; counts: { set: number; cleared: number } }
/** Every loop a test starts: a test that fails before its `q` must not leave timers that keep this file from ending (it would hang the suite and hide the failure). */
const running = new Set<{ handles: Set<ReturnType<typeof setInterval>>; settled: boolean }>();
afterEach(() => {
  for (const r of running) if (!r.settled) for (const h of r.handles) clearInterval(h);
  running.clear();
});
function start(store: RepoStore, o: Partial<DashDeps> & { columns?: number; rows?: number } = {}): Started {
  const tty = fakeTty(o.columns ?? 120, o.rows ?? 34), sig = fakeSignals();
  const counts = { set: 0, cleared: 0 };
  const live = { handles: new Set<ReturnType<typeof setInterval>>(), settled: false };
  running.add(live);
  const timers = {
    setInterval: ((...a: Parameters<typeof setInterval>) => { counts.set++; const h = setInterval(...a); live.handles.add(h); return h; }) as typeof setInterval,
    clearInterval: ((h: Parameters<typeof clearInterval>[0]) => { counts.cleared++; live.handles.delete(h as ReturnType<typeof setInterval>); clearInterval(h); }) as typeof clearInterval,
  };
  const { columns: _c, rows: _r, ...rest } = o;
  const done = runDashboard({ tty, signals: sig, store, fixed, caps: (size) => mkCaps({ ...size }), timers, ...rest });
  void done.finally(() => { live.settled = true; });
  return { tty, sig, done, counts };
}

test('q resolves 0, gives the terminal back (RESTORE last, raw mode off) and clears every timer and listener', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval'] });
  const { store } = mk(); put(store, ID(0), state(ID(0), { status: 'completed', current: 'done' }));
  const s = start(store);
  assert.equal(s.tty.rawMode, true);
  send(s.tty, 'j'); mock.timers.tick(100);
  send(s.tty, 'q');
  assert.equal(await s.done, 0);
  assert.equal(s.tty.rawMode, false);
  assert.ok(s.tty.writes.at(-1)!.endsWith(RESTORE) || s.tty.text().endsWith(RESTORE));
  assert.equal(s.tty.dataHandlers.size, 0); assert.equal(s.tty.resizeHandlers.size, 0); assert.equal(s.sig.count(), 0);
  assert.equal(s.counts.set, s.counts.cleared, 'every timer set was cleared');
  assert.deepEqual(s.sig.exits, []);
});

test('Ctrl+C with help open closes the help; without, it quits', async () => {
  const { store } = mk(); put(store, ID(0), state(ID(0), { status: 'completed', current: 'done' }));
  const s = start(store);
  send(s.tty, '?');
  assert.match(screenText(s.tty), /Keys/);
  const before = s.tty.writes.length;
  send(s.tty, '\x03');
  assert.ok(s.tty.writes.length > before, 'help closed: a frame was drawn');
  assert.ok(!/Keys/.test(clean(s.tty.writes.slice(before).join(''))));
  send(s.tty, '\x03');
  assert.equal(await s.done, 0);
});

test('the initial selection: the given run, else the newest running or waiting run, else the newest', async () => {
  const shown = async (setup: (s: RepoStore) => void, runId?: string): Promise<string> => {
    const { store } = mk(); setup(store);
    const s = start(store, runId ? { runId } : {});
    const text = screenText(s.tty);
    send(s.tty, 'q'); await s.done;
    return text.split('\n')[0] ?? text.slice(0, 400);
  };
  const seed = (s: RepoStore) => {
    put(s, ID(1), state(ID(1), { status: 'completed', current: 'done' }));
    put(s, ID(2), state(ID(2), { status: 'waiting-approval', current: 'approve-plan', artifacts: { plan: 'a'.repeat(64) } }));
    put(s, ID(3), state(ID(3), { status: 'completed', current: 'done' }));
    put(s, ID(4), state(ID(4), { status: 'failed' }));
  };
  const topbar = (text: string): string => /run (ab12c\d)/.exec(text)?.[1] ?? text;
  assert.equal(topbar(await shown(seed, ID(1))), 'ab12c1', 'the given run');
  assert.equal(topbar(await shown(seed)), 'ab12c2', 'the newest running or waiting run, not the newest');
  assert.equal(topbar(await shown((s) => { put(s, ID(1), state(ID(1), { status: 'completed', current: 'done' })); put(s, ID(3), state(ID(3), { status: 'failed' })); })), 'ab12c3', 'else the newest');
});

test('on Runs the selection follows the cursor: j shows the next run, k comes back', async () => {
  const { store } = mk();
  put(store, ID(1), state(ID(1), { status: 'completed', current: 'done' }));
  put(store, ID(2), state(ID(2), { status: 'failed' }));
  const s = start(store, { runId: ID(2) });
  assert.equal(/run (ab12c\d) ✖/.test(screenText(s.tty)), true);
  send(s.tty, 'r');
  send(s.tty, 'j');
  assert.match(clean(s.tty.writes.at(-1)!), /run ab12c1 ✔ done/);
  send(s.tty, 'k');
  assert.match(clean(s.tty.writes.at(-1)!), /run ab12c2 ✖ failed/);
  send(s.tty, 'q'); await s.done;
});

test('a bare Esc is delivered by the 50 ms flush: help closes only then', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval'] });
  const { store } = mk(); put(store, ID(0), state(ID(0), { status: 'completed', current: 'done' }));
  const s = start(store);
  send(s.tty, '?');
  const n = s.tty.writes.length;
  send(s.tty, '\x1b');
  assert.equal(s.tty.writes.length, n, 'a lone ESC is held');
  mock.timers.tick(49); assert.equal(s.tty.writes.length, n);
  mock.timers.tick(1);
  assert.ok(s.tty.writes.length > n, 'Esc delivered');
  assert.ok(!/Keys/.test(clean(s.tty.writes.at(-1)!)), 'the help box is gone from the frame');
  send(s.tty, 'q'); assert.equal(await s.done, 0);
});

test('AC-15: a static store writes nothing in 5 000 ms after its first frame', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-11-22T10:20:00.000Z') });
  const { store } = mk();
  put(store, ID(0), state(ID(0), { status: 'completed', current: 'done' }), [ev('run.completed')]);
  put(store, ID(1), state(ID(1), { status: 'waiting-approval', current: 'approve-plan', artifacts: { plan: 'a'.repeat(64) } }));
  const s = start(store);
  const after1 = s.tty.writes.length;
  assert.equal(s.counts.set, 1, 'only the poll timer runs: no tick when no step is live');
  assert.ok(after1 >= 2, 'the first frame is drawn');
  mock.timers.tick(5000);
  assert.equal(s.tty.writes.length, after1, 'nothing written while nothing changes');
  send(s.tty, 'q'); assert.equal(await s.done, 0);
});

test('AC-15: a live running run writes at most 5 frames in 5 000 ms, one write each, only rows that changed', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-11-22T10:15:30.000Z') });
  const { store } = mk();
  put(store, ID(0), state(ID(0)), [ev('agent.started', { agent: 'implementer', runtime: 'claude' })], 4242);
  const s = start(store, { isAlive: () => true });
  const first = s.tty.writes.length;
  assert.equal(s.counts.set, 2, 'the poll and the one-second tick');
  const firstFrame = s.tty.writes.slice(0, first).join('');
  assert.match(clean(firstFrame), /◉ running/);
  mock.timers.tick(5000);
  const writes = s.tty.writes.slice(first);
  assert.ok(writes.length >= 1, 'the elapsed time moves, so frames are drawn');
  assert.ok(writes.length <= 5, `at most 5 writes in 5 s, got ${writes.length}`);
  for (const w of writes) {
    const rows = rowsWritten(w);
    assert.ok(rows.length >= 1 && rows.length <= 3, `only changed rows: ${rows}`);
    assert.equal(new Set(rows).size, rows.length, 'each row once');
  }
  send(s.tty, 'q'); assert.equal(await s.done, 0);
});

test('AC-15: a live run that dies stops ticking: no frame is drawn for time passing, `not running?` appears', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval', 'Date'], now: Date.parse('2026-11-22T10:15:30.000Z') });
  const { store } = mk();
  put(store, ID(0), state(ID(0)), [], 4242);
  let alive = true;
  const s = start(store, { isAlive: () => alive });
  mock.timers.tick(2000);
  alive = false;
  mock.timers.tick(500);
  assert.match(clean(s.tty.writes.at(-1)!), /not running\?/);
  const n = s.tty.writes.length;
  mock.timers.tick(5000);
  assert.equal(s.tty.writes.length, n, 'no more frames once the process is gone');
  send(s.tty, 'q'); await s.done;
});

test('resize to 36 × 10 shows the too-small message; back to 120 × 34 rewrites every row once', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval'] });
  const { store } = mk(); put(store, ID(0), state(ID(0), { status: 'completed', current: 'done' }));
  const s = start(store);
  s.tty.dims = { columns: 36, rows: 10 };
  const before = s.tty.writes.length;
  for (const f of [...s.tty.resizeHandlers]) f();
  const small = s.tty.writes.slice(before);
  assert.equal(small.length, 1, 'one write for one resize');
  assert.match(clean(small[0]!).replace(/\s+/g, ' '), /40 × 12/);
  assert.match(clean(small[0]!).replace(/\s+/g, ' '), /taskquoin status/);
  s.tty.dims = { columns: 120, rows: 34 };
  const mid = s.tty.writes.length;
  for (const f of [...s.tty.resizeHandlers]) f();
  const big = s.tty.writes.slice(mid);
  assert.equal(big.length, 1);
  assert.deepEqual(rowsWritten(big[0]!), Array.from({ length: 34 }, (_, i) => i + 1), 'every row, once');
  send(s.tty, 'q'); await s.done;
});

test('an event appended to the run is on screen within one 500 ms poll', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval'] });
  const { store } = mk();
  put(store, ID(0), state(ID(0)), [ev('agent.started', { agent: 'planner', runtime: 'claude' })], 4242);
  const s = start(store, { isAlive: () => true });
  assert.ok(!screenText(s.tty).includes('verify-ok'));
  appendFileSync(join(store.runs, ID(0), 'events.jsonl'), JSON.stringify(ev('node.transition', { node: 'verify-ok', outcome: 'tests-green', next: 'review' })) + '\n');
  mock.timers.tick(500);
  assert.match(screenText(s.tty), /verify-ok/);
  send(s.tty, 'q'); await s.done;
});

test('AC-12: a run writing an event every 10 ms, 100 keys 20 ms apart: key to screen p95 < 50 ms', async () => {
  const { store } = mk();
  put(store, ID(0), state(ID(0)), [ev('agent.started', { agent: 'implementer', runtime: 'claude' })], process.pid);
  const s = start(store, { isAlive: () => true });
  const stamps: number[] = [];
  const write = s.tty.write.bind(s.tty);
  s.tty.write = (x) => { stamps.push(performance.now()); write(x); };
  let n = 0;
  const writer = setInterval(() => appendFileSync(join(store.runs, ID(0), 'events.jsonl'), JSON.stringify(ev('verify.result', { attempt: ++n, passed: false, exitCode: 1 })) + '\n'), 10);
  const lat: number[] = [];
  const t0 = performance.now();
  for (let i = 0; i < 100; i++) {
    const target = t0 + i * 20;
    await new Promise((r) => setTimeout(r, Math.max(0, target - performance.now())));
    const before = stamps.length;
    send(s.tty, i % 2 === 0 ? 'a' : 'r'); // each key moves the focus border: a frame always changes
    assert.ok(stamps.length > before, `key ${i} drew a frame`);
    lat.push(stamps[before]! - target);
  }
  clearInterval(writer);
  lat.sort((a, b) => a - b);
  const p95 = lat[Math.floor(lat.length * 0.95)]!;
  console.log(`key to frame p95 ${p95.toFixed(2)} ms (max ${lat.at(-1)!.toFixed(2)})`);
  assert.ok(p95 < 50, `p95 ${p95}`);
  send(s.tty, 'q'); await s.done;
});

const DIFF_TEXT = ['diff --git a/a.js b/a.js', '--- a/a.js', '+++ b/a.js', '@@ -1,2 +1,3 @@', ' keep', '-old', '+added one', '+added two', 'diff --git a/b.js b/b.js', '--- a/b.js', '+++ b/b.js', '@@ -1 +1 @@', '-x', '+y', ''].join('\n');

// ---- the diff and artifact viewer -----------------------------------------------------------------------------------

const art = (s: RepoStore, name: string, text: string | Buffer): string => putArtifact(s, Buffer.isBuffer(text) ? text : Buffer.from(text), { mediaType: 'text/plain', producer: name }).sha256;
const lastFrame = (tty: FakeTty, from: number): string => clean(tty.writes.slice(from).join(''));
const gateRun = (store: RepoStore, o: Record<string, unknown> = {}): string => {
  const a = (n: string, t: string) => art(store, n, t);
  put(store, ID(1), state(ID(1), { status: 'waiting-approval', current: 'approve-commit', attempts: 2, reviewedTree: 'c'.repeat(40), artifacts: { plan: a('plan', 'PLAN-TEXT\nline 2\n'), challenge: a('challenge', 'CHALLENGE-TEXT\n'), 'diff-1': a('diff-1', 'OLD-DIFF'), 'diff-2': a('diff-2', DIFF_TEXT), 'verify-2': a('verify-2', 'VERIFY-LOG\n'), 'red-2': a('red-2', 'RED-LOG\n') }, ...o }), [ev('run.waiting-approval', { node: 'approve-commit' })]);
  return ID(1);
};

test('keys: d and v ask for the viewer, q and Esc close it, p leaves it for the approval centre, Ctrl+C quits, d reloads', () => {
  assert.deepEqual(press(ui0(), 'd').effects, [{ kind: 'open-viewer', which: 'review' }]);
  assert.deepEqual(press(ui0(), 'V').effects, [{ kind: 'open-viewer', which: 'verify' }]);
  const v = { title: 'T', docs: [], file: 0, top: 0, wrap: false, readToEnd: [], artifact: 'plan', sha: 'a' };
  const inViewer = ui0({ screen: 'viewer', viewer: v });
  assert.deepEqual(press(inViewer, 'd').effects, [{ kind: 'open-viewer', which: 'review' }]);
  assert.deepEqual(press(inViewer, 'v').effects, [{ kind: 'open-viewer', which: 'verify' }]);
  assert.deepEqual(press(inViewer, 'p').effects, [{ kind: 'open-center' }]);
  assert.deepEqual(press(inViewer, '\x03').effects, [{ kind: 'quit' }]);
  assert.equal(press(inViewer, 'q').ui.screen, 'main');
  assert.equal(press(inViewer, '\x1b').ui.screen, 'main');
  assert.equal(press(inViewer, 'q').ui.viewer, undefined);
  assert.equal(press(inViewer, '?').ui.help, true);
  // typing a search owns the keyboard: d, v, p, q and ? are query characters there
  const typing = press(inViewer, '/').ui;
  const after = press(typing, 'dvpq?');
  assert.deepEqual(after.effects, []);
  assert.equal(after.ui.screen, 'viewer');
  assert.equal(after.ui.viewer!.search!.query, 'dvpq?');
});

test('d at the plan gate opens plan and challenge; q is back to the main view; q again quits', async () => {
  const { store } = mk();
  put(store, ID(1), state(ID(1), { status: 'waiting-approval', current: 'approve-plan', artifacts: { plan: art(store, 'plan', 'PLAN-TEXT\n'), challenge: art(store, 'challenge', 'CHALLENGE-TEXT\n'), 'diff-1': art(store, 'diff-1', 'OLD-DIFF') } }));
  const s = start(store, { columns: 130, rows: 34 });
  let n = s.tty.writes.length;
  send(s.tty, 'd');
  const shown = lastFrame(s.tty, n);
  assert.match(shown, /Plan · run ab12c1/);
  assert.match(shown, /PLAN-TEXT/);
  assert.match(shown, /Files/);
  assert.ok(!/OLD-DIFF/.test(shown), 'a run at the plan gate shows plan and challenge, not an older diff');
  n = s.tty.writes.length;
  send(s.tty, 'n');
  assert.match(lastFrame(s.tty, n), /CHALLENGE-TEXT/);
  n = s.tty.writes.length;
  send(s.tty, 'q');
  assert.match(lastFrame(s.tty, n), /Pipeline/);
  send(s.tty, 'q');
  assert.equal(await s.done, 0);
});

test('d at the commit gate opens the highest diff-N with ✔ current; a changed tree says ✖ changed since opened; d reloads', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval'] });
  const { store } = mk();
  const id = gateRun(store);
  const s = start(store, { columns: 130, rows: 34 });
  let n = s.tty.writes.length;
  send(s.tty, 'd');
  let shown = lastFrame(s.tty, n);
  assert.match(shown, /Diff · run ab12c1/);
  assert.match(shown, /tree waiting for approval cccccccccccc ✔ current/);
  assert.match(shown, /a\.js/);
  assert.ok(!/OLD-DIFF/.test(shown));
  n = s.tty.writes.length;
  mock.timers.tick(500);
  assert.equal(s.tty.writes.length, n, 'nothing changed: nothing drawn');
  // the tree moves under the open viewer
  const st = JSON.parse(readFileSync(join(store.runs, id, 'state.json'), 'utf8'));
  writeFileSync(join(store.runs, id, 'state.json'), JSON.stringify({ ...st, reviewedTree: 'e'.repeat(41) }));
  mock.timers.tick(500);
  shown = lastFrame(s.tty, n);
  assert.match(shown, /✖ changed since opened — d reloads/);
  assert.ok(!/✔ current/.test(shown));
  n = s.tty.writes.length;
  send(s.tty, 'd');
  shown = lastFrame(s.tty, n);
  assert.match(shown, /tree waiting for approval eeeeeeeeeeee ✔ current/, 'd reloads against the new tree');
  send(s.tty, 'q'); send(s.tty, 'q');
  assert.equal(await s.done, 0);
});

test('the artifact changing under the viewer (same tree) is stale too', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval'] });
  const { store } = mk();
  const id = gateRun(store);
  const s = start(store, { columns: 130, rows: 34 });
  send(s.tty, 'd');
  const n = s.tty.writes.length;
  const st = JSON.parse(readFileSync(join(store.runs, id, 'state.json'), 'utf8'));
  writeFileSync(join(store.runs, id, 'state.json'), JSON.stringify({ ...st, artifacts: { ...st.artifacts, 'diff-2': art(store, 'diff-2', DIFF_TEXT + '\n+late\n') } }));
  mock.timers.tick(500);
  assert.match(lastFrame(s.tty, n), /changed since opened/);
  send(s.tty, 'q'); send(s.tty, 'q'); await s.done;
});

test('v opens the highest verify-N and red-N; with none, a notice and the main view stays', async () => {
  const { store } = mk();
  gateRun(store);
  const s = start(store, { columns: 130, rows: 34 });
  let n = s.tty.writes.length;
  send(s.tty, 'v');
  const shown = lastFrame(s.tty, n);
  assert.match(shown, /Verify · run ab12c1/);
  assert.match(shown, /VERIFY-LOG/);
  n = s.tty.writes.length;
  send(s.tty, 'n');
  assert.match(lastFrame(s.tty, n), /RED-LOG/);
  send(s.tty, 'q'); send(s.tty, 'q'); await s.done;
  const empty = mk();
  put(empty.store, ID(2), state(ID(2)));
  const e = start(empty.store);
  n = e.tty.writes.length;
  send(e.tty, 'v');
  assert.match(lastFrame(e.tty, n), /nothing to show for this run yet/);
  assert.ok(!/Verify · run/.test(lastFrame(e.tty, n)), 'still the main view');
  send(e.tty, 'q'); await e.done;
});

test('an artifact whose bytes do not match its hash is an error notice, not a crash; a 5 MiB one is refused unread', async () => {
  const { store } = mk();
  const sha = art(store, 'x', 'honest');
  const evil = 'f'.repeat(64);
  writeFileSync(join(store.artifacts, evil), 'tampered');
  const big = '9'.repeat(64);
  put(store, ID(1), state(ID(1), { status: 'waiting-approval', current: 'approve-plan', artifacts: { plan: evil } }));
  const s = start(store, { columns: 130, rows: 34 });
  let n = s.tty.writes.length;
  send(s.tty, 'd');
  assert.match(lastFrame(s.tty, n), /does not match its hash/);
  assert.ok(!/Plan · run/.test(lastFrame(s.tty, n)), 'no viewer opened');
  send(s.tty, 'q'); await s.done;
  const b = mk();
  writeFileSync(join(b.store.artifacts, big), Buffer.alloc(5 * 1024 * 1024, 0x61));
  put(b.store, ID(1), state(ID(1), { status: 'waiting-approval', current: 'approve-plan', artifacts: { plan: big } }));
  const s2 = start(b.store, { columns: 130, rows: 34 });
  n = s2.tty.writes.length;
  send(s2.tty, 'd');
  const shown = lastFrame(s2.tty, n);
  assert.match(shown, /5\.0 MiB/);
  assert.ok(!/does not match/.test(shown), 'it was not read');
  assert.ok(sha.length === 64);
  send(s2.tty, 'q'); await s2.done;
});

test('the loop owns the read Set: scrolling every file of the viewer to its end adds the artifact name', async () => {
  const { store } = mk();
  gateRun(store);
  const read = new Set<string>();
  const s = start(store, { columns: 130, rows: 34, read });
  send(s.tty, 'd');
  assert.equal(read.has('diff-2'), false, 'a first screen of one file out of two is not the whole artifact');
  send(s.tty, 'G'); send(s.tty, 'n'); send(s.tty, 'G');
  assert.equal(read.has('diff-2'), true);
  send(s.tty, 'q'); send(s.tty, 'q'); await s.done;
});

test('a hostile diff reaches the screen as visible markers only', async () => {
  const { store } = mk();
  const E_ = String.fromCharCode(0x1b);
  const evil = `diff --git a/src/${E_}[31mevil.js b/src/${E_}[31mevil.js\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+${E_}]52;c;Y3VybA==\u0007 \u202e \u200b \u{e0041}\n`;
  put(store, ID(1), state(ID(1), { status: 'waiting-approval', current: 'approve-commit', attempts: 1, reviewedTree: 'c'.repeat(40), artifacts: { 'diff-1': art(store, 'diff-1', evil) } }));
  const s = start(store, { columns: 130, rows: 34 });
  const n = s.tty.writes.length;
  send(s.tty, 'd');
  const raw = s.tty.writes.slice(n).join('');
  const shown = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  assert.match(shown, /‹ESC›/);
  assert.match(shown, /‹U\+202E›/);
  assert.match(shown, /characters neutralised in this file/);
  assert.ok(!FORBIDDEN.test(shown));
  assert.ok(!shown.includes(E_));
  send(s.tty, 'q'); send(s.tty, 'q'); await s.done;
});

// ---- R4: the approval center and the separate `taskquoin approve` process ------------------------------------------

const TREE = '9c1e04b7aa31d2f04c11aa0b3e2e5f9d8c7b6a51';
interface Kid extends EventEmitter { pid: number; unref(): void }
function fakeApprove(o: { log?: string } = {}) {
  const calls: string[][] = [];
  const kids: Kid[] = [];
  const spawn = ((_cmd: string, args: string[], opts: { stdio: unknown[] }) => {
    calls.push(args);
    if (o.log !== undefined) writeSync(opts.stdio[1] as number, o.log);
    const kid = Object.assign(new EventEmitter(), { pid: 4000 + calls.length, unref() { /* detached */ } }) as Kid;
    kids.push(kid);
    return kid;
  }) as unknown as typeof import('node:child_process').spawn;
  return { approve: { node: process.execPath, entry: '/opt/taskquoin/main.ts', cwd: root, env: {}, spawn }, calls, kids };
}
/** A run waiting at the commit gate for TREE. */
const commitGate = (store: RepoStore): string => {
  put(store, ID(1), state(ID(1), { status: 'waiting-approval', current: 'approve-commit', attempts: 1, reviewedTree: TREE,
    history: [{ node: 'recall', outcome: 'ok', at: at(1) }, { node: 'review', outcome: 'review:APPROVE', at: at(2) }, { node: 'approve-commit', outcome: 'waiting-approval', at: at(3) }] }), [ev('run.waiting-approval', { node: 'approve-commit' })]);
  return ID(1);
};
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const typeIn = (tty: FakeTty, s: string): void => { for (const ch of s) send(tty, ch); };
/** p, the name (one chunk), Enter, the 12 characters key by key, Enter. */
const approveKeys = (tty: FakeTty, hash = TREE.slice(0, 12)): void => { send(tty, 'p'); send(tty, 'alice'); send(tty, '\r'); typeIn(tty, hash); send(tty, '\r'); };
const recordApproval = (store: RepoStore, id: string, as = 'alice (via taskquoin dashboard)'): void => {
  appendFileSync(join(store.runs, id, 'events.jsonl'), JSON.stringify({ type: 'approval', node: 'approve-commit', approvedBy: as, binding: TREE, ts: '2026-11-22T10:33:05.000Z' }) + '\n');
  const st = JSON.parse(readFileSync(join(store.runs, id, 'state.json'), 'utf8'));
  writeFileSync(join(store.runs, id, 'state.json'), JSON.stringify({ ...st, status: 'running', approvals: { 'approve-commit': { approvedBy: as, binding: TREE, at: '2026-11-22T10:33:05.000Z' } } }));
};

test('p, the name, the 12 characters key by key and Enter: one `taskquoin approve`, with what was typed; the store\'s approval → ✔ approved and the pid', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval'] });
  const { store } = mk(); const id = commitGate(store);
  const f = fakeApprove();
  const s = start(store, { approve: f.approve });
  assert.match(screenText(s.tty), /→ p opens the approval center/);
  send(s.tty, 'p');
  let n = s.tty.writes.length;
  assert.match(lastFrame(s.tty, 0), /Approval center/);
  assert.match(lastFrame(s.tty, 0), /Your name \(asked once per session\)/);
  send(s.tty, 'alice'); send(s.tty, '\r');
  typeIn(s.tty, TREE.slice(0, 12));
  assert.equal(f.calls.length, 0, 'no key approved on its own');
  send(s.tty, '\r');
  assert.deepEqual(f.calls, [['/opt/taskquoin/main.ts', 'approve', id, 'commit', '--expect=9c1e04b7aa31', '--as=alice (via taskquoin dashboard)']]);
  assert.match(lastFrame(s.tty, n), /◉ taskquoin approve started \(pid 4001\) — waiting for it to record the approval/);
  assert.ok(!/✔ approved/.test(lastFrame(s.tty, n)), 'started is not approved');
  send(s.tty, '\r');
  assert.equal(f.calls.length, 1, 'a second Enter sends nothing');
  n = s.tty.writes.length;
  recordApproval(store, id);
  mock.timers.tick(500);
  const shown = lastFrame(s.tty, n).replace(/\s+/g, ' ');
  assert.match(shown, /✔ approved by alice \(via taskquoin dashboard\) at 10:33:05 · the run continues \(pid 4001\)/);
  // the process exits non-zero later (the run failed afterwards): still approved — the store says so
  f.kids[0]!.emit('exit', 1, null); await tick();
  assert.ok(!/refused/.test(lastFrame(s.tty, n)));
  send(s.tty, '\x1b'); // Esc at `sent` closes the view only
  assert.match(lastFrame(s.tty, n).replace(/\s+/g, ' '), /✔ approved by alice/);
  assert.ok(!/Approval center/.test(clean(s.tty.writes.at(-1)!)));
  send(s.tty, 'q'); assert.equal(await s.done, 0, 'the child has exited: q quits at once');
});

test('Review Focus 4: the child refuses (a console holds the lock) and nothing is recorded → refused (exit 1), its neutralised output, nothing was approved — never approved', async () => {
  const { store } = mk(); commitGate(store);
  const E = String.fromCharCode(0x1b);
  const f = fakeApprove({ log: `taskquoin: approve failed: run run-c is busy (pid 4242)\nhint ${E}[31mred\u202e\n` });
  const s = start(store, { approve: f.approve });
  approveKeys(s.tty);
  const n = s.tty.writes.length;
  f.kids[0]!.emit('exit', 1, null); await tick();
  const raw = s.tty.writes.slice(n).join('');
  const shown = clean(raw).replace(/\s+/g, ' ');
  assert.match(shown, /✖ taskquoin approve refused \(exit 1\)/);
  assert.match(shown, /run run-c is busy \(pid 4242\)/);
  assert.match(shown, /hint ‹ESC›\[31mred‹U\+202E›/);
  assert.match(shown, /nothing was approved/);
  assert.ok(!/✔ approved|approved by/.test(shown), 'never approved');
  assert.ok(!FORBIDDEN.test(raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')), 'the child\'s output never reaches the screen raw');
  send(s.tty, 'q'); send(s.tty, 'q');
  assert.equal(await s.done, 0);
});

test('AC-5 at the loop: y, Y, Enter, Space and `pp` in one chunk never open the centre nor start a process; without the approve route p only focuses Approvals', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval'] });
  const { store } = mk(); commitGate(store);
  const f = fakeApprove();
  const s = start(store, { approve: f.approve });
  for (const k of ['y', 'Y', '\r', '\n', ' ', 'pp', 'p9c1e04b7aa31\r', 'yes\r', '\x1b[200~p\x1b[201~']) { send(s.tty, k); mock.timers.tick(60); }
  assert.ok(!/Approval center/.test(screenText(s.tty)), 'never opened');
  assert.equal(f.calls.length, 0);
  send(s.tty, 'q'); assert.equal(await s.done, 0);
  const plain = mk(); commitGate(plain.store);
  const p = start(plain.store);
  assert.match(screenText(p.tty), /→ \/approve commit or taskquoin approve/);
  send(p.tty, 'p');
  assert.ok(!/Approval center/.test(screenText(p.tty)));
  send(p.tty, 'q'); assert.equal(await p.done, 0);
});

test('Review Focus 2 at the loop: the gate approved elsewhere since the last poll → the centre says no longer waiting and starts nothing', async () => {
  const { store } = mk(); const id = commitGate(store);
  const f = fakeApprove();
  const s = start(store, { approve: f.approve });
  recordApproval(store, id, 'bob (via taskquoin console)'); // no poll in between
  approveKeys(s.tty);
  assert.match(screenText(s.tty).replace(/\s+/g, ' '), /No longer waiting — approved or changed elsewhere/);
  assert.equal(f.calls.length, 0);
  send(s.tty, 'q'); send(s.tty, 'q'); assert.equal(await s.done, 0);
});

test('the tree changing while the hash is typed: ✖ changed on the next poll, then Enter refuses — stale, nothing started; d opens the new diff', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval'] });
  const { store } = mk(); const id = commitGate(store);
  const f = fakeApprove();
  const s = start(store, { approve: f.approve, columns: 130, rows: 40 });
  send(s.tty, 'p'); send(s.tty, 'alice'); send(s.tty, '\r'); typeIn(s.tty, TREE.slice(0, 11));
  const st = JSON.parse(readFileSync(join(store.runs, id, 'state.json'), 'utf8'));
  writeFileSync(join(store.runs, id, 'state.json'), JSON.stringify({ ...st, reviewedTree: '77d0e2c41f95' + 'a'.repeat(28) }));
  let n = s.tty.writes.length;
  mock.timers.tick(500);
  assert.match(lastFrame(s.tty, n), /✖ changed/);
  send(s.tty, TREE[11]!); send(s.tty, '\r');
  assert.equal(f.calls.length, 0);
  assert.match(screenText(s.tty).replace(/\s+/g, ' '), /Refused: the tree changed since it was shown/);
  n = s.tty.writes.length;
  send(s.tty, 'd');
  assert.match(lastFrame(s.tty, n), /nothing to show for this run yet|Diff · run/, 'd leaves the centre for the diff');
  send(s.tty, 'q'); send(s.tty, 'q'); assert.equal(await s.done, 0);
});

test('Review Focus 5: shrunk below 40 × 12 with half a hash typed, keys pressed then are dropped; enlarged → the same text, nothing sent, every row redrawn', async () => {
  const { store } = mk(); commitGate(store);
  const f = fakeApprove();
  const s = start(store, { approve: f.approve, columns: 100, rows: 30 });
  send(s.tty, 'p'); send(s.tty, 'alice'); send(s.tty, '\r'); typeIn(s.tty, '9c1e04');
  s.tty.dims = { columns: 36, rows: 10 };
  for (const r of [...s.tty.resizeHandlers]) r();
  assert.match(clean(s.tty.writes.at(-1)!).replace(/\s+/g, ' '), /needs 40 × 12/);
  typeIn(s.tty, 'b7aa31'); send(s.tty, '\r'); // typed blind: dropped, never submitted
  assert.equal(f.calls.length, 0);
  s.tty.dims = { columns: 100, rows: 30 };
  const n = s.tty.writes.length;
  for (const r of [...s.tty.resizeHandlers]) r();
  const big = s.tty.writes.slice(n);
  assert.equal(big.length, 1);
  assert.deepEqual(rowsWritten(big[0]!), Array.from({ length: 30 }, (_, i) => i + 1), 'every row, once');
  assert.match(clean(big[0]!), /Retype the hash to approve: 9c1e04█/);
  assert.equal(f.calls.length, 0);
  send(s.tty, '\x03'); // Ctrl+C cancels the form
  assert.match(screenText(s.tty), /Cancelled: nothing was approved/);
  send(s.tty, '\x1b'); send(s.tty, 'q'); assert.equal(await s.done, 0);
});

test('quitting while `taskquoin approve` runs: the question (it continues in process N), Esc stays, q quits — then stderr names the pid and the log', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval'] });
  const { store } = mk(); commitGate(store);
  const f = fakeApprove();
  const errs: string[] = [];
  const s = start(store, { approve: f.approve, err: (x) => { errs.push(x); } });
  approveKeys(s.tty);
  send(s.tty, '\x1b'); // leave the centre (the process runs)
  send(s.tty, 'q');
  const words = (w: string): string => w.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ' ').replace(/[│╭╮╰╯─]/g, ' ').replace(/\s+/g, ' ');
  let shown = words(s.tty.writes.at(-1)!);
  assert.match(shown, /The run ab12c1 continues in process 4001 until its next gate — quitting does not stop it/);
  assert.match(shown, /q quit · Esc stay/);
  send(s.tty, '\x1b'); mock.timers.tick(50);
  shown = clean(s.tty.writes.at(-1)!);
  assert.ok(!/quitting does not stop it/.test(shown), 'Esc stays: the question is gone');
  let ended = false; void s.done.then(() => { ended = true; }); await tick();
  assert.equal(ended, false, 'still running');
  send(s.tty, 'q'); send(s.tty, 'q');
  assert.equal(await s.done, 0);
  assert.equal(errs.length, 1);
  assert.match(errs[0]!, /the run run-20261122T101100-ab12c1 continues in process 4001 until its next gate; its output: .*taskquoin-approve-[^/]+\/approve\.log/);
  const log = /its output: (\S+)$/.exec(errs[0]!)![1]!;
  assert.equal(lstatSync(log).mode & 0o777, 0o600);
  assert.ok(s.tty.text().indexOf(RESTORE) >= 0, 'said after the terminal was given back');
});

test('I4: the approval never targets another run: a state.json naming another run opens no centre and starts nothing', async () => {
  const { store } = mk();
  const A = ID(1), B = ID(2);
  put(store, A, state(B, { status: 'waiting-approval', current: 'approve-commit', attempts: 1, reviewedTree: TREE }), [ev('run.waiting-approval', { node: 'approve-commit' })]);
  const f = fakeApprove();
  const s = start(store, { approve: f.approve, runId: A });
  approveKeys(s.tty);
  assert.ok(!/Approval center/.test(screenText(s.tty)), 'never opened');
  assert.deepEqual(f.calls, []);
  send(s.tty, 'q'); assert.equal(await s.done, 0);
});

test('I1: a state.json with the wrong types is an unreadable row, never a crash — reviewedTree 12345, artifacts "x" then d, a numeric runId', async () => {
  for (const bad of [{ reviewedTree: 12345 }, { artifacts: 'x' }, { runId: 12345 }]) {
    const label = JSON.stringify(bad);
    const { store } = mk();
    put(store, ID(0), state(ID(0), { status: 'completed', current: 'done' }));
    put(store, ID(1), { ...state(ID(1), { status: 'waiting-approval', current: 'approve-commit', reviewedTree: TREE }), ...bad });
    const s = start(store, { approve: fakeApprove().approve });
    await tick();
    assert.match(screenText(s.tty), /unreadable/, label);
    send(s.tty, 'd'); send(s.tty, 'p');
    assert.ok(!/Approval center/.test(screenText(s.tty)), label);
    send(s.tty, 'q'); assert.equal(await s.done, 0, label);
  }
});

test('I1: an unexpected error in a poll or a key keeps the last frame and says the read failed; q still quits', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval'] });
  const { store } = mk(); commitGate(store);
  let bomb = false;
  const s = start(store, { approve: fakeApprove().approve, now: () => { if (bomb) throw new Error('boom'); return Date.parse(at(5)); } });
  send(s.tty, 'p'); // the centre redraws on every poll
  assert.match(screenText(s.tty), /Approval center/);
  bomb = true;
  const n = s.tty.writes.length;
  assert.doesNotThrow(() => { mock.timers.tick(500); }, 'a poll that throws');
  assert.doesNotThrow(() => { send(s.tty, 'a'); }, 'a key that throws');
  assert.equal(s.tty.writes.length, n, 'the last frame stays');
  bomb = false;
  send(s.tty, '\x1b'); send(s.tty, '\x1b'); // cancel, then close the centre
  assert.match(clean(s.tty.writes.at(-1)!), /read failed/);
  send(s.tty, 'q'); assert.equal(await s.done, 0);
});

test('I3: a FIFO events.jsonl, or an artifact that links to a FIFO, never freezes the dashboard: it paints, says what cannot be read, and q quits', (t) => {
  const fifo = join(root, `fifo-${process.pid}`);
  if (spawnSync('mkfifo', [fifo]).status !== 0) { t.skip('no mkfifo'); return; }
  const driver = join(import.meta.dirname, 'support', 'dashboard-driver.ts');
  const drive = (repo: string, base: string, keys: string[]) => {
    const keysFile = join(root, `keys-fifo-${keys.length}.json`); writeFileSync(keysFile, JSON.stringify(keys));
    // a deadline: a read that blocks fails this test instead of hanging the suite
    return spawnSync(process.execPath, [driver, repo, base, keysFile], { encoding: 'utf8', timeout: 30_000, env: { ...process.env, TZ: 'UTC', TQ_DRIVER_TEXT: '1' } });
  };
  const a = mk();
  put(a.store, ID(1), state(ID(1)));
  rmSync(join(a.store.runs, ID(1), 'events.jsonl')); assert.equal(spawnSync('mkfifo', [join(a.store.runs, ID(1), 'events.jsonl')]).status, 0);
  const r1 = drive(a.repo, a.base, ['q']);
  assert.equal(r1.status, 0, `events.jsonl a FIFO: exit ${r1.status} (signal ${r1.signal})\n${r1.stderr}`);
  assert.ok(Number(/^frames (\d+)/m.exec(r1.stdout)![1]) >= 1, 'it painted');
  assert.match(r1.stdout, /read failed/);
  const b = mk();
  const sha = 'a'.repeat(64);
  symlinkSync(fifo, join(b.store.artifacts, sha));
  put(b.store, ID(1), state(ID(1), { status: 'waiting-approval', current: 'approve-plan', artifacts: { plan: sha } }), [ev('run.waiting-approval', { node: 'approve-plan' })]);
  const r2 = drive(b.repo, b.base, ['d', 'q']);
  assert.equal(r2.status, 0, `the plan a link to a FIFO: exit ${r2.status} (signal ${r2.signal})\n${r2.stderr}`);
  assert.match(r2.stdout, /artifact plan cannot be read/);
});

test('I5: p while the first approval is still starting shows that approval and starts nothing; its approval, recorded later, is what the footer says', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval'] });
  const { store } = mk(); const id = commitGate(store);
  const f = fakeApprove();
  const s = start(store, { approve: f.approve, columns: 200 }); // the footer holds the whole outcome line
  approveKeys(s.tty);
  assert.equal(f.calls.length, 1);
  send(s.tty, '\x1b'); // the centre closes; the process is still starting and the store still says waiting
  let n = s.tty.writes.length;
  send(s.tty, 'p');
  assert.match(lastFrame(s.tty, n).replace(/\s+/g, ' '), /taskquoin approve started \(pid 4001\)/);
  typeIn(s.tty, TREE.slice(0, 12)); send(s.tty, '\r');
  assert.equal(f.calls.length, 1, 'no second taskquoin approve');
  send(s.tty, '\x1b');
  n = s.tty.writes.length;
  recordApproval(store, id);
  mock.timers.tick(500);
  assert.match(lastFrame(s.tty, n).replace(/\s+/g, ' '), /✔ approved by alice \(via taskquoin dashboard\) at 10:33:05/);
  f.kids[0]!.emit('exit', 0, null); await tick();
  send(s.tty, 'q'); assert.equal(await s.done, 0);
});

test('I5: an approval recorded by an earlier process is reported, even after a later process (another run) was refused', async (t) => {
  t.after(() => mock.timers.reset());
  mock.timers.enable({ apis: ['setInterval'] });
  const { store } = mk(); const older = commitGate(store), newer = ID(2);
  put(store, newer, state(newer, { status: 'waiting-approval', current: 'approve-commit', attempts: 1, reviewedTree: TREE,
    history: [{ node: 'recall', outcome: 'ok', at: at(1) }, { node: 'review', outcome: 'review:APPROVE', at: at(2) }, { node: 'approve-commit', outcome: 'waiting-approval', at: at(3) }] }), [ev('run.waiting-approval', { node: 'approve-commit' })]);
  const f = fakeApprove();
  const s = start(store, { approve: f.approve, columns: 200 }); // the footer holds the whole outcome line
  approveKeys(s.tty); // the newest waiting run: process 4001
  send(s.tty, '\x1b'); send(s.tty, 'r'); send(s.tty, 'j'); // the older run
  send(s.tty, 'p'); typeIn(s.tty, TREE.slice(0, 12)); send(s.tty, '\r'); // the name is kept: process 4002
  assert.deepEqual(f.calls.map((c) => c[2]), [newer, older]);
  send(s.tty, '\x1b');
  f.kids[1]!.emit('exit', 1, null); await tick();
  assert.match(clean(s.tty.writes.at(-1)!), /refused \(exit 1\)/);
  const n = s.tty.writes.length;
  recordApproval(store, newer);
  mock.timers.tick(500);
  assert.match(lastFrame(s.tty, n).replace(/\s+/g, ' '), /✔ approved by alice \(via taskquoin dashboard\) at 10:33:05 · the run continues \(pid 4001/);
  f.kids[0]!.emit('exit', 0, null); await tick();
  send(s.tty, 'q'); assert.equal(await s.done, 0);
});

// ---- read-only under the permission model --------------------------------------------------------------------------

function snapshot(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name), st = lstatSync(p);
    out[relative(base, p)] = `${d.isDirectory() ? 'd' : 'f'} ${st.size} ${st.mode} ${st.mtimeMs} ${d.isFile() ? readFileSync(p, 'latin1') : ''}`;
    if (d.isDirectory()) snapshot(p, base, out);
  }
  return out;
}

test('AC-10, R3-3: under node --permission the real loop browses every run, every panel and the help, and changes nothing', () => {
  const { repo, base, store } = mk();
  put(store, ID(0), state(ID(0)), [ev('agent.started', { agent: 'implementer', runtime: 'claude' })], process.pid);
  put(store, ID(1), state(ID(1), { status: 'waiting-approval', current: 'approve-plan', artifacts: { plan: 'a'.repeat(64) } }), [ev('run.waiting-approval', { node: 'approve-plan' })]);
  put(store, ID(2), state(ID(2), { status: 'waiting-approval', current: 'approve-commit', reviewedTree: 'b'.repeat(40) }));
  put(store, ID(3), state(ID(3), { status: 'completed', current: 'done', commit: 'deadbeefcafe0123' }), [ev('run.completed')]);
  put(store, ID(4), state(ID(4), { status: 'failed', reason: 'tests are red' }));
  put(store, ID(5), state(ID(5), { status: 'needs-human', reason: 'blocked by policy' }));
  put(store, ID(6), state(ID(6), { status: 'interrupted' }));
  const art = (name: string, text: string): string => putArtifact(store, Buffer.from(text), { mediaType: 'text/plain', producer: name }).sha256;
  put(store, ID(7), state(ID(7), { status: 'waiting-approval', current: 'approve-commit', attempts: 1, reviewedTree: 'd'.repeat(40), artifacts: { plan: art('plan', 'the plan\n'), 'diff-1': art('diff-1', DIFF_TEXT), 'verify-1': art('verify-1', 'ok\n'), 'red-1': art('red-1', 'red\n') } }), [ev('run.waiting-approval', { node: 'approve-commit' })]);
  const keysFile = join(root, 'keys.json');
  // every run (G and g on Runs, then j through the list), every panel (a l p r, Tab round), the help, resize-free, then q
  // the viewer first (the newest waiting run is selected): d, scroll, search, files, wrap, help, back, verify, back
  const viewer = ['d', 'j', 'j', 'G', 'g', '\x1b[6~', '\x1b[5~', '/', 'add', '\r', 'n', 'N', '\x1b', 'n', 'N', 'w', '?', '?', 'd', 'v', 'j', 'q', 'v', 'q', 'q'];
  // the approval center (R4): opened, a name, a wrong hash and Enter (refused, re-read), Esc cancels, Esc closes — nothing written, no process
  const center = ['p', 'alice', '\r', '9c1e', '\r', '\x1b', '\x1b'];
  const chunks = [...center, ...viewer, 'r', 'G', 'k', 'k', 'k', 'k', 'k', 'k', 'g', 'a', 'l', 'j', 'G', 'p', '\t', '\t', '\t', '\x1b[Z', '?', 'j', '?', '?', '\x1b[6~', '\x1b[5~', 'y', 'Y', '\r', ' ', 'q'];
  writeFileSync(keysFile, JSON.stringify(chunks));
  const before = snapshot(store.root);
  const driver = join(import.meta.dirname, 'support', 'dashboard-driver.ts');
  const r = spawnSync(process.execPath, ['--permission', '--allow-fs-read=*', driver, repo, base, keysFile], { encoding: 'utf8', timeout: 60_000, env: { ...process.env, TZ: 'UTC' } });
  assert.equal(r.status, 0, `exit ${r.status}\n${r.stderr}`);
  assert.match(r.stdout, /^frames \d+/m);
  assert.deepEqual(snapshot(store.root), before, 'the control store is byte-identical: paths, sizes, modes, mtimes, contents');
  assert.match(r.stdout, /^writes denied$/m, 'the child really ran without write permission');
  assert.match(r.stdout, /^center shown$/m, 'the approval center really opened');
  assert.doesNotMatch(r.stdout, /spawn attempted/, 'opening and cancelling the approval center starts no process');
  console.log(r.stdout.trim());
  assert.ok(Number(/^frames (\d+)/m.exec(r.stdout)![1]) >= 15, 'and drew a frame for the keys that change the screen');
  // and the permission model really would have refused a write: the same driver cannot even create a file
  const probe = spawnSync(process.execPath, ['--permission', '--allow-fs-read=*', '-e', `require('fs').writeFileSync(${JSON.stringify(join(base, 'x'))}, '1')`], { encoding: 'utf8' });
  assert.notEqual(probe.status, 0, 'writes are denied under --permission');
});
