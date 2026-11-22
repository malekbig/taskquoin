/**
 * RunView (console V2 / dashboard, spec §6): the run as the console timeline and the dashboard show it. A pure
 * projection — no I/O, no clock — of the stored RunState and its event log (as `readEvents` returns it, possibly cut
 * at its head) onto the nine logical steps. It decides nothing and invents nothing: what is not recorded is absent.
 *
 *  - Times are the state machine's. A history entry is written when a node is LEFT, so a step ends at its last entry
 *    and starts at the entry before its first one (the first step at the time in the run id, UTC). A step in progress
 *    (running, waiting) starts when the run entered it this time — after a loop back, not at its first visit.
 *  - `durationMs` (done or failed steps) is the time spent in the step, summed over its passes: a pass counts its
 *    agents' own `durationMs` when every agent of the pass reported one, else its history time. A pass resumed after
 *    an interruption has no known start (a resume writes nothing): without agent times the step has no duration.
 *  - Passes through implement / verify / red-check / review are `attempts` of their step (n = pass number in the step,
 *    the outcome from history; a pass in progress is the last attempt, outcome `running`). An attempt names its
 *    artifact (`verify-N`…, N = the run's attempt number) only when the stored one can be that pass's: a later pass
 *    with the same N (re-verify after a commit approval, resume) overwrites it. An attempt has its own start and duration
 *    by the step's rules: a pass resumed after an interruption has no known start; a pass in progress has no duration.
 *  - The current step takes the run's status (interrupted and needs-human: failed); a status this projection does not
 *    know gives `unknown`, never an invented failure.
 *  - `outcome` is the step's last history outcome (the critique's verdicts, who approved a gate, a loop's last pass,
 *    the stop that failed it) for a step done, failed, waiting or unknown; none for a step in progress (its pass has
 *    none yet) nor for one pending again after a loop back (that outcome belongs to a pass the run went back before).
 *  - agent, runtime and model are those of the step's latest agent run, from `agent.started` / `agent.finished` only.
 *    `runs` lists every agent run of the step's last pass (several judges), the pass in progress for a running step; a
 *    pass resumed after an interruption includes the part before it (a resume continues it: judges who answered are
 *    not asked again). None when no agent ran.
 *  - Free text (`reason`, outcomes, agent / runtime / model, artifact names, branch, times…) is returned as stored, as
 *    the type parameter `S` (`projectRun` gives `RunView<string>`: raw). A screen never prints it raw: the CLI's
 *    `shownRun()` (apps/cli/src/tui/view.ts) neutralises the whole view once into `RunView<Neutral>`, the only view a
 *    renderer accepts (ADR-0019 decision 3), and carries the count of marked characters.
 */
import { pendingApproval, type NodeId, type RunState, type WorkflowStatus } from '../workflow/feature-governed.ts';

export type StepId = 'planning' | 'critique' | 'plan-approval' | 'implementation' | 'verify' | 'red-proof' | 'review' | 'commit-approval' | 'commit';
/** `unknown`: the current step of a run whose stored status this projection does not know (never shown as a failure). */
export type StepState = 'pending' | 'running' | 'waiting' | 'done' | 'failed' | 'unknown';
/** `S` is the type of every free-text field: `string` as projected (raw), `Neutral` once the CLI has neutralised it. */
export interface AttemptView<S extends string = string> {
  n: number; outcome: S; endedAt?: S; artifact?: S;
  /** When the pass began and how long it took, by the step's rules (none when unknown; no duration while in progress). */
  startedAt?: S; durationMs?: number;
}
export interface StepView<S extends string = string> {
  id: StepId; state: StepState; startedAt?: S; endedAt?: S; durationMs?: number; agent?: S; runtime?: S; model?: S; attempts: AttemptView<S>[]; artifacts: S[];
  /** How the step ended, as history records it (`challenged:APPROVE`, `approved-by:<name>`, `tests-green`, `waiting-approval`…). */
  outcome?: S;
  /** Every agent of the step's last pass, in order (all its judges); `agent` / `runtime` / `model` are the last one's. */
  runs?: AgentRunView<S>[];
}
/** One agent run: its runtime and model as reported, its own time once it finished and reported one. */
export interface AgentRunView<S extends string = string> { agent: S; runtime?: S; model?: S; durationMs?: number }
export interface RunView<S extends string = string> { runId: S; status: string; current: string; attempts: number; branch?: S; startedAt: S; steps: StepView<S>[]; pending?: { gate: 'plan' | 'commit'; binding: S }; reason?: S; commit?: S }

/** Logical steps in pipeline order; `pass` = the artifact prefix of a loop node's pass; `artifacts` = the step's names. */
const STEPS: readonly { id: StepId; nodes: readonly NodeId[]; pass?: string; artifacts?: RegExp }[] = [
  { id: 'planning', nodes: ['recall', 'plan'], artifacts: /^(memory|plan)$/ },
  { id: 'critique', nodes: ['challenge'], artifacts: /^challenge(-.+)?$/ },
  { id: 'plan-approval', nodes: ['approve-plan'] },
  { id: 'implementation', nodes: ['implement'], pass: 'implement', artifacts: /^(workspace-baseline|implement-\d+)$/ },
  { id: 'verify', nodes: ['verify'], pass: 'verify', artifacts: /^(verify|ignored)-\d+$/ },
  { id: 'red-proof', nodes: ['red-check'], pass: 'red', artifacts: /^red-\d+$/ },
  { id: 'review', nodes: ['review'], pass: 'review', artifacts: /^(diff-\d+|review-\d+(-.+)?)$/ },
  { id: 'commit-approval', nodes: ['approve-commit'] },
  { id: 'commit', nodes: ['commit', 'record', 'done'] },
];
const STEP_OF = new Map<string, number>(STEPS.flatMap((s, i) => s.nodes.map(n => [n, i] as const)));
const ACTIVE: Record<WorkflowStatus, StepState> = { running: 'running', 'waiting-approval': 'waiting', completed: 'done', failed: 'failed', 'needs-human': 'failed', interrupted: 'failed' };
/** Events written with a history entry: `step()` → node.transition, `stop()` → run.<status> (never run.completed). */
const STOP_EVENTS = new Set(['run.failed', 'run.waiting-approval', 'run.needs-human', 'run.interrupted']);
/** Outcomes of a pass the run stopped in: it may have ended before writing its artifact. */
const STOPPED = new Set(['failed', 'needs-human', 'interrupted']);

interface AgentRun { agent: string; runtime?: string; model?: string; durationMs?: number; open: boolean }

const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
const sum = (xs: (number | undefined)[]) => (xs.every(x => x !== undefined) ? (xs as number[]).reduce((a, b) => a + b, 0) : undefined);
const between = (from: string | undefined, to: string) => {
  const d = from === undefined ? NaN : Date.parse(to) - Date.parse(from);
  return Number.isFinite(d) && d >= 0 ? d : undefined;
};

/** `run-YYYYMMDDTHHMMSS-xxxxxx` (UTC, as `taskquoin run` names runs) → ISO time; undefined for any other id. */
export function runIdTime(runId: string): string | undefined {
  const m = /^run-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})-/.exec(runId);
  if (!m) return undefined;
  const iso = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toISOString();
  return iso.startsWith(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`) ? iso : undefined; // no rolled-over date
}

/**
 * The agent runs of each history entry, and those after the last entry (the pass in progress). Agent events belong to
 * the next event written with a history entry; the k-th such event of a node is that node's k-th entry. A log cut at
 * its head has fewer of them: they are matched to the last entries. More than entries means the log is ahead of
 * state.json (an event is appended just before each save): matched to the first ones.
 */
function agentRuns(state: RunState, history: RunState['history'], events: Record<string, unknown>[]): { byEntry: AgentRun[][]; live: AgentRun[] } {
  const marks: { node: string; runs: AgentRun[] }[] = [];
  let runs: AgentRun[] = [], next: string | undefined;
  for (const e of events) {
    if (typeof e !== 'object' || e === null || typeof e.type !== 'string') continue;
    if (typeof e.runId === 'string' && e.runId !== state.runId) continue;
    const agent = str(e.agent);
    if (e.type === 'agent.started' && agent) runs.push({ agent, runtime: str(e.runtime), open: true });
    else if (e.type === 'agent.finished' && agent) {
      let r = runs.findLast(x => x.open && x.agent === agent);
      if (!r) runs.push(r = { agent, open: true }); // a log older than agent.started
      r.open = false; r.runtime = str(e.runtime) ?? r.runtime; r.model = str(e.model);
      r.durationMs = typeof e.durationMs === 'number' && Number.isFinite(e.durationMs) && e.durationMs >= 0 ? e.durationMs : undefined;
    } else if ((e.type === 'node.transition' || STOP_EVENTS.has(e.type)) && typeof e.node === 'string') {
      marks.push({ node: e.node, runs }); runs = [];
      next = e.type === 'node.transition' ? str(e.next) : e.node;
    }
  }
  const byEntry = history.map((): AgentRun[] => []);
  const entries = new Map<string, number[]>(), marked = new Map<string, AgentRun[][]>();
  const add = <T>(m: Map<string, T[]>, k: string, v: T) => { const xs = m.get(k); if (xs) xs.push(v); else m.set(k, [v]); };
  history.forEach((h, i) => add(entries, h.node, i));
  for (const m of marks) add(marked, m.node, m.runs);
  for (const [node, ms] of marked) {
    const es = entries.get(node) ?? [];
    const off = ms.length >= es.length ? 0 : es.length - ms.length;
    for (let j = 0; j < Math.min(ms.length, es.length); j++) byEntry[es[off + j]] = ms[j];
  }
  return { byEntry, live: next === undefined || next === state.current ? runs : [] };
}

export function projectRun(state: RunState, events: Record<string, unknown>[]): RunView<string> {
  const history = state.history ?? [], stored = state.artifacts ?? {};
  const runStart = runIdTime(state.runId);
  const startOf = (i: number) => (i > 0 ? history[i - 1].at : runStart);
  const { byEntry, live } = agentRuns(state, history, events);
  const current = STEP_OF.get(state.current) ?? -1;
  const running = state.status === 'running';
  // The run's attempt number at each entry: set by `implemented:N`; verify, red-check and review passes use it.
  let att: number | undefined;
  const attemptOf = history.map(h => {
    if (h.node !== 'implement') return att;
    const m = /^implemented:(\d+)$/.exec(h.outcome);
    return m ? (att = Number(m[1])) : undefined;
  });

  /** A pass's start: the entry before it, unknown when it was resumed after an interruption (a resume writes nothing). */
  const passStart = (i: number) => (i > 0 && history[i - 1].outcome === 'interrupted' ? undefined : startOf(i));
  /** A pass's time: its agents' own, else the history's (unknown when its start is). */
  const passMs = (i: number) => {
    const ms = sum(byEntry[i].map(r => (r.open ? undefined : r.durationMs)));
    if (byEntry[i].length && ms !== undefined) return ms;
    return between(passStart(i), history[i].at);
  };

  const steps = STEPS.map((def, idx): StepView => {
    const mine = history.flatMap((h, i) => (STEP_OF.get(h.node) === idx ? [i] : []));
    const st: StepState = idx === current ? ACTIVE[state.status] ?? 'unknown' : idx < current ? 'done' : 'pending';
    const inProgress = idx === current && running;
    const artifacts = def.artifacts ? Object.keys(stored).filter(n => def.artifacts!.test(n)) : [];

    const attempts: AttemptView[] = def.pass ? mine.map((i, k) => {
      const n = attemptOf[i];
      let name = n === undefined ? undefined : `${def.pass}-${n}`;
      if (name && def.id === 'review' && !Object.hasOwn(stored, name)) name = `diff-${n}`; // stopped before the judges
      const same = mine.filter(j => attemptOf[j] === n);
      const its = name !== undefined && Object.hasOwn(stored, name) && (same.length === 1 || (same.at(-1) === i && !STOPPED.has(history[i].outcome)));
      const from = passStart(i), ms = passMs(i);
      return { n: k + 1, outcome: history[i].outcome, endedAt: history[i].at, ...(its ? { artifact: name } : {}),
        ...(from !== undefined ? { startedAt: from } : {}), ...(ms !== undefined ? { durationMs: ms } : {}) };
    }) : [];
    if (def.pass && inProgress) {
      const from = history.length ? passStart(history.length) : runStart; // the pass in progress began at the last entry
      attempts.push({ n: attempts.length + 1, outcome: 'running', ...(from !== undefined ? { startedAt: from } : {}) });
    }

    if (st === 'pending') return { id: def.id, state: st, attempts, artifacts };
    let startedAt: string | undefined, endedAt: string | undefined, durationMs: number | undefined;
    if (st === 'running' || st === 'waiting') {
      const j = history.findLastIndex(h => STEP_OF.get(h.node) !== idx);
      startedAt = j >= 0 ? history[j].at : runStart;
    } else if (mine.length) {
      startedAt = startOf(mine[0]); endedAt = history[mine.at(-1)!].at; durationMs = sum(mine.map(passMs));
    }
    const last = [...mine.flatMap(i => byEntry[i]), ...(inProgress ? live : [])].at(-1);
    const outcome = st !== 'running' && mine.length ? history[mine.at(-1)!].outcome : undefined;
    // The last pass: from its last entry (or the end of history while in progress) back through the interruptions it resumed.
    const end = inProgress ? history.length : mine.length ? mine.at(-1)! + 1 : 0;
    let from = inProgress ? end : end - 1;
    while (from > 0 && STEP_OF.get(history[from - 1].node) === idx && history[from - 1].outcome === 'interrupted') from--;
    const runs = [...byEntry.slice(Math.max(from, 0), end).flat(), ...(inProgress ? live : [])]
      .map(({ agent, runtime, model, durationMs }): AgentRunView => ({ agent, ...(runtime ? { runtime } : {}), ...(model ? { model } : {}), ...(durationMs !== undefined ? { durationMs } : {}) }));
    return {
      id: def.id, state: st,
      ...(startedAt !== undefined ? { startedAt } : {}), ...(endedAt !== undefined ? { endedAt } : {}), ...(durationMs !== undefined ? { durationMs } : {}),
      ...(last ? { agent: last.agent } : {}), ...(last?.runtime ? { runtime: last.runtime } : {}), ...(last?.model ? { model: last.model } : {}),
      attempts, artifacts, ...(outcome !== undefined ? { outcome } : {}), ...(runs.length ? { runs } : {}),
    };
  });

  const p = pendingApproval(state);
  return {
    runId: state.runId, status: state.status, current: state.current, attempts: state.attempts,
    ...(typeof state.branch === 'string' ? { branch: state.branch } : {}),
    startedAt: runStart ?? '', steps,
    ...(p ? { pending: { gate: p.node === 'approve-plan' ? 'plan' as const : 'commit' as const, binding: p.binding } } : {}),
    ...(typeof state.reason === 'string' ? { reason: state.reason } : {}),
    ...(typeof state.commit === 'string' ? { commit: state.commit } : {}),
  };
}
