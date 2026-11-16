/**
 * PROVES: the Claude headless invocation (2.1.325) (a) never carries the task in argv — prompt goes on stdin (S2);
 * (b) loads no settings file (user/project/local) and no MCP server unless listed (S3);
 * (c) does not persist the session transcript (S10); (d) never uses --bare / bypassPermissions.
 * DOES NOT PROVE: runtime behaviour — live contract test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClaudeCommand } from '../src/command.ts';

const req = {
  agent: { id: 'implementer', description: 'Implements a task with TDD', prompt: 'You implement…', model: 'sonnet' },
  task: '--dangerously-skip-permissions',
  cwd: '/tmp/ws',
  permissions: { tools: ['Read', 'Edit'], allow: ['Read', 'Edit(./src/**)'], deny: ['Edit(./.claude/**)'] },
  maxTurns: 12,
};
const at = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

test('prompt is passed on stdin, never in argv (argument injection)', () => {
  const c = buildClaudeCommand(req);
  assert.equal(c.stdin, '--dangerously-skip-permissions');
  assert.ok(!c.args.includes('--dangerously-skip-permissions'));
  assert.ok(c.args.includes('-p'));
});

test('isolation: no settings sources, strict MCP, no session persistence, no bare', () => {
  const c = buildClaudeCommand(req);
  assert.equal(at(c.args, '--setting-sources'), '');
  assert.ok(c.args.includes('--strict-mcp-config'));
  assert.ok(c.args.includes('--no-session-persistence'));
  assert.ok(!c.args.includes('--bare'));
  assert.ok(!c.args.some(a => /bypassPermissions|dangerously/.test(a)));
  assert.equal(at(c.args, '--permission-mode'), 'dontAsk');
  assert.ok(c.args.includes('stream-json') && c.args.includes('--verbose'));
  assert.equal(at(c.args, '--max-turns'), '12');
});

test('tools, agent and permissions are inline', () => {
  const c = buildClaudeCommand(req);
  assert.equal(at(c.args, '--tools'), 'Read,Edit');
  const agents = JSON.parse(at(c.args, '--agents'));
  assert.equal(agents['af-implementer'].description, 'Implements a task with TDD');
  assert.deepEqual(agents['af-implementer'].tools, ['Read', 'Edit']);
  assert.equal(at(c.args, '--agent'), 'af-implementer');
  const settings = JSON.parse(at(c.args, '--settings'));
  assert.deepEqual(settings.permissions, { allow: ['Read', 'Edit(./src/**)'], deny: ['Edit(./.claude/**)'], defaultMode: 'dontAsk' });
});

test('empty tool list is passed as "" (all tools disabled), not omitted', () => {
  const c = buildClaudeCommand({ ...req, permissions: { tools: [], allow: [], deny: [] } });
  assert.equal(at(c.args, '--tools'), '');
});

test('no MCP configuration can be passed before R6 (connector scope unreviewed)', () => {
  const c = buildClaudeCommand(req);
  assert.ok(!c.args.includes('--mcp-config'));
  assert.ok(!('mcpConfigs' in req));
});

test('M3: agent id is validated', () => {
  assert.throws(() => buildClaudeCommand({ ...req, agent: { ...req.agent, id: '--x' } }), /agent id/);
  assert.throws(() => buildClaudeCommand({ ...req, agent: { ...req.agent, id: 'A B' } }), /agent id/);
});

test('PreToolUse hook is declared inline when provided, absent otherwise', () => {
  const none = JSON.parse(at(buildClaudeCommand(req).args, '--settings'));
  assert.equal(none.hooks, undefined);
  const c = buildClaudeCommand({ ...req, hookCommand: "'/usr/bin/node' '/opt/tq/main.ts' --policy '/s/p.json'" });
  const s = JSON.parse(at(c.args, '--settings'));
  const h = s.hooks.PreToolUse[0];
  assert.equal(h.matcher, 'Write|Edit|MultiEdit|NotebookEdit|Read|Grep|Glob|Bash');
  assert.deepEqual(h.hooks[0], { type: 'command', command: "'/usr/bin/node' '/opt/tq/main.ts' --policy '/s/p.json'", timeout: 15, onFailure: 'block' });
});

test('no-leak (ADR-0010): Bash runs in the native OS sandbox, no unsandboxed escape, fail if unavailable, no network', () => {
  const withShell = { ...req, permissions: { tools: ['Read', 'Bash'], allow: ['Read(./**)', 'Bash(npm test)'], deny: [] }, sandboxWriteRoots: ['/w/src', '/s/scratch'] };
  const s = JSON.parse(at(buildClaudeCommand(withShell).args, '--settings'));
  assert.deepEqual(s.sandbox, {
    enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, autoAllowBashIfSandboxed: false,
    network: { allowedDomains: [], allowLocalBinding: false, allowUnixSockets: [] },
    filesystem: { allowWrite: ['/w/src', '/s/scratch'], denyWrite: [], denyRead: [] },
  });
  const noShell = JSON.parse(at(buildClaudeCommand(req).args, '--settings'));
  assert.equal(noShell.sandbox, undefined, 'no Bash tool ⇒ no subprocess to sandbox');
});
