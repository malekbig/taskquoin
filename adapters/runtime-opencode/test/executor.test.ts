/**
 * PROVES (fake OpenCode run INSIDE the real sandbox — skipped without bubblewrap):
 *  - the prompt travels on stdin, never in argv; the model is imposed; only allowed variables reach OpenCode;
 *  - HOME is hidden; outside, .git and frozen paths are unwritable; secrets, instruction files (root and nested) and the
 *    repository's OpenCode config are invisible; the control store is masked; a read-only agent cannot write;
 *  - only the model provider's credential is visible; the plugin SDK and catalogue are there; a refreshed credential
 *    comes back; the run dir is removed (Review Focus 4);
 *  - outcomes: completed, provider error named, truncated stream, different model, step limit (Review Focus 5);
 *  - refusals before anything runs; the binary's mounts (Review Focus 3).
 * DOES NOT PROVE: the real OpenCode — tests/live-opencode.e2e.test.ts (Task 8).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { capabilitiesDigest, type RunRequest } from '@taskquoin/application';
import { ALLOWED_ENV_KEYS } from '@taskquoin/process-runner';
import { sandboxedToolAvailable } from '@taskquoin/local-tool';
import { OpenCodeExecutor, binaryMounts } from '../src/executor.ts';
import { userOpenCodeDirs } from '../src/credentials.ts';
import { authPath, modelsPath, pluginDir } from '../src/facts.ts';

const live = await sandboxedToolAvailable();
const needs = live ? {} : { skip: 'bubblewrap unavailable' };
const repoRoot = new URL('../../../', import.meta.url).pathname;
// Outside /tmp (the sandbox hides /tmp): HOME and the control store must be hidden BY the profile, not by accident.
const outsideRoot = (() => {
  const b = join(repoRoot, '.tq-test-tmp'); mkdirSync(b, { recursive: true }); const d = mkdtempSync(join(realpathSync(b), 'oc-'));
  process.on('exit', () => { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }); return d;
})();
const fakeDir = realpathSync(mkdtempSync(join(tmpdir(), 'tq-fake-oc-')));
copyFileSync(new URL('./fake-opencode.cjs', import.meta.url), join(fakeDir, 'fake-opencode.cjs'));
for (const f of ['run-ok', 'run-denied', 'run-error']) copyFileSync(new URL(`./fixtures/${f}.ndjson`, import.meta.url), join(fakeDir, `${f}.ndjson`));

const OPENAI = { type: 'oauth', access: 'SECRET-ACCESS', refresh: 'SECRET-REFRESH', expires: 1 };
function setup(version = '1.19.5', baseRoot = tmpdir()) {
  const base = realpathSync(mkdtempSync(join(baseRoot, 'tq-oc-base-')));
  const user = userOpenCodeDirs(base);
  mkdirSync(dirname(authPath(user)), { recursive: true }); writeFileSync(authPath(user), JSON.stringify({ openai: OPENAI, openrouter: { type: 'api', key: 'SECRET-KEY' } }), { mode: 0o600 });
  mkdirSync(dirname(modelsPath(user)), { recursive: true }); writeFileSync(modelsPath(user), '{}');
  mkdirSync(join(pluginDir(user), 'node_modules'), { recursive: true }); writeFileSync(join(pluginDir(user), 'node_modules', 'marker.txt'), 'sdk');
  const home = mkdtempSync(join(outsideRoot, 'home-')); mkdirSync(join(home, '.ssh')); writeFileSync(join(home, '.ssh', 'id_x'), 'PRIVATE');
  // WSL: ~/.aws is a link to a directory outside HOME (and outside /tmp): hiding HOME hides the link, not the target.
  const aws = mkdtempSync('/var/tmp/tq-oc-aws-'); process.on('exit', () => rmSync(aws, { recursive: true, force: true }));
  writeFileSync(join(aws, 'credentials'), 'AWS-SECRET\n'); symlinkSync(aws, join(home, '.aws'));
  const store = mkdtempSync(join(outsideRoot, 'store-')); writeFileSync(join(store, 'state.json'), '{}');
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'tq-oc-ws-')));
  execFileSync('git', ['init', '-q'], { cwd: ws });
  writeFileSync(join(ws, '.env'), 'SECRET=MARKER-ENV\n'); writeFileSync(join(ws, 'AGENTS.md'), 'MARKER-ROOT-AGENTS\n');
  mkdirSync(join(ws, 'sub')); writeFileSync(join(ws, 'sub', 'AGENTS.md'), 'MARKER-NESTED-AGENTS\n');
  writeFileSync(join(ws, 'opencode.json'), '{"permission":{"*":"allow"}}'); mkdirSync(join(ws, '.opencode', 'agent'), { recursive: true });
  writeFileSync(join(ws, '.opencode', 'agent', 'evil.md'), 'evil'); mkdirSync(join(ws, 'node_modules', 'dep'), { recursive: true });
  // A secret-NAMED link to an innocent-looking file, and a link leaving the repository towards a readable host file.
  writeFileSync(join(ws, 'credentials.txt'), 'SECRET-LINKED\n'); symlinkSync('credentials.txt', join(ws, '.env.local'));
  const hostDir = mkdtempSync('/var/tmp/tq-oc-host-'); process.on('exit', () => rmSync(hostDir, { recursive: true, force: true }));
  writeFileSync(join(hostDir, 'host-secret.txt'), 'HOST-SECRET\n'); symlinkSync(join(hostDir, 'host-secret.txt'), join(ws, 'ext-link'));
  const runBase = join(base, 'opencode', 'runs');
  const ex = new OpenCodeExecutor({ bin: process.execPath, prefixArgs: [join(fakeDir, 'fake-opencode.cjs')], version }, { userDirs: user, runBase, controlStore: store });
  return { base, user, home, store, ws, runBase, ex, aws };
}
type Ctx = ReturnType<typeof setup>;
function req(c: Ctx, caps: RunRequest['agent']['capabilities'], env: Record<string, string> = {}, over: Partial<RunRequest['agent']> = {}): RunRequest {
  return { agent: { id: 'implementer', description: 'd', prompt: 'ROLE-INSTRUCTIONS', capabilities: caps, model: 'openai/gpt-6-astra', ...over },
    task: 'TASK-TEXT', cwd: c.ws, timeoutMs: 60_000, maxOutputBytes: 1_000_000, frozenPaths: [join(c.ws, 'node_modules')],
    env: { PATH: process.env.PATH ?? '', HOME: c.home, LANG: 'C.UTF-8', TQ_FAKE_FROZEN: join(c.ws, 'node_modules'), TQ_FAKE_OUTSIDE: join(outsideRoot, 'outside.txt'), TQ_FAKE_STORE: c.store,
      TQ_FAKE_HOME_TARGET: join(c.aws, 'credentials'), TQ_FAKE_BASE: c.base, ...env },
    ticket: { kind: 'taskquoin.gate-ticket.v1', agentId: 'implementer', runtime: 'opencode', runtimeVersion: '1.19.5', capabilitiesDigest: capabilitiesDigest(caps), issuedAt: new Date().toISOString() } };
}
const WRITE = { 'fs.read': ['**'], 'fs.write': ['**'] };
const report = async (c: Ctx, caps: RunRequest['agent']['capabilities'] = WRITE) => {
  const r = await c.ex.run(req(c, caps, { TQ_FAKE_MODE: 'report' }));
  assert.equal(r.status, 'completed', r.stderr + r.terminalMessage);
  return { r, rep: JSON.parse(r.terminalMessage!) };
};

test('command: prompt on stdin never in argv; model imposed; only allowed variables; generated deny-by-default config', needs, async () => {
  const c = setup(); const { r, rep } = await report(c);
  assert.deepEqual(rep.argv, ['run', '--format', 'json', '--model', 'openai/gpt-6-astra']);
  assert.ok(rep.stdin.includes('ROLE-INSTRUCTIONS') && rep.stdin.includes('TASK-TEXT'));
  assert.ok(!r.command.args.join(' ').includes('TASK-TEXT'));
  // PWD is set by bubblewrap itself (--chdir); everything else comes from the runner's allowlist.
  for (const k of rep.envKeys) assert.ok(ALLOWED_ENV_KEYS.includes(k) || k.startsWith('TQ_FAKE_') || k === 'PWD', k);
  assert.equal(rep.config.permission['*'], 'deny'); assert.ok(rep.config.permission.edit);
  assert.equal(rep.catalogue, true);
});

test('sandbox: HOME hidden; outside, .git and frozen paths unwritable; secrets, instructions and repo OpenCode config invisible; store masked', needs, async () => {
  const c = setup(); const { rep } = await report(c);
  assert.deepEqual(rep.homeEntries, []);
  assert.equal(rep.repoWritable, true); assert.equal(rep.gitWritable, false); assert.equal(rep.frozenWritable, false); assert.equal(rep.outsideWritable, false);
  for (const k of ['envFile', 'rootAgents', 'nestedAgents', 'rootConfig']) assert.ok(!rep[k], `${k}: ${rep[k]}`);
  assert.equal(rep.dotOpencode, false); assert.deepEqual(rep.storeEntries, []);
  // final review (Codex HIGH 1): what a secret-named link points to, and what a link leaving the repository points to
  assert.ok(!rep.linkedSecret, `linked secret: ${rep.linkedSecret}`); assert.ok(!rep.externalLinked, `external link: ${rep.externalLinked}`);
  assert.ok(!rep.homeLinkTarget, `HOME secret behind a link: ${rep.homeLinkTarget}`); // final review (Claude I2)
  const ro = await report(c, { 'fs.read': ['**'] }); assert.equal(ro.rep.repoWritable, false); assert.equal(ro.rep.config.permission.edit, undefined);
});

test('credentials: only the model provider is visible, the plugin SDK is bound; a refreshed credential comes back; the run dir is removed', needs, async () => {
  const c = setup(); const { rep } = await report(c);
  assert.deepEqual(rep.authKeys, ['openai']); assert.equal(rep.pluginMarker, true);
  const r = await c.ex.run(req(c, WRITE, { TQ_FAKE_MODE: 'refresh' }));
  assert.equal(r.status, 'completed', r.stderr);
  const after = JSON.parse(readFileSync(authPath(c.user), 'utf8'));
  assert.equal(after.openai.access, 'SECRET-NEW'); assert.deepEqual(after.openrouter, { type: 'api', key: 'SECRET-KEY' });
  assert.deepEqual(readdirSync(c.runBase), []);
  assert.ok(!JSON.stringify(r).includes('SECRET-'));
});

test('outcomes: completed with usage and tool calls; provider error named; truncated stream; different model; denials; step limit', needs, async () => {
  const c = setup();
  const ok = await c.ex.run(req(c, WRITE)); assert.equal(ok.status, 'completed'); assert.ok(existsSync(join(c.ws, 'hello.txt')));
  assert.equal(ok.toolCalls?.[0].name, 'apply_patch'); assert.ok(ok.usage?.inputTokens); assert.deepEqual(ok.unsupported, []);
  assert.match(ok.terminalMessage ?? '', /\S/, 'a completed run always has a final message (the workflow requires one)'); // final review (I4)
  const err = await c.ex.run(req(c, WRITE, { TQ_FAKE_MODE: 'error' })); assert.equal(err.status, 'failed');
  assert.match(err.terminalMessage ?? '', /OpenCode \(openai\).*400.*not supported/);
  const tr = await c.ex.run(req(c, WRITE, { TQ_FAKE_MODE: 'truncated' })); assert.equal(tr.status, 'failed');
  assert.match(tr.terminalMessage ?? '', /OpenCode \(openai\): the stream ended without a final step/);
  const m = await c.ex.run(req(c, WRITE, { TQ_FAKE_MODE: 'model' })); assert.equal(m.status, 'failed'); assert.match(m.terminalMessage ?? '', /openai\/other-model/);
  assert.equal((await c.ex.run(req(c, WRITE, { TQ_FAKE_MODE: 'denied' }))).permissionDenials?.length, 2);
  const { rep } = await (async () => { const r = await c.ex.run(req(c, WRITE, { TQ_FAKE_MODE: 'report' }, { maxTurns: 9 })); return { rep: JSON.parse(r.terminalMessage!) }; })();
  assert.deepEqual(rep.config.agent, { build: { steps: 9 } });
});

test('refusals before anything runs: version, ticket, commands granted, no model, no sandbox, provider not connected, incomplete scan', needs, async () => {
  const c = setup();
  await assert.rejects(setup('9.9.9').ex.run(req(c, WRITE)), /opencode binary is 1\.19\.5, declared 9\.9\.9/);
  await assert.rejects(c.ex.run({ ...req(c, WRITE), ticket: undefined }), /ticket/i);
  const shell = { ...WRITE, 'shell.run': ['npm test'] };
  await assert.rejects(c.ex.run(req(c, shell)), /only read and write files/);
  await assert.rejects(c.ex.run(req(c, WRITE, {}, { model: undefined })), /model <provider>\/<model>/);
  const noBox = new OpenCodeExecutor({ bin: process.execPath, prefixArgs: [join(fakeDir, 'fake-opencode.cjs')], version: '1.19.5' }, { userDirs: c.user, runBase: c.runBase, controlStore: c.store, sandboxAvailable: async () => false });
  await assert.rejects(noBox.run(req(c, WRITE)), /bubblewrap unavailable/);
  await assert.rejects(c.ex.run(req(c, WRITE, {}, { model: 'mistral/large' })), /fournisseur "mistral" non connecté/);
  const locked = join(c.ws, 'locked'); mkdirSync(locked); chmodSync(locked, 0o000);
  try { await assert.rejects(c.ex.run(req(c, WRITE)), /scan incomplete/); } finally { chmodSync(locked, 0o700); }
  assert.ok(!existsSync(c.runBase) || readdirSync(c.runBase).length === 0);
});

test('binaryMounts: the real binary up to its package root; a shebang interpreter; never HOME itself', () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'tq-bm-home-')));
  const pkg = join(home, '.npm-global', 'lib', 'node_modules', 'opencode-ai'); mkdirSync(join(pkg, 'bin'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), '{}'); writeFileSync(join(pkg, 'bin', 'opencode.exe'), '\x7fELF');
  assert.deepEqual(binaryMounts(join(pkg, 'bin', 'opencode.exe'), '/usr/bin:/bin', home), [pkg]);
  writeFileSync(join(home, 'package.json'), '{}'); const loose = join(home, 'tools', 'oc'); mkdirSync(dirname(loose), { recursive: true });
  writeFileSync(loose, '#!/usr/bin/env node\n'); chmodSync(loose, 0o755);
  const m = binaryMounts(loose, `${dirname(process.execPath)}:/usr/bin:/bin`, home);
  assert.equal(m[0], join(home, 'tools')); assert.ok(!m.includes(home));
  assert.ok(m.some(d => existsSync(join(d, 'node'))), m.join(','));
});

test('final review (Claude I3): with the state base outside HOME, no other provider credential and no other repository store is visible', needs, async () => {
  const outBase = mkdtempSync('/var/tmp/tq-oc-state-'); process.on('exit', () => rmSync(outBase, { recursive: true, force: true }));
  const c = setup('1.19.5', outBase); mkdirSync(join(c.base, 'repos', 'other'), { recursive: true }); writeFileSync(join(c.base, 'repos', 'other', 'x'), 'x');
  const { rep } = await report(c);
  assert.deepEqual(rep.authKeys, ['openai']); assert.ok(rep.baseEntries === null || !rep.baseEntries.includes('repos'), JSON.stringify(rep.baseEntries));
  assert.equal(rep.pluginMarker, true);
});
