/**
 * PROVES: the dashboard frame is exactly `rows` lines of at most `columns` columns at 40..200 columns (and below the
 * minimum) in en/fr/ja/ar, UTF-8 and ASCII, with and without colour (AC-1); the layout mode thresholds; the too-small
 * message keeps the needed size and `taskquoin status` unbroken; with no colour nothing but text is emitted and every
 * run status is glyph + word, and there is no percentage or bar (AC-2/3); the focused panel's border is `mint`, the
 * others `line`; every hostile string of the CORPUS, as request, reason, branch, repo or event field, leaves the frame
 * free of forbidden characters with the neutralised count shown (AC-4); a waiting gate's 12-character hash is shown
 * bold in every mode, at 40 columns too; a completed run shows its commit, an interrupted one how to resume, and a
 * running run whose process is not alive is never `◉` (it says `not running?`); the help overlay fits 40 × 12, names
 * every key of the key table and says no key approves; 200 frames at 120 × 40 over a store of 10 000 events take p95 under 5 ms (AC-11).
 * DOES NOT PROVE: the loop, the keys or the timers (dashboard.test.ts), nor the terminal bytes (screen tests).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoStore, type RepoStore } from '@taskquoin/store-fs';
import { createWatcher, type DashboardModel, type DashStatic } from '../src/dashboard-data.ts';
import { displayWidth } from '../src/i18n/width.ts';
import { t } from '../src/i18n/index.ts';
import { renderDashboard, layoutMode, initialUi, type UiState } from '../src/tui/components/dashboard-frame.ts';
import { KEY_TABLE, renderHelp } from '../src/tui/components/help-panel.ts';
import { caps as mkCaps, CORPUS, FORBIDDEN, LANGS, SGR, withLang } from './support/tui-fixtures.ts';

process.env.TZ = 'UTC';
const root = mkdtempSync(join(tmpdir(), 'tq-dash-frame-'));
after(() => rmSync(root, { recursive: true, force: true }));

const NOW = Date.parse('2026-11-22T10:21:30.000Z');
const at = (k: number) => new Date(Date.parse('2026-11-22T10:15:00.000Z') + k * 10_000).toISOString();
const visible = (s: string): string => s.replace(SGR, '');
const norm = (lines: string[]): string => visible(lines.join('\n')).replace(/\s+/g, ' ');
const HASH = 'c0ffee123456';
const ID = (k: number) => `run-20261122T10${String(10 + k).padStart(2, '0')}00-ab12c${k}`;

const fixed = (o: Partial<DashStatic> = {}): DashStatic => ({
  version: '2026.11.1', repo: 'shop-api', branch: 'main', acceptedRisks: [], checkedAt: at(0), runtimeVersions: { claude: '2.1.330' },
  squad: [
    { role: 'Planner', who: 'planner · claude', state: 'ready', agent: 'planner', runtime: 'claude' },
    { role: 'Implementer', who: 'implementer · claude', state: 'risk', agent: 'implementer', runtime: 'claude', note: 'connector.write' },
    { role: 'Tester', who: 'verify · bubblewrap', state: 'blocked', note: 'bubblewrap unavailable' },
  ], ...o,
} as DashStatic);

const state = (id: string, o: Record<string, unknown> = {}) => ({
  runId: id, workflow: 'feature-governed', request: 'add a sum function', status: 'running', current: 'implement', revision: 1, attempts: 1,
  artifacts: {}, approvals: {}, history: [{ node: 'recall', outcome: 'ok', at: at(1) }, { node: 'plan', outcome: 'planned', at: at(2) }], ...o,
});
const put = (s: RepoStore, id: string, st: unknown, events: unknown[] = []): void => {
  const dir = join(s.runs, id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'state.json'), JSON.stringify(st));
  writeFileSync(join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e) + '\n').join(''));
};
const fresh = (): RepoStore => repoStore(mkdtempSync(join(root, 'repo-')), mkdtempSync(join(root, 'state-')));
const ev = (type: string, o: Record<string, unknown> = {}) => ({ type, ts: at(3), ...o });

/** The model the dashboard really builds, over a store holding one run of each status; `runId` is the selected one. */
type Kind = 'running' | 'waiting-plan' | 'waiting-commit' | 'completed' | 'failed' | 'needs-human' | 'interrupted';
const KINDS: Kind[] = ['running', 'waiting-plan', 'waiting-commit', 'completed', 'failed', 'needs-human', 'interrupted'];
const stateOf = (id: string, kind: Kind, extra: Record<string, unknown> = {}) => {
  switch (kind) {
    case 'running': return state(id, extra);
    case 'waiting-plan': return state(id, { status: 'waiting-approval', current: 'approve-plan', artifacts: { plan: HASH + 'a'.repeat(52) }, ...extra });
    case 'waiting-commit': return state(id, { status: 'waiting-approval', current: 'approve-commit', reviewedTree: HASH + 'b'.repeat(28), ...extra });
    case 'completed': return state(id, { status: 'completed', current: 'done', commit: 'deadbeefcafe0123', ...extra });
    case 'failed': return state(id, { status: 'failed', reason: 'tests are red', ...extra });
    case 'needs-human': return state(id, { status: 'needs-human', reason: 'blocked by policy', ...extra });
    case 'interrupted': return state(id, { status: 'interrupted', ...extra });
  }
};
function model(selected: Kind, o: { extra?: Record<string, unknown>; events?: unknown[]; fixed?: Partial<DashStatic>; alive?: boolean; all?: boolean } = {}): DashboardModel {
  const s = fresh();
  KINDS.forEach((k, i) => { if (o.all !== false || k === selected) put(s, ID(i), stateOf(ID(i), k), []); });
  const id = ID(KINDS.indexOf(selected));
  put(s, id, stateOf(id, selected, o.extra), o.events ?? [ev('agent.started', { agent: 'implementer', runtime: 'claude' })]);
  if (selected === 'running') writeFileSync(join(s.runs, id, 'lock'), String(process.pid));
  return createWatcher(s, fixed(o.fixed), { runId: id, now: () => new Date(at(5)), isAlive: () => o.alive ?? true }).model();
}
const ui = (o: Partial<UiState> = {}): UiState => ({ ...initialUi(), ...o });

test('AC-1: exactly rows lines, each within columns, in en/fr/ja/ar, utf8/ascii, colour 24/0, from 1 × 1 to 200 × 60', () => {
  const sizes: [number, number][] = [[40, 12], [60, 20], [80, 24], [100, 30], [120, 34], [120, 24], [200, 60], [39, 30], [80, 11], [1, 1]];
  const hostile = CORPUS.join(' ');
  const m = model('waiting-commit', { extra: { request: hostile, reason: hostile }, events: [ev('agent.started', { agent: hostile, runtime: hostile })], fixed: { repo: hostile, branch: hostile } });
  const helpOn = [false, true];
  for (const lang of LANGS) for (const charset of ['utf8', 'ascii'] as const) for (const colorDepth of [24, 0] as const) withLang(lang, () => {
    for (const [columns, rows] of sizes) for (const help of helpOn) for (const focus of ['pipeline', 'approvals', 'runs', 'agents', 'events'] as const) {
      const lines = renderDashboard(m, ui({ help, focus, tab: focus === 'agents' || focus === 'events' ? focus : 'runs' }), mkCaps({ columns, rows, charset, colorDepth }), NOW);
      const tag = `${lang} ${charset} c${colorDepth} ${columns}x${rows} help=${help} ${focus}`;
      assert.equal(lines.length, rows, tag);
      for (const l of lines) assert.ok(displayWidth(visible(l)) <= columns, `${tag}: ${displayWidth(visible(l))} > ${columns}`);
      if (colorDepth === 0) assert.ok(!lines.join('\n').includes('\x1b'), `${tag}: no colour, no escape`);
    }
  });
});

test('layoutMode: wide from 120 × 30, stacked 80..119 (or 120+ with fewer rows), narrow 40..79, too small below 40 × 12, plain or not interactive', () => {
  const mode = (columns: number, rows: number, o = {}) => layoutMode(mkCaps({ columns, rows, ...o }));
  assert.equal(mode(119, 40), 'stacked');
  assert.equal(mode(120, 29), 'stacked');
  assert.equal(mode(120, 30), 'wide');
  assert.equal(mode(79, 30), 'narrow');
  assert.equal(mode(40, 12), 'narrow');
  assert.equal(mode(39, 12), 'too-small');
  assert.equal(mode(40, 11), 'too-small');
  assert.equal(mode(200, 60, { plain: true }), 'too-small');
  assert.equal(mode(200, 60, { interactive: false }), 'too-small');
});

test('too small: the needed size, this size and `taskquoin status` are in the message, unbroken, at any width', () => {
  const m = model('running');
  for (const columns of [36, 20, 12]) {
    const lines = renderDashboard(m, ui(), mkCaps({ columns, rows: 10 }), NOW);
    assert.equal(lines.length, 10);
    const raw = visible(lines.join('\n'));
    // each of the three must sit on one line (unbroken), whatever the wrapping
    for (const piece of ['40 × 12', `${columns} × 10`, 'taskquoin status']) {
      if (displayWidth(piece) <= columns) assert.ok(raw.split('\n').some((l) => l.includes(piece)), `${columns}: ${piece} broken in\n${raw}`);
    }
    const flat = norm(lines);
    assert.ok(flat.includes('40 × 12') || columns < 7);
    assert.ok(!flat.includes('shop-api'), 'no panel below the minimum');
  }
  assert.match(norm(renderDashboard(m, ui(), mkCaps({ columns: 36, rows: 10 }), NOW)), /taskquoin status/);
  assert.match(norm(renderDashboard(m, ui(), mkCaps({ columns: 200, rows: 60, plain: true }), NOW)), /40 × 12/);
});

test('AC-2/3: with no colour no escape, every run status is glyph + word, and there is no percentage or bar', () => {
  const words: [Kind, RegExp][] = [
    ['running', /◉ running/], ['waiting-plan', /◆ waiting for you/], ['completed', /✔ done/], ['failed', /✖ failed/], ['needs-human', /◆ needs a human/], ['interrupted', /‖ interrupted/],
  ];
  for (const [columns, rows] of [[120, 40], [100, 30], [60, 20], [40, 12]] as const) {
    for (const [kind, re] of words) {
      const lines = renderDashboard(model(kind), ui(), mkCaps({ columns, rows, colorDepth: 0 }), NOW);
      const flat = lines.join('\n');
      assert.ok(!flat.includes('\x1b'));
      assert.match(flat, re, `${kind} at ${columns}x${rows}`);
      assert.ok(!/\d\s*%|[█▓▒░▏▎▍▌▋▊▉]|\[#+\s*\]/.test(flat), `no percentage or bar: ${kind} ${columns}x${rows}`);
    }
  }
  // the Runs list shows each run's own state as glyph and word (wide, all seven runs listed)
  const wideLines = renderDashboard(model('running'), ui({ focus: 'runs' }), mkCaps({ columns: 120, rows: 40, colorDepth: 0 }), NOW).join('\n');
  for (const [, re] of words) assert.match(wideLines, new RegExp(re.source.replace(' ', ' ab12c\\d {2}')), `row: ${re}`);
});

test('focused panel border is mint, the others line (24-bit), in wide and stacked', () => {
  const MINT = '\x1b[38;2;94;242;194m╭', LINE = '\x1b[38;2;95;106;153m╭';
  const m = model('running');
  for (const focus of ['pipeline', 'approvals', 'runs', 'agents', 'events'] as const) {
    const lines = renderDashboard(m, ui({ focus }), mkCaps({ columns: 120, rows: 40 }), NOW);
    const corners = lines.join('\n');
    assert.equal(corners.split(MINT).length - 1, 1, `exactly one mint panel when ${focus} is focused`);
    assert.equal(corners.split(LINE).length - 1, 4, 'the other four are line');
  }
  const st = renderDashboard(m, ui({ focus: 'approvals' }), mkCaps({ columns: 100, rows: 30 }), NOW).join('\n');
  assert.equal(st.split(MINT).length - 1, 1);
  assert.equal(st.split(LINE).length - 1, 2);
});

test('stacked: the lower panel is titled `Runs r · Agents a · Events l` with the shown one bold', () => {
  const m = model('running');
  for (const [tab, label] of [['runs', 'Runs r'], ['agents', 'Agents a'], ['events', 'Events l']] as const) {
    const lines = renderDashboard(m, ui({ tab, focus: tab }), mkCaps({ columns: 100, rows: 30 }), NOW);
    assert.ok(visible(lines.join('\n')).includes('Runs r · Agents a · Events l'));
    assert.ok(lines.join('\n').includes(`\x1b[1m${label}\x1b[22m`), `${label} bold`);
    assert.equal(lines.join('\n').split('\x1b[1m' + label).length - 1, 1);
  }
});

test('AC-4: each CORPUS string as request, reason, branch, repo or event field: nothing forbidden reaches the frame and the count is shown', () => {
  for (const bad of CORPUS) {
    for (const where of ['request', 'reason', 'branch', 'event', 'repo'] as const) {
      const extra: Record<string, unknown> = where === 'request' ? { request: bad } : where === 'reason' ? { reason: bad } : where === 'branch' ? { branch: bad } : {};
      const m = model('failed', { extra, events: [where === 'event' ? ev('agent.started', { agent: bad, runtime: bad }) : ev('agent.started', { agent: 'x', runtime: 'y' })], fixed: where === 'repo' ? { repo: bad, branch: bad } : {} });
      for (const [columns, rows] of [[120, 40], [100, 30], [60, 20]] as const) {
        const lines = renderDashboard(m, ui({ focus: 'events' }), mkCaps({ columns, rows }), NOW);
        const flat = visible(lines.join('\n'));
        assert.ok(!FORBIDDEN.test(flat), `${where} ${JSON.stringify(bad)} at ${columns}`);
        if (where === 'request' || where === 'reason') assert.match(flat, /\d+ neutralised/, `${where} ${JSON.stringify(bad)} at ${columns}: the count is shown`);
      }
    }
  }
  const narrow = renderDashboard(model('failed', { extra: { request: CORPUS[0] } }), ui({ focus: 'pipeline' }), mkCaps({ columns: 40, rows: 12 }), NOW);
  assert.match(visible(narrow.join('\n')), /\d+ neutralised/, 'and in the narrow layout');
});

test('a waiting gate: its 12-character hash is shown, bold, in every layout, at 40 columns too', () => {
  for (const kind of ['waiting-plan', 'waiting-commit'] as const) for (const [columns, rows] of [[120, 40], [100, 30], [60, 20], [40, 12]] as const) {
    for (const lang of ['en', 'fr', 'ja']) withLang(lang, () => {
      const out = renderDashboard(model(kind), ui({ focus: 'approvals' }), mkCaps({ columns, rows }), NOW).join('\n');
      assert.ok(out.includes(`\x1b[1m${HASH}\x1b[22m`), `${kind} ${lang} ${columns}: hash bold`);
    });
  }
  const wide = norm(renderDashboard(model('waiting-plan'), ui(), mkCaps({ columns: 120, rows: 40 }), NOW));
  assert.match(wide, /◆ plan waiting since 10:15:20 · c0ffee123456/);
  assert.match(wide, /→ \/approve plan or taskquoin approve/);
  assert.match(wide, /1 waiting/);
});

test('a completed run shows its commit; an interrupted one how to resume; failed shows its reason', () => {
  const done = norm(renderDashboard(model('completed'), ui(), mkCaps({ columns: 120, rows: 40 }), NOW));
  assert.match(done, /✔ committed deadbee(?!f)/);
  const stop = norm(renderDashboard(model('interrupted'), ui(), mkCaps({ columns: 120, rows: 40 }), NOW));
  assert.match(stop, /‖ interrupted/);
  assert.match(stop, /taskquoin resume run-20261122T101600-ab12c6/);
  assert.match(norm(renderDashboard(model('failed'), ui(), mkCaps({ columns: 120, rows: 40 }), NOW)), /✖ failed: tests are red/);
  assert.match(norm(renderDashboard(model('needs-human'), ui(), mkCaps({ columns: 120, rows: 40 }), NOW)), /needs a human: blocked by policy/);
});

test('a running run whose process is not alive is never the running glyph, never a timer: `not running?`', () => {
  const m = model('running', { alive: false, all: false });
  for (const [columns, rows] of [[120, 40], [100, 30], [60, 20]] as const) {
    const out = visible(renderDashboard(m, ui(), mkCaps({ columns, rows }), NOW).join('\n'));
    assert.ok(!out.includes('◉'), `${columns}: no running glyph`);
    assert.ok(!/⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/.test(out), 'no spinner');
    assert.match(out, /not running\?/);
    assert.ok(!/working ·/.test(out), 'no agent timer');
  }
  const alive = visible(renderDashboard(model('running', { all: false }), ui(), mkCaps({ columns: 120, rows: 40 }), NOW).join('\n'));
  assert.match(alive, /◉ running/);
});

test('the footer: keys, `read-only · last change`, and a red `✖ read failed` when the store could not be read', () => {
  const m = model('running');
  const ok = renderDashboard(m, ui(), mkCaps({ columns: 120, rows: 40, colorDepth: 0 }), NOW);
  assert.match(ok.at(-1)!, /^ r runs {2}a agents {2}d diff {2}l log {2}v verify {2}p approvals {2}\? help {2}q quit {2,}read-only · last change 10:15:50$/);
  const bad = renderDashboard({ ...m, readError: 'x' }, ui(), mkCaps({ columns: 120, rows: 40 }), NOW);
  assert.match(visible(bad.at(-1)!), /✖ read failed 10:15:50$/);
  assert.ok(bad.at(-1)!.includes('\x1b[38;2;247;118;142m✖ read failed'), 'red');
});

test('help: fits 40 × 12, names every key of the table, says no key approves, replaces the middle rows', () => {
  const m = model('running');
  const lines = renderDashboard(m, ui({ help: true }), mkCaps({ columns: 40, rows: 12, colorDepth: 0 }), NOW);
  assert.equal(lines.length, 12);
  const flat = lines.join('\n');
  for (const k of KEY_TABLE) for (const part of k.keys.split(' ')) assert.ok(flat.includes(part), `help names ${part}`);
  const words = norm(lines.map((l) => l.replace(/[│╭╮╰╯─]/g, ' ')));
  assert.match(words, /no key approves on its own/);
  assert.match(words, /hash typed/);
  assert.match(words, /\/approve/);
  assert.ok(lines[0]!.includes('taskquoin') || lines[0]!.includes('▙'), 'the top bar stays');
  assert.match(lines.at(-1)!, / r runs| r a d l v p/, 'the footer stays');
  assert.ok(!flat.includes('Pipeline'), 'the panels are replaced');
  for (const w of [40, 80, 120]) assert.ok(renderHelp('main', w, mkCaps()).every((l) => displayWidth(visible(l)) <= w));
  // the help box is centred in a wide frame
  const w = visible(renderDashboard(m, ui({ help: true }), mkCaps({ columns: 120, rows: 40, colorDepth: 0 }), NOW).join('\n'));
  assert.ok(/\n {30,}╭─ Keys/.test(w), 'centred');
  assert.equal(t('dashboard.help.title'), 'Keys');
});

test('AC-11: 200 frames at 120 × 40 over a store of 10 000 events: p95 under 5 ms', () => {
  const s = fresh();
  const id = ID(0);
  put(s, id, state(id), []);
  const lines: string[] = [];
  for (let i = 0; i < 10_000; i++) lines.push(JSON.stringify(ev(i % 2 ? 'agent.started' : 'verify.result', { agent: 'implementer', runtime: 'claude', passed: false, attempt: i, exitCode: 1 })));
  appendFileSync(join(s.runs, id, 'events.jsonl'), lines.join('\n') + '\n');
  writeFileSync(join(s.runs, id, 'lock'), String(process.pid));
  const m = createWatcher(s, fixed(), { runId: id, now: () => new Date(at(5)) }).model();
  assert.ok(m.selected!.events.length <= 1000);
  const c = mkCaps({ columns: 120, rows: 40 });
  const times: number[] = [];
  for (let i = 0; i < 20; i++) renderDashboard(m, ui(), c, NOW); // warm up
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    renderDashboard(m, ui({ focus: i % 2 ? 'runs' : 'events' }), c, NOW);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p95 = times[Math.floor(times.length * 0.95)]!;
  console.log(`frame p95 ${p95.toFixed(3)} ms (max ${times.at(-1)!.toFixed(3)})`);
  assert.ok(p95 < 5, `p95 ${p95}`);
});
