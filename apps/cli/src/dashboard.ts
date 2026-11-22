/**
 * The dashboard loop: keys, polling, resize, ticks. Read-only: it reads the control store through the watcher
 * (dashboard-data.ts) and paints through withTerminal; it writes nothing to disk, takes no lock and starts no process.
 * `onKey` is a pure reducer (the key table is documented in help-panel.ts); `runDashboard` owns the timers:
 *  - the store is polled every 500 ms and a frame is drawn only when the poll saw a change;
 *  - a 1 000 ms tick redraws only while the selected run has a live running step (its elapsed time is the one thing
 *    that changes with no file change); an idle dashboard writes nothing;
 *  - a held escape sequence is given to the decoder's `flush()` 50 ms after the last input (a bare Esc waits for it);
 *  - a resize takes the new size, forgets what is on the terminal and draws once.
 * Every timer and listener is cleared when the loop ends, however it ends.
 *
 * Approving (R4): `p`, alone in its input chunk, opens the approval center for the selected run's waiting gate; the
 * form (dashboard-approve.ts) then owns every raw input chunk. No key approves: the retyped hash and a separate Enter
 * hand the approval to `taskquoin approve`, in its own process — the only process the dashboard ever starts. The loop
 * then watches the control store: the approval recorded there is the success, never the exit code. Quitting while that
 * process lives asks first and says, after the terminal is given back, that it continues and where its output goes.
 */
import type { RepoStore } from '@taskquoin/store-fs';
import { artifactSha, createWatcher, freshApproval, freshPending, loadDocs, type DashboardModel, type DashStatic } from './dashboard-data.ts';
import { approvalForm, approvalRecord, spawnApprove, type ApprovalForm, type ApproveChild, type Gate } from './dashboard-approve.ts';
import { t } from './i18n/index.ts';
import type { Caps } from './tui/caps.ts';
import { n, nLog } from './tui/neutral.ts';
import { clock } from './tui/text.ts';
import { glyph, mark } from './tui/tokens.ts';
import type { Outcome } from './tui/components/approval-center.ts';
import { keyDecoder, type Key, type KeyChunk } from './tui/keys.ts';
import { withTerminal, type Signals, type TtyIO } from './tui/screen.ts';
import { geometry, openViewer, settle, sized, viewerKey } from './tui/components/diff-viewer.ts';
import { initialUi, layoutMode, renderDashboard, type Focus, type UiState } from './tui/components/dashboard-frame.ts';

export type Effect = { kind: 'quit'; confirmed?: true } | { kind: 'select'; runId: string } | { kind: 'open-viewer'; which: 'review' | 'verify' } | { kind: 'open-center' };

const ORDER: Focus[] = ['pipeline', 'approvals', 'runs', 'agents', 'events'];
const TABBED: readonly string[] = ['runs', 'agents', 'events'];
const PAGE = 10;
export const POLL_MS = 500;
export const TICK_MS = 1000;
export const FLUSH_MS = 50;

/** How far each panel's cursor (Runs) or offset (Agents, Events) can go; Pipeline and Approvals do not scroll. */
function last(focus: Focus, m: DashboardModel): number {
  switch (focus) {
    case 'runs': return Math.max(0, m.runs.length - 1);
    case 'agents': return Math.max(0, m.fixed.squad.length - 1);
    case 'events': return Math.max(0, (m.selected?.events.length ?? 0) - 1);
    default: return 0;
  }
}

const focused = (ui: UiState, focus: Focus): UiState => ({ ...ui, focus, ...(TABBED.includes(focus) ? { tab: focus as UiState['tab'] } : {}) });

function keyOf(key: Key): string | undefined {
  switch (key.name) {
    case 'char': return key.ch === 'G' ? 'G' : key.ch.toLowerCase();
    case 'up': return 'k';
    case 'down': return 'j';
    case 'home': return 'g';
    case 'end': return 'G';
    default: return undefined;
  }
}

/** One key in the viewer: typing a search query owns every key; otherwise `? d v p q` here and the rest to the viewer. */
function viewerStep(ui: UiState, key: Key, effects: Effect[], vh: number, multi: boolean): UiState {
  const v = ui.viewer!;
  if (key.name === 'ctrl-c') {
    if (ui.help) return { ...ui, help: false };
    effects.push({ kind: 'quit' });
    return ui;
  }
  const isChar = key.name === 'char';
  if (ui.help) return key.name === 'esc' || (isChar && (key.ch === '?' || key.ch === 'q')) ? { ...ui, help: false } : ui;
  if (!v.search?.typing && isChar) {
    if (key.ch === '?') return { ...ui, help: true };
    if (key.ch === 'd') { effects.push({ kind: 'open-viewer', which: 'review' }); return ui; }
    if (key.ch === 'v') { effects.push({ kind: 'open-viewer', which: 'verify' }); return ui; }
    if (key.ch === 'p') { if (!multi) effects.push({ kind: 'open-center' }); return ui; } // alone in its chunk, never type-ahead
  }
  const r = viewerKey(v, { keys: [key], multi: false }, vh);
  if (r.close) { const { viewer: _v, ...rest } = ui; return { ...rest, screen: 'main' }; }
  const { notice: _n, ...nv } = r.v;
  return { ...ui, viewer: nv };
}

/** Apply one key; `effects` collects what the loop must do. */
function step(ui: UiState, key: Key, m: DashboardModel, effects: Effect[], vh: number, multi: boolean): UiState {
  if (ui.quit) {
    // the quit question: q (or Ctrl+C) quits, Esc stays, nothing else acts
    if (key.name === 'esc') { const { quit: _q, ...rest } = ui; return rest; }
    if (key.name === 'ctrl-c' || (key.name === 'char' && key.ch.toLowerCase() === 'q')) effects.push({ kind: 'quit', confirmed: true });
    return ui;
  }
  if (ui.screen === 'center') return ui; // the form owns the keyboard (the loop hands it the raw chunks)
  if (ui.screen === 'viewer' && ui.viewer) return viewerStep(ui, key, effects, vh, multi);
  if (key.name === 'paste') return ui;
  if (key.name === 'ctrl-c') {
    if (ui.help) return { ...ui, help: false };
    effects.push({ kind: 'quit' });
    return ui;
  }
  if (key.name === 'esc') {
    const { notice: _gone, ...rest } = ui;
    return { ...rest, help: false };
  }
  const c = keyOf(key);
  if (c === 'q' && key.name === 'char') { effects.push({ kind: 'quit' }); return ui; }
  if (key.name === 'char' && c === '?') return { ...ui, help: !ui.help };
  if (ui.help) return ui; // the overlay owns the keyboard: only ?, Esc, Ctrl+C and q act
  if (key.name === 'tab' || key.name === 'backtab') {
    const at = ORDER.indexOf(ui.focus);
    return focused(ui, ORDER[(at + (key.name === 'tab' ? 1 : ORDER.length - 1)) % ORDER.length]!);
  }
  if (key.name === 'char') {
    if (c === 'r') return focused(ui, 'runs');
    if (c === 'a') return focused(ui, 'agents');
    if (c === 'l') return focused(ui, 'events');
    if (c === 'p') {
      // the centre opens only for a key pressed alone, for a gate that waits, when this dashboard can approve
      if (!multi && ui.approveHere && m.selected?.view.pending) effects.push({ kind: 'open-center' });
      return { ...ui, focus: 'approvals' };
    }
    if (c === 'd') { effects.push({ kind: 'open-viewer', which: 'review' }); return ui; }
    if (c === 'v') { effects.push({ kind: 'open-viewer', which: 'verify' }); return ui; }
  }
  let delta: number | undefined;
  let to: number | undefined;
  if (key.name === 'pageup') delta = -PAGE;
  else if (key.name === 'pagedown') delta = PAGE;
  else if (key.name === 'char' || key.name === 'up' || key.name === 'down' || key.name === 'home' || key.name === 'end') {
    if (c === 'j') delta = 1;
    else if (c === 'k') delta = -1;
    else if (c === 'g') to = 0;
    else if (c === 'G') to = Number.MAX_SAFE_INTEGER;
  }
  if (delta === undefined && to === undefined) return ui; // anything else is ignored
  const max = last(ui.focus, m);
  const from = Math.min(ui.pos[ui.focus], max);
  const next = clampPos(to ?? from + delta!, max);
  if (next === ui.pos[ui.focus] && ui.pos[ui.focus] <= max) return ui;
  if (ui.focus === 'runs' && m.runs[next]) effects.push({ kind: 'select', runId: m.runs[next]!.runId });
  return { ...ui, pos: { ...ui.pos, [ui.focus]: next } };
}
const clampPos = (v: number, max: number): number => Math.max(0, Math.min(max, v));

/** The next UI state and effects for the keys of one input chunk, applied in order (a quit ends the chunk). Pure. */
export function onKey(ui: UiState, chunk: KeyChunk, m: DashboardModel, vh = 20): { ui: UiState; effects: Effect[] } {
  const effects: Effect[] = [];
  let next = ui;
  for (const key of chunk.keys) {
    next = step(next, key, m, effects, vh, chunk.multi);
    if (effects.some((e) => e.kind === 'quit' || e.kind === 'open-viewer' || e.kind === 'open-center')) break;
  }
  return { ui: next, effects };
}

export interface DashDeps {
  tty: TtyIO; signals: Signals;
  caps: (size: { columns: number; rows: number }) => Caps;
  store: RepoStore; fixed: DashStatic; runId?: string;
  now?: () => number;
  timers?: { setInterval: typeof setInterval; clearInterval: typeof clearInterval };
  isAlive?: (pid: number) => boolean | undefined;
  /** The artifacts read to the end in this session (the loop owns and fills it; a caller may share it). */
  read?: Set<string>;
  /** How to start `taskquoin approve` (absent: no approval center, the Approvals panel names the console and CLI routes). */
  approve?: { node: string; entry: string; cwd: string; env: NodeJS.ProcessEnv; spawn?: typeof import('node:child_process').spawn };
  /** Where the message "the run continues in process N" goes once the terminal is given back (stderr). */
  err?: (s: string) => void;
}

/** One `taskquoin approve` started from this dashboard and what the store says it did. */
interface Started { runId: string; short: string; gate: Gate; binding: string; as: string; form: ApprovalForm; child?: ApproveChild; alive: boolean; outcome: Outcome; before: ReturnType<typeof freshApproval> }

const shortOf = (runId: string): string => { const last = runId.split('-').at(-1) ?? ''; return n(last === '' ? runId : last); };

/** Runs until `q` (or Ctrl+C); resolves 0. Signals and errors leave through withTerminal, which gives the terminal back. */
export async function runDashboard(d: DashDeps): Promise<number> {
  const now = d.now ?? ((): number => Date.now());
  const timers = d.timers ?? { setInterval: (...a: Parameters<typeof setInterval>) => setInterval(...a), clearInterval: (h: Parameters<typeof clearInterval>[0]) => { clearInterval(h); } } as NonNullable<DashDeps['timers']>;
  const watcher = createWatcher(d.store, d.fixed, { ...(d.runId !== undefined ? { runId: d.runId } : {}), now: () => new Date(now()), ...(d.isAlive ? { isAlive: d.isAlive } : {}) });
  if (d.runId === undefined) {
    // newest running or waiting run, else (the watcher's choice) the newest
    const pick = watcher.model().runs.find((r) => r.status === 'running' || r.status === 'waiting-approval');
    if (pick) watcher.select(pick.runId);
  }

  const started: Started[] = [];
  const code = await withTerminal(d.tty, d.signals, async (screen) => {
    let caps = d.caps(d.tty.size());
    let ui: UiState = { ...initialUi(), ...(d.approve ? { approveHere: true } : {}) };
    const m0 = watcher.model();
    const at = m0.runs.findIndex((r) => r.runId === m0.selected?.runId);
    if (at > 0) ui = { ...ui, pos: { ...ui.pos, runs: at } };

    const read = d.read ?? new Set<string>();
    const decoder = keyDecoder();
    let tick: ReturnType<typeof setInterval> | undefined;
    let flushTimer: ReturnType<typeof setInterval> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    const offs: (() => void)[] = [];
    let done: ((code: number) => void) | undefined;
    let closed = false;
    let approver: string | undefined; // asked once per dashboard session, kept in memory only
    let form: { f: ApprovalForm; runId: string } | undefined;

    const draw = (): void => { if (!closed) screen.draw(renderDashboard(watcher.model(), ui, caps, now())); };
    const wantsTick = (): boolean => {
      const s = watcher.model().selected;
      return s !== undefined && s.view.status === 'running' && s.liveness === 'live' && s.view.steps.some((st) => st.state === 'running');
    };
    const syncTick = (): void => {
      if (wantsTick()) { if (tick === undefined) tick = timers.setInterval(draw, TICK_MS); }
      else if (tick !== undefined) { timers.clearInterval(tick); tick = undefined; }
    };
    /** The viewer sized for this terminal, with what it has shown counted as read (a session-long Set of artifact names). */
    const fitViewer = (): void => {
      if (ui.screen !== 'viewer' || !ui.viewer) return;
      let v = sized(ui.viewer, caps, caps.rows);
      v = settle(v, geometry(caps, caps.rows).rows);
      if (v.docs.length > 0 && v.readToEnd.every(Boolean)) read.add(v.artifact);
      ui = { ...ui, viewer: v };
    };
    const open = (which: 'review' | 'verify'): void => {
      const id = watcher.model().selected?.runId;
      const r = id === undefined ? { error: t('dashboard.viewer.noRun') } : loadDocs(d.store, id, which);
      if ('error' in r) {
        ui = ui.viewer ? { ...ui, viewer: { ...ui.viewer, notice: r.error } } : { ...ui, notice: r.error };
        return;
      }
      const { notice: _n, ...rest } = ui;
      ui = { ...rest, screen: 'viewer', viewer: openViewer(r, geometry(caps, caps.rows).rows) };
      fitViewer();
    };
    // ---- the approval center and the process it starts ----------------------------------------------------------
    const outcomeLine = (o: Outcome): string => {
      const sep = ` ${mark('sep', caps)} `;
      switch (o.kind) {
        case 'started': return `${glyph('running', caps)} ${t('dashboard.center.started', { pid: o.pid })}`;
        case 'approved': return `${glyph('done', caps)} ${t('dashboard.center.approved', { as: n(o.as), time: clock(o.at), pid: o.pid })}`;
        case 'refused': return `${glyph('failed', caps)} ${t('dashboard.center.refused', { exit: n(o.exit) })}${sep}${t('dashboard.center.nothing')}`;
        case 'failed': return `${glyph('failed', caps)} ${t('dashboard.center.notStarted', { message: n(o.message) })}${sep}${t('dashboard.center.nothing')}`;
      }
    };
    /** Outside the centre, the latest process's outcome is the footer's notice. */
    const notify = (s: Started): void => { if (ui.screen !== 'center' && started.at(-1) === s) ui = { ...ui, notice: outcomeLine(s.outcome) }; };
    /** What the store says now about a started approval: recorded → approved (the process may still run). */
    const recordOf = (s: Started): { at?: string } | undefined => {
      const now = freshApproval(d.store, s.runId);
      return approvalRecord(now.state, now.events, s, s.before);
    };
    const finish = (s: Started, r: { code: number | null; signal: NodeJS.Signals | null }): void => {
      s.alive = false;
      if (s.outcome.kind === 'approved') return;
      const rec = recordOf(s);
      if (rec) s.outcome = { kind: 'approved', pid: s.child!.pid, as: s.as, at: rec.at ?? new Date(now()).toISOString() };
      else s.outcome = { kind: 'refused', exit: r.code !== null ? String(r.code) : r.signal ?? '?', tail: (s.child?.tail() ?? '').split('\n').filter((l) => l.trim() !== '').slice(-3) };
    };
    /** Each poll while an approval is in flight: the store, not the exit code, says whether it was approved. */
    const watch = (): boolean => {
      let changed = false;
      for (const s of started) {
        if (s.outcome.kind !== 'started') continue;
        const rec = recordOf(s);
        if (rec) { s.outcome = { kind: 'approved', pid: s.child!.pid, as: s.as, at: rec.at ?? new Date(now()).toISOString() }; notify(s); changed = true; }
      }
      return changed;
    };
    const startApprove = (f: ApprovalForm, runId: string, gate: Gate, expect: string, as: string): void => {
      const st = f.state();
      const binding = st.step === 'sent' ? st.shown.binding : '';
      const s: Started = { runId, short: shortOf(runId), gate, binding, as, form: f, alive: false, outcome: { kind: 'failed', message: '' }, before: freshApproval(d.store, runId) };
      started.push(s);
      try {
        const child = spawnApprove({ ...d.approve!, runId, gate, expect, as });
        s.child = child; s.alive = true; s.outcome = { kind: 'started', pid: child.pid };
        void child.exited.then((r) => { finish(s, r); if (!closed) { notify(s); draw(); } });
      } catch (e) {
        s.outcome = { kind: 'failed', message: nLog(String((e as Error)?.message ?? e)) };
      }
    };
    const openCenter = (): void => {
      const sel = watcher.model().selected;
      const gate = sel?.view.pending?.gate;
      const { viewer: _v, notice: _n, ...rest } = ui;
      if (!d.approve || !sel || !gate) { ui = { ...rest, screen: 'main', focus: 'approvals' }; return; }
      decoder.flush(); // input held from before the form: never typed into it
      const runId = sel.runId;
      const f: ApprovalForm = approvalForm({
        runId, gate, ...(approver !== undefined ? { approver } : {}),
        pending: () => freshPending(d.store, runId),
        approve: (r, g, expect, as) => { startApprove(f, r, g, expect, as); },
        onName: (name) => { approver = name; },
        context: () => {
          const m = watcher.model(), s = m.selected?.runId === runId ? m.selected : sel;
          return { view: s.view, request: s.request, read, acceptedRisks: d.fixed.acceptedRisks, waiting: m.runs.filter((r) => r.status === 'waiting-approval').length };
        },
        now: () => new Date(now()),
      });
      f.open();
      form = { f, runId };
      ui = { ...rest, screen: 'center', focus: 'approvals', center: { render: (c, h) => f.render(c, h, started.find((s) => s.form === f)?.outcome) } };
    };
    const closeCenter = (): void => {
      const f = form?.f;
      form = undefined;
      const { center: _c, ...rest } = ui;
      ui = { ...rest, screen: 'main', focus: 'approvals' };
      const st = f?.state().step;
      const mine = started.find((s) => s.form === f);
      if (mine) ui = { ...ui, notice: outcomeLine(mine.outcome) };
      else if (st === 'cancelled') ui = { ...ui, notice: t('dashboard.center.cancelled') };
    };
    /** A raw input chunk while the centre is open: the form's, or — once the form is done — a key that closes it. */
    const centerKey = (chunk: string): void => {
      const f = form!.f;
      if (layoutMode(caps) === 'too-small') { f.typeAhead(chunk); return; } // nothing is typed blind
      const st = f.state().step;
      if (st === 'name' || st === 'hash') {
        void f.key(chunk).catch(() => { /* startApprove reports its own failure */ });
        draw();
        return;
      }
      const dec = keyDecoder();
      const keys = [...dec.feed(chunk), ...dec.flush()].flatMap((c) => c.keys);
      const only = keys.length === 1 ? keys[0]! : undefined;
      if (st === 'stale' && only?.name === 'char' && only.ch.toLowerCase() === 'd') { closeCenter(); open('review'); draw(); return; }
      const closes = keys.some((k) => k.name === 'esc' || k.name === 'ctrl-c' || (k.name === 'char' && k.ch.toLowerCase() === 'q') || (k.name === 'enter' && st !== 'sent'));
      if (closes) { closeCenter(); draw(); }
    };

    const apply = (chunks: KeyChunk[]): void => {
      if (chunks.length === 0) return;
      for (const chunk of chunks) {
        if (ui.screen === 'center') break; // what follows the opening key is type-ahead: never the form's
        const r = onKey(ui, chunk, watcher.model(), geometry(caps, caps.rows).rows);
        ui = r.ui;
        for (const e of r.effects) {
          if (e.kind === 'quit') {
            const live = started.find((s) => s.alive && s.child);
            if (live && !e.confirmed) { ui = { ...ui, help: false, quit: { short: live.short, pid: live.child!.pid } }; continue; }
            done?.(0); return;
          }
          if (e.kind === 'select') watcher.select(e.runId);
          else if (e.kind === 'open-viewer') open(e.which);
          else openCenter();
        }
        fitViewer();
      }
      syncTick();
      draw();
    };
    /** After a poll that saw a change: is the viewer's tree still the one waiting for approval, and its artifact unchanged? */
    const recheck = (): void => {
      const v = ui.viewer, id = watcher.model().selected?.runId;
      if (ui.screen !== 'viewer' || !v?.binding || id === undefined) return;
      const current = freshPending(d.store, id)?.binding === v.binding.hash && artifactSha(d.store, id, v.artifact) === v.sha;
      if (current !== v.binding.current) ui = { ...ui, viewer: { ...v, binding: { ...v.binding, current } } };
    };
    const clearFlush = (): void => { if (flushTimer !== undefined) { timers.clearInterval(flushTimer); flushTimer = undefined; } };

    try {
      draw();
      syncTick();
      return await new Promise<number>((resolve) => {
        done = resolve;
        poll = timers.setInterval(() => {
          let changed = false;
          try { changed = watcher.poll(); } catch { /* an unreadable store is the watcher's business; keep the last frame */ }
          if (changed) { recheck(); syncTick(); }
          const outcome = watch();
          if (ui.screen === 'center') form?.f.refresh(); // the binding re-read each poll (shown, never acted on)
          if (changed || outcome || ui.screen === 'center') draw();
        }, POLL_MS);
        offs.push(d.tty.onData((chunk) => {
          if (ui.screen === 'center' && form) { clearFlush(); centerKey(chunk); return; }
          apply(decoder.feed(chunk));
          clearFlush();
          flushTimer = timers.setInterval(() => { clearFlush(); apply(decoder.flush()); }, FLUSH_MS);
        }));
        offs.push(d.tty.onResize(() => {
          caps = d.caps(d.tty.size());
          fitViewer();
          screen.invalidate();
          draw();
        }));
      });
    } finally {
      closed = true;
      for (const off of offs) { try { off(); } catch { /* nothing to undo */ } }
      if (poll !== undefined) timers.clearInterval(poll);
      if (tick !== undefined) timers.clearInterval(tick);
      clearFlush();
    }
  });
  // the terminal is back: say which approval processes go on, and where their output is
  for (const s of started) if (s.alive && s.child) d.err?.(t('dashboard.childContinues', { run: n(s.runId), pid: s.child.pid, log: n(s.child.logPath) }));
  return code;
}
