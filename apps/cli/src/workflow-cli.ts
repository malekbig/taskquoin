/**
 * `taskquoin run | approve | resume | status | show` — composition of the feature-governed workflow with real adapters.
 * Tree-based (ADR-0013): verify/review/approve/commit refer to one git tree id; git runs on the host with hooks and
 * fsmonitor disabled and commits with `commit-tree` (no repository code runs on the host). Verify runs the project's
 * tests in a clean room (ADR-0014): the tree materialized outside the workspace, mounted at the repository path in
 * bubblewrap with no network, .git and the inherited dependency dirs read-only, HOME hidden, secrets masked.
 * Approvals name the gate and the expected hash; a per-run lock serialises concurrent CLI calls (Codex R4 N4).
 */
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { homedir } from 'node:os';
import { advance, approve, newRun, pendingApproval, resume, type GateResult, type RunState, type WorkflowDeps } from '@taskquoin/application';
import { inheritGlobs, keyEnvName, testCommand, workflowOf, type TaskquoinConfig } from '@taskquoin/config';
import { ApiExecutor } from '@taskquoin/runtime-api';
import type { HostReport } from '@taskquoin/host-probe';
import { appendEvent, ensureTrustedDir, getArtifact, listRuns, loadRunState, putArtifact, saveRunState, stateBase, type RepoStore } from '@taskquoin/store-fs';
import { ClaudeExecutor } from '@taskquoin/runtime-claude';
import { CodexExecutor } from '@taskquoin/runtime-codex';
import { OpenCodeExecutor, userOpenCodeDirs } from '@taskquoin/runtime-opencode';
import { ClaudeMemMemory } from '@taskquoin/memory-claude-mem';
import type { GitWorkspace } from '@taskquoin/git';
import { defaultMaskDirs, dependencyDigests, fingerprintEntries, runSandboxedTool, scanWorkspace } from '@taskquoin/local-tool';
import { currentLanguage, t } from './i18n/index.ts';
import { displayWidth, padEndDisplay } from './i18n/width.ts';
import { LANGUAGES } from './i18n/languages.ts';
import { jsonOut, n, nBlock, nCut, nLog } from './tui/neutral.ts';
import { resolveAgentSkills, skillsBlock } from './skills-cli.ts';
import { matchGlob, SECRET_READ_GLOBS, selectInheritedRoots, TEST_PATH_GLOBS } from '@taskquoin/rules';
/** Never sent to any judge (multi-LLM A3): the same names Taskquoin masks and denies elsewhere. */
const isSecretPath = (p: string) => SECRET_READ_GLOBS.some(g => matchGlob(g, p));

/** Always required; the judges are whoever `workflow` cites (the `challenger` agent by default — optional otherwise). */
const ROLES = ['planner', 'implementer'] as const;
/** Planner and challenger must stay read-only: an "independent reviewer" that can write is not one (Codex R4 N8). */
const READ_ONLY_ROLES = ['planner'] as const;
const FORBIDDEN_FOR_READ_ONLY = ['fs.write', 'shell.run', 'net.egress', 'vcs.commit', 'vcs.push', 'connector.write', 'config.modify'] as const;

export interface CliContext { cfg: TaskquoinConfig; h: HostReport; root: string; store: RepoStore; gate: (id: string) => GateResult; hookEntry: string; out: (s?: string) => void; err: (s: string) => void }

export const configDigest = (root: string) => 'sha256:' + createHash('sha256').update(readFileSync(join(root, 'taskquoin.yaml'))).digest('hex');

function preflight(c: CliContext): string | undefined {
  const wf = workflowOf(c.cfg);
  for (const r of [...new Set([...ROLES, ...wf.challengers, ...wf.reviewers])]) {
    if (!Object.hasOwn(c.cfg.agents, r)) return t('workflow.missingAgent', { agent: n(r) });
    const sk = resolveAgentSkills(c.cfg, c.store, r);
    if (sk.errors.length) return t('workflow.skillsUnusableStart', { agent: n(r), errors: sk.errors.map(n).join('; ') });
  }
  for (const r of [...new Set([...READ_ONLY_ROLES, ...wf.challengers, ...wf.reviewers])]) {
    const bad = FORBIDDEN_FOR_READ_ONLY.filter(k => (c.cfg.agents[r].capabilities[k]?.length ?? 0) > 0);
    if (bad.length) return t('workflow.mustBeReadOnly', { agent: n(r), granted: bad.join(', ') });
  }
  return judgesProblem(c);
}

/**
 * An api or OpenCode judge that cannot run (a missing key, an unconnected provider) stops `run`, `approve` and `resume`
 * BEFORE anything changes — never after a paid implementation (multi-LLM A, project B). Claude/Codex keep their gate
 * where they run.
 */
function judgesProblem(c: CliContext): string | undefined {
  const wf = workflowOf(c.cfg);
  for (const r of [...new Set([...wf.challengers, ...wf.reviewers])].filter(id => c.cfg.agents[id].runtime === 'api' || c.cfg.agents[id].runtime === 'opencode')) {
    const g = c.gate(r);
    if (!g.ok) return t('workflow.judgeCannotStart', { agent: n(r), reasons: g.failures.map(f => n(f.message)).join('; ') });
  }
  return undefined;
}

/** Serialise every state-changing CLI call on a run (stale locks of dead processes are taken over). */
async function withRunLock<T>(c: CliContext, runId: string, fn: () => Promise<T>): Promise<T> {
  const dir = ensureTrustedDir(join(c.store.runs, runId)); const lock = join(dir, 'lock');
  try { writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); }
  catch {
    const pid = Number(readFileSync(lock, 'utf8'));
    let alive = false; try { if (pid > 0) { process.kill(pid, 0); alive = true; } } catch { alive = false; }
    if (alive) throw new Error(t('workflow.busy', { run: runId, pid }));
    writeFileSync(lock, String(process.pid), { mode: 0o600 });
  }
  try { return await fn(); } finally { rmSync(lock, { force: true }); }
}

function deps(c: CliContext, state: RunState, git: GitWorkspace): WorkflowDeps {
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? homedir(), LANG: process.env.LANG ?? 'C.UTF-8' };
  const claude = c.h.runtimes.claude, codex = c.h.runtimes.codex;
  const executors = {
    claude: claude?.version ? new ClaudeExecutor({ bin: claude.bin, version: claude.version }, { hook: { nodeBin: process.execPath, entry: c.hookEntry, policyDir: c.store.policies, controlStore: c.store.root } }) : undefined,
    codex: codex?.version ? new CodexExecutor({ bin: codex.bin, version: codex.version }) : undefined,
    opencode: c.h.runtimes.opencode?.version ? new OpenCodeExecutor({ bin: c.h.runtimes.opencode.bin, version: c.h.runtimes.opencode.version },
      { userDirs: userOpenCodeDirs(), runBase: join(stateBase(), 'opencode', 'runs'), controlStore: c.store.root }) : undefined,
  };
  const agent = (id: string) => {
    const a = c.cfg.agents[id];
    const p = a.runtime === 'api' ? c.cfg.providers![a.provider!] : undefined;
    const ex = p ? new ApiExecutor({ id: a.provider!, url: p.url, model: p.model, ...(keyEnvName(p) ? { keyEnv: keyEnvName(p) } : {}), maxOutputTokens: p.maxOutputTokens, timeoutSeconds: p.timeoutSeconds, tokenField: p.tokenField })
      : executors[a.runtime as 'claude' | 'codex' | 'opencode'];
    if (!ex) throw new Error(t('workflow.runtimeMissing', { runtime: a.runtime, agent: id }));
    const sk = resolveAgentSkills(c.cfg, c.store, id);
    if (sk.errors.length) throw new Error(t('workflow.skillsUnusable', { agent: n(id), errors: sk.errors.map(n).join('; ') }));
    const label = p ? `api: ${new URL(p.url).host}/${p.model}` : a.runtime === 'opencode' ? `opencode: ${a.model}` : a.runtime;
    // An implementer without commands (OpenCode, or no shell.run): Taskquoin runs the tests and allows more reworks.
    const noCommands = id === 'implementer' && !(a.capabilities['shell.run']?.length);
    return { spec: { id, description: a.description, prompt: a.prompt + skillsBlock(sk.loaded), capabilities: a.capabilities, model: a.model, maxTurns: a.maxTurns }, executor: ex, label, textOnly: !!p, ...(noCommands ? { noCommands } : {}) };
  };
  const testCmd = testCommand(c.cfg);
  const base = state.base!, branch = state.branch!;
  return {
    agents: Object.fromEntries([...new Set(['planner', 'implementer', ...workflowOf(c.cfg).challengers, ...workflowOf(c.cfg).reviewers])].map(id => [id, agent(id)])),
    workflow: workflowOf(c.cfg),
    judgeBudgetChars: (id) => { const a = c.cfg.agents[id]; return a.runtime === 'api' ? c.cfg.providers![a.provider!].maxInputChars : undefined; },
    gate: c.gate,
    artifacts: { put: (name, text) => putArtifact(c.store, Buffer.from(text), { mediaType: 'text/plain', producer: name }).sha256, get: (h) => getArtifact(c.store, h).toString('utf8') },
    save: (s) => saveRunState(c.store, s.runId, s),
    event: (e) => { appendEvent(c.store, state.runId, e); },
    verify: async (tree, roots) => {
      const no = (log: string) => ({ passed: false, exitCode: null, conclusive: false, treeChanged: false, log });
      const refuse = (why: string) => ({ ...no(`TASKQUOIN — Verify refused: ${why}`), refusal: why });
      if (!testCmd) return no('no test command configured (verify.command, or the implementer\'s shell.run) — cannot verify, failing closed');
      // Clean room (ADR-0014): the tree is materialized OUTSIDE the workspace (control store: agents cannot write it)
      // and mounted at the repository path; only `.git` and the inherited dependency dirs come from the working dir.
      const rooms = ensureTrustedDir(join(c.store.root, 'verify'), c.root);
      const room = mkdtempSync(join(rooms, `${state.runId}-`));
      try {
        try { await git.materialize(tree, room); } catch (e) { return no(`could not materialize tree ${tree.slice(0, 12)} in the clean room: ${(e as Error).message}`); }
        const unfreezable = symlinkedRoot(c.root, roots); if (unfreezable) return refuse(unfreezable);
        const scan = scanWorkspace(room);
        if (!scan.complete) return refuse(`clean-room scan incomplete (${scan.problem}) — cannot mask every secret`);
        const toVisible = (f: string) => (f === room || f.startsWith(room + '/') ? join(c.root, relative(room, f)) : f);
        const hideFiles = scan.secretFiles.map(toVisible);
        // Inherited dirs come from the working directory: scan them as content (their .git included) and mask their
        // secrets, also behind secret-named links (Codex CR #3, CR2 #3).
        for (const x of roots) {
          const dep = scanWorkspace(join(c.root, x), 200_000, { includeRootGit: true });
          if (!dep.complete) return refuse(`scan of inherited ${x} incomplete (${dep.problem}) — cannot mask every secret`);
          hideFiles.push(...dep.secretFiles);
        }
        const profile = { writableRoot: room, mountAt: c.root, home: env.HOME, hideHome: true, readOnly: [join(c.root, '.git'), ...roots.map(x => join(c.root, x))], hideFiles, maskDirs: [...defaultMaskDirs(), c.store.root] };
        // Links are resolved INSIDE the very sandbox the tests will get (realpath -m: every component physically,
        // dangling ones included) — no emulation can drift from what tests see (Codex CR #1, CR2 #1).
        const probe = await runSandboxedTool({ bin: '/bin/sh', args: ['-c', LINK_PROBE, 'probe', c.root], cwd: c.root, env: { PATH: '/usr/bin:/bin', LANG: 'C' }, timeoutMs: 120_000, maxOutputBytes: 20_000_000 }, profile);
        const parts = probe.stdout.split('\0'); const sep = parts.indexOf('TQ-SEP');
        const links = parts.slice(0, Math.max(sep, 0)).map(l => join(c.root, l)); const reals = parts.slice(sep + 1, sep + 1 + links.length);
        if (probe.status !== 'completed' || probe.truncated || sep < 0 || reals.length !== links.length || parts.length !== 2 * links.length + 2) return refuse(`could not resolve every symlink in the clean room (status ${probe.status}${probe.stderr ? `: ${probe.stderr.slice(0, 200)}` : ''})`);
        const inRepo = (t: string) => t === c.root || t.startsWith(c.root + '/');
        const leaving = links.filter((_l, i) => !inRepo(reals[i])).map(l => relative(c.root, l));
        const inDeps = leaving.filter(l => roots.some(x => l === x || l.startsWith(x + '/'))), inTree = leaving.filter(l => !inDeps.includes(l));
        if (inTree.length) return refuse(`the tree links outside the repository: ${inTree.slice(0, 5).join(', ')} — Verify would run code that is not in the tree`);
        if (inDeps.length) return refuse(`inherited dependencies link outside the repository: ${inDeps.slice(0, 5).join(', ')} — install them into the repository (not npm link) or remove them from verify.inherit`);
        // What a secret-NAMED link points to is masked, as resolved INSIDE the sandbox (a host-side resolution in the
        // room misses targets that only the inherited mounts provide, Codex CR3 #1).
        links.forEach((l, i) => { if (SECRET_READ_GLOBS.some(g => matchGlob(g, relative(c.root, l)))) hideFiles.push(reals[i]); });
        // The marker is printed INSIDE the sandbox before the test command: its presence proves the sandbox started.
        const r = await runSandboxedTool({ bin: '/bin/sh', args: ['-c', `echo ${SANDBOX_STARTED}; exec /bin/sh -c "$0"`, testCmd], cwd: c.root, env: { PATH: env.PATH, HOME: '/tmp', LANG: env.LANG }, timeoutMs: 15 * 60_000, maxOutputBytes: 2_000_000 }, profile);
        const treeChanged = (await git.dirTree(room, base)) !== tree;
        // Conclusive = the command ran in the sandbox, exited by itself with a test result (126/127 = not runnable,
        // 128+n = signal) and its WHOLE output was kept (a truncated log hides why it failed — Codex RED re-review #2).
        const started = r.stdout.startsWith(`${SANDBOX_STARTED}\n`);
        const conclusive = started && !r.truncated && (r.status === 'completed' || r.status === 'failed') && r.exitCode !== null && r.exitCode < 126;
        return { passed: started && r.status === 'completed' && r.exitCode === 0, exitCode: r.exitCode, conclusive, treeChanged,
          log: `$ ${testCmd}  (clean room of tree ${tree.slice(0, 12)}: no network, .git read-only, HOME hidden, ${roots.length ? `inherited read-only: ${roots.join(', ')}` : 'no inherited dirs'}, ${hideFiles.length} secret file(s) masked)\nstatus=${r.status} exit=${r.exitCode}${r.truncated ? ' OUTPUT TRUNCATED' : ''}\n${r.stdout}\n${r.stderr}`.slice(-200_000) };
      } finally { removeRoom(room); }
    },
    workspace: {
      snapshot: async (roots) => {
        const entries = await git.ignoredEntries();
        const r = roots ?? selectInheritedRoots(entries, inheritGlobs(c.cfg), (p) => existsSync(join(c.root, p)));
        const unfreezable = symlinkedRoot(c.root, r);
        if (unfreezable) return { roots: r, deps: {}, ignored: {}, refusal: unfreezable };
        const other = entries.filter(e => !r.some(x => e.path === x || e.path.startsWith(x + '/')));
        return { roots: r, deps: dependencyDigests(c.root, r), ignored: fingerprintEntries(c.root, other, r) };
      },
    },
    git: {
      candidateTree: () => git.candidateTree(base),
      diff: (t) => git.diff(base, t),
      changes: (t) => git.changes(base, t),
      gitlinks: (t) => git.gitlinks(t),
      commit: (t, m) => git.commitTree(t, base, branch, m),
      redTree: (t) => git.redTree(base, t, (p) => TEST_PATH_GLOBS.some(g => matchGlob(g, p))),
      judgeDiff: (t) => git.judgeDiff(base, t, isSecretPath),
      changedTexts: (t, budget) => git.changedTexts(base, t, isSecretPath, budget),
    },
    memory: c.cfg.memory.claudeMem.enabled ? new ClaudeMemMemory() : undefined,
    project: basename(c.root),
    run: { cwd: c.root, env, timeoutMs: 20 * 60_000, maxOutputBytes: 8_000_000 },
    now: () => new Date(),
  };
}

/**
 * Inherited paths must be plain directories of the working dir: a symlink anywhere on the way would mount (and let
 * the agent's sandbox resolve) what it points to, which neither the fingerprint nor the scans cover (Codex CR2 #2).
 */
function symlinkedRoot(root: string, roots: string[]): string | undefined {
  for (const x of roots) {
    let p = root;
    for (const seg of x.split('/')) { p = join(p, seg); let link = false; try { link = lstatSync(p).isSymbolicLink(); } catch { break; } if (link) return `inherited path ${x} goes through a symlink (${relative(root, p)}) — Verify would mount what it points to`; }
  }
  return undefined;
}

/** Delete a clean room even if tests left read-only directories in it (never follows symlinks). */
function removeRoom(dir: string): void {
  try { rmSync(dir, { recursive: true, force: true }); return; } catch { /* read-only dirs: make them writable, retry */ }
  const fix = (p: string) => { const s = lstatSync(p); if (!s.isDirectory()) return; chmodSync(p, 0o700); for (const n of readdirSync(p)) fix(join(p, n)); };
  try { fix(dir); rmSync(dir, { recursive: true, force: true }); } catch { /* left in the control store; harmless, never reused */ }
}

const GATE = { plan: 'approve-plan', commit: 'approve-commit' } as const;
const SANDBOX_STARTED = 'TASKQUOIN-SANDBOX-STARTED';
/** Every symlink of the clean room (and inherited dirs), then each one's physical resolution, NUL-separated, in order. */
const LINK_PROBE = 'cd "$1" && find . -path ./.git -prune -o -type l -print0 > /tmp/tq-links && xargs -0 -r realpath -m -z -- < /tmp/tq-links > /tmp/tq-real && cat /tmp/tq-links && printf "TQ-SEP\\0" && cat /tmp/tq-real';
// cd + a fixed `./.git` pattern: the repository path is never used as a find pattern (glob characters, Codex CR3 #2).
/** The CLI word for an approval node (`taskquoin approve <run> <plan|commit>`). */
const gateWord = (node: string) => (node === GATE.plan ? 'plan' : 'commit');

function report(c: CliContext, s: RunState) {
  c.out(t('workflow.report.head', { run: n(s.runId), status: n(s.status), node: n(s.current), attempt: s.attempts, branch: n(s.branch ?? '') }));
  if (s.reason) c.out(`  ${n(s.reason)}`);
  const p = pendingApproval(s);
  // Labels share one column whatever the language (display width, so CJK aligns too).
  const names = [t('workflow.report.reviewLabel'), t('workflow.report.approveLabel'), t('workflow.report.resumeLabel')];
  const width = Math.max(...names.map(displayWidth)) + 2;
  const labels = names.map(x => padEndDisplay(x, width));
  if (p) {
    const gate = gateWord(p.node);
    const att = s.attempts;
    const ignored = s.artifacts[`ignored-${att}`] ? t('workflow.report.ignoredNote', { n: att }) : '';
    const what = gate === 'plan' ? t('workflow.report.planArtifacts') : t('workflow.report.diffArtifacts', { n: att, ignored });
    c.out(`  ${labels[0]}taskquoin show ${n(s.runId)} ${what}`); // i18n-ok: command line to type
    c.out(`  ${labels[1]}${t('workflow.report.approveCmd', { run: n(s.runId), gate, hash: p.binding.slice(0, 12) })}`);
    c.out(`  ${' '.repeat(width)}${gate === 'plan' ? t('workflow.report.bindingPlan', { hash: p.binding }) : t('workflow.report.bindingTree', { hash: p.binding })}`);
  }
  if (s.status === 'interrupted') c.out(`  ${labels[2]}taskquoin resume ${n(s.runId)}`); // i18n-ok: command line to type
  if (s.status === 'completed') c.out(t('workflow.report.committed', { commit: n(s.commit ?? ''), branch: n(s.branch ?? '') }));
}
const exitFor = (s: RunState) => (s.status === 'completed' || s.status === 'waiting-approval' ? 0 : 1);

async function checkRunContext(c: CliContext, git: GitWorkspace, s: RunState): Promise<string | undefined> {
  if ((await git.currentBranch()) !== s.branch) return t('workflow.switchBranch', { branch: s.branch ?? '' });
  if (s.configDigest && s.configDigest !== configDigest(c.root)) return t('workflow.configChanged');
  return judgesProblem(c);
}

/** The language agents write their prose in for a run started in `lang`: the English name, or undefined for English. */
export const proseLanguageFor = (lang: string): string | undefined => (lang === 'en' ? undefined : LANGUAGES.find(l => l.code === lang)?.englishName);

/** `onStart` receives the id of the run THIS call creates (the console selects exactly that run). */
export async function cmdRun(c: CliContext, git: GitWorkspace, request: string | undefined, onStart?: (runId: string) => void): Promise<number> {
  if (!request?.trim()) { c.err(t('workflow.usage.run')); return 2; }
  const pf = preflight(c); if (pf) { c.err(t('workflow.cmdError', { command: 'run', message: pf })); return 1; }
  if (!(await git.isClean())) { c.err(t('workflow.cmdError', { command: 'run', message: t('workflow.dirtyTree') })); return 1; }
  const runId = `run-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${randomBytes(3).toString('hex')}`;
  const branch = `taskquoin/${runId}`;
  const base = await git.startRunBranch(branch);
  const proseLanguage = proseLanguageFor(currentLanguage());
  const s0: RunState = { ...newRun(runId, request), branch, base, configDigest: configDigest(c.root), ...(proseLanguage ? { proseLanguage } : {}) };
  onStart?.(runId);
  const s = await withRunLock(c, runId, () => advance(s0, deps(c, s0, git)));
  report(c, s);
  return exitFor(s);
}

export async function cmdApprove(c: CliContext, git: GitWorkspace, runId: string | undefined, gate: string | undefined, expect: string | undefined, as: string | undefined): Promise<number> {
  if (!runId || (gate !== 'plan' && gate !== 'commit') || !expect || !as?.trim()) { c.err(t('workflow.usage.approve')); return 2; }
  if (!loadRunState<RunState>(c.store, runId)) { c.err(t('workflow.unknownRun', { run: n(runId) })); return 1; }
  try {
    const s = await withRunLock(c, runId, async () => {
      const s0 = loadRunState<RunState>(c.store, runId)!;
      const problem = await checkRunContext(c, git, s0); if (problem) throw new Error(problem);
      const node = GATE[gate];
      const s1 = approve(s0, node, as.trim(), new Date(), expect.trim().toLowerCase());
      appendEvent(c.store, runId, { type: 'approval', node, approvedBy: as.trim(), binding: s1.approvals[node]!.binding });
      return advance(s1, deps(c, s1, git));
    });
    report(c, s); return exitFor(s);
  } catch (e) { c.err(t('workflow.cmdError', { command: 'approve', message: nLog((e as Error).message) })); return 1; }
}

export async function cmdResume(c: CliContext, git: GitWorkspace, runId: string | undefined): Promise<number> {
  if (!runId) { c.err(t('workflow.usage.resume')); return 2; }
  if (!loadRunState<RunState>(c.store, runId)) { c.err(t('workflow.unknownRun', { run: n(runId) })); return 1; }
  try {
    const s = await withRunLock(c, runId, async () => {
      const s0 = loadRunState<RunState>(c.store, runId)!;
      const problem = await checkRunContext(c, git, s0); if (problem) throw new Error(problem);
      const s1 = resume(s0);
      return advance(s1, deps(c, s1, git));
    });
    report(c, s); return exitFor(s);
  } catch (e) { c.err(t('workflow.cmdError', { command: 'resume', message: nLog((e as Error).message) })); return 1; }
}

/** Fields shared by `status --json` and `status <run> --json`; every key is always present (null when unset). */
const runSummary = (s: RunState) => ({ runId: s.runId, status: s.status, current: s.current, attempts: s.attempts,
  branch: s.branch ?? null, commit: s.commit ?? null, request: s.request.split('\n')[0] });

/**
 * `--json` goes through jsonOut, not the neutraliser: JSON.stringify escapes only C0, so jsonOut also escapes DEL, C1,
 * the bidi controls and U+2028/U+2029 as \u sequences. The parsed value is unchanged, and the bytes are identical for
 * any output without those characters (the text output is neutralised below).
 */
export function cmdStatus(c: CliContext, runId?: string, json = false): number {
  if (!runId && json) { c.out(jsonOut(listRuns(c.store).map(id => runSummary(loadRunState<RunState>(c.store, id)!)))); return 0; }
  if (!runId) { for (const id of listRuns(c.store)) { const s = loadRunState<RunState>(c.store, id)!; c.out(`${n(id)}  ${n(s.status).padEnd(16)} ${n(s.current).padEnd(15)} ${nCut(s.request.split('\n')[0], 60)}`); } return 0; }
  const s = loadRunState<RunState>(c.store, runId); if (!s) { c.err(t('workflow.unknownRun', { run: n(runId) })); return 1; }
  if (json) {
    const p = pendingApproval(s);
    c.out(jsonOut({ ...runSummary(s), history: s.history, pendingApproval: p ? { gate: gateWord(p.node), expectedHash: p.binding } : null }));
    return 0;
  }
  report(c, s);
  // Where the code goes for this run's judges (spec §2 objective 6), from the current configuration.
  const wf = workflowOf(c.cfg); const judge = (id: string) => { const a = c.cfg.agents[id]; if (!a) return t('workflow.judgeAbsent', { id: n(id) });
    if (a.runtime === 'opencode') return `${n(id)} (opencode: ${n(a.model ?? '')})`;
    if (a.runtime !== 'api') return `${n(id)} (${a.runtime})`; const p = c.cfg.providers![a.provider!]; return `${n(id)} (api: ${n(new URL(p.url).host)}/${n(p.model)})`; };
  const judges = [...new Set([...wf.challengers, ...wf.reviewers])].map(judge).join(', ');
  if (c.cfg.workflow) c.out(`  ${t('workflow.judges', { list: judges })}`); // default projects: no line
  for (const h of s.history) c.out(`  ${n(h.at)}  ${n(h.node).padEnd(15)} ${n(h.outcome)}`); return 0;
}

export function cmdShow(c: CliContext, runId: string | undefined, artifact: string | undefined): number {
  if (!runId) { c.err(t('workflow.usage.show')); return 2; }
  const s = loadRunState<RunState>(c.store, runId); if (!s) { c.err(t('workflow.unknownRun', { run: n(runId) })); return 1; }
  if (!artifact) { for (const name of Object.keys(s.artifacts).sort()) c.out(`${n(name)}  ${getArtifact(c.store, s.artifacts[name]).length}`); return 0; }
  const h = s.artifacts[artifact]; if (!h) { c.err(t('workflow.noArtifact', { artifact: n(artifact), available: Object.keys(s.artifacts).map(n).join(', ') })); return 1; }
  c.out(nBlock(getArtifact(c.store, h).toString('utf8'))); return 0;
}
