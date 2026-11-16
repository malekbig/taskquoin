#!/usr/bin/env node
/**
 * taskquoin — composition root (architecture §3). Commands: init, doctor, check <agent> [--json], uninstall [--purge-state].
 * Exit codes: 0 ok · 1 refused / failed check · 2 usage error.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { validateCapabilityMatrix, type CapabilityMatrix, type HostFacts, type RuntimeId } from '@taskquoin/domain';
import { API_RUNTIME_VERSION } from '@taskquoin/runtime-api';
import { failureDigest, isRealDate, pendingApproval, prepareRun, type GateResult, type OwnerException, type RunState } from '@taskquoin/application';
import { defaultConfig, keyEnvName, KNOWN_KEY_VARS, MAX_CONFIG_BYTES, parseConfig, renderConfig, workflowOf, type Stack, type TaskquoinConfig } from '@taskquoin/config';
import { probeHost, probeOllama, type HostReport } from '@taskquoin/host-probe';
import { ensureTrustedDir, listRuns, loadRiskAcceptances, loadRunState, repoStore, saveRiskAcceptance, stateBase } from '@taskquoin/store-fs';
import { codexSandboxFor } from '@taskquoin/runtime-codex';
import { ClaudeMemMemory } from '@taskquoin/memory-claude-mem';
import { GitWorkspace } from '@taskquoin/git';
import { cmdApprove, cmdResume, cmdRun, cmdShow, cmdStatus, configDigest, type CliContext } from './workflow-cli.ts';
import { animateLogo, completeCommand, drawSlashMenu, lineReader, renderBanner, runConsole, slashMenu, squadOf, type ConsoleCommands, type ConsoleIO } from './console.ts';
import { sandboxedToolAvailable } from '@taskquoin/local-tool';
import { installShortcut, removeShortcut, type ShortcutEnv } from './shortcut.ts';
import { createInterface } from 'node:readline';

import { cmdSkills, resolveAgentSkills } from './skills-cli.ts';

const CONFIG = 'taskquoin.yaml';
const out = (s = '') => process.stdout.write(s + '\n');
const err = (s: string) => process.stderr.write(s + '\n');
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const HOOK_ENTRY = new URL('../../../adapters/hooks-claude/src/main.ts', import.meta.url).pathname;

function loadMatrix(rt: RuntimeId): CapabilityMatrix {
  return validateCapabilityMatrix(JSON.parse(readFileSync(new URL(`../../../adapters/runtime-${rt}/src/capabilities.json`, import.meta.url), 'utf8')));
}

function detectStack(root: string): Stack {
  const has = (f: string) => existsSync(join(root, f));
  if (has('package.json')) return 'node';
  if (has('composer.json')) return 'php';
  if (has('pyproject.toml') || has('requirements.txt') || has('setup.py')) return 'python';
  if (has('go.mod')) return 'go';
  if (has('pom.xml')) return 'java-maven';
  if (has('build.gradle') || has('build.gradle.kts')) return 'java-gradle';
  return 'unknown';
}

async function host(): Promise<HostReport> {
  return probeHost({ cwd: process.cwd(), PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? homedir() });
}
function requireRepo(h: HostReport): string {
  if (!h.gitRoot) { err('taskquoin: not inside a git repository (Taskquoin commits verified work, ADR-0011)'); process.exit(1); }
  return h.gitRoot;
}
function loadConfig(root: string): TaskquoinConfig {
  const p = join(root, CONFIG);
  if (!existsSync(p)) { err(`taskquoin: ${CONFIG} not found — run "taskquoin init"`); process.exit(1); }
  if (statSync(p).size > MAX_CONFIG_BYTES) { err(`taskquoin: ${CONFIG} is too large`); process.exit(1); }
  try { return parseConfig(readFileSync(p, 'utf8')); } catch (e) { err(`taskquoin: ${(e as Error).message}`); process.exit(1); }
}

function gate(cfg: TaskquoinConfig, h: HostReport, agentId: string): GateResult & { runtimeFound: boolean } {
  const a = cfg.agents[agentId];
  if (a.runtime === 'api') {
    // A text-only judge: certified by construction (no tool path); runnable only when its provider key is present.
    const g = prepareRun({ agentId, agent: a, mandatory: cfg.policy.mandatory, exceptions: [], matrix: loadMatrix('api'), facts: { runtimeVersion: API_RUNTIME_VERSION, satisfied: ['landing-gate'] }, now: new Date() });
    const name = keyEnvName(cfg.providers![a.provider!]);
    if (name && !process.env[name]?.trim()) return { ...g, ok: false, ticket: undefined, runtimeFound: true,
      failures: [...g.failures, { capability: 'net.egress', class: 'UNSUPPORTED', message: `${name} absente — définissez-la dans votre environnement (la clé n'est jamais écrite dans le dépôt)` }] };
    return { ...g, runtimeFound: true };
  }
  const matrix = loadMatrix(a.runtime);
  const probe = h.runtimes[a.runtime];
  const facts: HostFacts = {
    runtimeVersion: probe?.version ?? 'not-installed',
    // landing-gate: the only execution path is the Taskquoin workflow, which enforces it.
    satisfied: [...(a.runtime === 'claude' && h.bashSandbox ? ['bash-sandbox' as const] : []), 'landing-gate' as const],
    ...(a.runtime === 'codex' ? { sandbox: codexSandboxFor(a.capabilities) } : {}),
  };
  const exceptions = loadRiskAcceptances(repoStore(h.gitRoot!)) as OwnerException[];
  return { ...prepareRun({ agentId, agent: a, mandatory: cfg.policy.mandatory, exceptions, matrix, facts, now: new Date() }), runtimeFound: !!probe };
}

async function cmdInit(): Promise<number> {
  const h = await host(); const root = requireRepo(h);
  const p = join(root, CONFIG);
  if (existsSync(p)) { err(`taskquoin: ${CONFIG} already exists — edit it, or remove it yourself to start over (never overwritten)`); return 1; }
  const stack = detectStack(root);
  const tools = { claude: !!h.runtimes.claude, codex: !!h.runtimes.codex };
  const cfg0 = defaultConfig(stack, tools);
  // Detection is LOCAL only: which key variables exist (their values are never read into the file), and a local Ollama.
  const detected = { env: KNOWN_KEY_VARS.filter(n => !!process.env[n]), ollamaModels: (await probeOllama()) ?? [] };
  const text = renderConfig(cfg0, detected);
  // Transactional (Codex R3): validate the store and record ownership BEFORE creating the file; roll back on failure.
  const store = repoStore(root);
  const mf = join(store.root, 'manifest.json');
  writeFileSync(mf, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), files: [{ path: CONFIG, sha256: sha(text) }] }, null, 2), { mode: 0o600 });
  try { writeFileSync(p, text, { flag: 'wx' }); } catch (e) { rmSync(mf, { force: true }); throw e; }
  out(`✔ ${CONFIG} created (stack: ${stack}) — agents: ${Object.entries(cfg0.agents).map(([id, a]) => `${id} (${a.runtime})`).join(', ')}`);
  out(`✔ control store: ${store.root} (outside the repository)`);
  if (detected.env.length || detected.ollamaModels.length) out(`ℹ IA détectées : ${[...detected.env, ...(detected.ollamaModels.length ? [`Ollama local (${detected.ollamaModels.join(', ')})`] : [])].join(', ')} — proposées en commentaire dans ${CONFIG} ; décommentez-les pour les utiliser (le code de ce projet leur sera alors envoyé)`);
  if (!tools.claude) out(`⚠ l'implementer a besoin de Claude Code (OpenCode, prévu ensuite, élargira ce choix) : installez Claude Code pour lancer des runs`);
  else if (!tools.codex) out(`ℹ Claude Code seul : le relecteur est aussi Claude (même modèle que l'implémenteur) — un juge indépendant est proposé en commentaire si une IA a été détectée`);
  out('Next: taskquoin doctor');
  return 0;
}

function printGate(id: string, cfg: TaskquoinConfig, g: GateResult & { runtimeFound: boolean }) {
  out(`Agent ${id} (${cfg.agents[id].runtime})${g.runtimeFound ? '' : ' — runtime NOT INSTALLED'}`);
  const a = cfg.agents[id];
  if (a.runtime === 'api') {
    const p = cfg.providers![a.provider!]; const name = keyEnvName(p);
    out(`  Provider ${a.provider}: ${p.url} (${p.model}) — ${name ? `clé ${name} ${process.env[name]?.trim() ? 'présente' : 'ABSENTE'}` : 'sans clé'}`);
  }
  for (const r of g.resolved) {
    const f = g.failures.find(x => x.capability === r.capability); const a = g.acceptedRisks.find(x => x.capability === r.capability);
    if (r.certified) out(`  ✔ ${r.capability} ${r.class} — ${r.mechanism}`);
    else if (a) out(`  ⚠ ${r.capability} accepted risk (approved by ${a.approvedBy} until ${a.expires}: ${a.reason}) — ${a.message}`);
    else out(`  ✖ ${r.capability} — ${f?.message ?? r.mechanism}`);
  }
}

async function cmdDoctor(): Promise<number> {
  const h = await host(); const root = requireRepo(h); const cfg = loadConfig(root);
  out(`Taskquoin doctor — ${root}`);
  for (const rt of ['claude', 'codex'] as const) {
    const p = h.runtimes[rt]; const m = loadMatrix(rt);
    out(p ? `Runtime ${rt}: ${p.version ?? '?'} (${p.bin}) ${p.version === m.runtimeVersion ? '✔' : `✖ matrix measured for ${m.runtimeVersion}`}` : `Runtime ${rt}: ✖ not found on PATH`);
  }
  out(`Bash sandbox (bubblewrap + socat): ${h.bashSandbox ? '✔' : '✖ not available — agents with a shell are refused (apt install bubblewrap socat)'}`);
  out(`Local tool isolation (unshare -rn): ${h.localIsolation ? '✔' : '✖ local tools will not run'}`);
  out(`PreToolUse hook entry: ${existsSync(HOOK_ENTRY) ? '✔' : '✖ missing'} (${HOOK_ENTRY})`);
  const conns = Object.entries(cfg.connectors);
  // Where this project's code goes (multi-LLM A): every agent that receives it, grouped by destination.
  const used = [...new Set(['planner', 'implementer', ...workflowOf(cfg).challengers, ...workflowOf(cfg).reviewers])].filter(id => cfg.agents[id]);
  const dest = new Map<string, string[]>();
  for (const id of used) {
    const a = cfg.agents[id]; let where: string;
    if (a.runtime === 'claude') where = 'Anthropic (Claude Code)'; else if (a.runtime === 'codex') where = 'OpenAI (Codex)';
    else { const p = cfg.providers![a.provider!]; const u = new URL(p.url); where = `${u.host} (${p.model})${['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ? ' — reste sur cette machine' : ''}`; }
    dest.set(where, [...(dest.get(where) ?? []), id]);
  }
  for (const id of workflowOf(cfg).reviewers) {
    const rt = cfg.agents[id]?.runtime;
    if (rt && rt !== 'api' && rt === cfg.agents.implementer?.runtime) out(`⚠ le relecteur ${id} utilise le même modèle que l'implémenteur (${rt}) : ajoutez un juge indépendant (suggestions commentées dans ${CONFIG}, ou providers)`);
  }
  out('Le code de ce projet est envoyé à :');
  for (const [where, ids] of dest) out(`  ${where.replace(' — reste sur cette machine', '')} — ${ids.join(', ')}${where.endsWith('reste sur cette machine') ? ' (reste sur cette machine)' : ''}`);
  out(`Remote connectors (ADR-0012): ${conns.length ? conns.map(([id, c]) => `${id} → ${c.host} [${c.scope}] read=${c.read.length} write=${c.write.length} (brokered)`).join('; ') : 'none'}`);
  if (cfg.memory.claudeMem.enabled) {
    const mem = new ClaudeMemMemory(); const lo = await mem.localOnlyCheck();
    out(`Memory (claude-mem): ${!lo.ok ? `✖ disabled — ${lo.reason}` : (await mem.available()) ? '✔ local worker, local-only' : '⚠ worker not running (runs proceed without memory)'}`);
  } else out('Memory (claude-mem): disabled in config');
  out();
  let refused = 0;
  for (const id of Object.keys(cfg.agents)) {
    const g = gate(cfg, h, id); printGate(id, cfg, g);
    const sk = resolveAgentSkills(cfg, repoStore(root), id);
    if ((cfg.agents[id].skills ?? []).length) out(`  Skills: ${[...sk.loaded.map(x => `✔ ${x.name} (${x.origin}, ${x.treeHash.slice(7, 19)})`), ...sk.errors.map(e => `✖ ${e}`)].join(' · ')}`);
    if (!g.ok || !g.runtimeFound || sk.errors.length) refused++;
    out();
  }
  const n = Object.keys(cfg.agents).length;
  out(refused ? `Verdict: ${n - refused} of ${n} agents can run — refused agents will not be started.` : `Verdict: all ${n} agents can run.`);
  return refused ? 1 : 0;
}

async function cmdCheck(agentId: string | undefined, json: boolean): Promise<number> {
  const h = await host(); const root = requireRepo(h); const cfg = loadConfig(root);
  if (!agentId || !cfg.agents[agentId]) { err(`taskquoin check <agent>: known agents: ${Object.keys(cfg.agents).join(', ')}`); return 2; }
  const g = gate(cfg, h, agentId);
  const ok = g.ok && g.runtimeFound;
  if (json) out(JSON.stringify({ agent: agentId, ok, runtimeFound: g.runtimeFound, failures: g.failures, acceptedRisks: g.acceptedRisks, resolved: g.resolved, warnings: g.warnings }, null, 2));
  else printGate(agentId, cfg, g);
  return ok ? 0 : 1;
}

/** Record an owner risk acceptance for the CURRENT failure of (agent, capability), in the control store. */
async function cmdAcceptRisk(agentId: string | undefined, capability: string | undefined, o: { reason?: string; expires?: string; as?: string }): Promise<number> {
  const h = await host(); const root = requireRepo(h); const cfg = loadConfig(root);
  if (!agentId || !Object.hasOwn(cfg.agents, agentId) || !capability) { err('usage: taskquoin accept-risk <agent> <capability> --reason "<why>" --expires YYYY-MM-DD --as <name>'); return 2; }
  if (!o.reason?.trim() || !o.as?.trim() || !o.expires || !isRealDate(o.expires)) { err('taskquoin accept-risk: --reason, --as and a real --expires date are required'); return 2; }
  if (o.expires < new Date().toISOString().slice(0, 10)) { err('taskquoin accept-risk: --expires is in the past'); return 2; }
  if (cfg.agents[agentId].runtime === 'api') { err(`taskquoin accept-risk: ${agentId} is an api judge — its restrictions hold by construction; nothing to accept (a missing key is fixed by defining it)`); return 1; }
  const g = gate(cfg, h, agentId);
  const f = g.failures.find(x => x.capability === capability);
  if (!f) { err(`taskquoin accept-risk: "${capability}" is not currently failing for ${agentId} — nothing to accept`); return 1; }
  const probe = h.runtimes[cfg.agents[agentId].runtime as 'claude' | 'codex']; // api judges returned above
  saveRiskAcceptance(repoStore(root), { agent: agentId, capability, reason: o.reason.trim(), expires: o.expires, approvedBy: o.as.trim(),
    runtimeVersion: probe?.version ?? 'not-installed', failureDigest: failureDigest(f.message), createdAt: new Date().toISOString() });
  out(`⚠ risk accepted by ${o.as.trim()} until ${o.expires} for ${agentId}/${capability} — bound to this exact failure:`);
  out(`  ${f.message}`);
  out('  It stops applying if the failure changes (other mechanism, other runtime version) or after the expiry date.');
  return 0;
}

async function cmdUninstall(purge: boolean): Promise<number> {
  const h = await host(); const root = requireRepo(h);
  const store = repoStore(root); const mf = join(store.root, 'manifest.json');
  if (!existsSync(mf)) { err('taskquoin: no manifest for this repository — nothing Taskquoin created is recorded'); return 1; }
  // Validate before touching anything (Codex R3): known schema, only files Taskquoin can create, contained, no symlinks.
  const OWNED = new Set([CONFIG]);
  let manifest: { files: { path: string; sha256: string }[] };
  try {
    manifest = JSON.parse(readFileSync(mf, 'utf8'));
    if (!Array.isArray(manifest.files)) throw new Error('files is not a list');
    for (const f of manifest.files) {
      if (typeof f?.path !== 'string' || typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error('malformed entry');
      if (!OWNED.has(f.path)) throw new Error(`"${f.path}" is not a file Taskquoin creates`);
    }
  } catch (e) { err(`taskquoin: invalid manifest (${(e as Error).message}); nothing removed`); return 1; }
  let kept = 0;
  for (const f of manifest.files) {
    const p = join(root, f.path);
    if (!existsSync(p)) { out(`- ${f.path} already absent`); continue; }
    if (lstatSync(p).isSymbolicLink() || realpathSync(p) !== join(realpathSync(root), f.path)) { kept++; out(`⚠ kept ${f.path} (symlink or outside the repository)`); continue; }
    if (sha(readFileSync(p)) === f.sha256) { rmSync(p); out(`✔ removed ${f.path}`); }
    else { kept++; out(`⚠ kept ${f.path} (modified since init) — remove it yourself if you want it gone`); }
  }
  if (purge) {
    if (!store.root.startsWith(stateBase() + '/')) { err(`taskquoin: refusing to purge ${store.root}: not under ${stateBase()}`); return 1; }
    rmSync(store.root, { recursive: true, force: true }); out(`✔ control store removed (${store.root})`);
  } else {
    if (!kept) rmSync(mf); // keep the manifest while a recorded file remains, so a later uninstall still knows it
    out(`- control store kept for audit (${store.root}); use --purge-state to remove it`);
  }
  return kept ? 1 : 0;
}

export const HELP = `taskquoin — governed execution for coding agents (Claude Code + Codex)

Setup
  init                          create taskquoin.yaml for the detected stack (manifest kept outside the repo)
  doctor                        check runtimes, sandbox, isolation, hook, memory, connectors; certify every agent
  check <agent> [--json]        run the policy gate for one agent
  accept-risk <agent> <capability> --reason "<why>" --expires YYYY-MM-DD --as <name>
                                record YOUR risk acceptance (control store, bound to the exact failure)
  version                       print the Taskquoin CLI version
Workflow
  console                       interactive shell (also: taskquoin alone, in a terminal) — type / for the menu
  run "<request>"               start the governed workflow on a dedicated branch taskquoin/<run>
  status [<run>] [--json]       list runs, or show one run's history (--json: machine-readable)
  show <run>                    list the run's artifacts with their size in bytes
  show <run> <artifact>         print plan | challenge | diff-N | verify-N | red-N | ignored-N | review-N | implement-N | memory
  approve <run> <plan|commit> --expect <hash> --as <name>
                                approve that gate, naming the hash you inspected (shown by status)
  resume <run>                  continue an interrupted run
Skills (local import only — Taskquoin never downloads)
  skills list                   first-party (pinned) and imported skills with their status
  skills audit <dir>            validate (Agent Skills spec) and audit a local skill without importing it
  skills import <dir> --source "<owner/repo@commit>"   copy into QUARANTINE (control store) + audit report
  skills approve <name> --as <name> [--accept-findings]   YOUR approval; re-hashed at every use
  skills revoke <name> --as <name>
Shortcut
  setup [--remove]              put \`taskquoin\` on your PATH (~/.local/bin/taskquoin; done automatically at first launch)
Removal
  uninstall [--purge-state]     remove what Taskquoin created and you did not modify

Exit codes: 0 ok · 1 refused / failed check · 2 usage error`;

async function ctx(): Promise<{ c: CliContext; git: GitWorkspace }> {
  const h = await host(); const root = requireRepo(h); const cfg = loadConfig(root);
  if (!h.git) throw new Error('git not found on PATH');
  const store = repoStore(root);
  const c: CliContext = { cfg, h, root, store, gate: (id) => gate(cfg, h, id), hookEntry: HOOK_ENTRY, out, err };
  return { c, git: new GitWorkspace({ gitBin: h.git, cwd: root, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? homedir() }, scratchDir: ensureTrustedDir(join(store.root, 'scratch')) }) };
}

/** `taskquoin console`: the same commands behind `/…` lines; approvals need the hash retyped (see console.ts). */
async function cmdConsole(): Promise<number> {
  const { c, git } = await ctx();
  const tty = !!process.stdin.isTTY;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty, ...(tty ? { completer: completeCommand } : {}) });
  const color = !!process.stdout.isTTY && !process.env.NO_COLOR;
  rl.on('SIGINT', () => out('\n(Ctrl+C est ignoré ici : /quit pour sortir. Un run en cours continue jusqu\'à sa prochaine approbation.)'));
  // readline owns the prompt (redrawn correctly); the "/" menu is drawn only while a prompt waits for input.
  const reader = lineReader(rl, (s) => process.stdout.write(s), { discardTypeAhead: tty, showPrompt: (q) => { rl.setPrompt(q); rl.prompt(); } });
  let prompting = false; let menuShown = false;
  const io: ConsoleIO = {
    ask: async (q) => { prompting = true; try { return await reader.ask(q); } finally { prompting = false; } },
    out, err: (s) => err(process.stderr.isTTY && !process.env.NO_COLOR ? `\x1b[38;2;247;118;142m${s}\x1b[0m` : s),
  };
  if (tty) {
    process.stdin.on('keypress', (_ch, key: { name?: string } | undefined) => {
      if (key?.name === 'return' || key?.name === 'enter') return;
      setImmediate(() => {
        if (!prompting) return;
        const items = slashMenu(rl.line);
        if (!items.length && !menuShown) return;
        process.stdout.write(drawSlashMenu({ promptWidth: rl.getPrompt().length, line: rl.line, cursor: rl.cursor, items, color }));
        menuShown = items.length > 0;
      });
    });
    rl.on('line', () => { if (menuShown) { process.stdout.write('\x1b[J'); menuShown = false; } });
  }
  // The console loaded taskquoin.yaml once: if it changes (or disappears) while the console is open, commands are
  // refused instead of running with a stale config (or a helper exiting the whole console).
  const startDigest = configDigest(c.root);
  const guard = async (f: () => Promise<number> | number): Promise<number> => {
    let now: string | undefined; try { now = configDigest(c.root); } catch { /* missing */ }
    if (now !== startDigest) { err('taskquoin.yaml a changé depuis l\'ouverture de la console : /quit puis relancez `taskquoin console`'); return 1; }
    return f();
  };
  const cmds: ConsoleCommands = {
    run: async (r) => { let runId: string | undefined; const code = await guard(() => cmdRun(c, git, r, (id) => { runId = id; })); return { code, ...(runId ? { runId } : {}) }; },
    status: (r) => guard(() => cmdStatus(c, r)), show: (r, a) => guard(() => cmdShow(c, r, a)),
    approve: (r, g, e, as) => guard(() => cmdApprove(c, git, r, g, e, as)), resume: (r) => guard(() => cmdResume(c, git, r)),
    doctor: () => guard(() => cmdDoctor()), skills: () => guard(() => cmdSkills(c.store, 'list', undefined, {}, out, err)),
    agents: () => guard(() => {
      for (const [id, a] of Object.entries(c.cfg.agents)) out(`${id.padEnd(12)} ${a.runtime.padEnd(7)} ${Object.keys(a.capabilities).join(', ')}${a.skills?.length ? `  — skills : ${a.skills.join(', ')}` : ''}`);
      return 0;
    }),
    pending: (r) => { const s = loadRunState<RunState>(c.store, r); const p = s && pendingApproval(s); return p ? { gate: p.node === 'approve-plan' ? 'plan' : 'commit', binding: p.binding } : undefined; },
    runs: () => listRuns(c.store),
  };
  // The squad as it really is: each agent's gate verdict, and Taskquoin's own sandboxed Verify as the tester.
  // Computed while the logo animation plays (terminal with colours only; TASKQUOIN_NO_ANIMATION=1 turns it off).
  const animate = tty && color && !process.env.TASKQUOIN_NO_ANIMATION;
  const playing = animate ? animateLogo((s) => process.stdout.write(s), (ms) => new Promise(r => setTimeout(r, ms))) : Promise.resolve();
  const squad = squadOf(c.cfg.agents, (id) => gate(c.cfg, c.h, id), await sandboxedToolAvailable());
  await playing;
  try { return await runConsole(io, cmds, renderBanner(squad, { color, logo: !animate })); } finally { rl.close(); }
}

const LAUNCHER = new URL('../../../bin/taskquoin', import.meta.url).pathname;
const shortcutEnv = (): ShortcutEnv => ({ home: process.env.HOME ?? homedir(), launcher: realpathSync(LAUNCHER), pathEnv: process.env.PATH ?? '', stateDir: stateBase() });

async function main(): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ allowPositionals: true, options: { json: { type: 'boolean' }, 'purge-state': { type: 'boolean' },
      reason: { type: 'string' }, expires: { type: 'string' }, as: { type: 'string' }, help: { type: 'boolean', short: 'h' },
      source: { type: 'string' }, 'accept-findings': { type: 'boolean' }, expect: { type: 'string' }, remove: { type: 'boolean' } } });
  } catch (e) { err(`taskquoin: ${(e as Error).message}\n${HELP}`); return 2; } // usage errors exit 2 (Codex R4)
  const { positionals, values } = parsed;
  if (values.help) { out(HELP); return 0; }
  // First launch in a terminal: put `taskquoin` on the PATH by itself (owner's request), unless removed or disabled.
  if (process.stdin.isTTY && process.stdout.isTTY && !process.env.TASKQUOIN_NO_SETUP && positionals[0] !== 'setup') {
    try { const r = installShortcut(shortcutEnv(), { auto: true }); if (r.status === 'installed') err(`✔ ${r.message}`); } catch { /* never blocks a command */ }
  }
  // Like `claude` or `codex`: `taskquoin` alone opens the console in a terminal (scripts still get the help).
  if (!positionals.length) { if (process.stdin.isTTY && process.stdout.isTTY) return cmdConsole(); out(HELP); return 0; }
  const [cmd, arg, arg2] = positionals;
  switch (cmd) {
    case 'help': out(HELP); return 0;
    case 'version': out(`taskquoin ${JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version}`); return 0;
    case 'init': return cmdInit();
    case 'doctor': return cmdDoctor();
    case 'check': return cmdCheck(arg, !!values.json);
    case 'console': return cmdConsole();
    case 'setup': {
      if (values.remove) { const r = removeShortcut(shortcutEnv()); out(r.message); return 0; }
      const r = installShortcut(shortcutEnv(), { auto: false }); (r.status === 'conflict' ? err : out)(r.message); return r.status === 'conflict' ? 1 : 0;
    }
    case 'run': { const { c, git } = await ctx(); return cmdRun(c, git, arg); }
    case 'approve': { const { c, git } = await ctx(); return cmdApprove(c, git, arg, arg2, values.expect, values.as); }
    case 'resume': { const { c, git } = await ctx(); return cmdResume(c, git, arg); }
    case 'status': { const { c } = await ctx(); return cmdStatus(c, arg, !!values.json); }
    case 'show': { const { c } = await ctx(); return cmdShow(c, arg, arg2); }
    case 'skills': { const h = await host(); const root = requireRepo(h); return cmdSkills(repoStore(root), arg, arg2, { source: values.source, as: values.as, acceptFindings: !!values['accept-findings'] }, out, err); }
    case 'accept-risk': return cmdAcceptRisk(arg, arg2, { reason: values.reason, expires: values.expires, as: values.as });
    case 'uninstall': return cmdUninstall(!!values['purge-state']);
    default: err('usage: taskquoin <init|doctor|check <agent> [--json]|run "<request>"|approve <run> --as <name>|status [<run>] [--json]|show <run> [<artifact>]|accept-risk <agent> <capability> --reason .. --expires .. --as ..|uninstall [--purge-state]>'); return 2;
  }
}

/** Exit only once stdout/stderr have drained: process.exit() drops whatever a pipe has not taken yet (pilot 2: `show … | grep` lost the tail). */
const exitAfterFlush = (code: number) => { process.exitCode = code; process.stdout.write('', () => process.stderr.write('', () => process.exit(code))); };
main().then(exitAfterFlush, e => { err(`taskquoin: ${(e as Error).message}`); exitAfterFlush(1); });
