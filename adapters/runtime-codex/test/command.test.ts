/**
 * PROVES: the Codex invocation (0.157.1)
 *  (a) sends agent instructions + task on stdin with positional "-" (S2, Codex R1 N7);
 *  (b) ignores user config.toml and execpolicy rules, persists no session, loads no AGENTS.md and injects no skill
 *      catalogue (Codex R1.1 P1) — effect measured by the live sentinel test;
 *  (c) disables model-side tools that bypass the OS sandbox;
 *  (d) for writers: pins network off, excludes /tmp and $TMPDIR, and pins writable_roots to a scratch dir;
 *  (e) never --profile / danger-full-access / --dangerously-*.
 * DOES NOT PROVE: runtime behaviour — live contract suite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexCommand, codexStdin, CODEX_DISABLED_FEATURES } from '../src/command.ts';

const base = { agentPrompt: 'You are a reviewer.', task: '--dangerously-bypass-approvals-and-sandbox', cwd: '/tmp/ws', sandbox: 'read-only' as const, lastMessageFile: '/s/out.md', model: 'gpt-5-codex' };
const at = (a: string[], f: string) => a[a.indexOf(f) + 1];
const hasPair = (a: string[], f: string, v: string) => a.some((x, i) => x === f && a[i + 1] === v);

test('agent instructions and task on stdin; "-" positional last; nothing of either in argv', () => {
  const c = buildCodexCommand(base);
  assert.equal(c.stdin, codexStdin(base.agentPrompt, base.task));
  assert.ok(c.stdin.indexOf('You are a reviewer.') < c.stdin.indexOf(base.task));
  assert.equal(c.args.at(-1), '-');
  assert.ok(!c.args.some(a => a.includes('reviewer') || a === base.task));
});

test('isolation: user config, rules, AGENTS.md, skills catalogue, session persistence', () => {
  const c = buildCodexCommand(base);
  for (const f of ['--json', '--ignore-user-config', '--ignore-rules', '--ephemeral']) assert.ok(c.args.includes(f), f);
  for (const kv of ['approval_policy="never"', 'web_search="disabled"', 'project_doc_max_bytes=0', 'skills.include_instructions=false']) assert.ok(hasPair(c.args, '-c', kv), kv);
  for (const feat of CODEX_DISABLED_FEATURES) assert.ok(hasPair(c.args, '--disable', feat), feat);
  assert.equal(at(c.args, '--sandbox'), 'read-only');
  assert.ok(!c.args.some(a => a.startsWith('--dangerously')) && !c.args.includes('--profile') && !c.args.includes('-p'));
});

test('writer: network off, /tmp and $TMPDIR excluded, writable_roots pinned to scratch', () => {
  const w = buildCodexCommand({ ...base, sandbox: 'workspace-write', scratchDir: '/home/u/.local/state/taskquoin/scratch/run-1' });
  for (const kv of ['sandbox_workspace_write.network_access=false', 'sandbox_workspace_write.exclude_slash_tmp=true', 'sandbox_workspace_write.exclude_tmpdir_env_var=true',
    'sandbox_workspace_write.writable_roots=["/home/u/.local/state/taskquoin/scratch/run-1"]']) assert.ok(hasPair(w.args, '-c', kv), kv);
  assert.throws(() => buildCodexCommand({ ...base, sandbox: 'workspace-write' }), /scratchDir/);
  assert.throws(() => buildCodexCommand({ ...base, sandbox: 'workspace-write', scratchDir: 'rel/dir' }), /scratchDir/);
  assert.throws(() => buildCodexCommand({ ...base, sandbox: 'workspace-write', scratchDir: '/x"]\nsandbox_mode="danger-full-access' }), /scratchDir/);
});

test('refuses danger-full-access and a model string that could inject TOML', () => {
  assert.throws(() => buildCodexCommand({ ...base, sandbox: 'danger-full-access' as never }), /danger-full-access/);
  assert.throws(() => buildCodexCommand({ ...base, model: 'x"\nsandbox_mode="danger-full-access' }), /invalid model/);
});

test('no-leak (ADR-0010): strict config (typos fail closed), analytics and OTel export off', () => {
  const c = buildCodexCommand(base);
  assert.ok(c.args.includes('--strict-config'));
  assert.ok(hasPair(c.args, '-c', 'analytics.enabled=false'));
  assert.ok(hasPair(c.args, '-c', 'otel.exporter="none"'));
});
