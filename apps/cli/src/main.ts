#!/usr/bin/env node
/**
 * taskquoin — composition root (architecture §3). Commands: init, doctor, check <agent> [--json], uninstall [--purge-state].
 * Exit codes: 0 ok · 1 refused / failed check · 2 usage error.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { validateCapabilityMatrix, type CapabilityMatrix, type HostFacts, type RuntimeId } from '@taskquoin/domain';
import { API_RUNTIME_VERSION } from '@taskquoin/runtime-api';
import { failureDigest, isReady, isRealDate, pendingApproval, prepareRun, type GateResult, type OwnerException, type RunState } from '@taskquoin/application';
import { defaultConfig, keyEnvName, KNOWN_KEY_VARS, MAX_CONFIG_BYTES, parseConfig, providerOf, renderConfig, workflowOf, type Stack, type TaskquoinConfig } from '@taskquoin/config';
import { findOnPath, probeHost, probeOllama, type HostReport } from '@taskquoin/host-probe';
import { connectedProviders, connectEnv, LOCAL_PROVIDERS, LOGIN_ARGS, MEASURED_CONNECTIONS, measuredHosts, OPENCODE_VERSION, userOpenCodeDirs, userOpenCodePaths } from '@taskquoin/runtime-opencode';
import { ensureTrustedDir, listRuns, loadRiskAcceptances, loadRunState, repoStore, saveRiskAcceptance, stateBase } from '@taskquoin/store-fs';
import { codexSandboxFor } from '@taskquoin/runtime-codex';
import { ClaudeMemMemory } from '@taskquoin/memory-claude-mem';
import { GitWorkspace } from '@taskquoin/git';
import { cmdApprove, cmdResume, cmdRun, cmdShow, cmdStatus, configDigest, type CliContext } from './workflow-cli.ts';
import { jsonOut, n as nz, nLog } from './tui/neutral.ts';
import { animateLogo, completeCommand, drawSlashMenu, lineReader, renderBanner, runConsole, slashMenu, squadOf, withTerminalReleased, type ConsoleCommands, type ConsoleIO } from './console.ts';
import { sandboxedToolAvailable } from '@taskquoin/local-tool';
import { installShortcut, removeShortcut, type ShortcutEnv } from './shortcut.ts';
import { runtimeNotices } from './runtime-notices.ts';
import { layoutOf } from './layout.ts';
import { en, ENGLISH_ONLY, loadPreferences, resolveLanguage, setLanguage, t, translate, type ParamNames, type Params } from './i18n/index.ts';
import { alignColumns } from './i18n/width.ts';
import { createInterface } from 'node:readline';

import { cmdSkills, resolveAgentSkills } from './skills-cli.ts';
import { cmdUpgrade, type UpgradeEnv } from './upgrade-cli.ts';
import { fetchLatest } from './upgrade-check.ts';
import { absoluteHome } from './home.ts';
import { savePreferences } from './preferences.ts';

const CONFIG = 'taskquoin.yaml';
const out = (s = '') => process.stdout.write(s + '\n');
const err = (s: string) => process.stderr.write(s + '\n');
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const LAYOUT = layoutOf(import.meta.url);
const HOOK_ENTRY = LAYOUT.hookEntry;
/** Failure messages end up in `check --json` (byte-identical whatever the language), so they stay English. */
const english = <K extends (typeof ENGLISH_ONLY)[number]>(key: K, ...args: Params<ParamNames<(typeof en)[K]>>) => translate('en', en, undefined, key, args[0]);

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
  // No absolute home: '' (the probe then never looks for the measured file, and nothing resolves against the cwd).
  return probeHost({ cwd: process.cwd(), PATH: process.env.PATH ?? '', HOME: absoluteHome() ?? '',
    claude: { measured: loadMatrix('claude').runtimeVersion, selection: loadPreferences(stateBase()).runtimeSelection?.claude ?? 'auto' } });
}
function requireRepo(h: HostReport): string {
  if (!h.gitRoot) { err(t('cli.notGit')); process.exit(1); }
  return h.gitRoot;
}
function loadConfig(root: string): TaskquoinConfig {
  const p = join(root, CONFIG);
  if (!existsSync(p)) { err(t('cli.configMissing', { config: CONFIG })); process.exit(1); }
  if (statSync(p).size > MAX_CONFIG_BYTES) { err(t('cli.configTooLarge', { config: CONFIG })); process.exit(1); }
  try { return parseConfig(readFileSync(p, 'utf8')); } catch (e) { err(`taskquoin: ${nz((e as Error).message)}`); process.exit(1); } // i18n-ok: the message comes from the config parser (domain text)
}

function gate(cfg: TaskquoinConfig, h: HostReport, agentId: string): GateResult & { runtimeFound: boolean } {
  const a = cfg.agents[agentId];
  if (a.runtime === 'api') {
    // A text-only judge: certified by construction (no tool path); runnable only when its provider key is present.
    const g = prepareRun({ agentId, agent: a, mandatory: cfg.policy.mandatory, exceptions: [], matrix: loadMatrix('api'), facts: { runtimeVersion: API_RUNTIME_VERSION, satisfied: ['landing-gate'] }, now: new Date() });
    const name = keyEnvName(cfg.providers![a.provider!]);
    if (name && !process.env[name]?.trim()) return { ...g, ok: false, ticket: undefined, runtimeFound: true,
      failures: [...g.failures, { capability: 'net.egress', class: 'UNSUPPORTED', message: english('cli.apiKeyMissing', { name }) }] };
    return { ...g, runtimeFound: true };
  }
  const matrix = loadMatrix(a.runtime);
  const probe = h.runtimes[a.runtime];
  const facts: HostFacts = {
    runtimeVersion: probe?.version ?? 'not-installed',
    // landing-gate: the only execution path is the Taskquoin workflow, which enforces it.
    satisfied: [...(a.runtime === 'claude' && h.bashSandbox ? ['bash-sandbox' as const] : []), ...(a.runtime === 'opencode' && h.fileSandbox ? ['file-sandbox' as const] : []), 'landing-gate' as const],
    ...(a.runtime === 'codex' ? { sandbox: codexSandboxFor(a.capabilities) } : {}),
  };
  const exceptions = loadRiskAcceptances(repoStore(h.gitRoot!)) as OwnerException[];
  const g = { ...prepareRun({ agentId, agent: a, mandatory: cfg.policy.mandatory, exceptions, matrix, facts, now: new Date() }), runtimeFound: !!probe };
  if (a.runtime === 'opencode') {
    // Taskquoin's own OpenCode connection (spec §5.2) must hold the model's provider — checked without reading any secret.
    const provider = providerOf(a.model!); const conn = connectedProviders(userOpenCodePaths()).find(p => p.id === provider);
    const refuse = (message: string) => ({ ...g, ok: false, ticket: undefined, failures: [...g.failures, { capability: 'net.egress' as const, class: 'UNSUPPORTED' as const, message }] });
    if (!conn) return refuse(english('cli.opencode.notConnected', { provider }));
    // Only measured provider/sign-in pairs are certified: their hosts are known (spec §5.4, final review C1).
    if (!measuredHosts(provider, conn.type)) return refuse(english('cli.opencode.unmeasured', { provider, type: conn.type, version: OPENCODE_VERSION, measured: MEASURED_CONNECTIONS.join(', ') }));
  }
  return g;
}

async function cmdInit(): Promise<number> {
  const h = await host(); const root = requireRepo(h);
  const p = join(root, CONFIG);
  if (existsSync(p)) { err(t('cli.init.exists', { config: CONFIG })); return 1; }
  const stack = detectStack(root);
  const tools = { claude: !!h.runtimes.claude, codex: !!h.runtimes.codex, opencode: !!h.runtimes.opencode };
  const cfg0 = defaultConfig(stack, tools);
  // Detection is LOCAL only: which key variables exist (their values are never read into the file), and a local Ollama.
  const detected = { env: KNOWN_KEY_VARS.filter(n => !!process.env[n]), ollamaModels: (await probeOllama()) ?? [] };
  const text = renderConfig(cfg0, detected);
  // Transactional (Codex R3): validate the store and record ownership BEFORE creating the file; roll back on failure.
  const store = repoStore(root);
  const mf = join(store.root, 'manifest.json');
  writeFileSync(mf, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), files: [{ path: CONFIG, sha256: sha(text) }] }, null, 2), { mode: 0o600 });
  try { writeFileSync(p, text, { flag: 'wx' }); } catch (e) { rmSync(mf, { force: true }); throw e; }
  out(t('cli.init.created', { config: CONFIG, stack, agents: Object.entries(cfg0.agents).map(([id, a]) => `${nz(id)} (${a.runtime})`).join(', ') }));
  out(t('cli.init.store', { path: nz(store.root) }));
  if (detected.env.length || detected.ollamaModels.length) out(t('cli.init.detected', { list: [...detected.env, ...(detected.ollamaModels.length ? [t('cli.init.ollama', { models: detected.ollamaModels.map(nz).join(', ') })] : [])].join(', '), config: CONFIG }));
  if (!tools.claude && tools.opencode) {
    const ps = connectedProviders(userOpenCodePaths()).map(p => p.id);
    out(t('cli.init.opencodeOnly', { config: CONFIG, providers: ps.length ? ps.map(nz).join(', ') : t('cli.init.noProvider') }));
  } else if (!tools.claude) out(t('cli.init.needImplementer'));
  else if (!tools.codex) out(t('cli.init.claudeOnly'));
  out(t('cli.init.next'));
  return 0;
}

function printGate(id: string, cfg: TaskquoinConfig, g: GateResult & { runtimeFound: boolean }) {
  out(t('cli.gate.agent', { id: nz(id), runtime: cfg.agents[id].runtime }) + (g.runtimeFound ? '' : t('cli.gate.notInstalled')));
  const a = cfg.agents[id];
  if (a.runtime === 'api') {
    const p = cfg.providers![a.provider!]; const name = keyEnvName(p);
    out(t('cli.gate.provider', { id: nz(a.provider!), url: nz(p.url), model: nz(p.model), key: name ? t('cli.gate.key', { name: nz(name), state: process.env[name]?.trim() ? t('cli.gate.present') : t('cli.gate.absent') }) : t('cli.gate.noKey') }));
  }
  const shown = new Set<unknown>();
  for (const r of g.resolved) {
    const f = g.failures.find(x => x.capability === r.capability); const a = g.acceptedRisks.find(x => x.capability === r.capability);
    if (r.certified) out(`  ✔ ${r.capability} ${r.class} — ${nz(r.mechanism)}`);
    else if (a) out(t('cli.gate.acceptedRisk', { capability: r.capability, by: nz(a.approvedBy), until: nz(a.expires), reason: nz(a.reason), message: nz(a.message) }));
    else { out(`  ✖ ${r.capability} — ${nz(f?.message ?? r.mechanism)}`); if (f) shown.add(f); }
  }
  // Failures added outside the capability matrix (a missing api key, an unconnected OpenCode provider) are shown too.
  for (const f of g.failures) if (!shown.has(f)) out(`  ✖ ${nz(f.message)}`);
}

async function cmdDoctor(): Promise<number> {
  const h = await host(); const root = requireRepo(h); const cfg = loadConfig(root);
  out(t('cli.doctor.title', { root: nz(root) }));
  for (const rt of ['claude', 'codex', 'opencode'] as const) {
    const p = h.runtimes[rt]; const m = loadMatrix(rt);
    if (p?.installed) { out(t('cli.doctor.runtimeFallback', { rt, installed: nz(p.installed.version ?? '?'), version: nz(p.version ?? '?'), bin: nz(p.bin) })); continue; }
    out(p ? t('cli.doctor.runtime', { rt, version: nz(p.version ?? '?'), bin: nz(p.bin), mark: p.version === m.runtimeVersion ? '✔' : t('cli.doctor.matrix', { version: m.runtimeVersion }) }) : t('cli.doctor.runtimeMissing', { rt }));
  }
  // Claude Code not measured and the measured one not used: why, and the `taskquoin upgrade` command that fixes it.
  for (const n of runtimeNotices(h, loadMatrix('claude').runtimeVersion, 'cli')) if (n.kind === 'action') out(n.text);
  out(t('cli.doctor.bash', { state: h.bashSandbox ? '✔' : t('cli.doctor.bashMissing') }));
  out(t('cli.doctor.file', { state: h.fileSandbox ? '✔' : t('cli.doctor.fileMissing') }));
  out(t('cli.doctor.isolation', { state: h.localIsolation ? '✔' : t('cli.doctor.isolationMissing') }));
  out(t('cli.doctor.hook', { state: existsSync(HOOK_ENTRY) ? '✔' : t('cli.doctor.hookMissing'), path: HOOK_ENTRY }));
  const conns = Object.entries(cfg.connectors);
  // Where this project's code goes (multi-LLM A): every agent that receives it, grouped by destination.
  const used = [...new Set(['planner', 'implementer', ...workflowOf(cfg).challengers, ...workflowOf(cfg).reviewers])].filter(id => cfg.agents[id]);
  const dest = new Map<string, { ids: string[]; local: boolean }>();
  for (const id of used) {
    const a = cfg.agents[id]; let where: string; let local = false;
    if (a.runtime === 'claude') where = 'Anthropic (Claude Code)'; else if (a.runtime === 'codex') where = 'OpenAI (Codex)';
    else if (a.runtime === 'opencode') {
      const provider = providerOf(a.model!); const type = connectedProviders(userOpenCodePaths()).find(p => p.id === provider)?.type;
      const hosts = measuredHosts(provider, type)?.code ?? [];
      local = LOCAL_PROVIDERS.includes(provider);
      where = `${nz(provider)} via OpenCode (${nz(a.model!)})${local ? '' : hosts.length ? t('cli.where.hosts', { hosts: hosts.join(', ') }) : t('cli.where.unmeasured')}`;
    }
    else { const p = cfg.providers![a.provider!]; const u = new URL(p.url); where = `${nz(u.host)} (${nz(p.model)})`; local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname); }
    dest.set(where, { ids: [...(dest.get(where)?.ids ?? []), id], local });
  }
  for (const id of workflowOf(cfg).reviewers) {
    const rt = cfg.agents[id]?.runtime;
    if (rt && rt !== 'api' && rt === cfg.agents.implementer?.runtime) out(t('cli.doctor.sameModel', { id: nz(id), rt, config: CONFIG }));
  }
  out(t('cli.doctor.codeGoesTo'));
  for (const [where, d] of dest) out(`  ${where} — ${d.ids.map(nz).join(', ')}${d.local ? ` (${t('cli.where.stays')})` : ''}`);
  out(t('cli.doctor.connectors', { list: conns.length ? conns.map(([id, c]) => t('cli.doctor.connector', { id: nz(id), host: nz(c.host), scope: nz(c.scope), read: c.read.length, write: c.write.length })).join('; ') : t('cli.doctor.none') }));
  if (cfg.memory.claudeMem.enabled) {
    const mem = new ClaudeMemMemory(); const lo = await mem.localOnlyCheck();
    out(t('cli.doctor.memory', { state: !lo.ok ? t('cli.doctor.memRefused', { reason: nz(lo.reason ?? '') }) : (await mem.available()) ? t('cli.doctor.memOk') : t('cli.doctor.memNoWorker') }));
  } else out(t('cli.doctor.memory', { state: t('cli.doctor.memOff') }));
  out();
  let refused = 0;
  for (const id of Object.keys(cfg.agents)) {
    const g = gate(cfg, h, id); printGate(id, cfg, g);
    const sk = resolveAgentSkills(cfg, repoStore(root), id);
    if ((cfg.agents[id].skills ?? []).length) out(t('cli.doctor.skills', { list: [...sk.loaded.map(x => `✔ ${nz(x.name)} (${nz(x.origin)}, ${x.treeHash.slice(7, 19)})`), ...sk.errors.map(e => `✖ ${nz(e)}`)].join(' · ') }));
    if (!isReady({ ...g, skillErrors: sk.errors })) refused++;
    out();
  }
  const n = Object.keys(cfg.agents).length;
  out(refused ? t('cli.doctor.verdictSome', { ok: n - refused, total: n }) : t('cli.doctor.verdictAll', { total: n }));
  return refused ? 1 : 0;
}

async function cmdCheck(agentId: string | undefined, json: boolean): Promise<number> {
  const h = await host(); const root = requireRepo(h); const cfg = loadConfig(root);
  if (!agentId || !cfg.agents[agentId]) { err(t('cli.check.usage', { agents: Object.keys(cfg.agents).join(', ') })); return 2; }
  const g = gate(cfg, h, agentId);
  const ok = g.ok && g.runtimeFound;
  if (json) out(jsonOut({ agent: agentId, ok, runtimeFound: g.runtimeFound, failures: g.failures, acceptedRisks: g.acceptedRisks, resolved: g.resolved, warnings: g.warnings }));
  else printGate(agentId, cfg, g);
  return ok ? 0 : 1;
}

/** Record an owner risk acceptance for the CURRENT failure of (agent, capability), in the control store. */
async function cmdAcceptRisk(agentId: string | undefined, capability: string | undefined, o: { reason?: string; expires?: string; as?: string }): Promise<number> {
  const h = await host(); const root = requireRepo(h); const cfg = loadConfig(root);
  if (!agentId || !Object.hasOwn(cfg.agents, agentId) || !capability) { err(t('cli.accept.usage')); return 2; }
  if (!o.reason?.trim() || !o.as?.trim() || !o.expires || !isRealDate(o.expires)) { err(t('cli.accept.required')); return 2; }
  if (o.expires < new Date().toISOString().slice(0, 10)) { err(t('cli.accept.past')); return 2; }
  if (cfg.agents[agentId].runtime === 'api') { err(t('cli.accept.apiJudge', { agent: agentId })); return 1; }
  const g = gate(cfg, h, agentId);
  const f = g.failures.find(x => x.capability === capability);
  if (!f) { err(t('cli.accept.notFailing', { capability: nz(capability), agent: nz(agentId) })); return 1; }
  const probe = h.runtimes[cfg.agents[agentId].runtime as 'claude' | 'codex']; // api judges returned above
  saveRiskAcceptance(repoStore(root), { agent: agentId, capability, reason: o.reason.trim(), expires: o.expires, approvedBy: o.as.trim(),
    runtimeVersion: probe?.version ?? 'not-installed', failureDigest: failureDigest(f.message), createdAt: new Date().toISOString() });
  out(t('cli.accept.done', { by: nz(o.as.trim()), until: nz(o.expires), agent: nz(agentId), capability: nz(capability) }));
  out(`  ${nz(f.message)}`);
  out(t('cli.accept.stops'));
  return 0;
}

/** `connect opencode` (spec §5.2): OpenCode's own sign-in, on Taskquoin's OpenCode directory; secrets are never printed. */
function cmdConnect(target: string | undefined, remove: boolean): number {
  if (target !== 'opencode') { err(t('cli.connect.usage')); return 2; }
  const dir = join(stateBase(), 'opencode');
  if (remove) { rmSync(dir, { recursive: true, force: true }); out(t('cli.connect.removed', { dir: nz(dir) })); return 0; }
  const bin = findOnPath('opencode', process.env.PATH ?? '');
  if (!bin) { err(t('cli.connect.notInstalled')); return 1; }
  const d = userOpenCodeDirs();
  out(t('cli.connect.intro', { dir: nz(dirname(d.config)) }));
  const r = spawnSync(bin, [...LOGIN_ARGS], { stdio: 'inherit', cwd: tmpdir(),
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? homedir(), LANG: process.env.LANG ?? 'C.UTF-8', ...connectEnv(d) } });
  const ps = connectedProviders(d);
  if (r.status !== 0) err(t('cli.connect.failed'));
  if (!ps.length) { err(t('cli.connect.none')); return 1; }
  out(t('cli.connect.connected', { list: ps.map(p => `${nz(p.id)} (${nz(p.type)})`).join(', ') }));
  return r.status === 0 ? 0 : 1;
}

async function cmdUninstall(purge: boolean): Promise<number> {
  const h = await host(); const root = requireRepo(h);
  const store = repoStore(root); const mf = join(store.root, 'manifest.json');
  if (!existsSync(mf)) { err(t('cli.uninstall.noManifest')); return 1; }
  // Validate before touching anything (Codex R3): known schema, only files Taskquoin can create, contained, no symlinks.
  const OWNED = new Set([CONFIG]);
  let manifest: { files: { path: string; sha256: string }[] };
  try {
    manifest = JSON.parse(readFileSync(mf, 'utf8'));
    if (!Array.isArray(manifest.files)) throw new Error(t('cli.uninstall.notList'));
    for (const f of manifest.files) {
      if (typeof f?.path !== 'string' || typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) throw new Error(t('cli.uninstall.malformed'));
      if (!OWNED.has(f.path)) throw new Error(t('cli.uninstall.notOwned', { path: nz(f.path) })); // the parameter, neutralised here
    }
    // A whole message (translated, or the JSON parser's quoting the file): the log profile, as for any thrown error.
  } catch (e) { err(t('cli.uninstall.invalid', { reason: nLog((e as Error).message) })); return 1; }
  let kept = 0;
  for (const f of manifest.files) {
    const p = join(root, f.path);
    if (!existsSync(p)) { out(t('cli.uninstall.absent', { path: nz(f.path) })); continue; }
    if (lstatSync(p).isSymbolicLink() || realpathSync(p) !== join(realpathSync(root), f.path)) { kept++; out(t('cli.uninstall.keptLink', { path: nz(f.path) })); continue; }
    if (sha(readFileSync(p)) === f.sha256) { rmSync(p); out(t('cli.uninstall.removed', { path: nz(f.path) })); }
    else { kept++; out(t('cli.uninstall.keptModified', { path: nz(f.path) })); }
  }
  if (purge) {
    if (!store.root.startsWith(stateBase() + '/')) { err(t('cli.uninstall.refusePurge', { path: nz(store.root), base: nz(stateBase()) })); return 1; }
    rmSync(store.root, { recursive: true, force: true }); out(t('cli.uninstall.purged', { path: nz(store.root) }));
  } else {
    if (!kept) rmSync(mf); // keep the manifest while a recorded file remains, so a later uninstall still knows it
    out(t('cli.uninstall.storeKept', { path: nz(store.root) }));
  }
  return kept ? 1 : 0;
}

/** Short commands are aligned in one column by display width; the long ones keep their description on the next line. */
export function help(): string {
  const col: [string, string][] = [
    ['  init', t('cli.help.init')], ['  doctor', t('cli.help.doctor')], ['  check <agent> [--json]', t('cli.help.check')], ['  version', t('cli.help.version')],
    ['  upgrade [auto|path|install] [--offline]', t('cli.help.upgrade')], ['  console', t('cli.help.console')], ['  run "<request>"', t('cli.help.run')], ['  status [<run>] [--json]', t('cli.help.status')],
    ['  show <run>', t('cli.help.showList')], ['  show <run> <artifact>', t('cli.help.showOne')], ['  resume <run>', t('cli.help.resume')],
    ['  skills list', t('cli.help.skillsList')], ['  skills audit <dir>', t('cli.help.skillsAudit')],
    ['  connect opencode [--remove]', t('cli.help.connect')], ['  setup [--remove]', t('cli.help.setup2')], ['  uninstall [--purge-state]', t('cli.help.uninstall')],
  ];
  const L = alignColumns(col); const at = (cmd: string) => L[col.findIndex(([c]) => c === `  ${cmd}`)]!;
  const wrap = ' '.repeat(L[0]!.length - col[0]![1].length);
  return [
    t('cli.help.title'), '',
    t('cli.help.setup'), at('init'), at('doctor'), at('upgrade [auto|path|install] [--offline]'), at('check <agent> [--json]'),
    '  accept-risk <agent> <capability> --reason "<why>" --expires YYYY-MM-DD --as <name>', wrap + t('cli.help.acceptRisk'), at('version'),
    t('cli.help.workflow'), at('console'), at('run "<request>"'), at('status [<run>] [--json]'), at('show <run>'), at('show <run> <artifact>'),
    '  approve <run> <plan|commit> --expect <hash> --as <name>', wrap + t('cli.help.approve'), at('resume <run>'),
    t('cli.help.skills'), at('skills list'), at('skills audit <dir>'),
    `  skills import <dir> --source "<owner/repo@commit>"   ${t('cli.help.skillsImport')}`,
    `  skills approve <name> --as <name> [--accept-findings]   ${t('cli.help.skillsApprove')}`,
    '  skills revoke <name> --as <name>',
    t('cli.help.shortcut'), at('connect opencode [--remove]'), at('setup [--remove]'),
    t('cli.help.removal'), at('uninstall [--purge-state]'), '',
    t('cli.help.exit'),
  ].join('\n');
}

async function ctx(): Promise<{ c: CliContext; git: GitWorkspace }> {
  const h = await host(); const root = requireRepo(h); const cfg = loadConfig(root);
  if (!h.git) throw new Error(t('cli.gitMissing'));
  const store = repoStore(root);
  const c: CliContext = { cfg, h, root, store, gate: (id) => gate(cfg, c.h, id), hookEntry: HOOK_ENTRY, out, err };
  return { c, git: new GitWorkspace({ gitBin: h.git, cwd: root, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? homedir() }, scratchDir: ensureTrustedDir(join(store.root, 'scratch')) }) };
}

/** One line from stdin (a terminal or a pipe, like the console's lineReader, ADR-0015); closed input → undefined (cancel). */
function askStdin(question: string): Promise<string | undefined> {
  process.stdout.write(question);
  return new Promise((res) => {
    const rl = createInterface({ input: process.stdin, terminal: false });
    let got = false;
    rl.once('line', (l) => { got = true; res(l); rl.close(); });
    rl.once('close', () => { if (!got) res(undefined); });
  });
}

/** Starts `bin` with the user's environment and terminal; never throws: a binary that cannot start is exit code 127. */
function runInherit(bin: string, args: string[], cwd: string): Promise<number> {
  return new Promise((res) => {
    let child;
    try { child = spawn(bin, args, { cwd, stdio: 'inherit', env: process.env }); } catch (e) { err(t('upgrade.runFailed', { bin: nz(bin), reason: nz((e as Error).message) })); res(127); return; }
    child.once('error', (e) => { err(t('upgrade.runFailed', { bin: nz(bin), reason: nz(e.message) })); res(127); });
    child.once('close', (code) => res(code ?? 1));
  });
}

/** `taskquoin upgrade` and `/upgrade`: the registry is read only here, never when `offline`. */
async function cmdUpgradeWith(arg: string | undefined, o: { h: HostReport; offline: boolean; ask: UpgradeEnv['ask']; surface: UpgradeEnv['surface']; run?: UpgradeEnv['run'] }): Promise<{ code: number; h: HostReport }> {
  const measured = { claude: loadMatrix('claude').runtimeVersion, codex: loadMatrix('codex').runtimeVersion, opencode: loadMatrix('opencode').runtimeVersion };
  const e: UpgradeEnv = {
    h: o.h, measured, selection: loadPreferences(stateBase()).runtimeSelection?.claude ?? 'auto', packaged: LAYOUT.packaged, version: LAYOUT.version,
    offline: o.offline, home: absoluteHome(), surface: o.surface, out, err, ask: o.ask,
    save: (sel) => savePreferences(stateBase(), { runtimeSelection: { ...loadPreferences(stateBase()).runtimeSelection, claude: sel } }),
    reprobe: () => host(), latest: () => fetchLatest(), run: o.run ?? runInherit,
  };
  const code = await cmdUpgrade(arg || undefined, e);
  return { code, h: e.h };
}
const isOffline = (flag?: boolean) => !!flag || process.env.TASKQUOIN_OFFLINE === '1';

/** `taskquoin console`: the same commands behind `/…` lines; approvals need the hash retyped (see console.ts). */
async function cmdConsole(offline: boolean): Promise<number> {
  const { c, git } = await ctx();
  const tty = !!process.stdin.isTTY;
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: tty, ...(tty ? { completer: completeCommand } : {}) });
  const color = !!process.stdout.isTTY && !process.env.NO_COLOR;
  rl.on('SIGINT', () => out('\n' + t('cli.console.sigint')));
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
    if (now !== startDigest) { err(t('cli.console.configChanged')); return 1; }
    return f();
  };
  const cmds: ConsoleCommands = {
    run: async (r) => { let runId: string | undefined; const code = await guard(() => cmdRun(c, git, r, (id) => { runId = id; })); return { code, ...(runId ? { runId } : {}) }; },
    status: (r) => guard(() => cmdStatus(c, r)), show: (r, a) => guard(() => cmdShow(c, r, a)),
    approve: (r, g, e, as) => guard(() => cmdApprove(c, git, r, g, e, as)), resume: (r) => guard(() => cmdResume(c, git, r)),
    doctor: () => guard(() => cmdDoctor()), skills: () => guard(() => cmdSkills(c.store, 'list', undefined, {}, out, err)),
    agents: () => guard(() => {
      for (const [id, a] of Object.entries(c.cfg.agents)) out(`${nz(id).padEnd(12)} ${a.runtime.padEnd(7)} ${Object.keys(a.capabilities).join(', ')}${a.skills?.length ? t('cli.console.agentSkills', { list: a.skills.map(nz).join(', ') }) : ''}`);
      return 0;
    }),
    pending: (r) => { const s = loadRunState<RunState>(c.store, r); const p = s && pendingApproval(s); return p ? { gate: p.node === 'approve-plan' ? 'plan' : 'commit', binding: p.binding } : undefined; },
    runs: () => listRuns(c.store),
    // The installer gets the terminal (Ctrl+C stops it); --offline given to `taskquoin console` holds for /upgrade.
    upgrade: async (a, ask) => {
      const r = await cmdUpgradeWith(a, { h: c.h, offline, ask, surface: 'console',
        run: (bin, args, cwd) => withTerminalReleased({ rl, stdin: process.stdin, signals: process }, () => runInherit(bin, args, cwd)) });
      c.h = await host(); return r.code;
    },
  };
  // The squad as it really is: each agent's gate verdict, and Taskquoin's own sandboxed Verify as the tester.
  // Computed while the logo animation plays (terminal with colours only; TASKQUOIN_NO_ANIMATION=1 turns it off).
  const animate = tty && color && !process.env.TASKQUOIN_NO_ANIMATION;
  const playing = animate ? animateLogo((s) => process.stdout.write(s), (ms) => new Promise(r => setTimeout(r, ms))) : Promise.resolve();
  const squad = squadOf(c.cfg.agents, (id) => ({ ...gate(c.cfg, c.h, id), skillErrors: resolveAgentSkills(c.cfg, repoStore(c.root), id).errors }), await sandboxedToolAvailable());
  await playing;
  try { return await runConsole(io, cmds, renderBanner(squad, { color, logo: !animate, notices: runtimeNotices(c.h, loadMatrix('claude').runtimeVersion) })); } finally { rl.close(); }
}

/** Source checkouts only: an npm install has no launcher to link — npm already put `taskquoin` on the PATH. */
const shortcutEnv = (launcher: string): ShortcutEnv => ({ home: process.env.HOME ?? homedir(), launcher: realpathSync(launcher), pathEnv: process.env.PATH ?? '', stateDir: stateBase() });

async function main(): Promise<number> {
  setLanguage(resolveLanguage(process.env, loadPreferences(stateBase())));
  let parsed;
  try {
    parsed = parseArgs({ allowPositionals: true, options: { json: { type: 'boolean' }, 'purge-state': { type: 'boolean' },
      reason: { type: 'string' }, expires: { type: 'string' }, as: { type: 'string' }, help: { type: 'boolean', short: 'h' },
      source: { type: 'string' }, 'accept-findings': { type: 'boolean' }, expect: { type: 'string' }, remove: { type: 'boolean' }, offline: { type: 'boolean' } } });
  } catch (e) { err(`taskquoin: ${nz((e as Error).message)}\n${help()}`); return 2; } // i18n-ok: node's parseArgs message (usage errors exit 2, Codex R4)
  const { positionals, values } = parsed;
  if (values.help) { out(help()); return 0; }
  // First launch in a terminal: put `taskquoin` on the PATH by itself (owner's request), unless removed or disabled.
  if (LAYOUT.launcher && process.stdin.isTTY && process.stdout.isTTY && !process.env.TASKQUOIN_NO_SETUP && positionals[0] !== 'setup') {
    try { const r = installShortcut(shortcutEnv(LAYOUT.launcher), { auto: true }); if (r.status === 'installed') err(`✔ ${r.message}`); } catch { /* never blocks a command */ }
  }
  // Like `claude` or `codex`: `taskquoin` alone opens the console in a terminal (scripts still get the help).
  if (!positionals.length) { if (process.stdin.isTTY && process.stdout.isTTY) return cmdConsole(isOffline(values.offline)); out(help()); return 0; }
  const [cmd, arg, arg2] = positionals;
  switch (cmd) {
    case 'help': out(help()); return 0;
    case 'version': out(`taskquoin ${LAYOUT.version}`); return 0;
    case 'init': return cmdInit();
    case 'doctor': return cmdDoctor();
    case 'upgrade': return (await cmdUpgradeWith(arg, { h: await host(), offline: isOffline(values.offline), ask: askStdin, surface: 'cli' })).code;
    case 'check': return cmdCheck(arg, !!values.json);
    case 'console': return cmdConsole(isOffline(values.offline));
    case 'connect': return cmdConnect(arg, !!values.remove);
    case 'setup': {
      if (!LAYOUT.launcher) { out(t('cli.setup.npm')); return 0; }
      if (values.remove) { const r = removeShortcut(shortcutEnv(LAYOUT.launcher)); out(r.message); return 0; }
      const r = installShortcut(shortcutEnv(LAYOUT.launcher), { auto: false }); (r.status === 'conflict' ? err : out)(r.message); return r.status === 'conflict' ? 1 : 0;
    }
    case 'run': { const { c, git } = await ctx(); return cmdRun(c, git, arg); }
    case 'approve': { const { c, git } = await ctx(); return cmdApprove(c, git, arg, arg2, values.expect, values.as); }
    case 'resume': { const { c, git } = await ctx(); return cmdResume(c, git, arg); }
    case 'status': { const { c } = await ctx(); return cmdStatus(c, arg, !!values.json); }
    case 'show': { const { c } = await ctx(); return cmdShow(c, arg, arg2); }
    case 'skills': { const h = await host(); const root = requireRepo(h); return cmdSkills(repoStore(root), arg, arg2, { source: values.source, as: values.as, acceptFindings: !!values['accept-findings'] }, out, err); }
    case 'accept-risk': return cmdAcceptRisk(arg, arg2, { reason: values.reason, expires: values.expires, as: values.as });
    case 'uninstall': return cmdUninstall(!!values['purge-state']);
    default: err(t('cli.usage')); return 2;
  }
}

/** Exit only once stdout/stderr have drained: process.exit() drops whatever a pipe has not taken yet (pilot 2: `show … | grep` lost the tail). */
const exitAfterFlush = (code: number) => { process.exitCode = code; process.stdout.write('', () => process.stderr.write('', () => process.exit(code))); };
// A whole message from outside (any thrown error): the log profile, like cmdApprove / cmdResume, so a translated
// message keeps its ZWNJ/ZWJ while controls and bidi are still marked.
main().then(exitAfterFlush, e => { err(`taskquoin: ${nLog((e as Error).message)}`); exitAfterFlush(1); }); // i18n-ok: the message comes from the thrown error
