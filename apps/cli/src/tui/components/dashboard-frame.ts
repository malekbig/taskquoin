/**
 * The dashboard frame: five panels (Pipeline, Approvals, Runs, Agents, Events) laid out for the terminal's size — wide
 * (two columns), stacked (one column, a tabbed lower panel), narrow (no borders, one panel) or a single "too small"
 * message — plus the help overlay. A frame is exactly `caps.rows` lines, each within `caps.columns`. Everything here
 * is a pure function of the model (already neutral), the UI state and the clock: it reads nothing, writes nothing.
 * State is always glyph + word; a running run whose process is not known alive is `?` "not running?", never `◉`.
 */
import type { RunView } from '@taskquoin/application';
import { t, tn } from '../../i18n/index.ts';
import { displayWidth } from '../../i18n/width.ts';
import type { DashboardModel, RunEntry, SelectedRun } from '../../dashboard-data.ts';
import type { Caps } from '../caps.ts';
import { n } from '../neutral.ts';
import { bold, ellipsis, glyph, mark, paint, selected as selectedBg, stateToken } from '../tokens.ts';
import { clip, clock, cut, localWhen, pad, wrap } from '../text.ts';
import { renderAgents } from './agent-list.ts';
import { agentRows } from '../../dashboard-data.ts';
import { renderEvents } from './event-viewer.ts';
import { panel, section } from './panel.ts';
import { renderHelp } from './help-panel.ts';
import { renderViewer, type ViewerState } from './diff-viewer.ts';
import { renderFooter, renderTopBar, runState, statusWord, type RunStatusView } from './status-bar.ts';
import { renderTimeline } from './timeline.ts';

export type Focus = 'pipeline' | 'approvals' | 'runs' | 'agents' | 'events';
/** The approval center on screen: the form draws itself (dashboard-approve.ts) within the rows it is given. */
export interface CenterScreen { render(caps: Caps, height: number): string[] }
/**
 * `approveHere`: this dashboard can approve (the approval center, `p`); else the Approvals panel names /approve and
 * taskquoin approve. `quit`: the question asked when quitting while a `taskquoin approve` process still runs.
 */
export interface UiState { screen: 'main' | 'viewer' | 'center'; focus: Focus; tab: 'runs' | 'agents' | 'events'; pos: Record<Focus, number>; help: boolean; notice?: string; viewer?: ViewerState; center?: CenterScreen; approveHere?: boolean; quit?: { short: string; pid: number } }
export type Mode = 'wide' | 'stacked' | 'narrow' | 'too-small';

export const initialUi = (): UiState => ({ screen: 'main', focus: 'pipeline', tab: 'runs', pos: { pipeline: 0, approvals: 0, runs: 0, agents: 0, events: 0 }, help: false });

export function layoutMode(caps: Caps): Mode {
  if (caps.plain || !caps.interactive || caps.columns < 40 || caps.rows < 12) return 'too-small';
  if (caps.columns >= 120 && caps.rows >= 30) return 'wide';
  return caps.columns >= 80 ? 'stacked' : 'narrow';
}

const NBSP = ' ';
const FOOTER_KEYS = (): [string, string][] => [
  ['r', t('dashboard.frame.key.runs')], ['a', t('dashboard.frame.key.agents')], ['d', t('dashboard.frame.key.diff')], ['l', t('dashboard.frame.key.log')],
  ['v', t('dashboard.frame.key.verify')], ['p', t('dashboard.frame.key.approvals')], ['?', t('dashboard.frame.key.help')], ['q', t('dashboard.frame.key.quit')],
];
const TITLE: Record<Focus, () => string> = {
  pipeline: () => t('dashboard.frame.pipeline'), approvals: () => t('dashboard.frame.approvals'), runs: () => t('dashboard.frame.runs'),
  agents: () => t('dashboard.frame.agents'), events: () => t('dashboard.frame.events'),
};
const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const shortOf = (m: DashboardModel, sel: SelectedRun): string => m.runs.find((r) => r.runId === sel.runId)?.short ?? n(sel.runId.split('-').at(-1) ?? sel.runId);

// ---- Runs ---------------------------------------------------------------------------------------------------------

/** The Runs body: `▸` on the cursor row, glyph and word, short id, request, start time; the cursor stays in view. */
export function renderRuns(runs: RunEntry[], o: { cursor: number; selected?: string; width: number; height: number }, caps: Caps, now: number): string[] {
  const { width, height } = o;
  if (height <= 0) return [];
  if (runs.length === 0) return [paint('muted', cut(t('dashboard.frame.noRuns'), width, ellipsis(caps)), caps)];
  const cursor = clamp(o.cursor, 0, runs.length - 1);
  const start = clamp(cursor - Math.floor(height / 2), 0, Math.max(0, runs.length - height));
  return runs.slice(start, start + height).map((r, k) => {
    const state = runState(r.status, r.liveness), word = statusWord(r.status, r.liveness);
    const cur = start + k === cursor ? mark('cursor', caps) : ' ';
    const when = localWhen(r.startedAt, now);
    const headPlain = `${cur} ${glyph(state, caps)} ${n(r.short)}  ${word}`;
    const headW = displayWidth(headPlain);
    const room = width - headW - 2 - displayWidth(when) - 2;
    let line: string;
    if (headW + 2 + displayWidth(when) > width) line = cut(headPlain, width, ellipsis(caps));
    else {
      const head = `${cur} ${paint(stateToken(state), glyph(state, caps), caps)} ${n(r.short)}  ${paint(stateToken(state), word, caps)}`;
      const req = room >= 6 ? `  ${pad(cut(n(r.request), room, ellipsis(caps)), room)}` : '';
      const gap = req === '' ? ' '.repeat(Math.max(1, width - headW - displayWidth(when))) : '  ';
      line = head + req + gap + paint('muted', when, caps);
    }
    return r.runId === o.selected ? selectedBg(pad(clip(line, width), width), caps) : line;
  });
}

// ---- Approvals ----------------------------------------------------------------------------------------------------

const GATE_STEP = { 'plan-approval': 'plan', 'commit-approval': 'commit' } as const;

/** The first line of the Approvals body for a waiting gate: the hash is the last, unbroken, bold part. */
function waitingLine(view: RunView<string>, width: number, caps: Caps): string {
  const gate = view.pending!.gate;
  const since = view.steps.find((s) => s.state === 'waiting')?.startedAt;
  const hash = view.pending!.binding.slice(0, 12);
  const sep = ` ${mark('sep', caps)} `;
  const head = `${glyph('waiting', caps)} ${t('dashboard.frame.waitingSince', { gate, time: clock(since) })}`;
  const room = width - displayWidth(sep) - displayWidth(hash);
  if (room < 4) return cut(hash, width, '');
  return paint('orange', cut(head, room, ellipsis(caps)), caps) + sep + bold(hash, caps);
}

/** The Approvals body (the human's next action for the selected run). Strings arrive neutral. */
export function renderApprovals(sel: SelectedRun | undefined, waiting: number, width: number, caps: Caps, here = false): string[] {
  const more = ellipsis(caps);
  if (!sel) return [paint('muted', cut(t('dashboard.frame.none'), width, more), caps)];
  const v = sel.view as RunView<string>;
  const status = v.status as RunStatusView;
  const state = runState(status, sel.liveness), word = statusWord(status, sel.liveness);
  if (v.pending) {
    const how = here ? t('dashboard.frame.openCenter') : t('dashboard.frame.approveHint', { gate: v.pending.gate });
    return [waitingLine(v, width, caps), cut(`${mark('arrow', caps)} ${how}`, width, more)];
  }
  if (status === 'failed' || status === 'needs-human' || status === 'interrupted') {
    const head = paint(stateToken(state), `${glyph(state, caps)} ${word}`, caps);
    const reason = v.reason ? `: ${n(v.reason)}` : '';
    const lines = [head + cut(reason, Math.max(0, width - displayWidth(`${glyph(state, caps)} ${word}`)), more)];
    if (status === 'interrupted') lines.push(cut(t('dashboard.frame.resume', { run: n(v.runId) }), width, more));
    return lines;
  }
  if (status === 'running' && sel.liveness !== 'live') {
    return [`${paint(stateToken('unknown'), glyph('unknown', caps), caps)} ${cut(t('dashboard.frame.notRunning', { run: n(v.runId) }), Math.max(0, width - 2), more)}`];
  }
  if (status === 'completed') {
    const sha = v.commit ? v.commit.slice(0, 7) : '';
    return [paint('green', cut(`${glyph('done', caps)} ${sha ? t('dashboard.frame.committed', { sha }) : word}`, width, more), caps)];
  }
  const lines = [cut(t('dashboard.frame.none'), width, more)];
  const ahead = v.steps.find((s) => s.state === 'pending' && s.id in GATE_STEP);
  if (ahead) lines.push(paint('muted', cut(t('dashboard.frame.next', { gate: GATE_STEP[ahead.id as keyof typeof GATE_STEP] }), width, more), caps));
  else if (waiting > 0) lines.push(paint('muted', cut(tn('dashboard.frame.waitingCount', waiting), width, more), caps));
  return lines;
}

// ---- panel bodies -------------------------------------------------------------------------------------------------

/** Lines the Pipeline needs for this run (a retry adds a nested line). */
const pipelineLines = (sel: SelectedRun | undefined): number => (sel ? sel.view.steps.reduce((a, s) => a + 1 + Math.max(0, s.attempts.length - 1), 0) : 1);

function pipelineBody(sel: SelectedRun | undefined, width: number, height: number, caps: Caps, now: number): string[] {
  if (!sel) return [paint('muted', cut(t('dashboard.top.noRun'), width, ellipsis(caps)), caps)];
  const running = sel.view.status === 'running';
  const lines = renderTimeline(sel.view as RunView<string>, { ...caps, columns: width }, now, { hints: false, live: !running || sel.liveness === 'live', elapsed: running && sel.liveness === 'live' });
  if (lines.length <= height) return lines;
  let active = 0, at = 0;
  const steps = sel.view.steps;
  let found = false;
  for (const s of steps) {
    if (!found && (s.state === 'running' || s.state === 'waiting' || s.state === 'failed')) { active = at; found = true; }
    at += 1 + Math.max(0, s.attempts.length - 1);
  }
  if (!found) active = Math.max(0, lines.length - 1);
  return lines.slice(clamp(active - Math.floor(height / 2), 0, lines.length - height)).slice(0, height);
}

const markedLabel = (sel: SelectedRun | undefined): string | undefined => (sel && sel.marked > 0 ? tn('dashboard.frame.marked', sel.marked) : undefined);

function agentsBody(m: DashboardModel, ui: UiState, width: number, height: number, caps: Caps, now: number): string[] {
  const rows = renderAgents(agentRows(m.fixed, m.selected), width, caps, now);
  return rows.slice(clamp(ui.pos.agents, 0, Math.max(0, rows.length - height)));
}

function eventsBody(m: DashboardModel, ui: UiState, width: number, height: number, caps: Caps): string[] {
  const sel = m.selected;
  return renderEvents(sel?.events ?? [], { offset: clamp(ui.pos.events, 0, Math.max(0, (sel?.events.length ?? 0) - 1)), height, width, skipped: sel?.skipped ?? 0, cut: sel?.cut ?? false }, caps);
}

function runsBody(m: DashboardModel, ui: UiState, width: number, height: number, caps: Caps, now: number): string[] {
  return renderRuns(m.runs, { cursor: ui.pos.runs, ...(m.selected ? { selected: m.selected.runId } : {}), width, height }, caps, now);
}

function body(kind: Focus, m: DashboardModel, ui: UiState, width: number, height: number, caps: Caps, now: number): string[] {
  const waiting = m.runs.filter((r) => r.status === 'waiting-approval').length;
  switch (kind) {
    case 'pipeline': return pipelineBody(m.selected, width, height, caps, now);
    case 'approvals': return renderApprovals(m.selected, waiting, width, caps, ui.approveHere === true);
    case 'runs': return runsBody(m, ui, width, height, caps, now);
    case 'agents': return agentsBody(m, ui, width, height, caps, now);
    case 'events': return eventsBody(m, ui, width, height, caps);
  }
}

// ---- frame --------------------------------------------------------------------------------------------------------

function footer(m: DashboardModel, ui: UiState, caps: Caps, keysOnly: boolean): string {
  const keys = FOOTER_KEYS();
  if (m.readError !== undefined) return renderFooter(keys, `${glyph('failed', caps)} ${t('dashboard.frame.readFailed', { time: clock(m.lastChange) })}`, caps, 'red');
  if (ui.notice) return renderFooter(keys, n(ui.notice), caps);
  if (keysOnly) return renderFooter(keys, '', caps);
  return renderFooter(keys, `${t('dashboard.frame.readOnly')} ${mark('sep', caps)} ${t('dashboard.frame.lastChange', { time: clock(m.lastChange) })}`, caps);
}

function topBar(m: DashboardModel, caps: Caps): string {
  const sel = m.selected;
  const ready = m.fixed.squad.filter((s) => s.state !== 'blocked').length;
  return renderTopBar({
    version: m.fixed.version, repo: m.fixed.repo, ...(m.fixed.branch ? { branch: m.fixed.branch } : {}),
    ...(sel ? { run: { short: shortOf(m, sel), status: sel.view.status as RunStatusView, liveness: sel.liveness } } : {}),
    ready, total: m.fixed.squad.length, acceptedRisks: m.fixed.acceptedRisks.length,
  }, caps);
}

const boxed = (kind: Focus, title: string, right: string | undefined, m: DashboardModel, ui: UiState, w: number, h: number, caps: Caps, now: number, focused: boolean): string[] =>
  panel({ title, ...(right ? { right } : {}), body: body(kind, m, ui, w - 4, h - 2, caps, now), width: w, height: h, focused }, caps);

function approvalsRight(m: DashboardModel): string | undefined {
  const waiting = m.runs.filter((r) => r.status === 'waiting-approval').length;
  return waiting > 0 ? tn('dashboard.frame.waitingCount', waiting) : undefined;
}

function wide(m: DashboardModel, ui: UiState, caps: Caps, now: number): string[] {
  const mid = caps.rows - 3, lw = 50, rw = caps.columns - lw - 1;
  const f = (k: Focus): boolean => ui.focus === k;
  const pH = Math.min(pipelineLines(m.selected) + 2, mid - 4 - 5), aH = 4, rH = mid - pH - aH;
  const left = [
    ...boxed('pipeline', TITLE.pipeline(), markedLabel(m.selected), m, ui, lw, pH, caps, now, f('pipeline')),
    ...boxed('approvals', TITLE.approvals(), approvalsRight(m), m, ui, lw, aH, caps, now, f('approvals')),
    ...boxed('runs', TITLE.runs(), undefined, m, ui, lw, rH, caps, now, f('runs')),
  ];
  const gH = Math.min(m.fixed.squad.length + 2, mid - 3), eH = mid - gH;
  const right = [
    ...boxed('agents', TITLE.agents(), undefined, m, ui, rw, gH, caps, now, f('agents')),
    ...boxed('events', TITLE.events(), undefined, m, ui, rw, eH, caps, now, f('events')),
  ];
  return [topBar(m, caps), '', ...left.map((l, i) => `${l} ${right[i] ?? ''}`), footer(m, ui, caps, false)];
}

function stacked(m: DashboardModel, ui: UiState, caps: Caps, now: number): string[] {
  const mid = caps.rows - 2, w = caps.columns;
  const aH = mid >= 13 ? 4 : 3;
  const pH = Math.max(3, Math.min(pipelineLines(m.selected) + 2, mid - aH - 6));
  const tH = mid - aH - pH;
  const tab = ui.tab, labels = (['runs', 'agents', 'events'] as const).map((k) => ({ k, text: `${TITLE[k]()} ${k === 'events' ? 'l' : k[0]}` }));
  let tabPanel = boxed(tab, labels.map((l) => l.text).join(' · '), undefined, m, ui, w, tH, caps, now, ui.focus === tab);
  const shown = labels.find((l) => l.k === tab)!.text;
  if (tabPanel.length > 0) tabPanel = [tabPanel[0]!.replace(shown, bold(shown, caps)), ...tabPanel.slice(1)];
  return [
    topBar(m, caps),
    ...boxed('pipeline', TITLE.pipeline(), markedLabel(m.selected), m, ui, w, pH, caps, now, ui.focus === 'pipeline'),
    ...boxed('approvals', TITLE.approvals(), approvalsRight(m), m, ui, w, aH, caps, now, ui.focus === 'approvals'),
    ...tabPanel,
    footer(m, ui, caps, false),
  ];
}

function narrow(m: DashboardModel, ui: UiState, caps: Caps, now: number): string[] {
  const w = caps.columns, sel = m.selected;
  const lead = ` ${caps.charset === 'utf8' ? '▙' : '#'} `;
  let top: string;
  if (!sel) top = paint('mint', lead, caps) + paint('muted', cut(t('dashboard.top.noRun'), Math.max(0, w - displayWidth(lead)), ellipsis(caps)), caps);
  else {
    const status = sel.view.status as RunStatusView, state = runState(status, sel.liveness);
    const st = `${glyph(state, caps)} ${statusWord(status, sel.liveness)}`;
    const head = cut(shortOf(m, sel), Math.max(0, w - displayWidth(lead) - displayWidth(st) - 1), ellipsis(caps));
    top = paint('mint', lead, caps) + head + ' ' + paint(stateToken(state), st, caps);
  }
  const action = sel ? ' ' + renderApprovals(sel, 0, w - 1, caps, ui.approveHere === true)[0]! : '';
  const kind = ui.focus, count = markedLabel(sel);
  const title = count ? `${TITLE[kind]()} ${mark('sep', caps)} ${count}` : TITLE[kind]();
  const h = caps.rows - 3;
  const right = kind === 'approvals' ? approvalsRight(m) : undefined;
  const sec = section({ title, ...(right ? { right } : {}), body: body(kind, m, ui, w, h - 1, caps, now), width: w, height: h }, caps);
  return [top, action, ...sec, footer(m, ui, caps, true)];
}

/** The one message below 40 × 12 (or in plain / non-interactive mode): what is needed, what there is, and `taskquoin status`. */
function tooSmall(caps: Caps): string[] {
  const ascii = caps.charset !== 'utf8', x = ascii ? 'x' : '×';
  const need = `40 ${x} 12`, have = `${caps.columns} ${x} ${caps.rows}`, cmd = 'taskquoin status';
  let text = t('dashboard.tooSmall', { need: need.replaceAll(' ', NBSP), have: have.replaceAll(' ', NBSP), cmd: cmd.replaceAll(' ', NBSP) });
  if (ascii) text = text.replaceAll('—', '-');
  return wrap(text, caps.columns).map((l) => l.replaceAll(NBSP, ' '));
}

function overlay(frame: string[], ui: UiState, caps: Caps): string[] {
  return boxOver(frame, renderHelp(ui.screen, caps.columns, caps, ui.approveHere === true), caps);
}

/** The quit question while `taskquoin approve` still runs: it continues, quitting does not stop it, q quits, Esc stays. */
function quitBox(q: NonNullable<UiState['quit']>, caps: Caps): string[] {
  const fold = (s: string): string => (caps.charset === 'utf8' ? s : s.replaceAll('—', '-').replaceAll('·', '-'));
  const w = Math.max(1, Math.min(caps.columns, 64)), inner = Math.max(1, w - 4);
  const body = [...wrap(fold(t('dashboard.quit.body', { short: n(q.short), pid: q.pid })), inner), '', bold(fold(t('dashboard.quit.keys')), caps)];
  return panel({ title: fold(t('dashboard.quit.title')), body, width: w, height: body.length + 2, focused: true }, caps);
}

function boxOver(frame: string[], box: string[], caps: Caps): string[] {
  const midH = caps.rows - 2;
  const shown = box.slice(0, midH);
  const top = 1 + Math.floor((midH - shown.length) / 2);
  const indent = ' '.repeat(Math.max(0, Math.floor((caps.columns - displayWidth(shown[0] ?? '')) / 2)));
  const out = frame.slice();
  for (let i = 1; i <= midH; i++) out[i] = i >= top && i < top + shown.length ? indent + shown[i - top]! : '';
  return out;
}

export function renderDashboard(m: DashboardModel, ui: UiState, caps: Caps, now: number): string[] {
  const mode = layoutMode(caps);
  let lines: string[];
  if (mode === 'too-small') lines = tooSmall(caps);
  else {
    lines = mode === 'wide' ? wide(m, ui, caps, now) : mode === 'stacked' ? stacked(m, ui, caps, now) : narrow(m, ui, caps, now);
    if (ui.screen === 'viewer' && ui.viewer) lines = renderViewer(ui.viewer, caps, caps.rows);
    else if (ui.screen === 'center' && ui.center) {
      // the run's top bar, then the centre: the keyboard belongs to the form (no help overlay there)
      const top = topBar(m, caps);
      lines = mode === 'narrow' ? [top, ...ui.center.render(caps, caps.rows - 1)] : [top, '', ...ui.center.render(caps, caps.rows - 2)];
    }
    if (ui.help && ui.screen !== 'center') lines = overlay(lines, ui, caps);
    if (ui.quit) lines = boxOver(lines, quitBox(ui.quit, caps), caps);
  }
  if (mode === 'too-small' && ui.quit) {
    // even below 40 × 12 the question is asked in words: the run goes on, q quits, Esc stays
    const fold = (s: string): string => (caps.charset === 'utf8' ? s : s.replaceAll('—', '-').replaceAll('·', '-'));
    lines = wrap(fold(`${t('dashboard.quit.body', { short: n(ui.quit.short), pid: ui.quit.pid })} ${mark('sep', caps)} ${t('dashboard.quit.keys')}`), caps.columns);
  }
  const out: string[] = [];
  for (let i = 0; i < caps.rows; i++) out.push(clip(lines[i] ?? '', caps.columns));
  return out;
}

