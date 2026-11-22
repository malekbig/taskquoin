/**
 * PROVES: the dashboard's top bar, footer, agent list and event viewer keep every line within the width at 40..200
 * columns in en, fr, ja, ar and both charsets; with no colour they emit no escape and still carry glyph + word for
 * every run status (a `running` run whose process is not known alive is `?` "not running?", never the running glyph);
 * the top bar keeps `◆ waiting for you` at 40 columns and gives things up in the fixed order; READY counts equal the
 * squad's ready + risk members whatever the verdicts (seeded, 200 squads); a model not recorded is `?`, not applicable
 * `—`; the working timer uses the timeline's duration; hostile text is shown neutralised, counted (singular and plural),
 * and re-neutralising is idempotent; skipped and cut notices; no percentage; the timeline's `hints`, `live` and `elapsed`
 * options (and that clock/duration/cut have one copy, in text.ts).
 * DOES NOT PROVE: that the data layer builds these views from a real store (dashboard-data tests) nor the frame layout.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { projectRun, type RunView, type StepId, type WorkflowStatus } from '@taskquoin/application';
import { setLanguage, t } from '../src/i18n/index.ts';
import { displayWidth } from '../src/i18n/width.ts';
import { n, neutralize } from '../src/tui/neutral.ts';
import { renderAgents, type AgentRow } from '../src/tui/components/agent-list.ts';
import { renderEvents, type EventLine } from '../src/tui/components/event-viewer.ts';
import { renderFooter, renderTopBar, runState, statusWord, type RunStatusView, type TopBar } from '../src/tui/components/status-bar.ts';
import { renderTimeline } from '../src/tui/components/timeline.ts';
import { caps as mkCaps, CORPUS, FORBIDDEN, LANGS, SGR, withLang } from './support/tui-fixtures.ts';

process.env.TZ = 'UTC';
const WIDTHS = [40, 60, 80, 100, 120, 200];
const STATUSES: RunStatusView[] = ['running', 'waiting-approval', 'needs-human', 'completed', 'failed', 'interrupted', 'unreadable'];
const NOW = Date.parse('2026-11-22T10:21:30.000Z');
const visible = (s: string): string => s.replace(SGR, '');

/** mulberry32: the same sequence for the same seed, so a failure can be replayed. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x; return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
}

const topBar = (o: Partial<TopBar> = {}): TopBar => ({
  version: '2026.11.1', repo: 'shop-api', branch: 'main', run: { short: 'ab12cd', status: 'waiting-approval' }, ready: 3, total: 4, acceptedRisks: 1, ...o,
});
const rows = (): AgentRow[] => [
  { id: 'planner', role: 'Architect', runtime: 'claude 2.1.330', state: 'blocked', note: 'claude not found' },
  { id: 'implementer', role: 'Developer', runtime: 'claude 2.1.330', model: 'opus', state: 'risk', note: 'connector.write', workingSince: new Date(NOW - 252_000).toISOString() },
  { id: 'challenger', role: 'Reviewer', runtime: 'codex 0.157.1', state: 'ready' },
  { role: 'Tester', runtime: 'bubblewrap 0.6.1', model: null, state: 'ready' },
];
const events = (): EventLine[] => [
  { at: '2026-11-22T10:24:02.000Z', subject: 'implement', text: 'attempt 2: Developer running', tone: 'cyan', marked: 0 },
  { at: '2026-11-22T10:21:07.000Z', subject: 'security', text: 'implementer: wrote the notes', marked: 2 },
  { at: '2026-11-22T10:20:01.000Z', subject: 'verify-1', text: 'tests failing in the clean room (exit 1)', tone: 'red', marked: 0 },
];

test('every renderer stays within its width at 40..200 columns, in en/fr/ja/ar and both charsets, with hostile text', () => {
  for (const lang of LANGS) for (const charset of ['utf8', 'ascii'] as const) withLang(lang, () => {
    for (const w of WIDTHS) {
      const c = mkCaps({ columns: w, charset });
      const hostile = CORPUS.join(' ');
      for (const status of STATUSES) for (const liveness of ['live', 'none', 'unknown'] as const) {
        const top = renderTopBar(topBar({ repo: hostile, branch: hostile, run: { short: hostile, status, liveness }, acceptedRisks: 12 }), c);
        assert.ok(displayWidth(top) <= w, `top ${lang} ${charset} ${w} ${status}: ${displayWidth(top)}`);
        assert.ok(!FORBIDDEN.test(visible(top)), 'top bar neutralised');
      }
      const foot = renderFooter([['r', 'runs'], ['a', 'agents'], ['l', 'log'], ['p', 'approvals'], ['?', 'help'], ['q', 'quit']], 'read-only · read 10:24:13 ✔ ' + hostile, c);
      assert.ok(displayWidth(foot) <= w, `footer ${lang} ${charset} ${w}: ${displayWidth(foot)}`);
      const agents = rows().map((r) => ({ ...r, role: hostile, runtime: hostile, note: hostile, model: hostile }));
      for (const l of renderAgents([...rows(), ...agents], w, c, NOW)) {
        assert.ok(displayWidth(l) <= w, `agents ${lang} ${charset} ${w}: ${displayWidth(l)} ${l}`);
        assert.ok(!FORBIDDEN.test(visible(l)), 'agents neutralised');
      }
      const ev = [...events(), ...CORPUS.map((s): EventLine => ({ at: '2026-11-22T10:00:00.000Z', subject: s, text: s, marked: 3 }))];
      const out = renderEvents(ev, { offset: 0, height: 12, width: w, skipped: 2, cut: true }, c);
      assert.equal(out.length, 12);
      for (const l of out) {
        assert.ok(displayWidth(l) <= w, `events ${lang} ${charset} ${w}: ${displayWidth(l)} ${l}`);
        assert.ok(!FORBIDDEN.test(visible(l)), 'events neutralised');
      }
    }
  });
});

test('no colour: no escape anywhere, and glyph + word for every run status', () => {
  setLanguage('en');
  const c = mkCaps({ colorDepth: 0, columns: 100 });
  const want: Record<RunStatusView, RegExp> = {
    running: /◉ running/, 'waiting-approval': /◆ waiting for you/, 'needs-human': /◆ needs a human/, completed: /✔ done/, failed: /✖ failed/, interrupted: /‖ interrupted/, unreadable: /\? unreadable/,
  };
  for (const status of STATUSES) {
    const top = renderTopBar(topBar({ run: { short: 'ab12cd', status, liveness: 'live' } }), c);
    assert.ok(!top.includes('\x1b'), `no ESC for ${status}`);
    assert.match(top, want[status], status);
  }
  for (const l of [...renderAgents(rows(), 100, c, NOW), ...renderEvents(events(), { offset: 0, height: 6, width: 100, skipped: 1, cut: true }, c), renderFooter([['q', 'quit']], 'read-only', c)]) {
    assert.ok(!l.includes('\x1b'), l);
  }
});

test('a running run whose process is not alive is `?` "not running?", never the running glyph', () => {
  setLanguage('en');
  const c = mkCaps({ colorDepth: 0, columns: 100 });
  for (const liveness of ['none', 'unknown', undefined] as const) {
    const top = renderTopBar(topBar({ run: { short: 'ab12cd', status: 'running', liveness } }), c);
    assert.match(top, /\? not running\?/);
    assert.ok(!top.includes('◉'));
    assert.equal(runState('running', liveness), 'unknown');
    assert.equal(statusWord('running', liveness), 'not running?');
  }
  assert.equal(runState('running', 'live'), 'running');
  assert.deepEqual(STATUSES.slice(1).map((s) => runState(s)), ['waiting', 'waiting', 'done', 'failed', 'interrupted', 'unknown']);
  assert.equal(runState('unreadable', 'live'), 'unknown');
});

test('the top bar at 40 columns keeps the waiting glyph and word, and gives things up in order', () => {
  setLanguage('en');
  const c = (columns: number) => mkCaps({ colorDepth: 0, columns });
  assert.match(renderTopBar(topBar({ repo: 'a-rather-long-repository-name' }), c(40)), /◆ waiting for you/);
  const full = renderTopBar(topBar(), c(200));
  assert.match(full, /taskquoin 2026\.11\.1 │ shop-api main │ run ab12cd ◆ waiting for you │ agents 3\/4 ready · 1 accepted risk$/);
  // Narrowing one column at a time: version, then branch, then risks, then ready go, and each stays gone.
  const gone = (s: string): string[] => [!s.includes('2026.11.1') && 'version', !s.includes('main') && 'branch', !s.includes('accepted risk') && 'risks', !/agents 3/.test(s) && 'ready'].filter(Boolean) as string[];
  let last = 0; const seen: string[] = [];
  for (let w = 200; w >= 40; w--) {
    const g = gone(renderTopBar(topBar(), c(w)));
    assert.ok(g.length >= last, `monotonic at ${w}`);
    for (const x of g) if (!seen.includes(x)) seen.push(x);
    last = g.length;
  }
  assert.deepEqual(seen, ['version', 'branch', 'risks', 'ready']);
  assert.match(renderTopBar(topBar({ run: undefined }), c(80)), /no run selected/);
});

test('the footer drops labels before keys and cuts the right text before keys', () => {
  setLanguage('en');
  const keys = [['r', 'runs'], ['a', 'agents'], ['l', 'log'], ['p', 'approvals'], ['?', 'help'], ['q', 'quit']] as const;
  const f = (columns: number, right = 'read-only · read 10:24:13 ✔') => renderFooter(keys, right, mkCaps({ colorDepth: 0, columns }));
  const wide = f(120);
  assert.equal(displayWidth(wide), 120);
  assert.match(wide, /^ r runs {2}a agents {2}l log {2}p approvals {2}\? help {2}q quit {2,}read-only · read 10:24:13 ✔$/);
  const mid = f(80);
  assert.ok(displayWidth(mid) <= 80);
  assert.match(mid, /r runs {2}a agents/);
  assert.ok(!mid.includes('10:24:13 ✔'), 'the right text is cut first');
  const narrow = f(40);
  assert.ok(displayWidth(narrow) <= 40);
  for (const k of ['r', 'a', 'l', 'p', '?', 'q']) assert.ok(narrow.split(/\s+/).includes(k), `key ${k} kept at 40`);
  assert.ok(!narrow.includes('runs'), 'labels dropped');
  for (let w = 20; w <= 200; w++) assert.ok(displayWidth(f(w)) <= Math.max(w, 0) || w < 20, `fits at ${w}`);
});

test('READY is counted from the squad: whatever the verdicts, READY rows equal ready + risk members (AC-7, seeded)', () => {
  setLanguage('en');
  const c = mkCaps({ colorDepth: 0, columns: 120 });
  for (let seed = 1; seed <= 200; seed++) {
    const rnd = prng(seed);
    const squad: AgentRow[] = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, i) => ({
      role: `Role${i}`, runtime: 'claude', state: (['ready', 'risk', 'blocked'] as const)[Math.floor(rnd() * 3)], ...(rnd() < 0.5 ? { note: 'x' } : {}),
    }));
    const text = renderAgents(squad, 120, c, NOW).join('\n');
    const ready = (text.match(/(?<!NOT )READY/g) ?? []).length;
    assert.equal(ready, squad.filter((r) => r.state !== 'blocked').length, `seed ${seed}`);
    assert.equal((text.match(/NOT READY/g) ?? []).length, squad.filter((r) => r.state === 'blocked').length, `seed ${seed}`);
  }
});

test('agents: model undefined is `?`, null is `—` (`-` in ASCII); the working timer is the timeline\'s duration; idle otherwise', () => {
  setLanguage('en');
  const c = mkCaps({ colorDepth: 0, columns: 120 });
  const lines = renderAgents(rows(), 120, c, NOW);
  assert.match(lines[0], /^○ Architect +claude 2\.1\.330 +\? +NOT READY +claude not found +· idle$/);
  assert.match(lines[1], /Developer +claude 2\.1\.330 +opus +READY +connector\.write +◉ working · 4 min 12 s$/);
  assert.match(lines[3], /Tester +bubblewrap 0\.6\.1 +— +READY +· idle$/);
  assert.match(renderAgents(rows(), 120, mkCaps({ colorDepth: 0, columns: 120, charset: 'ascii' }), NOW)[3], /Tester +bubblewrap 0\.6\.1 +- +READY/);
  assert.match(renderAgents(rows(), 120, mkCaps({ columns: 120 }), NOW)[1], /\x1b\[38;2;125;207;255m◉ working/, 'working is cyan');
  assert.match(renderAgents(rows(), 120, mkCaps({ columns: 120 }), NOW)[0], /\x1b\[38;2;154;165;206m· idle/, 'idle is muted');
});

test('agents: columns go note, model, runtime, never the state word', () => {
  setLanguage('en');
  const r = rows();
  const at = (w: number) => renderAgents(r, w, mkCaps({ colorDepth: 0, columns: w }), NOW)[1];
  const all = at(120);
  assert.ok(all.includes('connector.write') && all.includes('opus') && all.includes('claude 2.1.330'));
  const seen: string[] = [];
  for (let w = 120; w >= 40; w--) {
    const l = at(w);
    assert.ok(/READY/.test(l), `state word at ${w}`);
    for (const [name, text] of [['note', 'connector.write'], ['model', 'opus'], ['runtime', 'claude 2.1.330']] as const) if (!l.includes(text) && !seen.includes(name)) seen.push(name);
  }
  assert.deepEqual(seen, ['note', 'model', 'runtime']);
});

test('events: newest first, exactly `height` lines, clock + subject + text', () => {
  setLanguage('en');
  const c = mkCaps({ colorDepth: 0, columns: 80 });
  const out = renderEvents(events(), { offset: 0, height: 8, width: 80, skipped: 0, cut: false }, c);
  assert.equal(out.length, 8);
  assert.match(out[0], /^10:24:02 {2}implement {2}attempt 2: Developer running$/);
  assert.match(out[1], /^10:21:07 {2}security {2,}implementer: wrote the notes$/);
  assert.match(out[2], /^ +⚠ 2 characters neutralised$/);
  assert.match(out[3], /^10:20:01 {2}verify-1 {2,}tests failing/);
  assert.equal(out[7], '');
  const off = renderEvents(events(), { offset: 1, height: 2, width: 80, skipped: 0, cut: false }, c);
  assert.equal(off.length, 2);
  assert.match(off[0], /^10:21:07/);
  assert.equal(renderEvents([], { offset: 0, height: 3, width: 40, skipped: 0, cut: false }, c).length, 3);
  assert.match(renderEvents([{ at: '', subject: 'run', text: 'x', marked: 0 }], { offset: 0, height: 1, width: 40, skipped: 0, cut: false }, c)[0], /^\? {2}run {2}x$/, 'unknown time is `?`');
  assert.ok(![...out, ...renderTimeline(projectRun({ runId: 'r', status: 'running' } as never, []), c, NOW)].some((l) => /%/.test(l)), 'no percentage');
});

test('events: a hostile line is shown neutralised and counted, singular and plural, red', () => {
  setLanguage('en');
  const hostile = neutralize('implementer: \u001b]52;c;eA==\u0007x');
  assert.match(hostile.text, /‹ESC›\]52/);
  const one = neutralize('a\u001bb');
  const c = mkCaps({ colorDepth: 24, columns: 100 });
  const out = renderEvents([{ at: '2026-11-22T10:00:00.000Z', subject: 'security', text: hostile.text, marked: hostile.marked }, { at: '2026-11-22T10:00:01.000Z', subject: 'x', text: one.text, marked: one.marked }], { offset: 0, height: 6, width: 100, skipped: 0, cut: false }, c);
  const text = out.map(visible).join('\n');
  assert.match(text, /‹ESC›\]52;c;eA==‹BEL›x/);
  assert.match(text, /⚠ 2 characters neutralised/);
  assert.match(text, /⚠ 1 character neutralised/);
  assert.ok(out.some((l) => /\x1b\[38;2;247;118;142m⚠ 2 characters neutralised/.test(l)), 'the warning is red');
  assert.ok(!FORBIDDEN.test(text));
  withLang('fr', () => assert.match(renderEvents([{ at: '', subject: 'x', text: 'y', marked: 1 }], { offset: 0, height: 3, width: 80, skipped: 0, cut: false }, mkCaps({ colorDepth: 0 })).join('\n'), /1 caractère neutralisé/));
});

test('events: unreadable lines skipped and older events not shown, kept inside `height`', () => {
  setLanguage('en');
  const c = mkCaps({ colorDepth: 0, columns: 80 });
  const out = renderEvents(events(), { offset: 0, height: 8, width: 80, skipped: 2, cut: true }, c);
  assert.equal(out.length, 8);
  assert.ok(out.includes('2 unreadable lines skipped'));
  assert.ok(out.includes('older events not shown'));
  assert.ok(renderEvents(events(), { offset: 0, height: 8, width: 80, skipped: 1, cut: false }, c).includes('1 unreadable line skipped'));
  assert.ok(!renderEvents(events(), { offset: 0, height: 8, width: 80, skipped: 0, cut: false }, c).some((l) => /skipped|not shown/.test(l)));
  const tight = renderEvents(events(), { offset: 0, height: 2, width: 80, skipped: 2, cut: true }, c);
  assert.equal(tight.length, 2);
  assert.match(tight[0], /^10:24:02/, 'an event keeps priority over the notices when there is no room for both');
  const text = renderEvents(events(), { offset: 0, height: 8, width: 80, skipped: 2, cut: true }, mkCaps({ columns: 80, charset: 'ascii' })).join('\n');
  assert.match(text, /! 2 characters neutralised/);
});

test('re-neutralising is idempotent: n(n(x)) === n(x) for the whole corpus', () => {
  for (const s of CORPUS) assert.equal(n(n(s)), n(s), JSON.stringify(s));
  const top = renderTopBar(topBar({ repo: n(CORPUS[2]) }), mkCaps({ colorDepth: 0, columns: 200 }));
  assert.equal(top, renderTopBar(topBar({ repo: CORPUS[2] }), mkCaps({ colorDepth: 0, columns: 200 })));
});

const IDS: StepId[] = ['planning', 'critique', 'plan-approval', 'implementation', 'verify', 'red-proof', 'review', 'commit-approval', 'commit'];
const T = (hms: string) => `2026-11-22T${hms}.000Z`;
function running(status: WorkflowStatus = 'running'): RunView {
  return { runId: 'run-20261122T101500-ab12cd', status, current: 'implement', attempts: 1, branch: 'b', startedAt: T('10:15:00'), pending: status === 'waiting-approval' ? { gate: 'plan', binding: 'a'.repeat(64) } : undefined,
    steps: IDS.map((id, i): RunView['steps'][number] => i === 0 ? { id, state: 'done', startedAt: T('10:15:00'), endedAt: T('10:16:40'), durationMs: 98_000, agent: 'planner', runtime: 'claude', attempts: [], artifacts: ['plan'] }
      : i === 2 ? { id, state: 'waiting', startedAt: T('10:17:30'), attempts: [], artifacts: [] }
      : i === 3 ? { id, state: 'running', startedAt: T('10:17:30'), agent: 'implementer', runtime: 'claude', attempts: [{ n: 1, outcome: 'rework', artifact: 'diff-1' }, { n: 2, outcome: 'running', artifact: 'diff-2' }] as never, artifacts: [] }
      : { id, state: 'pending', attempts: [], artifacts: [] }) } as RunView;
}

test('timeline options: hints:false drops every /show, the default is unchanged, the binding hash stays', () => {
  setLanguage('en');
  const c = mkCaps({ colorDepth: 0, columns: 120 });
  const v = running('waiting-approval');
  const base = renderTimeline(v, c, NOW);
  assert.ok(base.some((l) => l.includes('/show plan')));
  assert.deepEqual(renderTimeline(v, c, NOW, {}), base);
  assert.deepEqual(renderTimeline(v, c, NOW, { hints: true }), base);
  const bare = renderTimeline(v, c, NOW, { hints: false });
  assert.ok(!bare.join('\n').includes('/show'), 'no /show');
  assert.ok(!bare.join('\n').includes('show '), 'no show either');
  assert.ok(bare.some((l) => l.includes('aaaaaaaaaaaa')), 'the bound hash is not a hint to drop');
  assert.equal(bare.length, base.length);
});

test('timeline options: live:false shows a running step `?` "not running?" with no elapsed time; elapsed:false shows a clock time only', () => {
  setLanguage('en');
  const c = mkCaps({ colorDepth: 0, columns: 120 });
  const v = running();
  const def = renderTimeline(v, c, NOW);
  assert.match(def[3], /◉ Implementation +running .*4 min 0 s/);
  const dead = renderTimeline(v, c, NOW, { live: false });
  assert.match(dead[3], /\? Implementation +not running\?/);
  assert.ok(!dead[3].includes('◉') && !/\d+ min|\d+ s\b/.test(dead[3]), `no glyph, no elapsed: ${dead[3]}`);
  const still = renderTimeline(v, c, NOW, { elapsed: false });
  assert.ok(!/4 min/.test(still[3]) && /10:17:30/.test(still[3]), still[3]);
  assert.ok(!/4 min|\b0 s/.test(still[2]) && /10:17:30/.test(still[2]), `a waiting step shows no stale elapsed: ${still[2]}`);
  assert.deepEqual(renderTimeline(v, c, NOW, { live: true, elapsed: true }), def);
});

test('clock, duration and cut have one copy: timeline.ts imports them from text.ts', () => {
  const src = readFileSync(new URL('../src/tui/components/timeline.ts', import.meta.url), 'utf8');
  assert.match(src, /from '\.\.\/text\.ts'/);
  assert.ok(!/export function (clock|duration)|function pad2/.test(src));
  void t;
});
