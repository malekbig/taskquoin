/**
 * PROVES: taskquoin.yaml parsing is strict and fail-closed — unknown keys, unknown capabilities, unknown runtimes,
 * remote connectors without the ADR-0012 fields, exceptions without reason/expiry are rejected with path-precise
 * errors; defaults depend on the detected stack and keep the implementer certifiable (fs.write "**", agents never
 * commit or push, ADR-0011); YAML anchors/aliases and duplicate keys are refused (no surprise expansion).
 * DOES NOT PROVE: that a valid config is safe to run — that is prepareRun's job.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { parseConfig, defaultConfig, renderConfig, inheritGlobs, keyEnvName, workflowOf, type Stack, providerOf, testCommand, OPENCODE_CAPABILITIES } from '../src/index.ts';

test('defaults per stack: test command and certifiable implementer', () => {
  const cases: [Stack, string][] = [['node', 'npm test'], ['php', 'vendor/bin/phpunit'], ['python', 'pytest'], ['go', 'go test ./...'], ['java-maven', 'mvn -q test']];
  for (const [stack, cmd] of cases) {
    const c = defaultConfig(stack);
    assert.equal(c.agents.implementer.capabilities['shell.run']?.[0], cmd, 'first entry = full suite, used by Verify');
    assert.ok((c.agents.implementer.capabilities['shell.run'] ?? []).length >= 2, 'a targeted form lets the agent run one test');
    assert.deepEqual(c.agents.implementer.capabilities['fs.write'], ['**']);
    assert.equal(c.agents.implementer.capabilities['vcs.commit'], undefined);
    assert.equal(c.agents.implementer.runtime, 'claude');
    assert.equal(c.agents.challenger.runtime, 'codex');
    assert.deepEqual(c.agents.planner.capabilities, { 'fs.read': ['**'] });
    assert.deepEqual(c.agents.challenger.capabilities, { 'fs.read': ['**'] });
    assert.deepEqual(Object.keys(c.connectors), []);
  }
});

test('render → parse round-trip is lossless', () => {
  const c = defaultConfig('node');
  assert.deepEqual(parseConfig(renderConfig(c)), c);
});

test('strict: unknown keys, capabilities, runtimes rejected with paths', () => {
  const y = renderConfig(defaultConfig('node'));
  assert.throws(() => parseConfig(y + 'surprise: 1\n'), /config\.surprise: unknown key/);
  assert.throws(() => parseConfig(y.replace('fs.read:', 'fs.reed:')), /agents\.\w+\.capabilities\.fs\.reed: unknown capability/);
  assert.throws(() => parseConfig(y.replace('runtime: codex', 'runtime: gemini')), /agents\.challenger\.runtime/);
  assert.throws(() => parseConfig('version: 2\n'), /config\.version: expected 1/);
});

test('YAML aliases and duplicate keys are refused', () => {
  assert.throws(() => parseConfig('version: 1\nx: &a [1]\ny: *a\n'), /alias/i);
  assert.throws(() => parseConfig('version: 1\nversion: 1\n'), /duplicate|unique/i);
});

test('remote connector (ADR-0012) needs host, one scope, explicit read/write lists; writes need the broker', () => {
  const base = defaultConfig('node');
  const ok = { ...base, connectors: { jira: { host: 'acme.atlassian.net', scope: 'PROJ', read: ['issue.get', 'issue.search'], write: ['issue.comment'], credentialRef: 'env:JIRA_TOKEN' } } };
  assert.deepEqual(parseConfig(renderConfig(ok)).connectors.jira.scope, 'PROJ');
  const noScope = { ...base, connectors: { jira: { host: 'acme.atlassian.net', read: [], write: [], credentialRef: 'env:X' } } };
  assert.throws(() => parseConfig(renderConfig(noScope as never)), /connectors\.jira\.scope/);
  const literalSecret = { ...base, connectors: { jira: { host: 'h.example', scope: 'P', read: [], write: [], credentialRef: 'abc123' } } };
  assert.throws(() => parseConfig(renderConfig(literalSecret)), /credentialRef.*env:|keychain:/);
});

test('exceptions are NOT accepted from the repository (Codex R3 #2) — they live in the control store', () => {
  const y = renderConfig(defaultConfig('node')).replace('policy:\n  mandatory:', 'policy:\n  exceptions: []\n  mandatory:');
  assert.throws(() => parseConfig(y), /config\.policy\.exceptions: .*taskquoin accept-risk/);
});

test('anchors, oversized files and prototype keys are refused', () => {
  assert.throws(() => parseConfig('version: 1\nx: &a 1\n'), /anchor/i);
  assert.throws(() => parseConfig('version: 1\n' + '#'.repeat(300_000)), /too large/);
  const y = renderConfig(defaultConfig('node')).replace('  challenger:', '  constructor:');
  assert.doesNotThrow(() => parseConfig(y), 'own-property handling: an agent may be called constructor without touching prototypes');
});

test('verify.inherit (ADR-0014): stack defaults + owner additions; dangerous patterns refused', () => {
  assert.deepEqual(inheritGlobs(defaultConfig('node')), ['**/node_modules']);
  assert.deepEqual(inheritGlobs(defaultConfig('php')), ['vendor']);
  assert.deepEqual(inheritGlobs(defaultConfig('python')), ['.venv', 'venv']);
  assert.deepEqual(inheritGlobs(defaultConfig('go')), []);
  const y = renderConfig(defaultConfig('node'));
  const c = parseConfig(y + 'verify:\n  inherit:\n    - dist\n');
  assert.deepEqual(c.verify, { inherit: ['dist'] });
  assert.deepEqual(inheritGlobs(c), ['**/node_modules', 'dist']);
  assert.deepEqual(parseConfig(renderConfig(c)), c, 'round-trip');
  assert.equal(parseConfig(y).verify, undefined, 'optional');
  for (const bad of ['"**"', '"*"', '"**/*"', '/abs', '../up', 'a/../b', '.git', '.git/hooks', '""']) {
    assert.throws(() => parseConfig(y + `verify:\n  inherit:\n    - ${bad}\n`), /verify\.inherit\[0\]/, bad);
  }
  assert.throws(() => parseConfig(y + 'verify:\n  other: 1\n'), /verify\.other: unknown key/);
});

// ── multi-LLM judges (project A, Task 1) ──────────────────────────────────────────────────────────────────────────
const judgesRaw = () => {
  const base = YAML.parse(renderConfig(defaultConfig('node')));
  return { ...base,
    providers: { deepseek: { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: 'env:DEEPSEEK_API_KEY' }, local: { url: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' } },
    agents: { ...base.agents, security: { runtime: 'api', provider: 'deepseek', description: 'Revue de sécurité indépendante du diff', prompt: 'Tu es relecteur de sécurité.', capabilities: {} } },
    workflow: { challengers: ['challenger'], reviewers: ['challenger', 'security'] } };
};
const parsed = (mut: (r: any) => void = () => {}) => { const r = judgesRaw(); mut(r); return parseConfig(YAML.stringify(r)); };

test('providers + api agents + workflow lists: valid example parses and round-trips', () => {
  const c = parsed();
  assert.deepEqual(c.providers!.deepseek, { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: 'env:DEEPSEEK_API_KEY', maxOutputTokens: 4000, timeoutSeconds: 300, tokenField: 'max_tokens' });
  assert.equal(c.providers!.local.key, undefined);
  assert.equal(c.agents.security.runtime, 'api'); assert.equal(c.agents.security.provider, 'deepseek');
  assert.deepEqual(workflowOf(c), { challengers: ['challenger'], reviewers: ['challenger', 'security'] });
  assert.equal(keyEnvName(c.providers!.deepseek), 'DEEPSEEK_API_KEY'); assert.equal(keyEnvName(c.providers!.local), undefined);
  assert.deepEqual(parseConfig(renderConfig(c)), c, 'round-trip');
  assert.deepEqual(workflowOf(defaultConfig('node')), { challengers: ['challenger'], reviewers: ['challenger'] }, 'defaults = today');
  assert.equal(parsed(r => { r.providers.deepseek.tokenField = 'max_completion_tokens'; r.providers.deepseek.maxInputChars = 400000; }).providers!.deepseek.tokenField, 'max_completion_tokens');
  for (const url of ['http://localhost:11434/v1', 'http://127.0.0.1:8080', 'http://[::1]:1/v1']) assert.equal(parsed(r => { r.providers.local.url = url; }).providers!.local.url, url, url);
  assert.ok(parsed(r => { r.workflow.reviewers = ['challenger']; }).agents.security, 'an api agent not listed anywhere is allowed');
});

test('providers and api agents are validated with precise paths', () => {
  const bad: [string, (r: any) => void, RegExp][] = [
    ['http to a remote host', r => { r.providers.deepseek.url = 'http://api.deepseek.com'; }, /providers\.deepseek\.url/],
    ['credentials in url', r => { r.providers.deepseek.url = 'https://u:p@h.com/v1'; }, /providers\.deepseek\.url/],
    ['query in url', r => { r.providers.deepseek.url = 'https://h.com/v1?x=1'; }, /providers\.deepseek\.url/],
    ['fragment in url', r => { r.providers.deepseek.url = 'https://h.com/v1#x'; }, /providers\.deepseek\.url/],
    ['key in clear', r => { r.providers.deepseek.key = 'sk-123'; }, /providers\.deepseek\.key/],
    ['unknown provider key', r => { r.providers.deepseek.temperature = 0; }, /providers\.deepseek\.temperature: unknown key/],
    ['bad provider id', r => { r.providers.Deep = structuredClone(r.providers.deepseek); }, /providers\.Deep/],
    ['bad tokenField', r => { r.providers.deepseek.tokenField = 'tokens'; }, /providers\.deepseek\.tokenField/],
    ['api agent without provider', r => { delete r.agents.security.provider; }, /agents\.security\.provider/],
    ['api agent with unknown provider', r => { r.agents.security.provider = 'nope'; }, /agents\.security\.provider: unknown provider/],
    ['api agent with capabilities', r => { r.agents.security.capabilities = { 'fs.read': ['**'] }; }, /agents\.security\.capabilities/],
    ['api agent with maxTurns', r => { r.agents.security.maxTurns = 3; }, /agents\.security\.maxTurns/],
    ['provider on a non-api agent', r => { r.agents.planner.provider = 'deepseek'; }, /agents\.planner\.provider/],
    ['api planner', r => { r.agents.planner = structuredClone(r.agents.security); }, /agents\.planner\.runtime/],
    ['api implementer', r => { r.agents.implementer = structuredClone(r.agents.security); }, /agents\.implementer\.runtime/],
    ['empty reviewers', r => { r.workflow.reviewers = []; }, /workflow\.reviewers/],
    ['duplicate reviewer', r => { r.workflow.reviewers = ['security', 'security']; }, /workflow\.reviewers.*duplicate/],
    ['unknown reviewer', r => { r.workflow.reviewers = ['ghost']; }, /workflow\.reviewers.*unknown agent/],
    ['unknown challenger', r => { r.workflow.challengers = ['ghost']; }, /workflow\.challengers.*unknown agent/],
    ['unknown workflow key', r => { r.workflow.judges = []; }, /workflow\.judges: unknown key/],
  ];
  for (const [name, mut, re] of bad) assert.throws(() => parsed(mut), re, name);
});

// ── init presets + detected AIs (project A, Task 6) ──────────────────────────────────────────────────────────────
/** What an editor's "toggle comment" does to the whole file but its header: remove one "# " per line — notes ("## ──") stay comments. */
const uncomment = (text: string) => text.split('\n').map((l, i) => (i === 0 ? l : l.replace(/^(\s*)# /, '$1'))).join('\n');

test('defaultConfig by installed tools: Claude only → a read-only Claude challenger; the default stays Claude + Codex', () => {
  assert.equal(defaultConfig('node').agents.challenger.runtime, 'codex');
  const c = defaultConfig('node', { claude: true, codex: false });
  assert.equal(c.agents.challenger.runtime, 'claude'); assert.deepEqual(c.agents.challenger.capabilities, { 'fs.read': ['**'] });
  assert.equal(c.agents.planner.runtime, 'claude'); assert.equal(c.agents.implementer.runtime, 'claude');
  assert.deepEqual(parseConfig(renderConfig(c)), c);
});

test('renderConfig with detected AIs: suggestions are commented out; once uncommented they form a valid config with a security judge', () => {
  const text = renderConfig(defaultConfig('node'), { env: ['DEEPSEEK_API_KEY', 'MISTRAL_API_KEY'], ollamaModels: ['qwen2.5-coder:7b'] });
  assert.deepEqual(parseConfig(text), defaultConfig('node'), 'nothing is active until the owner uncomments it');
  assert.match(text, /# .*api\.deepseek\.com/); assert.match(text, /# .*localhost:11434/); assert.match(text, /env:DEEPSEEK_API_KEY/);
  const c = parseConfig(uncomment(text));
  assert.deepEqual(Object.keys(c.providers!).sort(), ['deepseek', 'local', 'mistral']);
  assert.equal(c.agents.security.runtime, 'api'); assert.equal(c.agents.security.provider, 'deepseek'); assert.deepEqual(c.agents.security.skills, ['security-review']);
  assert.deepEqual(workflowOf(c).reviewers, ['challenger', 'security']);
  const reasoning = parseConfig(uncomment(renderConfig(defaultConfig('node'), { env: ['OPENAI_API_KEY'], ollamaModels: [] })));
  assert.equal(reasoning.providers!.openai.tokenField, 'max_completion_tokens');
  assert.ok(reasoning.providers!.openai.maxOutputTokens >= 16000, 'reasoning models need room beyond their reasoning tokens (final review)');
  const localOnly = parseConfig(uncomment(renderConfig(defaultConfig('node'), { env: [], ollamaModels: ['llama3.2:3b'] })));
  assert.equal(localOnly.agents.security.provider, 'local'); assert.equal(localOnly.providers!.local.model, 'llama3.2:3b');
  assert.equal(renderConfig(defaultConfig('node'), { env: [], ollamaModels: [] }), renderConfig(defaultConfig('node')), 'nothing detected → no suggestion');
  assert.equal(renderConfig(defaultConfig('node'), { env: ['UNRELATED_TOKEN'], ollamaModels: [] }), renderConfig(defaultConfig('node')), 'unknown variables are ignored');
});

// ── OpenCode (project B, step 1) ───────────────────────────────────────────────────────────────────────────────────
const withImplementer = (impl: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const c = defaultConfig('node') as unknown as Record<string, unknown> & { agents: Record<string, unknown> };
  return renderConfig({ ...c, ...extra, agents: { ...c.agents, implementer: { description: 'd', prompt: 'p', ...impl } } } as never);
};
const oc = { runtime: 'opencode', model: 'openai/gpt-6-astra', capabilities: { 'fs.read': ['**'], 'fs.write': ['**'] } };

test('runtime opencode: model <provider>/<model> required; only fs.read and fs.write; no provider', () => {
  assert.throws(() => parseConfig(withImplementer({ ...oc, model: undefined }, { verify: { command: 'npm test' } })), /\.agents\.implementer\.model: required for runtime opencode, as <provider>\/<model>/);
  assert.throws(() => parseConfig(withImplementer({ ...oc, model: 'gpt-6-astra' }, { verify: { command: 'npm test' } })), /<provider>\/<model>/);
  assert.throws(() => parseConfig(withImplementer({ ...oc, capabilities: { 'fs.write': ['**'], 'shell.run': ['npm test'] } }, { verify: { command: 'npm test' } })),
    /\.agents\.implementer\.capabilities\.shell\.run: no commands for OpenCode in this version: Taskquoin runs your tests with verify\.command/);
  assert.throws(() => parseConfig(withImplementer({ ...oc, provider: 'p' }, { verify: { command: 'npm test' } })), /only for runtime api/);
  const c = parseConfig(withImplementer(oc, { verify: { command: 'npm test' } }));
  assert.equal(c.agents.implementer.runtime, 'opencode'); assert.equal(providerOf(c.agents.implementer.model!), 'openai');
  assert.equal(providerOf('openrouter/deepseek/deepseek-chat'), 'openrouter');
  assert.deepEqual([...OPENCODE_CAPABILITIES], ['fs.read', 'fs.write']);
});

test('verify.command: required for an OpenCode implementer; testCommand prefers it; round-trip lossless', () => {
  assert.throws(() => parseConfig(withImplementer(oc)), /\.verify\.command: required — the implementer runs no command/);
  const c = parseConfig(withImplementer(oc, { verify: { command: 'npm test' } }));
  assert.equal(testCommand(c), 'npm test'); assert.deepEqual(parseConfig(renderConfig(c)), c);
  assert.equal(testCommand(parseConfig(renderConfig(defaultConfig('node')))), 'npm test'); // today's configs: implementer shell.run[0]
  const both = parseConfig(renderConfig({ ...defaultConfig('node'), verify: { inherit: [], command: 'npm run test:unit' } }));
  assert.equal(testCommand(both), 'npm run test:unit');
});

test('defaultConfig with OpenCode only: planner, implementer and challenger on OpenCode, verify.command set; Claude stays preferred', () => {
  const c = defaultConfig('node', { claude: false, codex: false, opencode: true });
  for (const id of ['planner', 'implementer', 'challenger']) { assert.equal(c.agents[id].runtime, 'opencode', id); assert.match(c.agents[id].model ?? '', /^[a-z0-9]+\/\S+$/); }
  assert.deepEqual(c.agents.implementer.capabilities, { 'fs.read': ['**'], 'fs.write': ['**'] });
  assert.equal(c.verify?.command, 'npm test');
  assert.deepEqual(parseConfig(renderConfig(c)), c);
  assert.equal(defaultConfig('node', { claude: true, codex: false, opencode: true }).agents.implementer.runtime, 'claude');
});
