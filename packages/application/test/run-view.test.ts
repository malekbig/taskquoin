/**
 * PROVES: projectRun maps what feature-governed really writes — the state as saveRunState keeps it (JSON) and the
 * events as readEvents returns them from the real store — onto the nine logical steps:
 *  - times are the state machine's: a step ends at its last history entry, starts at the entry before its first one
 *    (the first step at the time in the run id); a step in progress starts when the run entered it this time;
 *  - durations are measured, never guessed: an agent's own durationMs when its events are there, else the history;
 *    none when a pass's start is unknown (resumed after an interruption, run id without a time);
 *  - passes through implement / verify / red-check / review are attempts nested under their step, with the outcome
 *    from history, the artifact the pass left (none when a later pass overwrote it) and their own start and duration;
 *  - every step that ended carries its last history outcome (the critique verdict, who approved a gate); a step in
 *    progress or pending again after a loop back carries none;
 *  - agent, runtime and model come from agent.started / agent.finished only; old runs (no events) show none; `runs`
 *    keeps every agent of the step's last pass (all judges), a resumed pass with the part before the interruption;
 *  - a log cut at its head, a log slightly ahead of state.json, foreign or malformed events change nothing they should
 *    not; reason is returned as stored; a stored status it does not know leaves the current step `unknown`;
 *  - pure: no clock read, inputs untouched.
 * DOES NOT PROVE: rendering (R2 timeline, R3 dashboard) or reading the store (adapters/store-fs tests).
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { advance, approve, MAX_REVIEW_DIFF, newRun, pendingApproval, projectRun, resume, type RunRequest, type RunResult, type RunState, type RuntimeExecutor, type StepView, type WorkflowDeps } from '../src/index.ts';
import { appendEvent, readEvents, repoStore } from '../../../adapters/store-fs/src/store.ts';

const RUN = 'run-20261122T101500-ab12cd';
const START = '2026-11-22T10:15:00.000Z';
/** The fake workflow clock ticks once per history entry: entry k (1-based) is written at START + 10 k seconds. */
const at = (k: number) => new Date(Date.parse(START) + k * 10_000).toISOString();
const T1 = '1'.repeat(40), T2 = '2'.repeat(40);
const PLAN = 'PLAN: add sum()', CRITIQUE = 'plan ok\nVERDICT: APPROVE', APPROVE = 'Looks good.\nVERDICT: APPROVE';

const root = mkdtempSync(join(tmpdir(), 'tq-run-view-'));
after(() => rmSync(root, { recursive: true, force: true }));

type Reply = { msg: string; ms: number; model?: string } | Error;
const says = (msg: string, ms: number, model?: string): Reply => ({ msg, ms, ...(model ? { model } : {}) });

class Fake implements RuntimeExecutor {
  readonly runtime: 'claude' | 'codex'; private replies: Reply[]; private onRun: (agent: string) => void;
  constructor(runtime: 'claude' | 'codex', replies: Reply[], onRun: (agent: string) => void) { this.runtime = runtime; this.replies = [...replies]; this.onRun = onRun; }
  async run(req: RunRequest): Promise<RunResult> {
    this.onRun(req.agent.id);
    const r = this.replies.shift();
    if (r === undefined) throw new Error('unexpected call');
    if (r instanceof Error) throw r;
    return { status: 'completed', runtime: this.runtime, runtimeVersion: 'fake', exitCode: 0, terminalMessage: r.msg, command: { bin: '/x', args: [], cwd: '/w' },
      effectiveConfigDigest: 'sha256:x', unsupported: [], stdoutTruncated: false, stderr: '', durationMs: r.ms,
      ...(r.model ? { inventory: { tools: [], mcpServers: [], plugins: [], skills: [], agents: [], model: r.model } } : {}) };
  }
}

interface Stored { state: RunState; events: Record<string, unknown>[] }

/**
 * The real workflow with fake agents, git and Verify. `stored()` = what a reader finds on disk: the last saved state
 * (JSON, like saveRunState) and the events written through the real store, read back with readEvents. `live` = the
 * same, taken while each agent works.
 */
function drive(o: { claude: Reply[]; codex: Reply[]; verify: boolean[]; trees?: string[]; diff?: string; judges?: string[] }) {
  const store = repoStore(mkdtempSync(join(root, 'repo-')), mkdtempSync(join(root, 'state-')));
  const blobs = new Map<string, string>(); const verify = [...o.verify]; const trees = [...(o.trees ?? [])];
  let tree = T1, ticks = 0, saved: RunState | undefined;
  const stored = (): Stored => ({ state: JSON.parse(JSON.stringify(saved)) as RunState, events: readEvents(store, RUN).events });
  const live: (Stored & { agent: string })[] = [];
  const onRun = (agent: string) => { live.push({ agent, ...stored() }); };
  const spec = (id: string) => ({ id, description: id, prompt: id, capabilities: {} });
  const claude = new Fake('claude', o.claude, onRun), codex = new Fake('codex', o.codex, onRun);
  const deps: WorkflowDeps = {
    agents: { planner: { spec: spec('planner'), executor: claude }, implementer: { spec: spec('implementer'), executor: claude }, challenger: { spec: spec('challenger'), executor: codex, label: 'codex' },
      ...Object.fromEntries((o.judges ?? []).map(id => [id, { spec: spec(id), executor: codex, label: 'codex' }])) },
    ...(o.judges ? { workflow: { challengers: o.judges, reviewers: o.judges } } : {}),
    gate: () => ({ ok: true, failures: [], resolved: [], warnings: [], acceptedRisks: [] }),
    artifacts: { put: (_n, t) => { const h = createHash('sha256').update(t).digest('hex'); blobs.set(h, t); return h; }, get: (h) => blobs.get(h)! },
    save: (s) => { saved = JSON.parse(JSON.stringify(s)) as RunState; },
    event: (e) => { appendEvent(store, RUN, e); },
    verify: async () => {
      const passed = verify.shift(); if (passed === undefined) throw new Error('unexpected verify');
      return { passed, exitCode: passed ? 0 : 1, conclusive: true, treeChanged: false, log: passed ? 'all green' : 'FAIL: expected 2 got 3' };
    },
    workspace: { snapshot: async (roots) => ({ roots: roots ?? [], deps: {}, ignored: {} }) },
    git: {
      candidateTree: async () => { if (trees.length) tree = trees.shift()!; return tree; },
      diff: async () => o.diff ?? 'diff --git a/src/x.ts b/src/x.ts\n+export const sum = 1;', changes: async () => [{ status: 'M', path: 'src/x.ts' }], gitlinks: async () => [],
      commit: async () => 'c'.repeat(40), redTree: async (t) => `r${t.slice(1)}`, judgeDiff: async () => 'diff --git a/src/x.ts b/src/x.ts\n+export const sum = 1;', changedTexts: async () => [],
    },
    project: 'demo', run: { cwd: '/w', env: { PATH: '/bin' }, timeoutMs: 1000, maxOutputBytes: 1000 },
    now: () => new Date(Date.parse(START) + (++ticks) * 10_000),
  };
  return {
    start: () => advance({ ...newRun(RUN, 'add a sum function'), branch: `taskquoin/${RUN}` }, deps),
    approve: (s: RunState, node: 'approve-plan' | 'approve-commit') => advance(approve(s, node, 'owner', new Date(START), pendingApproval(s)!.binding), deps),
    resume: (s: RunState) => advance(resume(s), deps),
    stored, live,
  };
}
const view = ({ state, events }: Stored) => projectRun(state, events);
const step = (v: { steps: StepView[] }, id: string) => v.steps.find(x => x.id === id)!;
const pending = (...ids: string[]) => ids.map(id => ({ id, state: 'pending', attempts: [], artifacts: [] }));

test('(a) waiting at plan approval: planning and critique done with their times, the plan gate pending, the rest pending', async () => {
  const run = drive({ claude: [says(PLAN, 7_000, 'claude-fake-1')], codex: [says(CRITIQUE, 9_000)], verify: [] });
  const s = await run.start();
  assert.equal(s.status, 'waiting-approval');
  assert.deepEqual(view(run.stored()), {
    runId: RUN, status: 'waiting-approval', current: 'approve-plan', attempts: 0, branch: `taskquoin/${RUN}`, startedAt: START,
    steps: [
      // recall from the run id's time to its history entry (10 s), then the planner's own measured time (7 s)
      { id: 'planning', state: 'done', startedAt: START, endedAt: at(2), durationMs: 17_000, agent: 'planner', runtime: 'claude', model: 'claude-fake-1', attempts: [], artifacts: ['plan'], outcome: 'planned',
        runs: [{ agent: 'planner', runtime: 'claude', model: 'claude-fake-1', durationMs: 7_000 }] },
      { id: 'critique', state: 'done', startedAt: at(2), endedAt: at(3), durationMs: 9_000, agent: 'challenger', runtime: 'codex', attempts: [], artifacts: ['challenge-challenger', 'challenge'], outcome: 'challenged:APPROVE',
        runs: [{ agent: 'challenger', runtime: 'codex', durationMs: 9_000 }] },
      { id: 'plan-approval', state: 'waiting', startedAt: at(3), attempts: [], artifacts: [], outcome: 'waiting-approval' },
      ...pending('implementation', 'verify', 'red-proof', 'review', 'commit-approval', 'commit'),
    ],
    pending: { gate: 'plan', binding: s.artifacts.plan }, reason: 'plan approval required',
  });
});

/** The happy path, both gates approved. */
async function completed() {
  const run = drive({ claude: [says(PLAN, 7_000, 'claude-fake-1'), says('implemented sum', 60_000, 'claude-fake-1')], codex: [says(CRITIQUE, 9_000), says(APPROVE, 20_000)], verify: [true, false] });
  let s = await run.start();
  s = await run.approve(s, 'approve-plan');
  s = await run.approve(s, 'approve-commit');
  assert.equal(s.status, 'completed');
  return run.stored();
}

test('(b) completed: every step done, ending at its last history entry and starting at the one before; commit set', async () => {
  const stored = await completed();
  const v = view(stored);
  assert.equal(v.status, 'completed'); assert.equal(v.current, 'done'); assert.equal(v.commit, 'c'.repeat(40));
  assert.equal(v.pending, undefined); assert.equal(v.reason, undefined);
  assert.deepEqual(v.steps.map(x => [x.id, x.state, x.startedAt, x.endedAt]), [
    ['planning', 'done', START, at(2)], ['critique', 'done', at(2), at(3)], ['plan-approval', 'done', at(3), at(5)],
    ['implementation', 'done', at(5), at(6)], ['verify', 'done', at(6), at(7)], ['red-proof', 'done', at(7), at(8)],
    ['review', 'done', at(8), at(9)], ['commit-approval', 'done', at(9), at(11)], ['commit', 'done', at(11), at(13)],
  ]);
  // agents' own times where an agent worked (planner, challenger, implementer, reviewer); the history elsewhere —
  // including the human's wait at both gates
  assert.deepEqual(v.steps.map(x => x.durationMs), [17_000, 9_000, 20_000, 60_000, 10_000, 10_000, 20_000, 20_000, 20_000]);
  assert.deepEqual(v.steps.map(x => [x.agent, x.runtime, x.model]), [
    ['planner', 'claude', 'claude-fake-1'], ['challenger', 'codex', undefined], [undefined, undefined, undefined],
    ['implementer', 'claude', 'claude-fake-1'], [undefined, undefined, undefined], [undefined, undefined, undefined],
    ['challenger', 'codex', undefined], [undefined, undefined, undefined], [undefined, undefined, undefined],
  ]);
  assert.deepEqual(step(v, 'implementation').attempts, [{ n: 1, outcome: 'implemented:1', endedAt: at(6), artifact: 'implement-1', startedAt: at(5), durationMs: 60_000 }]);
  assert.deepEqual(step(v, 'verify').attempts, [{ n: 1, outcome: 'tests-green', endedAt: at(7), artifact: 'verify-1', startedAt: at(6), durationMs: 10_000 }]);
  assert.deepEqual(step(v, 'red-proof').attempts, [{ n: 1, outcome: 'red-proven', endedAt: at(8), artifact: 'red-1', startedAt: at(7), durationMs: 10_000 }]);
  assert.deepEqual(step(v, 'review').attempts, [{ n: 1, outcome: 'review:APPROVE', endedAt: at(9), artifact: 'review-1', startedAt: at(8), durationMs: 20_000 }]);
  for (const id of ['planning', 'critique', 'plan-approval', 'commit-approval', 'commit']) assert.deepEqual(step(v, id).attempts, [], id);
  assert.deepEqual(v.steps.map(x => x.artifacts), [['plan'], ['challenge-challenger', 'challenge'], [], ['workspace-baseline', 'implement-1'], ['verify-1'], ['red-1'], ['diff-1', 'review-1-challenger', 'review-1'], [], []]);
});

test('(c) verify failed once then passed: two attempts under Verify and Implementation; live, the rework is running', async () => {
  const run = drive({ claude: [says(PLAN, 7_000), says('impl 1', 60_000, 'claude-fake-1'), says('impl 2', 50_000, 'claude-fake-2')], codex: [says(CRITIQUE, 9_000), says(APPROVE, 20_000)], verify: [false, true, false] });
  const s = await run.approve(await run.start(), 'approve-plan');
  assert.equal(s.current, 'approve-commit');
  const v = view(run.stored());
  assert.deepEqual(step(v, 'verify'), {
    id: 'verify', state: 'done', startedAt: at(6), endedAt: at(9), durationMs: 20_000,
    attempts: [{ n: 1, outcome: 'tests-red:rework', endedAt: at(7), artifact: 'verify-1', startedAt: at(6), durationMs: 10_000 }, { n: 2, outcome: 'tests-green', endedAt: at(9), artifact: 'verify-2', startedAt: at(8), durationMs: 10_000 }],
    artifacts: ['verify-1', 'verify-2'], outcome: 'tests-green',
  });
  assert.deepEqual(step(v, 'implementation'), {
    id: 'implementation', state: 'done', startedAt: at(5), endedAt: at(8), durationMs: 110_000, agent: 'implementer', runtime: 'claude', model: 'claude-fake-2',
    attempts: [{ n: 1, outcome: 'implemented:1', endedAt: at(6), artifact: 'implement-1', startedAt: at(5), durationMs: 60_000 }, { n: 2, outcome: 'implemented:2', endedAt: at(8), artifact: 'implement-2', startedAt: at(7), durationMs: 50_000 }],
    artifacts: ['workspace-baseline', 'implement-1', 'implement-2'], outcome: 'implemented:2', runs: [{ agent: 'implementer', runtime: 'claude', model: 'claude-fake-2', durationMs: 50_000 }],
  });
  assert.equal(step(v, 'commit-approval').state, 'waiting');
  assert.deepEqual(v.pending, { gate: 'commit', binding: T1 });

  // What a reader sees while the implementer reworks: the step runs again since Verify sent it back; Verify is pending
  // again, its failed pass kept; the stored attempt counter is still 1 (saved after the agent answers).
  const lv = view(run.live.filter(l => l.agent === 'implementer')[1]);
  assert.equal(lv.status, 'running'); assert.equal(lv.current, 'implement'); assert.equal(lv.attempts, 1);
  assert.deepEqual(step(lv, 'implementation'), {
    id: 'implementation', state: 'running', startedAt: at(7), agent: 'implementer', runtime: 'claude',
    attempts: [{ n: 1, outcome: 'implemented:1', endedAt: at(6), artifact: 'implement-1', startedAt: at(5), durationMs: 60_000 }, { n: 2, outcome: 'running', startedAt: at(7) }],
    artifacts: ['workspace-baseline', 'implement-1'], runs: [{ agent: 'implementer', runtime: 'claude' }],
  }, 'no model until the running agent reports one — never the previous attempt\'s');
  assert.deepEqual(step(lv, 'verify'), { id: 'verify', state: 'pending', attempts: [{ n: 1, outcome: 'tests-red:rework', endedAt: at(7), artifact: 'verify-1', startedAt: at(6), durationMs: 10_000 }], artifacts: ['verify-1'] });
  assert.deepEqual(lv.steps.map(x => x.state), ['done', 'done', 'done', 'running', 'pending', 'pending', 'pending', 'pending', 'pending']);
});

test('(d) needs-human after 3 verify failures: Implementation done, Verify failed with 3 attempts, reason set', async () => {
  const run = drive({ claude: [says(PLAN, 7_000), says('i1', 1_000), says('i2', 1_000), says('i3', 1_000)], codex: [says(CRITIQUE, 9_000)], verify: [false, false, false] });
  const s = await run.approve(await run.start(), 'approve-plan');
  assert.equal(s.status, 'needs-human');
  const v = view(run.stored());
  assert.equal(v.status, 'needs-human'); assert.equal(v.current, 'verify'); assert.equal(v.attempts, 3);
  assert.equal(v.reason, 'tests still failing after 3 attempts');
  assert.equal(step(v, 'implementation').state, 'done');
  assert.deepEqual(step(v, 'implementation').attempts.map(a => [a.n, a.outcome]), [[1, 'implemented:1'], [2, 'implemented:2'], [3, 'implemented:3']]);
  assert.deepEqual(step(v, 'verify'), {
    id: 'verify', state: 'failed', startedAt: at(6), endedAt: at(11), durationMs: 30_000,
    attempts: [
      { n: 1, outcome: 'tests-red:rework', endedAt: at(7), artifact: 'verify-1', startedAt: at(6), durationMs: 10_000 },
      { n: 2, outcome: 'tests-red:rework', endedAt: at(9), artifact: 'verify-2', startedAt: at(8), durationMs: 10_000 },
      { n: 3, outcome: 'needs-human', endedAt: at(11), artifact: 'verify-3', startedAt: at(10), durationMs: 10_000 },
    ],
    artifacts: ['verify-1', 'verify-2', 'verify-3'], outcome: 'needs-human',
  });
  assert.deepEqual(v.steps.slice(5), pending('red-proof', 'review', 'commit-approval', 'commit'));
});

test('(e) interrupted at implement: the step failed, the run interrupted; the agent that was cut off is named', async () => {
  const run = drive({ claude: [says(PLAN, 7_000), new Error('network down')], codex: [says(CRITIQUE, 9_000)], verify: [] });
  const s = await run.approve(await run.start(), 'approve-plan');
  assert.equal(s.status, 'interrupted');
  const v = view(run.stored());
  assert.equal(v.status, 'interrupted'); assert.equal(v.current, 'implement'); assert.equal(v.reason, 'implement: network down');
  assert.deepEqual(step(v, 'implementation'), {
    // the agent never finished: no agent time, the history's (the run entered the step at 5, stopped at 6)
    id: 'implementation', state: 'failed', startedAt: at(5), endedAt: at(6), durationMs: 10_000, agent: 'implementer', runtime: 'claude',
    attempts: [{ n: 1, outcome: 'interrupted', endedAt: at(6), startedAt: at(5), durationMs: 10_000 }], artifacts: ['workspace-baseline'], outcome: 'interrupted',
    runs: [{ agent: 'implementer', runtime: 'claude' }],
  });
  assert.deepEqual(v.steps.slice(4), pending('verify', 'red-proof', 'review', 'commit-approval', 'commit'));
});

test('(e) then resumed: the interrupted pass stays an attempt; the resumed one has no known start without events', async () => {
  const run = drive({ claude: [says(PLAN, 7_000), new Error('network down'), says('impl', 50_000)], codex: [says(CRITIQUE, 9_000), says(APPROVE, 20_000)], verify: [true, false] });
  const s = await run.resume(await run.approve(await run.start(), 'approve-plan'));
  assert.equal(s.current, 'approve-commit');

  const lv = view(run.live.filter(l => l.agent === 'implementer')[1]);
  assert.equal(lv.status, 'running');
  assert.deepEqual(step(lv, 'implementation'), {
    id: 'implementation', state: 'running', startedAt: at(5), agent: 'implementer', runtime: 'claude',
    attempts: [{ n: 1, outcome: 'interrupted', endedAt: at(6), startedAt: at(5), durationMs: 10_000 }, { n: 2, outcome: 'running' }], artifacts: ['workspace-baseline'],
    runs: [{ agent: 'implementer', runtime: 'claude' }, { agent: 'implementer', runtime: 'claude' }], // the cut-off run, then the resumed one at work
  });

  const stored = run.stored();
  const v = view(stored);
  assert.deepEqual(step(v, 'implementation'), {
    // 10 s until the interruption (history) + the resumed agent's own 50 s; when the resume happened is not recorded
    id: 'implementation', state: 'done', startedAt: at(5), endedAt: at(7), durationMs: 60_000, agent: 'implementer', runtime: 'claude',
    attempts: [{ n: 1, outcome: 'interrupted', endedAt: at(6), startedAt: at(5), durationMs: 10_000 }, { n: 2, outcome: 'implemented:2', endedAt: at(7), artifact: 'implement-2', durationMs: 50_000 }],
    artifacts: ['workspace-baseline', 'implement-2'], outcome: 'implemented:2',
    runs: [{ agent: 'implementer', runtime: 'claude' }, { agent: 'implementer', runtime: 'claude', durationMs: 50_000 }],
  });
  assert.equal(step(projectRun(stored.state, []), 'implementation').durationMs, undefined, 'never the idle time between interruption and resume');
});

test('(f) no events (old run): no agent, runtime or model; the same times, durations from the history only', async () => {
  const stored = await completed();
  const withEvents = view(stored), old = projectRun(stored.state, []);
  for (const x of old.steps) for (const k of ['agent', 'runtime', 'model']) assert.ok(!(k in x), `${x.id} has no ${k}`);
  assert.deepEqual(old.steps.map(x => [x.startedAt, x.endedAt]), withEvents.steps.map(x => [x.startedAt, x.endedAt]));
  assert.deepEqual(old.steps.map(x => x.durationMs), [20_000, 10_000, 20_000, 10_000, 10_000, 10_000, 10_000, 20_000, 20_000]);
  const noTime = (x: StepView) => x.attempts.map(({ durationMs: _, ...a }) => a);
  assert.deepEqual(old.steps.map(noTime), withEvents.steps.map(noTime));
  assert.deepEqual(old.steps.flatMap(x => x.attempts.map(a => a.durationMs)), [10_000, 10_000, 10_000, 10_000], 'the history\'s, never an agent\'s');
  assert.equal(old.startedAt, START);
});

test('tree changed after commit approval: Verify, RED proof and Review gain a pass; an overwritten artifact stays with the last one', async () => {
  const run = drive({ claude: [says(PLAN, 7_000), says('impl', 60_000)], codex: [says(CRITIQUE, 9_000), says(APPROVE, 20_000), says(APPROVE, 20_000)], verify: [true, false, true, false], trees: [T1, T2, T2] });
  const s = await run.approve(await run.approve(await run.start(), 'approve-plan'), 'approve-commit');
  assert.equal(s.current, 'approve-commit'); assert.equal(s.status, 'waiting-approval');
  const v = view(run.stored());
  // verify-1, red-1, review-1 now hold the second pass (same attempt number): the first pass has none
  assert.deepEqual(step(v, 'verify').attempts, [{ n: 1, outcome: 'tests-green', endedAt: at(7), startedAt: at(6), durationMs: 10_000 }, { n: 2, outcome: 'tests-green', endedAt: at(13), artifact: 'verify-1', startedAt: at(12), durationMs: 10_000 }]);
  assert.deepEqual(step(v, 'red-proof').attempts, [{ n: 1, outcome: 'red-proven', endedAt: at(8), startedAt: at(7), durationMs: 10_000 }, { n: 2, outcome: 'red-proven', endedAt: at(14), artifact: 'red-1', startedAt: at(13), durationMs: 10_000 }]);
  assert.deepEqual(step(v, 'review').attempts, [{ n: 1, outcome: 'review:APPROVE', endedAt: at(9), startedAt: at(8), durationMs: 20_000 }, { n: 2, outcome: 'review:APPROVE', endedAt: at(15), artifact: 'review-1', startedAt: at(14), durationMs: 20_000 }]);
  assert.equal(step(v, 'verify').durationMs, 20_000);
  assert.deepEqual(step(v, 'commit-approval'), { id: 'commit-approval', state: 'waiting', startedAt: at(15), attempts: [], artifacts: [], outcome: 'waiting-approval' }, 'waiting since the new review, not since the first visit');
  assert.deepEqual(step(v, 'commit'), { id: 'commit', state: 'pending', attempts: [], artifacts: [] });
  assert.deepEqual(v.pending, { gate: 'commit', binding: T2 });
  assert.match(v.reason ?? '', /working tree changed after approval/);
});

test('a review stopped before the judges (diff too large) names the diff it could not send as its artifact', async () => {
  const run = drive({ claude: [says(PLAN, 7_000), says('impl', 60_000)], codex: [says(CRITIQUE, 9_000)], verify: [true, false], diff: 'x'.repeat(MAX_REVIEW_DIFF + 1) });
  const s = await run.approve(await run.start(), 'approve-plan');
  assert.equal(s.status, 'needs-human');
  const v = view(run.stored());
  assert.deepEqual(step(v, 'review'), { id: 'review', state: 'failed', startedAt: at(8), endedAt: at(9), durationMs: 10_000, attempts: [{ n: 1, outcome: 'needs-human', endedAt: at(9), artifact: 'diff-1', startedAt: at(8), durationMs: 10_000 }], artifacts: ['diff-1'], outcome: 'needs-human' });
  assert.match(v.reason ?? '', /diff too large/);
});

test('a log cut at its head (readEvents keeps the tail): later steps keep their agents, earlier ones fall back to history', async () => {
  const run = drive({ claude: [says(PLAN, 7_000), says('impl 1', 60_000, 'claude-fake-1'), says('impl 2', 50_000, 'claude-fake-2')], codex: [says(CRITIQUE, 9_000), says(APPROVE, 20_000)], verify: [false, true, false] });
  await run.approve(await run.start(), 'approve-plan');
  const { state, events } = run.stored();
  const v = projectRun(state, events.slice(events.findLastIndex(e => e.type === 'agent.started' && e.agent === 'implementer')));
  assert.equal(step(v, 'planning').agent, undefined); assert.equal(step(v, 'planning').durationMs, 20_000);
  assert.equal(step(v, 'critique').agent, undefined);
  const impl = step(v, 'implementation');
  assert.deepEqual([impl.agent, impl.model, impl.durationMs], ['implementer', 'claude-fake-2', 10_000 + 50_000], 'attempt 1 from history, attempt 2 measured');
  assert.equal(step(v, 'review').agent, 'challenger');

  // The kept events belong to the LAST passes: the resumed implementer's time is not lent to the interrupted pass
  // (which would leave the resumed one with no known start, hence no duration).
  const resumed = drive({ claude: [says(PLAN, 7_000), new Error('network down'), says('impl', 50_000)], codex: [says(CRITIQUE, 9_000), says(APPROVE, 20_000)], verify: [true, false] });
  await resumed.resume(await resumed.approve(await resumed.start(), 'approve-plan'));
  const r = resumed.stored();
  const cut = projectRun(r.state, r.events.slice(r.events.findLastIndex(e => e.type === 'agent.started' && e.agent === 'implementer')));
  assert.equal(step(cut, 'implementation').durationMs, 10_000 + 50_000);
});

test('a log slightly ahead of state.json (an event is appended just before each save) never lends the next node\'s agent', async () => {
  const run = drive({ claude: [says(PLAN, 7_000)], codex: [says(CRITIQUE, 9_000)], verify: [] });
  await run.start();
  const [planner, challenger] = run.live;
  assert.deepEqual([planner.agent, challenger.agent], ['planner', 'challenger']);
  assert.deepEqual(step(view(planner), 'planning'), { id: 'planning', state: 'running', startedAt: START, agent: 'planner', runtime: 'claude', attempts: [], artifacts: [], runs: [{ agent: 'planner', runtime: 'claude' }] });
  // state.json still says "plan running"; the log already shows plan → challenge and the challenger starting
  const ahead = projectRun(planner.state, challenger.events);
  assert.equal(step(ahead, 'planning').state, 'running');
  assert.notEqual(step(ahead, 'planning').agent, 'challenger');
  assert.equal(step(ahead, 'critique').state, 'pending');
});

test('foreign and malformed events are ignored; the projection is pure (no clock, inputs untouched)', async (t) => {
  const { state, events } = await completed();
  const junk: Record<string, unknown>[] = [
    { type: 7 }, { type: 'node.transition' }, { type: 'agent.started', agent: 42 },
    { type: 'agent.finished', runId: 'run-20261122T101500-other1', agent: 'intruder', runtime: 'x', durationMs: 1, model: 'm' },
    { type: 'run.failed', runId: 'run-20261122T101500-other1', node: 'plan' }, { type: 'run.completed', node: 'done' },
  ];
  const mid = Math.floor(events.length / 2);
  const noisy = [...junk, ...events.slice(0, mid), ...junk, ...events.slice(mid), ...junk];
  const freeze = <T>(x: T): T => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
  t.mock.method(Date, 'now', () => { throw new Error('projectRun read the clock'); });
  const clean = projectRun(state, events);
  assert.deepEqual(projectRun(freeze(structuredClone(state)), freeze(noisy)), clean);
  assert.deepEqual(projectRun(state, events), clean, 'same inputs, same view');
});

test('reason is returned as stored (raw: shownRun in the CLI neutralises it); a run id without a time gives no start', async () => {
  const { state } = await completed();
  const esc = String.fromCharCode(27);
  assert.equal(projectRun({ ...state, status: 'failed', reason: `agent ended${esc}[2J` }, []).reason, `agent ended${esc}[2J`);
  const custom = projectRun({ ...state, runId: 'run-1' }, []);
  assert.equal(custom.startedAt, '');
  const planning = step(custom, 'planning');
  assert.equal(planning.startedAt, undefined); assert.equal(planning.durationMs, undefined, 'recall has no known start');
  assert.equal(planning.endedAt, at(2));
  assert.equal(step(custom, 'critique').durationMs, 10_000);
});

test('a stored status the projection does not know leaves the current step unknown, never an invented failure', async () => {
  const { state } = await completed();
  const v = projectRun({ ...state, status: 'paused-by-a-newer-version' as RunState['status'], current: 'review' }, []);
  assert.equal(v.status, 'paused-by-a-newer-version');
  assert.equal(step(v, 'review').state, 'unknown');
  assert.deepEqual(v.steps.map(x => x.state), ['done', 'done', 'done', 'done', 'done', 'done', 'unknown', 'pending', 'pending']);
});

test('every step that ended says how: the critique verdict, who approved each gate, a loop\'s last pass; none in progress or pending again', async () => {
  const v = view(await completed());
  assert.deepEqual(v.steps.map(x => [x.id, x.outcome]), [
    ['planning', 'planned'], ['critique', 'challenged:APPROVE'], ['plan-approval', 'approved-by:owner'], ['implementation', 'implemented:1'],
    ['verify', 'tests-green'], ['red-proof', 'red-proven'], ['review', 'review:APPROVE'], ['commit-approval', 'approved-by:owner'], ['commit', 'recorded'],
  ]);
  const waiting = drive({ claude: [says(PLAN, 7_000)], codex: [says(CRITIQUE, 9_000)], verify: [] });
  await waiting.start();
  assert.equal(step(view(waiting.stored()), 'plan-approval').outcome, 'waiting-approval', 'the gate says it waits');

  // After the tree changed past the commit approval: while the review runs again, the earlier approval and the commit
  // node's entry belong to a pass the run went back before — the pending steps say nothing.
  const run = drive({ claude: [says(PLAN, 7_000), says('impl', 60_000)], codex: [says(CRITIQUE, 9_000), says(APPROVE, 20_000), says(APPROVE, 20_000)], verify: [true, false, true, false], trees: [T1, T2, T2] });
  await run.approve(await run.approve(await run.start(), 'approve-plan'), 'approve-commit');
  const again = view(run.live.filter(l => l.agent === 'challenger')[2]);
  assert.equal(step(again, 'review').state, 'running'); assert.equal(step(again, 'review').outcome, undefined, 'a pass in progress has no outcome yet');
  for (const id of ['commit-approval', 'commit']) assert.deepEqual([step(again, id).state, step(again, id).outcome], ['pending', undefined], id);
  assert.equal(step(again, 'verify').outcome, 'tests-green', 'the re-verified pass');
});

test('an attempt has its own start and duration by the step\'s rules; a resumed pass has no known start, one in progress no duration', async () => {
  const run = drive({ claude: [says(PLAN, 7_000), says('impl 1', 60_000), says('impl 2', 50_000)], codex: [says(CRITIQUE, 9_000), says(APPROVE, 20_000)], verify: [false, true, false] });
  await run.approve(await run.start(), 'approve-plan');
  const v = view(run.stored());
  const times = (x: StepView) => x.attempts.map(a => [a.n, a.startedAt, a.durationMs]);
  assert.deepEqual(times(step(v, 'implementation')), [[1, at(5), 60_000], [2, at(7), 50_000]], 'the agent\'s own time');
  assert.deepEqual(times(step(v, 'verify')), [[1, at(6), 10_000], [2, at(8), 10_000]], 'the history\'s');
  assert.deepEqual(times(step(view(run.live.filter(l => l.agent === 'implementer')[1]), 'implementation')), [[1, at(5), 60_000], [2, at(7), undefined]], 'in progress since the rework began');

  const resumed = drive({ claude: [says(PLAN, 7_000), new Error('network down'), says('impl', 50_000)], codex: [says(CRITIQUE, 9_000), says(APPROVE, 20_000)], verify: [true, false] });
  await resumed.resume(await resumed.approve(await resumed.start(), 'approve-plan'));
  assert.deepEqual(times(step(view(resumed.live.filter(l => l.agent === 'implementer')[1]), 'implementation')), [[1, at(5), 10_000], [2, undefined, undefined]], 'a resume writes nothing: no start');
  const r = resumed.stored();
  assert.deepEqual(times(step(view(r), 'implementation')), [[1, at(5), 10_000], [2, undefined, 50_000]]);
  assert.deepEqual(times(step(projectRun(r.state, []), 'implementation')), [[1, at(5), 10_000], [2, undefined, undefined]], 'never the idle time before the resume');
});

test('every judge of a step is kept in its runs — two critics, two reviewers — and agent stays the latest; live, the one at work has no time', async () => {
  const run = drive({ judges: ['challenger', 'security'], claude: [says(PLAN, 7_000), says('impl', 60_000, 'claude-fake-1')],
    codex: [says(CRITIQUE, 9_000, 'gpt-a'), says(CRITIQUE, 4_000, 'gpt-b'), says(APPROVE, 20_000), says(APPROVE, 5_000)], verify: [true, false] });
  await run.approve(await run.start(), 'approve-plan');
  const v = view(run.stored());
  const critique = step(v, 'critique');
  assert.deepEqual(critique.runs, [{ agent: 'challenger', runtime: 'codex', model: 'gpt-a', durationMs: 9_000 }, { agent: 'security', runtime: 'codex', model: 'gpt-b', durationMs: 4_000 }]);
  assert.deepEqual([critique.agent, critique.model, critique.durationMs, critique.outcome], ['security', 'gpt-b', 13_000, 'challenged:challenger=APPROVE,security=APPROVE']);
  assert.deepEqual(step(v, 'review').runs, [{ agent: 'challenger', runtime: 'codex', durationMs: 20_000 }, { agent: 'security', runtime: 'codex', durationMs: 5_000 }]);
  assert.deepEqual(step(v, 'implementation').runs, [{ agent: 'implementer', runtime: 'claude', model: 'claude-fake-1', durationMs: 60_000 }]);
  for (const id of ['plan-approval', 'verify', 'red-proof', 'commit-approval', 'commit']) assert.equal(step(v, id).runs, undefined, id);
  const lv = view(run.live.filter(l => l.agent === 'security')[1]);
  assert.deepEqual(step(lv, 'review').runs, [{ agent: 'challenger', runtime: 'codex', durationMs: 20_000 }, { agent: 'security', runtime: 'codex' }]);
});

test('runs: the last pass of a step only (the implementer of the rework, not the first one); a resumed pass keeps the judges asked before the interruption', async () => {
  const rework = drive({ claude: [says(PLAN, 7_000), says('impl 1', 60_000, 'm1'), says('impl 2', 50_000, 'm2')], codex: [says(CRITIQUE, 9_000), says(APPROVE, 20_000)], verify: [false, true, false] });
  await rework.approve(await rework.start(), 'approve-plan');
  assert.deepEqual(step(view(rework.stored()), 'implementation').runs, [{ agent: 'implementer', runtime: 'claude', model: 'm2', durationMs: 50_000 }]);

  const run = drive({ judges: ['challenger', 'security'], claude: [says(PLAN, 7_000)], codex: [says(CRITIQUE, 9_000), new Error('network down'), says(CRITIQUE, 4_000)], verify: [] });
  const s = await run.start();
  assert.equal(s.status, 'interrupted');
  await run.resume(s);
  assert.deepEqual(step(view(run.stored()), 'critique').runs, [
    { agent: 'challenger', runtime: 'codex', durationMs: 9_000 }, { agent: 'security', runtime: 'codex' }, { agent: 'security', runtime: 'codex', durationMs: 4_000 },
  ], 'the challenger answered before the interruption and is not asked again; the cut-off run has no time');
});
