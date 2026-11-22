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
 */
import type { RepoStore } from '@taskquoin/store-fs';
import { artifactSha, createWatcher, freshPending, loadDocs, type DashboardModel, type DashStatic } from './dashboard-data.ts';
import { t } from './i18n/index.ts';
import type { Caps } from './tui/caps.ts';
import { keyDecoder, type Key, type KeyChunk } from './tui/keys.ts';
import { withTerminal, type Signals, type TtyIO } from './tui/screen.ts';
import { geometry, openViewer, settle, sized, viewerKey } from './tui/components/diff-viewer.ts';
import { initialUi, renderDashboard, type Focus, type UiState } from './tui/components/dashboard-frame.ts';

export type Effect = { kind: 'quit' } | { kind: 'select'; runId: string } | { kind: 'open-viewer'; which: 'review' | 'verify' } | { kind: 'open-center' };

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
function viewerStep(ui: UiState, key: Key, effects: Effect[], vh: number): UiState {
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
    if (key.ch === 'p') { effects.push({ kind: 'open-center' }); return ui; }
  }
  const r = viewerKey(v, { keys: [key], multi: false }, vh);
  if (r.close) { const { viewer: _v, ...rest } = ui; return { ...rest, screen: 'main' }; }
  const { notice: _n, ...nv } = r.v;
  return { ...ui, viewer: nv };
}

/** Apply one key; `effects` collects what the loop must do. */
function step(ui: UiState, key: Key, m: DashboardModel, effects: Effect[], vh: number): UiState {
  if (ui.screen === 'viewer' && ui.viewer) return viewerStep(ui, key, effects, vh);
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
    if (c === 'p') return { ...ui, focus: 'approvals' };
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
    next = step(next, key, m, effects, vh);
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
}

/** Runs until `q` (or Ctrl+C); resolves 0. Signals and errors leave through withTerminal, which gives the terminal back. */
export function runDashboard(d: DashDeps): Promise<number> {
  const now = d.now ?? ((): number => Date.now());
  const timers = d.timers ?? { setInterval: (...a: Parameters<typeof setInterval>) => setInterval(...a), clearInterval: (h: Parameters<typeof clearInterval>[0]) => { clearInterval(h); } } as NonNullable<DashDeps['timers']>;
  const watcher = createWatcher(d.store, d.fixed, { ...(d.runId !== undefined ? { runId: d.runId } : {}), now: () => new Date(now()), ...(d.isAlive ? { isAlive: d.isAlive } : {}) });
  if (d.runId === undefined) {
    // newest running or waiting run, else (the watcher's choice) the newest
    const pick = watcher.model().runs.find((r) => r.status === 'running' || r.status === 'waiting-approval');
    if (pick) watcher.select(pick.runId);
  }

  return withTerminal(d.tty, d.signals, async (screen) => {
    let caps = d.caps(d.tty.size());
    let ui = initialUi();
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

    const draw = (): void => { screen.draw(renderDashboard(watcher.model(), ui, caps, now())); };
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
    const apply = (chunks: KeyChunk[]): void => {
      if (chunks.length === 0) return;
      for (const chunk of chunks) {
        const r = onKey(ui, chunk, watcher.model(), geometry(caps, caps.rows).rows);
        ui = r.ui;
        for (const e of r.effects) {
          if (e.kind === 'quit') { done?.(0); return; }
          if (e.kind === 'select') watcher.select(e.runId);
          else if (e.kind === 'open-viewer') open(e.which);
          else { const { viewer: _v, ...rest } = ui; ui = { ...rest, screen: 'main', focus: 'approvals' }; } // the approval centre arrives with R4's Task 8
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
          if (changed) { recheck(); syncTick(); draw(); }
        }, POLL_MS);
        offs.push(d.tty.onData((chunk) => {
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
      for (const off of offs) { try { off(); } catch { /* nothing to undo */ } }
      if (poll !== undefined) timers.clearInterval(poll);
      if (tick !== undefined) timers.clearInterval(tick);
      clearFlush();
    }
  });
}
