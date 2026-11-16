/**
 * PROVES: ClaudeExecutor honours ExecutionContract v1 with a fake binary (no model calls): prompt via stdin,
 * hardened flags (fake exits 64 otherwise), terminal evidence → status, permission denials surfaced, timeout.
 * DOES NOT PROVE: real CLI behaviour — tests/live-contract.e2e.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunRequest } from '@taskquoin/application';
import { ClaudeExecutor, type ClaudeHookOptions } from '../src/executor.ts';
import { capabilitiesDigest, type GateTicket } from '@taskquoin/application';
import { realpathSync as rp0 } from 'node:fs';

const HOOK_ENTRY = new URL('../../hooks-claude/src/main.ts', import.meta.url).pathname;
const hookDir = rp0(mkdtempSync(join(tmpdir(), 'tq-hookpol-')));
const hookOpts: ClaudeHookOptions = { nodeBin: process.execPath, entry: HOOK_ENTRY, policyDir: hookDir, controlStore: '/srv/store' };
const ticket = (caps: RunRequest['agent']['capabilities'], version = '9.9.9', agentId = 'implementer'): GateTicket => ({ kind: 'taskquoin.gate-ticket.v1', agentId, runtime: 'claude', runtimeVersion: version, capabilitiesDigest: capabilitiesDigest(caps), issuedAt: new Date().toISOString() });

const FAKE = { bin: process.execPath, prefixArgs: [new URL('./fake-claude.cjs', import.meta.url).pathname], version: '9.9.9' };
const ex = new ClaudeExecutor(FAKE, { hook: hookOpts });
const CAPS = { 'fs.read': ['**'], 'fs.write': ['src/**'] };
const req = (over: Partial<RunRequest> = {}): RunRequest => ({
  agent: { id: 'implementer', description: 'd', prompt: 'p', capabilities: CAPS },
  task: '--dangerously-skip-permissions', cwd: mkdtempSync(join(tmpdir(), 'tq-')), timeoutMs: 3000, maxOutputBytes: 100_000,
  env: { PATH: process.env.PATH ?? '' }, ticket: ticket(CAPS), ...over,
});

test('completed; prompt arrived on stdin; denials surfaced; prompt absent from argv', async () => {
  const r = await ex.run(req());
  assert.equal(r.status, 'completed', r.stderr);
  assert.equal(r.terminalMessage, 'prompt=--dangerously-skip-permissions');
  assert.deepEqual(r.permissionDenials, [{ tool: 'Write', input: { file_path: 'x' } }]);
  assert.ok(!r.command.args.includes('--dangerously-skip-permissions'));
  assert.equal(r.usage?.costUsd, 0.002);
  assert.match(r.effectiveConfigDigest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(r.inventory?.mcpServers, []);
  assert.ok(r.inventory?.tools.includes('Edit'));
});

test('allow rules derive from capabilities; base denies always present', async () => {
  const r = await ex.run(req());
  const s = JSON.parse(r.command.args[r.command.args.indexOf('--settings') + 1]);
  assert.ok(s.permissions.allow.includes('Edit(./src/**)'));
  assert.ok(s.permissions.deny.includes('Edit(./.claude/**)'));
  assert.ok(s.permissions.deny.includes('Bash(git push *)'));
});

test('no terminal event ⇒ unknown; hang ⇒ timeout', async () => {
  assert.equal((await ex.run(req({ env: { PATH: process.env.PATH ?? '', TQ_FAKE_MODE: 'no-result' } }))).status, 'unknown');
  assert.equal((await ex.run(req({ timeoutMs: 500, env: { PATH: process.env.PATH ?? '', TQ_FAKE_MODE: 'hang' } }))).status, 'timeout');
});

test('with a hook: per-run policy written outside the workspace, referenced by the hook command, removed afterwards', async () => {
  const { mkdtempSync: mk, existsSync, readFileSync, realpathSync } = await import('node:fs');
  const policyDir = realpathSync(mk(join(tmpdir(), 'tq-pol-')));
  const hx = new ClaudeExecutor(FAKE, { hook: { nodeBin: process.execPath, entry: HOOK_ENTRY, policyDir, controlStore: '/srv/store' } });
  const q = req({ env: { PATH: process.env.PATH ?? '', HOME: '/home/u', TQ_FAKE_ECHO_POLICY: '1' } });
  const r = await hx.run(q);
  assert.equal(r.status, 'completed', r.stderr);
  const s = JSON.parse(r.command.args[r.command.args.indexOf('--settings') + 1]);
  const cmd: string = s.hooks.PreToolUse[0].hooks[0].command;
  const policyPath = /--policy '([^']+)'/.exec(cmd)?.[1] ?? '';
  assert.ok(policyPath.startsWith(policyDir + '/'), policyPath);
  assert.equal(s.hooks.PreToolUse[0].hooks[0].onFailure, 'block');
  const echoed = JSON.parse(/POLICY=(.*)$/m.exec(r.terminalMessage ?? '')?.[1] ?? '{}');
  assert.deepEqual(echoed, { projectRoot: realpathSync(q.cwd), home: '/home/u', writeGlobs: ['src/**'], vcs: { commit: false, push: false }, controlStore: '/srv/store' });
  assert.equal(existsSync(policyPath), false, 'policy removed after the run');
  assert.ok(s.permissions.deny.includes('Edit(//srv/store/**)'));
  void readFileSync;
});

test('frozen paths (ADR-0014): inherited dependency directories become sandbox denyWrite AND hook frozenRoots', async () => {
  const { mkdirSync, realpathSync } = await import('node:fs');
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'tq-frozen-'))); mkdirSync(join(cwd, 'node_modules'));
  const caps = { ...CAPS, 'shell.run': ['npm test'] };
  const q = req({ cwd, agent: { id: 'implementer', description: 'd', prompt: 'p', capabilities: caps }, ticket: ticket(caps), frozenPaths: [join(cwd, 'node_modules')], env: { PATH: process.env.PATH ?? '', HOME: '/home/u', TQ_FAKE_ECHO_POLICY: '1' } });
  const r = await ex.run(q);
  assert.equal(r.status, 'completed', r.stderr);
  const s = JSON.parse(r.command.args[r.command.args.indexOf('--settings') + 1]);
  assert.ok(s.sandbox.filesystem.denyWrite.includes(join(cwd, 'node_modules')), JSON.stringify(s.sandbox.filesystem.denyWrite));
  const echoed = JSON.parse(/POLICY=(.*)$/m.exec(r.terminalMessage ?? '')?.[1] ?? '{}');
  assert.deepEqual(echoed.frozenRoots, [join(cwd, 'node_modules')]);
  await assert.rejects(ex.run(req({ cwd, frozenPaths: ['/etc'] })), /frozen path outside the workspace/);
});

test('no-leak (ADR-0010): non-essential traffic (telemetry, error reports, auto-update) disabled for every run', async () => {
  const r = await ex.run(req({ env: { PATH: process.env.PATH ?? '', TQ_FAKE_ECHO_ENV: '1' } }));
  assert.match(r.terminalMessage ?? '', /CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1/);
  assert.match(r.terminalMessage ?? '', /DISABLE_TELEMETRY=1/);
});

test('sandbox deny lists derive from the shared rules lists (protected writes, secret reads, control store)', async () => {
  const { sandboxDenyWrite, sandboxDenyRead } = await import('../src/executor.ts');
  const empty = { complete: true, instructionFiles: [], secretFiles: [], externalLinks: [], links: [], secretLinks: [], entries: 0 };
  const w = sandboxDenyWrite('/ws', '/st', empty);
  for (const x of ['/ws/.claude', '/ws/.codex', '/ws/.agents', '/ws/.git', '/ws/taskquoin.yaml', '/ws/CLAUDE.md', '/ws/AGENTS.md', '/ws/.mcp.json', '/ws/.github/workflows', '/st']) assert.ok(w.includes(x), x);
  assert.ok(!w.some(x => x.includes('*')), 'no globs passed to the sandbox');
  const r = sandboxDenyRead('/ws', '/home/u', '/st', empty);
  for (const x of ['/ws/.env', '/home/u/.ssh', '/home/u/.aws', '/home/u/.codex/auth.json', '/home/u/.claude/.credentials.json', '/st']) assert.ok(r.includes(x), x);
  assert.ok(!r.some(x => x.includes('*')));
});

test('workspace scan: every nested instruction file and secret file becomes a concrete deny; .git always denied (Codex R3)', async () => {
  const { scanWorkspace, sandboxDenyWrite, sandboxDenyRead } = await import('../src/executor.ts');
  const { mkdtempSync: mk, mkdirSync: md, writeFileSync: wf, realpathSync: rp } = await import('node:fs');
  const ws = rp(mk(join(tmpdir(), 'tq-scan-')));
  for (const d of ['pkg/a', 'node_modules/x', 'apps/api', 'certs']) md(join(ws, d), { recursive: true });
  for (const f of ['pkg/a/CLAUDE.md', 'pkg/AGENTS.md', 'node_modules/x/CLAUDE.md', 'apps/api/.env.local', '.env.production', 'certs/server.key', 'certs/ca.pem', 'src.ts']) wf(join(ws, f), 'x');
  const scan = scanWorkspace(ws);
  assert.equal(scan.complete, true);
  const w = sandboxDenyWrite(ws, '/st', scan);
  for (const x of ['pkg/a/CLAUDE.md', 'pkg/AGENTS.md', 'node_modules/x/CLAUDE.md']) assert.ok(w.includes(`${ws}/${x}`), x);
  assert.ok(w.includes(`${ws}/.git`), '.git always denied (agents never commit, ADR-0011)');
  const r = sandboxDenyRead(ws, '/home/u', '/st', scan);
  for (const x of ['apps/api/.env.local', '.env.production', 'certs/server.key', 'certs/ca.pem']) assert.ok(r.includes(`${ws}/${x}`), x);
  assert.ok(!r.includes(`${ws}/src.ts`));
  const { symlinkSync: sl } = await import('node:fs');
  wf(join(ws, 'node_modules/x/credentials.txt'), 'S'); sl('credentials.txt', join(ws, 'node_modules/x/.env'));
  const r2 = sandboxDenyRead(ws, '/home/u', '/st', scanWorkspace(ws));
  assert.ok(r2.includes(`${ws}/node_modules/x/credentials.txt`), 'the target of a secret-named symlink is denied too (Codex CR2 #3)');
});

test('workspace scan that cannot complete refuses the run (fail closed)', async () => {
  const { scanWorkspace } = await import('../src/executor.ts');
  const { mkdtempSync: mk, writeFileSync: wf, realpathSync: rp } = await import('node:fs');
  const ws = rp(mk(join(tmpdir(), 'tq-scanbig-')));
  for (let i = 0; i < 30; i++) wf(join(ws, `f${i}`), 'x');
  assert.equal(scanWorkspace(ws, 10).complete, false);
});

test('refusals: no hook, no/mismatched ticket, wrong binary version, hook code inside the workspace', async () => {
  assert.throws(() => new ClaudeExecutor(FAKE, undefined as never), /requires the Taskquoin PreToolUse hook/);
  assert.throws(() => new ClaudeExecutor(FAKE, { hook: { ...hookOpts, entry: 'rel/main.ts' } }), /absolute/);
  await assert.rejects(ex.run(req({ ticket: undefined })), /no gate ticket/);
  await assert.rejects(ex.run(req({ ticket: ticket({ 'fs.read': ['**'] }) })), /capabilities differ/);
  await assert.rejects(new ClaudeExecutor({ ...FAKE, version: '2.1.325' }, { hook: hookOpts }).run(req()), /binary is 9\.9\.9, declared 2\.1\.325/);
  const { mkdirSync: md, writeFileSync: wf, realpathSync: rp } = await import('node:fs');
  const ws = rp(mkdtempSync(join(tmpdir(), 'tq-selfgov-'))); md(join(ws, 'h')); wf(join(ws, 'h', 'main.ts'), '');
  await assert.rejects(new ClaudeExecutor(FAKE, { hook: { ...hookOpts, entry: join(ws, 'h', 'main.ts') } }).run(req({ cwd: ws })), /hook code is inside the workspace/);
});
