import YAML from 'yaml';
import { CAPABILITIES, isCapability, type Capability, type CapabilityGrants, type RuntimeId } from '@taskquoin/domain';

export type Stack = 'node' | 'php' | 'python' | 'go' | 'java-maven' | 'java-gradle' | 'unknown';
export type RuntimeName = RuntimeId;
export interface AgentConfig { runtime: RuntimeName; description: string; prompt: string; capabilities: CapabilityGrants; model?: string; maxTurns?: number;
  /** `runtime: api` only: the id of the provider (in `providers`) this judge is reached through. */
  provider?: string;
  /** First-party or owner-approved skills injected into this agent's instructions (same text for every runtime). */
  skills?: string[] }
/** ADR-0012: one remote service, one scope, explicit operations, credential by reference. */
export interface ConnectorConfig { host: string; scope: string; read: string[]; write: string[]; credentialRef: string }
/**
 * A provider allowed to receive this project's code (multi-LLM project A): an OpenAI-compatible chat API. Listing it
 * here IS the project's consent. The key is a reference (`env:NAME`), never the key itself.
 */
export interface ProviderConfig { url: string; model: string; key?: string; maxOutputTokens: number; timeoutSeconds: number;
  tokenField: 'max_tokens' | 'max_completion_tokens'; maxInputChars?: number }
export interface WorkflowConfig { challengers: string[]; reviewers: string[] }
export interface TaskquoinConfig {
  version: 1;
  stack: Stack;
  agents: Record<string, AgentConfig>;
  /** Additional mandatory restrictions; the built-in floor always applies on top (cannot be removed here). */
  policy: { mandatory: Capability[] };
  connectors: Record<string, ConnectorConfig>;
  memory: { claudeMem: { enabled: boolean } };
  /**
   * ADR-0014: Verify runs in a clean room; only the stack's dependency directories (see `inheritGlobs`) and these extra
   * ignored paths are carried over from the working directory, read-only, and frozen for agents during the run.
   */
  verify?: { inherit: string[]; command?: string };
  providers?: Record<string, ProviderConfig>;
  /** Who challenges the plan and who reviews the diff (every reviewer must APPROVE). Default: the `challenger` agent. */
  workflow?: WorkflowConfig;
}

/** The judges of a project: `workflow`, or today's single `challenger` for both steps. */
export function workflowOf(c: TaskquoinConfig): WorkflowConfig { return c.workflow ?? { challengers: ['challenger'], reviewers: ['challenger'] }; }
/** `DEEPSEEK_API_KEY` for `key: env:DEEPSEEK_API_KEY`; undefined when the provider needs no key (e.g. local Ollama). */
export function keyEnvName(p: ProviderConfig): string | undefined { return p.key?.slice('env:'.length); }

const STACKS: readonly Stack[] = ['node', 'php', 'python', 'go', 'java-maven', 'java-gradle', 'unknown'];
/** First entry = the full suite (Taskquoin's Verify runs it); the others let the agent run ONE test (pilot 1: RED/GREEN
 * could not be observed through the full, truncated output). */
const TEST_CMDS: Record<Stack, string[]> = {
  node: ['npm test', 'npm test -- *', 'node --test *'], php: ['vendor/bin/phpunit', 'vendor/bin/phpunit *'], python: ['pytest', 'pytest *'],
  go: ['go test ./...', 'go test *'], 'java-maven': ['mvn -q test', 'mvn -q test *'], 'java-gradle': ['./gradlew test', './gradlew test *'], unknown: [],
};

/** Ignored dependency directories carried into Verify per stack (go/maven/gradle caches live in HOME, hidden anyway). */
const INHERIT_DEFAULTS: Record<Stack, string[]> = {
  node: ['**/node_modules'], php: ['vendor'], python: ['.venv', 'venv'], go: [], 'java-maven': [], 'java-gradle': [], unknown: [],
};
/** Effective inherited paths: the stack's defaults plus the owner's `verify.inherit`. */
/** The command Verify (and the RED proof) runs: `verify.command`, else the implementer's first `shell.run` (today's configs). */
export function testCommand(c: TaskquoinConfig): string | undefined { return c.verify?.command ?? c.agents.implementer?.capabilities['shell.run']?.[0]; }
/** OpenCode agents (project B, step 1) read and write files of the repository — nothing else. */
export const OPENCODE_CAPABILITIES: readonly Capability[] = ['fs.read', 'fs.write'];
/** `openai/gpt-6-astra` → `openai` (OpenCode's model ids are `<provider>/<model>`; the model part may contain `/`). */
export function providerOf(model: string): string { return model.slice(0, model.indexOf('/')); }
const OPENCODE_MODEL_RE = /^[a-z0-9][a-z0-9._-]*\/\S+$/;

export function inheritGlobs(c: TaskquoinConfig): string[] { return [...new Set([...INHERIT_DEFAULTS[c.stack], ...(c.verify?.inherit ?? [])])]; }

export const DEFAULT_MANDATORY: readonly Capability[] = ['fs.write', 'net.egress', 'config.modify', 'connector.write', 'vcs.commit', 'vcs.push'];

/** Which agent CLIs are installed (from the host probe). Default: both, as before. */
export interface InstalledTools { claude: boolean; codex: boolean; opencode?: boolean }
/** Suggested by init for an all-OpenCode project: a model a ChatGPT sign-in accepts (measured — opencode-interface-1.19.5.md). */
export const OPENCODE_DEFAULT_MODEL = 'openai/gpt-6-astra';

export function defaultConfig(stack: Stack, tools: InstalledTools = { claude: true, codex: true }): TaskquoinConfig {
  const tests = TEST_CMDS[stack];
  // Claude Code only: the challenger is a read-only Claude agent (the same model family as the implementer — doctor says so).
  const challengerRuntime: RuntimeName = tools.claude && !tools.codex ? 'claude' : 'codex';
  const c: TaskquoinConfig = {
    version: 1,
    stack,
    agents: {
      planner: {
        runtime: 'claude',
        description: 'Read-only planner: turns a request into a minimal, test-first implementation plan.',
        prompt: 'You plan; you never modify files. Read the repository, then produce the plan requested.',
        capabilities: { 'fs.read': ['**'] },
        maxTurns: 30,
        skills: ['planning-contract'],
      },
      implementer: {
        runtime: 'claude',
        description: 'Implements an approved task with strict TDD (RED → GREEN → REFACTOR).',
        prompt: 'You implement exactly the approved task. Write a failing test first, make it pass with the simplest change, then refactor. Never commit: Taskquoin verifies and commits.',
        // fs.write "**": per-glob scope is not enforceable for subprocesses (measured R2.1); protected config stays denied.
        capabilities: { 'fs.read': ['**'], 'fs.write': ['**'], ...(tests.length ? { 'shell.run': tests } : {}) },
        maxTurns: 40,
        skills: ['tdd'],
      },
      challenger: {
        runtime: challengerRuntime,
        description: 'Independent, read-only adversarial reviewer of plans and diffs.',
        prompt: 'You are an independent reviewer. Challenge the plan or diff: correctness, security, missing tests, over-engineering. Report blocking and non-blocking findings with file:line. Do not modify files.',
        capabilities: { 'fs.read': ['**'] },
        skills: ['code-review'],
      },
    },
    policy: { mandatory: [...DEFAULT_MANDATORY] },
    connectors: {},
    memory: { claudeMem: { enabled: true } },
  };
  // OpenCode only (project B step 1): every role on OpenCode, the implementer without commands — Taskquoin runs the tests.
  if (tools.claude || !tools.opencode) return c;
  for (const a of Object.values(c.agents)) { a.runtime = 'opencode'; a.model = OPENCODE_DEFAULT_MODEL; delete a.capabilities['shell.run']; }
  return { ...c, ...(tests[0] ? { verify: { inherit: [], command: tests[0] } } : {}) };
}

/** Providers `init` can suggest when their key variable is present (models are examples: check them at the provider). */
const KNOWN_PROVIDERS: { env: string; id: string; url: string; model: string; tokenField?: 'max_completion_tokens' }[] = [
  { env: 'DEEPSEEK_API_KEY', id: 'deepseek', url: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { env: 'MISTRAL_API_KEY', id: 'mistral', url: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' },
  { env: 'OPENROUTER_API_KEY', id: 'openrouter', url: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat' },
  { env: 'GEMINI_API_KEY', id: 'gemini', url: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  { env: 'OPENAI_API_KEY', id: 'openai', url: 'https://api.openai.com/v1', model: 'gpt-5', tokenField: 'max_completion_tokens' },
  { env: 'ANTHROPIC_API_KEY', id: 'anthropic', url: 'https://api.anthropic.com/v1', model: 'claude-sonnet-5-5' },
];
/** The environment variables `init` looks at (their values are never read into the file). */
export const KNOWN_KEY_VARS: readonly string[] = KNOWN_PROVIDERS.map(p => p.env);
export interface DetectedAIs { env: string[]; ollamaModels: string[] }

const commentOut = (yaml: string, indent = '') => yaml.trimEnd().split('\n').map(l => `${indent}# ${l}`).join('\n');

/**
 * taskquoin.yaml text. With `detected` AIs, adds them as COMMENTED suggestions (providers, a `security` judge inside
 * `agents`, a `workflow`): uncommenting them is the project's consent to send its code there (multi-LLM A).
 */
export function renderConfig(c: TaskquoinConfig, detected?: DetectedAIs): string {
  const text = '# Taskquoin project configuration — see docs/architecture.md. Protected: agents can never edit this file.\n' +
    YAML.stringify(c, { lineWidth: 0 });
  const remote = KNOWN_PROVIDERS.filter(p => detected?.env.includes(p.env));
  const local = detected?.ollamaModels[0];
  if (!remote.length && !local) return text;
  const providers: Record<string, Record<string, unknown>> = {};
  // Reasoning models spend output tokens on reasoning first: give them room, or the verdict is cut (final review).
  for (const p of remote) providers[p.id] = { url: p.url, model: p.model, key: `env:${p.env}`, ...(p.tokenField ? { tokenField: p.tokenField, maxOutputTokens: 16000 } : {}) };
  if (local) providers.local = { url: 'http://localhost:11434/v1', model: local };
  const judge = { security: { runtime: 'api', provider: remote[0]?.id ?? 'local', description: 'Revue de sécurité indépendante du diff',
    prompt: 'You are an independent security reviewer of the diff. Report every security defect with file:line and a fix.', capabilities: {}, skills: ['security-review'] } };
  const agentBlock = `  ## ── juge de sécurité suggéré : décommentez-le AVEC providers et workflow (en bas du fichier)\n${commentOut(YAML.stringify(judge, { lineWidth: 0 }), '  ')}`;
  const lines = text.split('\n'); const agentsAt = lines.indexOf('agents:');
  const next = lines.findIndex((l, i) => i > agentsAt && /^\S/.test(l));
  lines.splice(next, 0, agentBlock);
  // Notes start with "## ": an editor's comment toggle on the whole block leaves them comments (final review).
  const tail = ['## ── IA détectées sur cette machine. Les décommenter, c\'est accepter de leur envoyer le code de ce projet.',
    '## ── Les noms de modèles sont des exemples : vérifiez-les chez le fournisseur. Les clés restent dans votre environnement.',
    commentOut(YAML.stringify({ providers }, { lineWidth: 0 })), commentOut(YAML.stringify({ workflow: { challengers: ['challenger'], reviewers: ['challenger', 'security'] } }, { lineWidth: 0 }))];
  return lines.join('\n').replace(/\n*$/, '\n') + tail.join('\n') + '\n';
}

// ── validation ────────────────────────────────────────────────────────────────────────────────────────────────────
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
function fail(path: string, msg: string): never { throw new Error(`config${path}: ${msg}`); }
function keys(o: Record<string, unknown>, path: string, allowed: string[], required: string[] = allowed) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${path}.${k}`, `unknown key (allowed: ${allowed.join(', ')})`);
  for (const k of required) if (!(k in o)) fail(`${path}.${k}`, 'required');
}
const str = (x: unknown, path: string, nonEmpty = true): string => { if (typeof x !== 'string' || (nonEmpty && !x.trim())) fail(path, 'expected a non-empty string'); return x; };
const strs = (x: unknown, path: string): string[] => { if (!Array.isArray(x) || x.some(v => typeof v !== 'string')) fail(path, 'expected a list of strings'); return x as string[]; };
const ID_RE = /^[a-z][a-z0-9-]{0,47}$/;
const HOST_RE = /^(?=.{1,253}$)[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;

function agent(raw: unknown, path: string): AgentConfig {
  if (!isObj(raw)) fail(path, 'expected a mapping');
  keys(raw, path, ['runtime', 'description', 'prompt', 'capabilities', 'model', 'maxTurns', 'skills', 'provider'], ['runtime', 'description', 'prompt', 'capabilities']);
  if (raw.skills !== undefined && strs(raw.skills, `${path}.skills`).some(n => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n))) fail(`${path}.skills`, 'skill names are lowercase letters, digits and single hyphens');
  if (raw.runtime !== 'claude' && raw.runtime !== 'codex' && raw.runtime !== 'api' && raw.runtime !== 'opencode') fail(`${path}.runtime`, `expected claude|codex|api|opencode, got ${JSON.stringify(raw.runtime)}`);
  if (raw.runtime === 'opencode' && (typeof raw.model !== 'string' || !OPENCODE_MODEL_RE.test(raw.model))) fail(`${path}.model`, 'required for runtime opencode, as <provider>/<model> (e.g. openai/gpt-6-astra)');
  if (!isObj(raw.capabilities)) fail(`${path}.capabilities`, 'expected a mapping');
  if (raw.runtime === 'api') {
    // A text-only judge: text in, verdict out — it has no capability at all, and no agent loop to bound.
    if (raw.provider === undefined) fail(`${path}.provider`, 'required for runtime api (an id from providers)');
    if (Object.keys(raw.capabilities).length) fail(`${path}.capabilities`, 'an api judge has no capability (text in, text out): use {}');
    if (raw.maxTurns !== undefined) fail(`${path}.maxTurns`, 'not applicable to runtime api (one request, one answer)');
  } else if (raw.provider !== undefined) fail(`${path}.provider`, 'only for runtime api');
  const caps: CapabilityGrants = {};
  for (const [k, v] of Object.entries(raw.capabilities)) {
    if (!isCapability(k)) fail(`${path}.capabilities.${k}`, `unknown capability (known: ${CAPABILITIES.join(', ')})`);
    caps[k] = strs(v, `${path}.capabilities.${k}`);
    if (raw.runtime === 'opencode' && !OPENCODE_CAPABILITIES.includes(k) && caps[k].length)
      fail(`${path}.capabilities.${k}`, k === 'shell.run' ? 'no commands for OpenCode in this version: Taskquoin runs your tests with verify.command' : 'not available to OpenCode in this version (only fs.read and fs.write)');
  }
  if (raw.maxTurns !== undefined && (!Number.isInteger(raw.maxTurns) || (raw.maxTurns as number) < 1 || (raw.maxTurns as number) > 200)) fail(`${path}.maxTurns`, 'expected an integer 1..200');
  return { runtime: raw.runtime, description: str(raw.description, `${path}.description`), prompt: str(raw.prompt, `${path}.prompt`), capabilities: caps,
    ...(raw.model !== undefined ? { model: str(raw.model, `${path}.model`) } : {}), ...(raw.maxTurns !== undefined ? { maxTurns: raw.maxTurns as number } : {}),
    ...(raw.skills !== undefined ? { skills: raw.skills as string[] } : {}), ...(raw.provider !== undefined ? { provider: str(raw.provider, `${path}.provider`) } : {}) };
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const ENV_REF_RE = /^env:[A-Z_][A-Z0-9_]*$/;
function provider(raw: unknown, path: string): ProviderConfig {
  if (!isObj(raw)) fail(path, 'expected a mapping');
  keys(raw, path, ['url', 'model', 'key', 'maxOutputTokens', 'timeoutSeconds', 'tokenField', 'maxInputChars'], ['url', 'model']);
  const u = str(raw.url, `${path}.url`);
  let url: URL; try { url = new URL(u); } catch { fail(`${path}.url`, 'expected an absolute URL'); }
  if (url.username || url.password) fail(`${path}.url`, 'no credentials in the URL (use key: env:NAME)');
  if (u.includes('?') || u.includes('#')) fail(`${path}.url`, 'no query string or fragment');
  if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname)) fail(`${path}.url`, 'https is required (http only for localhost, 127.0.0.1, [::1])');
  if (url.protocol !== 'https:' && url.protocol !== 'http:') fail(`${path}.url`, 'expected https://');
  if (raw.key !== undefined && (typeof raw.key !== 'string' || !ENV_REF_RE.test(raw.key))) fail(`${path}.key`, 'must reference an environment variable (env:NAME), never contain the key');
  const int = (k: string, min: number, max: number, dflt?: number) => {
    if (raw[k] === undefined) return dflt;
    if (!Number.isInteger(raw[k]) || (raw[k] as number) < min || (raw[k] as number) > max) fail(`${path}.${k}`, `expected an integer ${min}..${max}`);
    return raw[k] as number;
  };
  const tokenField = raw.tokenField ?? 'max_tokens';
  if (tokenField !== 'max_tokens' && tokenField !== 'max_completion_tokens') fail(`${path}.tokenField`, 'expected max_tokens|max_completion_tokens');
  const maxInputChars = int('maxInputChars', 1000, 50_000_000);
  return { url: u, model: str(raw.model, `${path}.model`), ...(raw.key !== undefined ? { key: raw.key as string } : {}),
    maxOutputTokens: int('maxOutputTokens', 1, 1_000_000, 4000)!, timeoutSeconds: int('timeoutSeconds', 1, 3600, 300)!, tokenField,
    ...(maxInputChars !== undefined ? { maxInputChars } : {}) };
}

/** Judges: listed agents exist, no duplicate, never empty (someone always challenges and reviews). */
function workflowSection(raw: unknown, agents: Record<string, AgentConfig>): WorkflowConfig {
  if (!isObj(raw)) fail('.workflow', 'expected a mapping');
  keys(raw, '.workflow', ['challengers', 'reviewers']);
  const list = (k: 'challengers' | 'reviewers') => {
    const ids = strs(raw[k], `.workflow.${k}`);
    if (!ids.length) fail(`.workflow.${k}`, 'at least one agent');
    ids.forEach((id, i) => {
      if (ids.indexOf(id) !== i) fail(`.workflow.${k}`, `duplicate agent "${id}"`);
      if (!Object.hasOwn(agents, id)) fail(`.workflow.${k}`, `unknown agent "${id}"`);
    });
    return ids;
  };
  return { challengers: list('challengers'), reviewers: list('reviewers') };
}

function connector(raw: unknown, path: string): ConnectorConfig {
  if (!isObj(raw)) fail(path, 'expected a mapping');
  keys(raw, path, ['host', 'scope', 'read', 'write', 'credentialRef']);
  const host = str(raw.host, `${path}.host`); if (!HOST_RE.test(host)) fail(`${path}.host`, 'expected a plain hostname');
  const credentialRef = str(raw.credentialRef, `${path}.credentialRef`);
  if (!/^(env|keychain):[A-Za-z0-9_.-]+$/.test(credentialRef)) fail(`${path}.credentialRef`, 'must reference a secret (env:NAME or keychain:NAME), never contain it');
  return { host, scope: str(raw.scope, `${path}.scope`), read: strs(raw.read, `${path}.read`), write: strs(raw.write, `${path}.write`), credentialRef };
}

/** Parse and validate taskquoin.yaml. Strict and fail-closed. */
export const MAX_CONFIG_BYTES = 256 * 1024;

export function parseConfig(text: string): TaskquoinConfig {
  if (Buffer.byteLength(text) > MAX_CONFIG_BYTES) fail('', `file too large (> ${MAX_CONFIG_BYTES} bytes)`);
  const doc = YAML.parseDocument(text, { uniqueKeys: true, prettyErrors: false });
  if (doc.errors.length) fail('', `invalid YAML: ${doc.errors[0].message}`);
  let alias = false; let anchor = false;
  YAML.visit(doc, { Alias() { alias = true; return YAML.visit.BREAK; }, Node(_k, n) { if ((n as { anchor?: string }).anchor) { anchor = true; return YAML.visit.BREAK; } return undefined; } });
  if (alias || anchor) fail('', 'YAML aliases/anchors are not allowed');
  const raw = doc.toJS({ maxAliasCount: 0 }) as unknown;
  if (!isObj(raw)) fail('', 'expected a mapping');
  if (raw.version !== 1) fail('.version', `expected 1, got ${JSON.stringify(raw.version)}`);
  keys(raw, '', ['version', 'stack', 'agents', 'policy', 'connectors', 'memory', 'verify', 'providers', 'workflow'], ['version', 'stack', 'agents', 'policy', 'connectors', 'memory']);
  if (!STACKS.includes(raw.stack as Stack)) fail('.stack', `expected one of ${STACKS.join(', ')}`);
  if (!isObj(raw.agents) || Object.keys(raw.agents).length === 0) fail('.agents', 'expected at least one agent');
  const agents: Record<string, AgentConfig> = {};
  for (const [id, a] of Object.entries(raw.agents)) { if (!ID_RE.test(id)) fail(`.agents.${id}`, 'invalid agent id'); Object.defineProperty(agents, id, { value: agent(a, `.agents.${id}`), enumerable: true, writable: true, configurable: true }); }
  if (!isObj(raw.policy)) fail('.policy', 'expected a mapping');
  if (Object.hasOwn(raw.policy, 'exceptions')) fail('.policy.exceptions', 'risk acceptances are not read from the repository; record them with "taskquoin accept-risk" (stored in the control store, ADR-0012/Codex R3)');
  keys(raw.policy, '.policy', ['mandatory']);
  const mandatory = strs(raw.policy.mandatory, '.policy.mandatory').map((c, i) => { if (!isCapability(c)) fail(`.policy.mandatory[${i}]`, `unknown capability ${c}`); return c; });
  if (!isObj(raw.connectors)) fail('.connectors', 'expected a mapping');
  const connectors: Record<string, ConnectorConfig> = {};
  for (const [id, c] of Object.entries(raw.connectors)) { if (!ID_RE.test(id)) fail(`.connectors.${id}`, 'invalid connector id'); connectors[id] = connector(c, `.connectors.${id}`); }
  if (!isObj(raw.memory) || !isObj(raw.memory.claudeMem) || typeof raw.memory.claudeMem.enabled !== 'boolean') fail('.memory.claudeMem.enabled', 'expected a boolean');
  keys(raw.memory, '.memory', ['claudeMem']); keys(raw.memory.claudeMem, '.memory.claudeMem', ['enabled']);
  let verify: TaskquoinConfig['verify'];
  if (raw.verify !== undefined) {
    if (!isObj(raw.verify)) fail('.verify', 'expected a mapping');
    keys(raw.verify, '.verify', ['inherit', 'command'], []);
    verify = { inherit: raw.verify.inherit === undefined ? [] : strs(raw.verify.inherit, '.verify.inherit').map((g, i) => inheritEntry(g, `.verify.inherit[${i}]`)),
      ...(raw.verify.command !== undefined ? { command: str(raw.verify.command, '.verify.command') } : {}) };
  }
  let providers: Record<string, ProviderConfig> | undefined;
  if (raw.providers !== undefined) {
    if (!isObj(raw.providers)) fail('.providers', 'expected a mapping');
    providers = {};
    for (const [id, p] of Object.entries(raw.providers)) { if (!ID_RE.test(id)) fail(`.providers.${id}`, 'invalid provider id'); providers[id] = provider(p, `.providers.${id}`); }
  }
  for (const [id, a] of Object.entries(agents)) {
    if (a.runtime !== 'api') continue;
    if (id === 'planner' || id === 'implementer') fail(`.agents.${id}.runtime`, 'the planner reads the repository and the implementer writes code: they need claude|codex|opencode (an api judge has no tools)');
    if (!providers || !Object.hasOwn(providers, a.provider!)) fail(`.agents.${id}.provider`, `unknown provider "${a.provider}" (list it under providers)`);
  }
  if (agents.implementer?.runtime === 'opencode' && !verify?.command) fail('.verify.command', 'required — the implementer runs no command, Taskquoin needs your test command (e.g. npm test)');
  const workflow = raw.workflow !== undefined ? workflowSection(raw.workflow, agents) : undefined;
  return { version: 1, stack: raw.stack as Stack, agents, policy: { mandatory }, connectors, memory: { claudeMem: { enabled: raw.memory.claudeMem.enabled } },
    ...(verify ? { verify } : {}), ...(providers ? { providers } : {}), ...(workflow ? { workflow } : {}) };
}

/** A relative path or glob naming ignored files to carry into Verify — never everything, never outside, never .git. */
function inheritEntry(g: string, path: string): string {
  const segs = g.split('/');
  if (!g || g.startsWith('/') || segs.includes('..') || segs.includes('')) fail(path, 'expected a relative path inside the repository');
  if (segs[0] === '.git') fail(path, '.git is never inherited');
  if (segs.every(x => x === '*' || x === '**')) fail(path, 'inheriting everything would defeat the clean room (ADR-0014)');
  return g;
}
