/**
 * The dashboard's data layer: a READ-ONLY watcher over the control store (spec §6, AC-10/13/14).
 *
 * It never writes, never locks, never creates a directory, never calls `repoStore()`, never opens `runs/<id>/lock`
 * for writing. `poll()` only stats (the `runs` directory, the `state.json` of the newest runs, the selected run's
 * directory, its `events.jsonl` and, for a running run, whether its process is alive); it reads a file only when its
 * stamp changed, and an unchanged stamp returns `false` with the same model object. Every string that comes from the
 * store goes through `n()` here, once, and the characters made visible are counted in `marked` (untrusted-text rules
 * 1 and 2); renderers receive neutral text only.
 */
import { lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pendingApproval, projectRun, runIdTime, type RunState, type RunView, type WorkflowStatus } from '@taskquoin/application';
import type { SquadMember } from '@taskquoin/application';
import { getArtifact, listRuns, readEvents, readRegularFile, type RepoStore } from '@taskquoin/store-fs';
import { t } from './i18n/index.ts';
import { parseDiff, textDocs, type Doc } from './tui/components/diff-viewer.ts';
import { n, neutralize, type Neutral } from './tui/neutral.ts';
import { shownRun } from './tui/view.ts';
import type { Token } from './tui/tokens.ts';
import type { AgentRow } from './tui/components/agent-list.ts';
import type { EventLine } from './tui/components/event-viewer.ts';
import type { Liveness, RunStatusView } from './tui/components/status-bar.ts';

/** Computed once when the dashboard opens (Task 6); every string already neutral. */
export interface DashStatic { version: string; repo: string; branch?: string; clean?: boolean; acceptedRisks: string[]; squad: SquadMember[]; runtimeVersions: Record<string, string>; checkedAt: string }
export interface RunEntry { runId: string; short: string; status: RunStatusView; request: string; startedAt: string; waiting?: 'plan' | 'commit'; liveness?: Liveness }
/** `runId` is the run's directory id: what the centre approves (a state.json naming another run is unreadable). */
export interface SelectedRun { runId: string; view: RunView<Neutral>; request: string; reason?: string; marked: number; events: EventLine[]; skipped: number; cut: boolean; liveness: Liveness; gone?: true }
export interface DashboardModel { fixed: DashStatic; runs: RunEntry[]; selected?: SelectedRun; lastChange: string; readError?: string }

export const MAX_RUNS = 50;
export const MAX_EVENTS = 1000;
const TAIL_BYTES = 512 * 1024;
const STATE_MAX_BYTES = 4 * 1024 * 1024;
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const STATUSES: readonly string[] = ['running', 'waiting-approval', 'completed', 'failed', 'needs-human', 'interrupted'] satisfies WorkflowStatus[];

const validId = (id: string): boolean => RUN_ID_RE.test(id) && !id.includes('..');
const num = (v: unknown): string => (typeof v === 'number' && Number.isFinite(v) ? String(v) : '?');

// ---- event lines -------------------------------------------------------------------------------------------------

/** One stored event as a line: every string through `n()`, the number of characters made visible in `marked`. */
export function eventLine(e: Record<string, unknown>): EventLine {
  let marked = 0;
  const s = (v: unknown, fallback = '?'): string => {
    if (typeof v !== 'string' || v === '') return fallback;
    const r = neutralize(v, { singleLine: true }); marked += r.marked; return r.text;
  };
  const at = typeof e.ts === 'string' ? s(e.ts, '') : '';
  const type = typeof e.type === 'string' ? e.type : undefined;
  const done = (subject: string, text: string, tone?: Token): EventLine => ({ at, subject, text, ...(tone ? { tone } : {}), marked });
  const who = () => s(e.label ?? e.runtime);
  switch (type) {
    case 'node.transition': return done(s(e.node), t('dashboard.event.transition', { outcome: s(e.outcome), next: s(e.next) }));
    case 'agent.started': return done(s(e.agent), t('dashboard.event.agentStarted', { who: who() }));
    case 'agent.finished': return done(s(e.agent), t('dashboard.event.agentFinished', { who: who(), status: s(e.status) }));
    case 'verify.result': return e.passed === true
      ? done(s(type), t('dashboard.event.verifyPassed', { attempt: num(e.attempt) }), 'green')
      : done(s(type), t('dashboard.event.verifyFailed', { attempt: num(e.attempt), exit: e.exitCode === null || e.exitCode === undefined ? '?' : num(e.exitCode) }), 'red');
    case 'red.result': return e.inconclusive === true
      ? done(s(type), t('dashboard.event.redInconclusive', { attempt: num(e.attempt) }), 'amber')
      : e.redFailed === true ? done(s(type), t('dashboard.event.redProven', { attempt: num(e.attempt) }), 'green')
      : done(s(type), t('dashboard.event.redNotProven', { attempt: num(e.attempt) }), 'red');
    case 'approval': return done(s(e.node), t('dashboard.event.approval', { by: s(e.approvedBy) }), 'green');
    case 'risk.accepted': return done(s(e.agent), t('dashboard.event.risk', { capability: s(e.capability), by: s(e.approvedBy) }), 'amber');
    default:
      if (type !== undefined && type.startsWith('run.')) {
        const status = type.slice(4);
        const tone: Token | undefined = status === 'completed' ? 'green' : status === 'waiting-approval' ? 'amber' : ['failed', 'needs-human', 'interrupted'].includes(status) ? 'red' : undefined;
        return done(s('run'), t('dashboard.event.run', { status: s(status), node: s(e.node) }), tone);
      }
      return done('', s(type));
  }
}

// ---- agent rows --------------------------------------------------------------------------------------------------

/** The Agents panel's rows: the squad with each agent's runtime version, last model and, when live, its running step. */
export function agentRows(fixed: DashStatic, sel?: SelectedRun): AgentRow[] {
  return fixed.squad.map((m): AgentRow => {
    const runtime = m.runtime ?? '?';
    const base: AgentRow = { role: m.role, runtime: `${n(runtime)} ${n(fixed.runtimeVersions[runtime] ?? '?')}`, state: m.state, ...(m.note ? { note: m.note } : {}) };
    if (m.agent === undefined) return { ...base, model: null };
    let model: string | undefined; let workingSince: string | undefined;
    const steps = sel?.view.steps ?? [];
    for (let i = steps.length - 1; i >= 0 && model === undefined; i--) {
      const st = steps[i]!;
      model = (st.runs ?? []).findLast(r => r.agent === m.agent && r.model)?.model ?? (st.agent === m.agent ? st.model : undefined);
    }
    const running = steps.find(st => st.state === 'running' && (st.agent === m.agent || (st.runs ?? []).some(r => r.agent === m.agent)));
    if (running && sel?.liveness === 'live' && running.startedAt) workingSince = running.startedAt;
    return { ...base, id: m.agent, ...(model !== undefined ? { model } : {}), ...(workingSince ? { workingSince } : {}) };
  });
}

// ---- liveness ----------------------------------------------------------------------------------------------------

const defaultIsAlive = (pid: number): boolean | undefined => {
  try { process.kill(pid, 0); return true; }
  catch (e) { const c = (e as NodeJS.ErrnoException).code; return c === 'ESRCH' ? false : c === 'EPERM' ? true : undefined; }
};

/**
 * The pid written in runs/<id>/lock, read only (one descriptor: never a link, never a FIFO, at most 32 bytes): an
 * integer above 0 or nothing (kill(0) would signal our own group).
 */
function lockPid(store: RepoStore, id: string): number | undefined {
  try {
    const text = readRegularFile(join(store.runs, id, 'lock'), { maxBytes: 32 }).bytes.toString('utf8').trim();
    if (!/^\d{1,10}$/.test(text)) return undefined;
    const pid = Number(text);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
  } catch { return undefined; }
}

// ---- stamps ------------------------------------------------------------------------------------------------------

const BINDING_RE = /^[0-9a-f]{40,64}$/;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const OPTIONAL_STRINGS = ['request', 'reason', 'branch', 'commit', 'reviewedTree'] as const;

/**
 * state.json of run `id` (its directory), read now, and its shape: the one check between the store and every reader
 * here. A regular file of at most 4 MiB (opened once, never through a link, never blocking on a FIFO) holding an object whose `runId` is that directory (a state naming another run
 * would send an approval there), `status` and `current` strings, `attempts` a finite number, `artifacts` an object of
 * strings, `approvals` an object, `history` an array of `{node, outcome, at}` strings, `request`, `reason`, `branch`,
 * `commit` and `reviewedTree` strings when present, and a pending binding that is a hash (40 to 64 lowercase hex).
 * Throws otherwise: the row reads `unreadable` and the selection keeps its last view.
 */
function readStateFile(store: RepoStore, id: string): RunState {
  if (!validId(id)) throw new Error('invalid run id');
  const v = JSON.parse(readRegularFile(join(store.runs, id, 'state.json'), { maxBytes: STATE_MAX_BYTES }).bytes.toString('utf8')) as unknown;
  if (!isObject(v) || typeof v.status !== 'string') throw new Error('invalid state');
  if (v.runId !== id) throw new Error('the state of another run');
  if (typeof v.current !== 'string' || typeof v.attempts !== 'number' || !Number.isFinite(v.attempts)) throw new Error('invalid state');
  if (!isObject(v.artifacts) || !Object.values(v.artifacts).every((x) => typeof x === 'string') || !isObject(v.approvals)) throw new Error('invalid state');
  if (!Array.isArray(v.history) || !v.history.every((h) => isObject(h) && typeof h.node === 'string' && typeof h.outcome === 'string' && typeof h.at === 'string')) throw new Error('invalid state');
  if (OPTIONAL_STRINGS.some((k) => v[k] !== undefined && typeof v[k] !== 'string')) throw new Error('invalid state');
  const p = pendingApproval(v as unknown as RunState);
  if (p && !BINDING_RE.test(p.binding)) throw new Error('the pending binding is not a hash');
  return v as unknown as RunState;
}

// ---- the viewer's data -------------------------------------------------------------------------------------------

/**
 * The gate a run waits for and its binding, read from state.json NOW (never the cached model); undefined when none or
 * unreadable. `at`: when it started waiting (the run's last history entry), for the stale screen's re-verify time.
 */
export function freshPending(store: RepoStore, runId: string): { gate: 'plan' | 'commit'; binding: string; at?: string } | undefined {
  try {
    if (!validId(runId)) return undefined;
    const state = readStateFile(store, runId);
    const p = pendingApproval(state);
    if (!p || !BINDING_RE.test(p.binding)) return undefined; // a binding is a hash, or there is none
    const at = Array.isArray(state.history) ? state.history.at(-1)?.at : undefined;
    return { gate: p.node === 'approve-plan' ? 'plan' : 'commit', binding: p.binding, ...(typeof at === 'string' ? { at } : {}) };
  } catch { return undefined; }
}

/**
 * The run's state and its last events, read NOW, for one check only: did `taskquoin approve` record the approval
 * (dashboard-approve.ts approvalRecorded). Never rendered; nothing here is shown or neutralised.
 */
export function freshApproval(store: RepoStore, runId: string): { state?: RunState; events: Record<string, unknown>[] } {
  if (!validId(runId)) return { events: [] };
  let state: RunState | undefined;
  try { state = readStateFile(store, runId); } catch { state = undefined; }
  let events: Record<string, unknown>[] = [];
  try { events = readEvents(store, runId, { max: MAX_EVENTS, tailBytes: TAIL_BYTES }).events; } catch { events = []; }
  return { ...(state ? { state } : {}), events };
}

/** The sha of a named artifact in state.json now. */
export function artifactSha(store: RepoStore, runId: string, name: string): string | undefined {
  try {
    if (!validId(runId)) return undefined;
    const v = readStateFile(store, runId).artifacts?.[name];
    return typeof v === 'string' ? v : undefined;
  } catch { return undefined; }
}

export const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
const SHA_RE = /^[0-9a-f]{64}$/;
const highest = (names: string[], prefix: string): number | undefined => {
  let best: number | undefined;
  for (const k of names) { const m = new RegExp(`^${prefix}-(\\d+)$`).exec(k); if (m && (best === undefined || Number(m[1]) > best)) best = Number(m[1]); }
  return best;
};

/**
 * What the viewer shows, read on demand: `review` is plan + challenge at the plan gate (or before any diff), else the
 * highest `diff-N`; `verify` is the highest `verify-N` and its `red-N`. Each artifact is opened once through
 * `getArtifact` (never through a link, never blocking on a FIFO or a device; over 4 MiB is refused, unread, with the
 * `taskquoin show` route) and re-hashed. `binding` is
 * the commit gate's tree hash when the run waits at commit and the artifact is its `diff-<attempts>`.
 */
export function loadDocs(store: RepoStore, runId: string, which: 'review' | 'verify'): { title: string; artifact: string; sha: string; docs: Doc[]; binding?: string } | { error: string } {
  if (!validId(runId)) return { error: t('dashboard.viewer.noRun') };
  let state: RunState;
  try { state = readStateFile(store, runId); } catch { return { error: t('dashboard.data.stateInvalid') }; }
  const arts = state.artifacts ?? {};
  const names = Object.keys(arts);
  const short = n(runId.split('-').at(-1) ?? runId);
  let picked: string[] = [], titleKey: 'dashboard.viewer.titleDiff' | 'dashboard.viewer.titlePlan' | 'dashboard.viewer.titleVerify' = 'dashboard.viewer.titleDiff', asDiff = false;
  if (which === 'verify') {
    const v = highest(names, 'verify');
    if (v !== undefined) picked = [`verify-${v}`, ...(`red-${v}` in arts ? [`red-${v}`] : [])];
    titleKey = 'dashboard.viewer.titleVerify';
  } else {
    const d = highest(names, 'diff');
    if (d !== undefined && state.current !== 'approve-plan') { picked = [`diff-${d}`]; asDiff = true; }
    else { picked = ['plan', 'challenge'].filter((k) => k in arts); titleKey = 'dashboard.viewer.titlePlan'; }
  }
  if (picked.length === 0) return { error: t('dashboard.viewer.none') };
  const shaOf = (name: string): string | undefined => (typeof arts[name] === 'string' && SHA_RE.test(arts[name]!) ? arts[name] : undefined);
  for (const name of picked) if (shaOf(name) === undefined) return { error: t('dashboard.viewer.unreadable', { artifact: n(name), run: n(runId) }) };
  const texts: { name: string; text: string }[] = [];
  for (const name of picked) {
    try { texts.push({ name, text: getArtifact(store, shaOf(name)!, { maxBytes: MAX_ARTIFACT_BYTES }).toString('utf8') }); }
    catch (e) {
      const { code, size, message } = (e ?? {}) as { code?: unknown; size?: unknown; message?: unknown };
      if (code === 'EFBIG' && typeof size === 'number') return { error: t('dashboard.viewer.tooBig', { artifact: n(name), size: (size / 1048576).toFixed(1), run: n(runId) }) };
      const mismatch = /hash mismatch/.test(String(message));
      return { error: t(mismatch ? 'dashboard.viewer.mismatch' : 'dashboard.viewer.unreadable', { artifact: n(name), run: n(runId) }) };
    }
  }
  let docs = asDiff ? parseDiff(texts[0]!.text) : textDocs(texts);
  if (docs.length === 0) docs = textDocs(texts);
  const pending = pendingApproval(state);
  const binding = asDiff && pending?.node === 'approve-commit' && picked[0] === `diff-${state.attempts}` && BINDING_RE.test(pending.binding) ? pending.binding : undefined;
  return { title: t(titleKey, { run: short }), artifact: picked[0]!, sha: shaOf(picked[0]!)!, docs, ...(binding !== undefined ? { binding } : {}) };
}

const stampOf = (path: string, link = false): string => {
  try { const s = (link ? lstatSync : statSync)(path); return `${s.mtimeMs}:${s.size}`; } catch { return '-'; }
};

interface Row { stamp: string; entry?: RunEntry }
interface Sel { id: string; stateStamp: string; evStamp: string; selected?: SelectedRun; readError?: string }

export function createWatcher(store: RepoStore, fixed: DashStatic, o: { runId?: string; now: () => Date; isAlive?: (pid: number) => boolean | undefined }): { model(): DashboardModel; poll(): boolean; select(runId: string): void } {
  const isAlive = o.isAlive ?? defaultIsAlive;
  let runsStamp = '';
  let ids: string[] = [];
  const rows = new Map<string, Row>();
  let want: string | undefined = o.runId;
  let sel: Sel | undefined;
  let key = '';
  let current: DashboardModel;

  const listIds = (): string[] => {
    try { return listRuns(store).filter(validId).sort().reverse().slice(0, MAX_RUNS); } catch { return []; }
  };
  const readState = (id: string): RunState | undefined => readStateFile(store, id);
  const liveness = (id: string, status: string | undefined): Liveness => {
    if (status !== 'running') return 'none';
    const pid = lockPid(store, id);
    if (pid === undefined) return 'none';
    const a = isAlive(pid);
    return a === undefined ? 'unknown' : a ? 'live' : 'none';
  };
  const shortOf = (id: string): string => { const last = id.split('-').at(-1) ?? ''; return n(last === '' ? id : last); };
  const rowOf = (id: string): RunEntry => {
    const base = { runId: n(id), short: shortOf(id), startedAt: runIdTime(id) ?? '' };
    try {
      const s = readState(id)!;
      const status = (STATUSES.includes(s.status) ? s.status : 'unreadable') as RunStatusView;
      const pending = status === 'waiting-approval' ? pendingApproval(s) : undefined;
      const request = typeof s.request === 'string' ? n(s.request.split('\n')[0]!.slice(0, 300)) : n('');
      return { ...base, status, request, ...(pending ? { waiting: pending.node === 'approve-plan' ? 'plan' as const : 'commit' as const } : {}), ...(status === 'running' ? { liveness: liveness(id, status) } : {}) };
    } catch { return { ...base, status: 'unreadable', request: n('') }; }
  };

  /** The selected run: state, events and projection, neutralised. Throws when state.json cannot be used. */
  const loadSelected = (id: string, lv: (status: string) => Liveness): SelectedRun => {
    const state = readState(id)!;
    const { events: raw, skipped, cut } = readEvents(store, id, { max: MAX_EVENTS, tailBytes: TAIL_BYTES });
    const shown = shownRun(projectRun(state, raw));
    let marked = shown.marked;
    const reqText = typeof state.request === 'string' ? state.request.split('\n')[0]!.slice(0, 300) : '';
    const req = neutralize(reqText, { singleLine: true }); marked += req.marked;
    const events = raw.map(eventLine).reverse();
    for (const e of events) marked += e.marked;
    return { runId: id, view: shown.view, request: req.text, ...(shown.view.reason !== undefined ? { reason: shown.view.reason } : {}), marked, events, skipped, cut, liveness: lv(state.status) };
  };

  /** Rebuild what the stamps say changed; returns the new composite key. */
  const refresh = (first: boolean): string => {
    const rs = stampOf(store.runs);
    if (first || rs !== runsStamp) { runsStamp = rs; ids = listIds(); }
    const live = new Set(ids);
    for (const k of [...rows.keys()]) if (!live.has(k)) rows.delete(k);
    const parts: string[] = [rs];
    for (const id of ids) {
      const stamp = stampOf(join(store.runs, id, 'state.json'), true);
      const prev = rows.get(id);
      if (!prev || prev.stamp !== stamp) rows.set(id, { stamp, entry: stamp === '-' ? undefined : rowOf(id) });
      parts.push(`${id}=${stamp}`);
    }
    if (want !== undefined && validId(want)) {
      const id = want;
      const dir = stampOf(join(store.runs, id)), state = stampOf(join(store.runs, id, 'state.json'), true), ev = stampOf(join(store.runs, id, 'events.jsonl'), true);
      const same = sel?.id === id;
      if (!same || sel!.stateStamp !== state || sel!.evStamp !== ev) {
        const next: Sel = { id, stateStamp: state, evStamp: ev };
        if (state === '-' && dir === '-') {
          if (same && sel!.selected) next.selected = { ...sel!.selected, gone: true };
        } else {
          try { next.selected = loadSelected(id, st => liveness(id, st)); }
          catch { next.readError = t('dashboard.data.stateInvalid'); if (same) next.selected = sel!.selected; }
        }
        sel = next;
      } else if (sel!.selected && sel!.selected.view.status === 'running') {
        const lv = liveness(id, 'running'); // the process dying changes no file: it is probed on every poll
        if (sel!.selected.liveness !== lv) sel = { ...sel!, selected: { ...sel!.selected, liveness: lv } };
      }
      parts.push(`sel=${id}:${dir}:${state}:${ev}:${sel!.selected?.liveness ?? ''}`);
    } else { sel = undefined; parts.push('sel=none'); }
    return parts.join('|');
  };

  const build = (): DashboardModel => ({
    fixed,
    runs: ids.map(id => rows.get(id)?.entry).filter((e): e is RunEntry => e !== undefined),
    ...(sel?.selected ? { selected: sel.selected } : {}),
    lastChange: o.now().toISOString(),
    ...(sel?.readError ? { readError: sel.readError } : {}),
  });

  if (want === undefined) {
    ids = listIds(); runsStamp = stampOf(store.runs);
    want = ids[0];
  }
  key = refresh(true);
  current = build();

  return {
    model: () => current,
    poll(): boolean {
      const before = key;
      key = refresh(false);
      if (key === before) return false;
      current = build();
      return true;
    },
    select(runId: string): void {
      want = runId; sel = undefined;
      key = refresh(false);
      current = build();
    },
  };
}
