/**
 * Workflow `feature-governed` (architecture §7, ADR-0004/0009/0011/0013). A small, fixed graph driven by a persisted
 * state machine. The unit of governance is an immutable git TREE id (Codex R4 N2/N3):
 *
 *   recall → plan → challenge → [approve-plan] → implement → verify(tree) → review(tree) ─┬─ APPROVE → [approve-commit: tree]
 *                                                  ▲                                     │        → commit(tree) → record → done
 *                                                  └──── rework (≤ 2) ◄──────────────────┘ tests red / tree changed / CHANGES_REQUESTED
 *   commit: if the working tree no longer equals the approved tree ⇒ approval invalidated ⇒ verify + review again.
 *
 * Rules: gate before every agent; approvals name the gate and the expected hash (no replay across gates — N4); "done" is
 * decided by Verify on the host (sandboxed), never by a model; agents never commit; landing gate on every changed path,
 * case-insensitive; submodules refused; adapter exceptions ⇒ `interrupted` (resumable — N7); every save bumps a revision.
 */
import { PROTECTED_WRITE_GLOBS, TEST_PATH_GLOBS, matchGlob } from '@taskquoin/rules';
import type { GateResult } from '../use-cases/prepare-run.ts';
import type { AgentSpec, RunResult, RuntimeExecutor } from '../ports/runtime-executor.ts';
import type { MemoryPort, MemoryRecall } from '../ports/memory.ts';
import { challengeTask, implementTask, MAX_REVIEW_DIFF, memoryContextBlock, parseVerdict, planTask, reviewTask, strictVerdict } from './prompts.ts';

export type NodeId = 'recall' | 'plan' | 'challenge' | 'approve-plan' | 'implement' | 'verify' | 'red-check' | 'review' | 'approve-commit' | 'commit' | 'record' | 'done';
export type WorkflowStatus = 'running' | 'waiting-approval' | 'completed' | 'failed' | 'needs-human' | 'interrupted';
export type ApprovalNode = 'approve-plan' | 'approve-commit';
export interface Approval { approvedBy: string; at: string; binding: string }

export interface RunState {
  runId: string; workflow: 'feature-governed'; request: string;
  /** English name of the language the agents write their prose in (e.g. `French`); absent for English. Saved so a resume keeps it. */
  proseLanguage?: string;
  status: WorkflowStatus; current: NodeId;
  /** Incremented on every save; the CLI uses it for compare-and-swap. */
  revision: number;
  attempts: number;
  artifacts: Record<string, string>;
  approvals: Partial<Record<ApprovalNode, Approval>>;
  /** Tree verified in the current attempt, and tree reviewed (and therefore approvable). */
  verifiedTree?: string; reviewedTree?: string;
  /** Set when the tree changed after a commit approval and was re-verified/re-reviewed. */
  reverified?: boolean;
  /** Reworks the reviewers asked for (capped at MAX_REVIEW_REWORKS whatever the implementer — project B). */
  reviewReworks?: number;
  lastVerify?: { passed: boolean; exitCode: number | null; treeChanged?: boolean };
  lastVerdict?: 'APPROVE' | 'CHANGES_REQUESTED';
  /** Outcome of Taskquoin's RED proof for the verified tree (stated in the commit message). */
  redProof?: 'proven' | 'not-applicable';
  /** ADR-0014: dependency directories inherited read-only by Verify, fixed at the first implementation. */
  inheritedRoots?: string[];
  /**
   * Multi-LLM A: judges' answers already obtained for the current challenge (key = plan hash) or review (key =
   * tree:attempt), saved one by one so a resumed run never calls — or pays — a judge twice.
   */
  judged?: { node: 'challenge' | 'review'; key: string; byAgent: Record<string, string> };
  commit?: string;
  /** Orchestrator bookkeeping. */
  branch?: string; base?: string; configDigest?: string;
  reason?: string;
  history: { node: NodeId; outcome: string; at: string }[];
}

export interface VerifyResult { passed: boolean; exitCode: number | null; conclusive: boolean; treeChanged: boolean; log: string;
  /** Verify will not run this tree at all (e.g. symlinks leaving the repository): a human decision, never a rework. */
  refusal?: string }
/** `roots` = inherited dependency directories (repository-relative); `deps` = their digests; `ignored` = path → fingerprint. */
export interface WorkspaceSnapshot { roots: string[]; deps: Record<string, string>; ignored: Record<string, string>;
  /** The inherited paths cannot be frozen (e.g. one goes through a symlink): stop before any agent writes. */
  refusal?: string }

/** What changed between two fingerprint maps (paths only). */
function changedPaths(a: Record<string, string>, b: Record<string, string>): { added: string[]; changed: string[]; removed: string[] } {
  const added = Object.keys(b).filter(k => !(k in a)).sort(), removed = Object.keys(a).filter(k => !(k in b)).sort();
  const changed = Object.keys(b).filter(k => k in a && a[k] !== b[k]).sort();
  return { added, changed, removed };
}
const MAX_LISTED = 200;

export const MAX_ATTEMPTS = 3; // first implementation + 2 reworks
/** An implementer without commands (OpenCode, project B) cannot see its own tests fail: 2 more reworks, only when
 *  Taskquoin's tests (Verify, RED proof) fail; reviewer refusals keep the usual 2 reworks (no extra paid judge calls). */
export const MAX_ATTEMPTS_NO_COMMANDS = 5;
export const MAX_REVIEW_REWORKS = 2;
/** Changed files given to a text-only judge without a provider `maxInputChars`. */
const DEFAULT_FILES_BUDGET = 200_000;
/** Room kept for the <changed-files> frame and per-file headers. */
const FILES_FRAME_MARGIN = 2_000;

export interface WorkflowDeps {
  /** By agent id. `label` names where the work goes (e.g. `codex`, `api: api.deepseek.com/deepseek-chat`); `textOnly` = an api judge. */
  agents: Record<string, { spec: AgentSpec; executor: RuntimeExecutor; label?: string; textOnly?: boolean; noCommands?: boolean }>;
  /** Judges (multi-LLM A). Default: the `challenger` agent challenges the plan and reviews the diff. */
  workflow?: { challengers: string[]; reviewers: string[] };
  /** A judge's input limit in characters (provider `maxInputChars`), if any. */
  judgeBudgetChars?(agentId: string): number | undefined;
  gate(agentId: string): GateResult;
  artifacts: { put(name: string, text: string): string; get(sha: string): string };
  save(state: RunState): void;
  event(e: { type: string } & Record<string, unknown>): void;
  /**
   * Project checks on `tree`, in a clean room (ADR-0014): the tree materialized outside the workspace and mounted at
   * the repository path, `inherited` dependency directories read-only, sandboxed (no network, .git read-only, HOME
   * hidden). The working directory is never touched. `conclusive` = the test command really ran inside the sandbox and
   * exited by itself; `treeChanged` = the tests modified tracked files of the room.
   */
  verify(tree: string, inherited: string[]): Promise<VerifyResult>;
  /** ADR-0014: dependency directories (frozen, fingerprinted) and every other ignored file of the working directory. */
  workspace: { snapshot(roots?: string[]): Promise<WorkspaceSnapshot> };
  /** Tree-based git (base commit bound by the composition root). */
  git: {
    candidateTree(): Promise<string>;
    diff(tree: string): Promise<string>;
    changes(tree: string): Promise<{ status: string; path: string }[]>;
    gitlinks(tree: string): Promise<string[]>;
    commit(tree: string, message: string): Promise<string>;
    /** base tree + only the test files changed in `green` (base itself if no test changed). */
    redTree(green: string): Promise<string>;
    /** The diff judges receive: secrets and binaries replaced by placeholders (the human approves `diff`). */
    judgeDiff(tree: string): Promise<string>;
    /** Full new text of the changed non-secret, non-binary files, within `budgetChars` (text-only judges). */
    changedTexts(tree: string, budgetChars: number): Promise<{ path: string; text: string }[]>;
  };
  memory?: MemoryPort;
  project: string;
  run: { cwd: string; env: Record<string, string>; timeoutMs: number; maxOutputBytes: number };
  now(): Date;
}

const RUN_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
/** Landing gate (Codex R3/R4): any change — either side, any case — to a protected path never lands. */
export const protectedChanges = (paths: string[]) => paths.filter(p => PROTECTED_WRITE_GLOBS.some(g => matchGlob(g.toLowerCase(), p.toLowerCase())));

export function newRun(runId: string, request: string): RunState {
  if (!RUN_ID_RE.test(runId) || runId.includes('..')) throw new Error(`invalid run id ${JSON.stringify(runId)}`);
  if (!request.trim()) throw new Error('empty request');
  return { runId, workflow: 'feature-governed', request, status: 'running', current: 'recall', revision: 0, attempts: 0, artifacts: {}, approvals: {}, history: [] };
}

/** The gate the run waits for and the exact hash a human must inspect and name to approve it. */
export function pendingApproval(s: RunState): { node: ApprovalNode; binding: string } | undefined {
  if (s.status !== 'waiting-approval') return undefined;
  if (s.current === 'approve-plan' && s.artifacts.plan) return { node: 'approve-plan', binding: s.artifacts.plan };
  if (s.current === 'approve-commit' && s.reviewedTree) return { node: 'approve-commit', binding: s.reviewedTree };
  return undefined;
}

/** Human approval of `node`, naming the hash the human inspected (≥ 12 hex chars). Pure. */
export function approve(state: RunState, node: ApprovalNode, approvedBy: string, now: Date, expected: string): RunState {
  const p = pendingApproval(state);
  if (!p || p.node !== node) throw new Error(`run ${state.runId} is not waiting for ${node} (status ${state.status}, at ${state.current})`);
  if (!approvedBy.trim()) throw new Error('approvedBy is required');
  if (!/^[0-9a-f]{12,64}$/.test(expected)) throw new Error('the expected hash must have at least 12 hex characters (copy it from `taskquoin status`)');
  if (!p.binding.startsWith(expected)) throw new Error(`expected ${expected} does not match the pending artifact ${p.binding.slice(0, 12)}… — re-read it before approving`);
  return { ...state, status: 'running', reason: undefined, approvals: { ...state.approvals, [node]: { approvedBy: approvedBy.trim(), at: now.toISOString(), binding: p.binding } } };
}

/** Continue an interrupted run from the node where it stopped. */
export function resume(state: RunState): RunState {
  if (state.status !== 'interrupted') throw new Error(`only an interrupted run can be resumed (status ${state.status})`);
  return { ...state, status: 'running', reason: undefined };
}

export async function advance(input: RunState, d: WorkflowDeps): Promise<RunState> {
  let s: RunState = structuredClone(input);
  const maxAttempts = d.agents.implementer?.noCommands ? MAX_ATTEMPTS_NO_COMMANDS : MAX_ATTEMPTS;
  const save = () => { s = { ...s, revision: (s.revision ?? 0) + 1 }; d.save(s); };
  const step = (next: NodeId, outcome: string, patch: Partial<RunState> = {}) => {
    s = { ...s, ...patch, history: [...s.history, { node: s.current, outcome, at: d.now().toISOString() }], current: next };
    d.event({ type: 'node.transition', runId: s.runId, node: s.history.at(-1)!.node, outcome, next, attempts: s.attempts });
    save();
  };
  const stop = (status: WorkflowStatus, reason: string) => {
    s = { ...s, status, reason, history: [...s.history, { node: s.current, outcome: status, at: d.now().toISOString() }] };
    d.event({ type: 'run.' + status, runId: s.runId, node: s.current });
    save();
  };
  const wf = d.workflow ?? { challengers: ['challenger'], reviewers: ['challenger'] };
  const labelOf = (id: string) => d.agents[id]?.label ?? d.agents[id]?.executor.runtime ?? id;
  const runAgent = async (role: string, task: string, frozenPaths?: string[]): Promise<RunResult | undefined> => {
    const g = d.gate(role);
    if (!g.ok) { stop('failed', `gate refused agent ${role}: ${g.failures.map(f => f.message).join(' | ')}`); return undefined; }
    for (const r of g.acceptedRisks) d.event({ type: 'risk.accepted', runId: s.runId, agent: role, capability: r.capability, approvedBy: r.approvedBy, expires: r.expires });
    const { spec, executor } = d.agents[role];
    const r = await executor.run({ agent: spec, task, cwd: d.run.cwd, env: d.run.env, timeoutMs: d.run.timeoutMs, maxOutputBytes: d.run.maxOutputBytes, ticket: g.ticket, ...(frozenPaths?.length ? { frozenPaths } : {}) });
    d.event({ type: 'agent.finished', runId: s.runId, agent: role, runtime: r.runtime, label: labelOf(role), status: r.status, costUsd: r.usage?.costUsd ?? null,
      tokens: { prompt: r.usage?.inputTokens ?? null, completion: r.usage?.outputTokens ?? null }, digest: r.effectiveConfigDigest });
    if (r.status !== 'completed' || !r.terminalMessage?.trim()) {
      // What the runtime said (e.g. OpenCode naming its provider's error) comes first, then stderr (final review I4).
      const why = r.status !== 'completed' && r.terminalMessage?.trim() ? r.terminalMessage.trim() : r.stderr;
      stop('failed', `agent ${role} ended with status ${r.status}${why ? `: ${why.slice(0, 300)}` : ''}`); return undefined;
    }
    return r;
  };
  const text = (name: string) => (s.artifacts[name] ? d.artifacts.get(s.artifacts[name]) : '');
  const art = (name: string, body: string) => ({ ...s.artifacts, [name]: d.artifacts.put(name, body) });
  /**
   * Ask every judge in `ids` (in order) for `node`/`key`; each answer is saved before the next judge is called, so a
   * resume asks only those that have not answered. Returns the answers by id, or undefined when the run stopped.
   */
  const askJudges = async (node: 'challenge' | 'review', key: string, ids: string[], artifactName: (id: string) => string,
    taskFor: (id: string) => Promise<string | { stop: string }>): Promise<Record<string, string> | undefined> => {
    let byAgent = s.judged?.node === node && s.judged.key === key ? { ...s.judged.byAgent } : {};
    for (const id of ids) {
      if (byAgent[id]) continue;
      const task = await taskFor(id);
      if (typeof task !== 'string') { stop('needs-human', task.stop); return undefined; }
      const r = await runAgent(id, task);
      if (!r) return undefined;
      const answer = strictVerdict(r.terminalMessage!) ? r.terminalMessage! : `${r.terminalMessage!}\n\nTASKQUOIN: no strict VERDICT line — counted as CHANGES_REQUESTED`;
      byAgent = { ...byAgent, [id]: d.artifacts.put(artifactName(id), answer) };
      s = { ...s, artifacts: { ...s.artifacts, [artifactName(id)]: byAgent[id] }, judged: { node, key, byAgent } };
      save();
    }
    return byAgent;
  };
  /** One judge: its raw answer (today's artifacts); several: one section per judge. */
  const combine = (ids: string[], byAgent: Record<string, string>) =>
    ids.length === 1 ? d.artifacts.get(byAgent[ids[0]]) : ids.map(id => `## ${id} (${labelOf(id)})\n\n${d.artifacts.get(byAgent[id])}`).join('\n\n');

  save();
  while (s.status === 'running') {
    const node = s.current;
    try {
      switch (node) {
        case 'recall': {
          let recall: MemoryRecall | undefined;
          try { recall = d.memory && (await d.memory.available()) ? await d.memory.recall(s.request, d.project) : undefined; } catch { recall = undefined; }
          step('plan', recall ? 'recalled' : 'no-memory', recall ? { artifacts: art('memory', memoryContextBlock(recall)) } : {});
          break;
        }
        case 'plan': {
          const r = await runAgent('planner', planTask(s.request, text('memory'), s.proseLanguage));
          if (r) step('challenge', 'planned', { artifacts: art('plan', r.terminalMessage!) });
          break;
        }
        case 'challenge': {
          const ids = wf.challengers;
          const tasks = Object.fromEntries(ids.map(id => [id, challengeTask(s.request, text('plan'), { textOnly: !!d.agents[id].textOnly }, s.proseLanguage)]));
          const tooBig = ids.find(id => { const b = d.judgeBudgetChars?.(id); return b !== undefined && tasks[id].length > b; });
          if (tooBig) { stop('needs-human', `trop gros pour le critique ${tooBig} (${tasks[tooBig].length} caractères > maxInputChars ${d.judgeBudgetChars!(tooBig)}) — raccourcissez la demande ; rien n'a été envoyé`); break; }
          const byAgent = await askJudges('challenge', s.artifacts.plan, ids, (id) => `challenge-${id}`, async (id) => tasks[id]);
          if (!byAgent) break;
          const verdicts = ids.map(id => `${ids.length > 1 ? `${id}=` : ''}${parseVerdict(d.artifacts.get(byAgent[id]))}`).join(',');
          step('approve-plan', `challenged:${verdicts}`, { artifacts: art('challenge', combine(ids, byAgent)), judged: undefined });
          break;
        }
        case 'approve-plan': {
          const a = s.approvals['approve-plan'];
          if (a && a.binding === s.artifacts.plan) step('implement', `approved-by:${a.approvedBy}`);
          else stop('waiting-approval', 'plan approval required');
          break;
        }
        case 'implement': {
          const attempt = s.attempts + 1;
          const feedback = s.attempts === 0 ? undefined : { verifyLog: [text(`verify-${s.attempts}`), text(`red-${s.attempts}`)].filter(Boolean).join('\n\n'), review: text(`review-${s.attempts}`) };
          if (!s.inheritedRoots) { // ADR-0014: ONE baseline per run — a resume never blesses what an interrupted attempt changed
            const snap = await d.workspace.snapshot();
            if (snap.refusal) { stop('needs-human', `Verify refused: ${snap.refusal}`); break; }
            s = { ...s, inheritedRoots: snap.roots, artifacts: art('workspace-baseline', JSON.stringify(snap)) };
          }
          s = { ...s, attempts: attempt, verifiedTree: undefined, reviewedTree: undefined };
          const frozen = s.inheritedRoots!.map(r => `${d.run.cwd.replace(/\/$/, '')}/${r}`);
          const r = await runAgent('implementer', implementTask(s.request, text('plan'), text('challenge'), feedback, { noCommands: !!d.agents.implementer.noCommands }), frozen);
          if (r) step('verify', `implemented:${attempt}`, { artifacts: art(`implement-${attempt}`, r.terminalMessage!) });
          break;
        }
        case 'verify': {
          const before = await d.git.candidateTree();
          const links = await d.git.gitlinks(before);
          if (links.length) { stop('needs-human', `submodules are not supported in governed runs (${links.join(', ')})`); break; }
          const roots = s.inheritedRoots ?? [];
          const baseline = JSON.parse(text('workspace-baseline') || '{"roots":[],"deps":{},"ignored":{}}') as WorkspaceSnapshot;
          const now = await d.workspace.snapshot(roots);
          const deps = changedPaths(baseline.deps, now.deps); const depsChanged = [...deps.added, ...deps.changed, ...deps.removed];
          if (depsChanged.length) { // frozen for agents (sandbox + hook): a change is a bypass or someone else's write — fail closed
            stop('needs-human', `dependencies changed during the run: ${depsChanged.slice(0, 5).join(', ')}${depsChanged.length > 5 ? ` (+${depsChanged.length - 5})` : ''} — Verify inherits them, so nothing is verified or committed; reinstall them and start a new run`);
            break;
          }
          const ign = changedPaths(baseline.ignored, now.ignored); const nIgn = ign.added.length + ign.changed.length + ign.removed.length;
          let arts = s.artifacts;
          if (nIgn) {
            const lines = [...ign.added.map(p => `+ ${p}`), ...ign.changed.map(p => `~ ${p}`), ...ign.removed.map(p => `- ${p}`)];
            arts = art(`ignored-${s.attempts}`, `TASKQUOIN — ignored files created (+), changed (~) or removed (-) in the working directory since the run started. They are NOT in the diff, NOT verified (clean room) and NOT committed, but they stay on the developer's disk.\n${lines.slice(0, MAX_LISTED).join('\n')}${lines.length > MAX_LISTED ? `\n… and ${lines.length - MAX_LISTED} more` : ''}`);
            s = { ...s, artifacts: arts };
          }
          const v = await d.verify(before, roots);
          if (v.refusal) { s = { ...s, artifacts: art(`verify-${s.attempts}`, v.log) }; stop('needs-human', `Verify refused: ${v.refusal}`); break; }
          const treeChanged = v.treeChanged;
          const log = treeChanged ? `${v.log}\n\nTASKQUOIN: verification modified tracked files of the clean room; tests must not change the code under test` : v.log;
          arts = art(`verify-${s.attempts}`, log);
          const passed = v.passed && !treeChanged;
          d.event({ type: 'verify.result', runId: s.runId, attempt: s.attempts, passed, exitCode: v.exitCode, tree: before, ignoredChanges: nIgn });
          const lastVerify = { passed, exitCode: v.exitCode, treeChanged };
          if (passed) step('red-check', 'tests-green', { artifacts: arts, lastVerify, verifiedTree: before });
          else if (s.attempts < maxAttempts && !s.reverified) step('implement', treeChanged ? 'tree-changed:rework' : 'tests-red:rework', { artifacts: arts, lastVerify });
          else { s = { ...s, artifacts: arts, lastVerify }; stop('needs-human', treeChanged ? `verification modified tracked files (attempt ${s.attempts})` : `tests still failing after ${s.attempts} attempts`); }
          break;
        }
        case 'red-check': {
          // RED proof by Taskquoin (pilot 1, ADR-0013 §6): the same suite on base + changed test files only must FAIL
          // by itself (a conclusive run). It proves the changed tests depend on the non-test changes — not that they
          // assert the requested behaviour: the reviewer and the human judge that, with this log in front of them.
          // Clean room (ADR-0014): the red tree is materialized apart; the working directory is never touched.
          const green = s.verifiedTree!;
          const red = await d.git.redTree(green);
          if (red === green) { // only files classified as tests changed: nothing to demonstrate — said to reviewer + human
            const arts = art(`red-${s.attempts}`, 'TASKQUOIN RED PROOF — not applicable: only test files changed (no production change to demonstrate).');
            d.event({ type: 'red.result', runId: s.runId, attempt: s.attempts, redFailed: null, tree: red });
            step('review', 'red-not-applicable:tests-only', { artifacts: arts, redProof: 'not-applicable' });
            break;
          }
          const v = await d.verify(red, s.inheritedRoots ?? []);
          if (v.refusal) { s = { ...s, artifacts: art(`red-${s.attempts}`, v.log) }; stop('needs-human', `Verify refused: ${v.refusal}`); break; }
          const head = `TASKQUOIN RED PROOF — tests run on base + test changes only (tree ${red.slice(0, 12)}); they must FAIL.`;
          if (!v.conclusive) {
            const why = 'the red run did not complete by itself (timeout, sandbox, launch or materialization failure, output limit)';
            s = { ...s, artifacts: art(`red-${s.attempts}`, `${head}\nRESULT: INCONCLUSIVE — ${why}. This is not evidence.\n\n${v.log}`) };
            d.event({ type: 'red.result', runId: s.runId, attempt: s.attempts, redFailed: null, inconclusive: true, tree: red });
            stop('needs-human', `RED proof inconclusive: ${why}`);
            break;
          }
          const log = `${head}\n${v.passed ? 'RESULT: they PASSED — the tests pass WITHOUT your production change, so they do not test it. Write a test that fails before the change.' : 'RESULT: they failed as required (RED proven).'}\n\n${v.log}`;
          const arts = art(`red-${s.attempts}`, log);
          d.event({ type: 'red.result', runId: s.runId, attempt: s.attempts, redFailed: !v.passed, tree: red });
          if (!v.passed) step('review', 'red-proven', { artifacts: arts, redProof: 'proven' });
          else if (s.attempts < maxAttempts && !s.reverified) step('implement', 'red-not-proven:rework', { artifacts: arts, verifiedTree: undefined });
          else { s = { ...s, artifacts: arts }; stop('needs-human', `no failing test demonstrates the change (attempt ${s.attempts})`); }
          break;
        }
        case 'review': {
          const tree = s.verifiedTree!;
          const touched = protectedChanges((await d.git.changes(tree)).map(c => c.path));
          if (touched.length) { stop('needs-human', `protected configuration changed: ${touched.join(', ')} — Taskquoin never commits such changes`); break; }
          const diff = await d.git.diff(tree);
          s = { ...s, artifacts: art(`diff-${s.attempts}`, diff) };
          if (diff.length > MAX_REVIEW_DIFF) { stop('needs-human', `diff too large to review completely (${diff.length} chars > ${MAX_REVIEW_DIFF}) — split the task`); break; }
          // Judges never receive secrets or binaries (multi-LLM A3); text-only judges also get the changed files.
          const jdiff = await d.git.judgeDiff(tree);
          const changed = await d.git.changes(tree);
          const testsOnly = s.redProof === 'not-applicable' ? changed.map(c => c.path) : undefined;
          // New production files are absent from the RED tree by construction: their import failing is the expected RED (live demo, project B).
          const newProductionFiles = changed.filter(c => c.status === 'A' && !TEST_PATH_GLOBS.some(g => matchGlob(g, c.path))).map(c => c.path);
          const ids = wf.reviewers; const key = `${tree}:${s.attempts}`;
          const answered = s.judged?.node === 'review' && s.judged.key === key ? s.judged.byAgent : {};
          // Every judge's task is built and checked against its budget BEFORE any judge is called (none is paid for
          // nothing); changed files get only the room LEFT after the task itself (final review).
          const tasks: Record<string, string> = {}; let tooBig: string | undefined;
          for (const id of ids.filter(x => !answered[x])) {
            const textOnly = !!d.agents[id].textOnly; const budget = d.judgeBudgetChars?.(id);
            const build = (files?: { path: string; text: string }[]) => reviewTask(s.request, text('plan'), jdiff, text(`verify-${s.attempts}`), text(`red-${s.attempts}`), testsOnly, text(`ignored-${s.attempts}`), { textOnly, newProductionFiles, ...(files ? { files } : {}) }, s.proseLanguage);
            const bare = build();
            if (budget !== undefined && bare.length > budget) { tooBig = `trop gros pour le relecteur ${id} (${bare.length} caractères > maxInputChars ${budget}) — découpez la tâche ; rien n'a été envoyé`; break; }
            if (!textOnly) { tasks[id] = bare; continue; }
            const room = Math.min(DEFAULT_FILES_BUDGET, (budget ?? Number.POSITIVE_INFINITY) - bare.length - FILES_FRAME_MARGIN);
            const omitted = [{ path: '…', text: '[budget atteint : fichiers non inclus]' }];
            let task = build(room > 0 ? await d.git.changedTexts(tree, room) : omitted);
            if (budget !== undefined && task.length > budget) task = build(omitted);
            tasks[id] = task;
          }
          if (tooBig) { stop('needs-human', tooBig); break; }
          const byAgent = await askJudges('review', key, ids, (id) => `review-${s.attempts}-${id}`, async (id) => tasks[id]);
          if (!byAgent) break;
          const refusing = ids.filter(id => parseVerdict(d.artifacts.get(byAgent[id])) !== 'APPROVE');
          const verdict = refusing.length ? 'CHANGES_REQUESTED' as const : 'APPROVE' as const;
          const arts = art(`review-${s.attempts}`, combine(ids, byAgent));
          if (verdict === 'APPROVE') step('approve-commit', 'review:APPROVE', { artifacts: arts, lastVerdict: verdict, reviewedTree: tree, judged: undefined });
          else if (s.attempts < maxAttempts && (s.reviewReworks ?? 0) < MAX_REVIEW_REWORKS && !s.reverified) step('implement', `review:CHANGES_REQUESTED:rework${ids.length > 1 ? `:${refusing.join(',')}` : ''}`, { artifacts: arts, lastVerdict: verdict, judged: undefined, reviewReworks: (s.reviewReworks ?? 0) + 1 });
          else { s = { ...s, artifacts: arts, lastVerdict: verdict, judged: undefined }; stop('needs-human', `review still requests changes after ${s.attempts} attempts${ids.length > 1 ? ` — ${refusing.join(', ')}` : ''}`); }
          break;
        }
        case 'approve-commit': {
          const a = s.approvals['approve-commit'];
          if (a && a.binding === s.reviewedTree) step('commit', `approved-by:${a.approvedBy}`);
          else stop('waiting-approval', s.reverified ? 'working tree changed after approval — re-verified and re-reviewed; approve the new tree' : 'commit approval required (bound to the exact tree)');
          break;
        }
        case 'commit': {
          const a = s.approvals['approve-commit']!;
          const now = await d.git.candidateTree();
          if (now !== a.binding) {
            const approvals = { ...s.approvals }; delete approvals['approve-commit'];
            step('verify', 'tree-changed-after-approval', { approvals, verifiedTree: undefined, reviewedTree: undefined, reverified: true });
            break;
          }
          const commit = await d.git.commit(a.binding, `taskquoin: ${s.request.split('\n')[0].slice(0, 60)}\n\nTaskquoin-Run: ${s.runId}\nTaskquoin-Tree: ${a.binding}\nPlan-Approved-By: ${s.approvals['approve-plan']?.approvedBy}\nCommit-Approved-By: ${a.approvedBy}\nVerified: tests green in Taskquoin's sandbox on this exact tree (attempt ${s.attempts})\nRED-Proof: ${s.redProof === 'proven' ? `proven (attempt ${s.attempts})` : 'not applicable (only files classified as tests changed)'}\nReviewed-By: ${wf.reviewers.map(id => `${id} (${labelOf(id)})`).join(', ')}`);
          step('record', 'committed', { commit });
          break;
        }
        case 'record': {
          if (d.memory) {
            try {
              const files = (await d.git.changes(s.reviewedTree!)).map(c => c.path);
              await d.memory.record({ runId: s.runId, workflow: s.workflow, status: 'completed', project: d.project, filesChanged: files,
                decisions: [`plan approved by ${s.approvals['approve-plan']?.approvedBy}`, `verification passed on tree ${s.reviewedTree?.slice(0, 12)} (attempt ${s.attempts})`, `review: ${s.lastVerdict}`, `commit ${s.commit} approved by ${s.approvals['approve-commit']?.approvedBy}`] });
            } catch { /* memory never blocks */ }
          }
          step('done', 'recorded');
          break;
        }
        case 'done': s = { ...s, status: 'completed' }; save(); break;
        default: stop('failed', `unexpected node ${node}`);
      }
    } catch (e) {
      // Adapter failure (git, store, verify infrastructure…): persist a resumable state instead of losing the run.
      s = { ...s, current: node };
      stop('interrupted', `${node}: ${(e as Error).message}`);
    }
  }
  return s;
}
