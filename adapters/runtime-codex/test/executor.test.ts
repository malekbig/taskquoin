/**
 * PROVES: CodexExecutor with a fake binary:
 *  - agent prompt and task reach stdin; empty fs.write grant ⇒ read-only (N2);
 *  - completion requires exit 0 AND turn.completed AND a non-empty last message; the message read is bounded (N6);
 *  - writer scratch dir lives under a trusted base OUTSIDE the workspace, is TMPDIR, and is removed (R1.1 P1);
 *  - a symlinked scratch base or a base inside the workspace is refused;
 *  - maxTurns is reported as unsupported rather than silently dropped.
 * DOES NOT PROVE: real CLI behaviour — tests/live-contract.e2e.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunRequest } from '@taskquoin/application';
import { CodexExecutor, codexSandboxFor } from '../src/executor.ts';
import { capabilitiesDigest } from '@taskquoin/application';
import { chmodSync } from 'node:fs';

const root = mkdtempSync(join(tmpdir(), 'tq-codex-test-'));
const scratchBase = join(root, 'state', 'scratch');
const mk = (opts: { scratchBase?: string } = {}) => new CodexExecutor({ bin: process.execPath, prefixArgs: [new URL('./fake-codex.cjs', import.meta.url).pathname], version: '9.9.9' }, { scratchBase: opts.scratchBase ?? scratchBase });
const req = (caps: RunRequest['agent']['capabilities'], env: Record<string, string> = {}, over: Partial<RunRequest['agent']> = {}): RunRequest => {
  const cwd = join(root, 'ws-' + Math.random().toString(36).slice(2)); mkdirSync(cwd, { recursive: true });
  return { agent: { id: 'challenger', description: 'd', prompt: 'ROLE-INSTRUCTIONS', capabilities: caps, ...over }, task: 'review the plan', cwd, timeoutMs: 5000, maxOutputBytes: 100_000, env: { PATH: process.env.PATH ?? '', ...env },
    ticket: { kind: 'taskquoin.gate-ticket.v1', agentId: 'challenger', runtime: 'codex', runtimeVersion: '9.9.9', capabilitiesDigest: capabilitiesDigest(caps), issuedAt: new Date().toISOString() } };
};
const sandboxOf = (r: { command: { args: string[] } }) => r.command.args[r.command.args.indexOf('--sandbox') + 1];

test('read-only agent: completed; agent prompt + task on stdin; command executions surfaced', async () => {
  const r = await mk().run(req({ 'fs.read': ['**'] }));
  assert.equal(r.status, 'completed', r.stderr);
  assert.ok(r.terminalMessage?.includes('ROLE-INSTRUCTIONS') && r.terminalMessage.includes('review the plan'));
  assert.equal(sandboxOf(r), 'read-only');
  assert.deepEqual(r.commandExecutions?.[0], { command: 'sh probe.sh', exitCode: 0, status: 'completed', output: 'PROBE x 0\n' });
  assert.deepEqual(r.usage, { inputTokens: 10, outputTokens: 2 });
  assert.match(r.effectiveConfigDigest, /^sha256:/);
});

test('empty fs.write grant ⇒ read-only sandbox', async () => {
  assert.equal(sandboxOf(await mk().run(req({ 'fs.write': [] }))), 'read-only');
});

test('completion requires turn.completed and a non-empty message', async () => {
  assert.equal((await mk().run(req({}, { TQ_FAKE_MODE: 'no-turn' }))).status, 'unknown');
  assert.equal((await mk().run(req({}, { TQ_FAKE_MODE: 'empty-message' }))).status, 'unknown');
  assert.equal((await mk().run(req({}, { TQ_FAKE_MODE: 'no-message' }))).status, 'unknown');
});

test('last message read is bounded', async () => {
  const r = await mk().run(req({}, { TQ_FAKE_MODE: 'big-message' }));
  assert.ok((r.terminalMessage ?? '').length <= 1024 * 1024);
});

test('writer: scratch under trusted base outside workspace, used as TMPDIR and writable root, removed afterwards', async () => {
  const q = req({ 'fs.write': ['**'] }, { TQ_FAKE_ECHO_TMPDIR: '1' });
  const r = await mk().run(q);
  assert.equal(r.status, 'completed', r.stderr);
  assert.equal(sandboxOf(r), 'workspace-write');
  const tmp = /TMPDIR=(.*)$/m.exec(r.terminalMessage ?? '')?.[1] ?? '';
  assert.ok(tmp.startsWith(scratchBase + '/'), tmp);
  assert.ok(!tmp.startsWith(q.cwd));
  assert.ok(r.command.args.includes(`sandbox_workspace_write.writable_roots=[${JSON.stringify(tmp)}]`));
  assert.equal(existsSync(tmp), false, 'scratch removed');
  const msg = r.command.args[r.command.args.indexOf('-o') + 1];
  assert.ok(!msg.startsWith(tmp + '/'), 'last-message file must not live inside the writable scratch root');
  assert.equal(existsSync(join(q.cwd, '.taskquoin-tmp')), false, 'nothing created inside the workspace');
});

test('refuses a symlinked scratch base and a base inside the workspace', async () => {
  const real = join(root, 'elsewhere'); mkdirSync(real, { recursive: true });
  const link = join(root, 'link-base'); symlinkSync(real, link);
  await assert.rejects(mk({ scratchBase: link }).run(req({ 'fs.write': ['**'] })), /symlink/);
  const q = req({ 'fs.write': ['**'] });
  await assert.rejects(mk({ scratchBase: join(q.cwd, 'scratch') }).run(q), /inside the workspace/);
});

test('maxTurns is reported unsupported, not silently dropped', async () => {
  const r = await mk().run(req({}, {}, { maxTurns: 5 }));
  assert.deepEqual(r.unsupported, ['maxTurns']);
});

test('codexSandboxFor is the single source of truth for the sandbox fact (H2)', () => {
  assert.equal(codexSandboxFor({}), 'read-only');
  assert.equal(codexSandboxFor({ 'fs.write': [] }), 'read-only');
  assert.equal(codexSandboxFor({ 'fs.write': ['src/**'] }), 'workspace-write');
});

test('M2: a group/world-writable scratch base is refused', async () => {
  const b = join(root, 'loose-base'); mkdirSync(b, { recursive: true }); chmodSync(b, 0o777);
  await assert.rejects(mk({ scratchBase: b }).run(req({ 'fs.write': ['**'] })), /group\/world-writable/);
});

test('M1: cleanup problems are reported, never replace the run result', async () => {
  const ex = mk();
  const q = req({ 'fs.write': ['**'] }, { TQ_FAKE_MODE: 'remove-scratch-base' });
  const r = await ex.run(q);
  assert.equal(typeof r.status, 'string');
  assert.ok(Array.isArray(r.cleanupErrors));
});

test('refusals: no ticket, ticket for other capabilities', async () => {
  const q = req({ 'fs.read': ['**'] });
  await assert.rejects(mk().run({ ...q, ticket: undefined }), /no gate ticket/);
  await assert.rejects(mk().run({ ...q, agent: { ...q.agent, capabilities: { 'fs.write': ['**'] } } }), /capabilities differ/);
});

test('frozen paths (ADR-0014): a read-only Codex satisfies them by construction; a writer cannot enforce them and refuses', async () => {
  const ro = req({ 'fs.read': ['**'] }); const r = await mk().run({ ...ro, frozenPaths: [join(ro.cwd, 'node_modules')] });
  assert.equal(r.status, 'completed'); assert.equal(sandboxOf(r), 'read-only');
  const w = req({ 'fs.read': ['**'], 'fs.write': ['**'] });
  await assert.rejects(mk().run({ ...w, frozenPaths: [join(w.cwd, 'node_modules')] }), /cannot keep frozen paths read-only/);
});
