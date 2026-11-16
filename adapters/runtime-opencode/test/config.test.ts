/**
 * PROVES: the generated OpenCode config leaves NO path to `ask` and grants nothing beyond reading (and editing for a
 * writer) inside the repository. The evaluator replays OpenCode 1.19.5's measured rule order (built-in `build` agent
 * rules, then the config's `permission` object, then OpenCode's trailing tool-output rule; last match wins; `*` spans
 * `/`; nothing matching ⇒ ask — docs/reports/opencode-interface-1.19.5.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opencodeConfig } from '../src/config.ts';

type Rule = [string, string, string];
const BUILTIN: Rule[] = [['*', '*', 'allow'], ['doom_loop', '*', 'ask'], ['external_directory', '*', 'ask'], ['question', '*', 'deny'],
  ['plan_enter', '*', 'deny'], ['plan_exit', '*', 'deny'], ['read', '*', 'allow'], ['read', '*.env', 'ask'], ['read', '*.env.*', 'ask'],
  ['read', '*.env.example', 'allow'], ['question', '*', 'allow'], ['plan_enter', '*', 'allow']];
const wild = (p: string, s: string) => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 's').test(s);
function flatten(perm: Record<string, unknown>): Rule[] {
  return Object.entries(perm).flatMap(([k, v]) => typeof v === 'string' ? [[k, '*', v] as Rule] : Object.entries(v as Record<string, string>).map(([p, a]) => [k, p, a] as Rule));
}
function evaluate(cfg: { permission: Record<string, unknown> }, permission: string, resource: string): string {
  const rules = [...BUILTIN, ...flatten(cfg.permission), ['external_directory', '/tmp/d/opencode/tool-output/*', 'allow'] as Rule];
  let r = 'ask';
  for (const [p, pat, a] of rules) if ((p === '*' || p === permission) && wild(pat, resource)) r = a;
  return r;
}
const PERMISSIONS = ['read', 'edit', 'list', 'glob', 'grep', 'bash', 'webfetch', 'websearch', 'task', 'skill', 'question', 'todowrite',
  'external_directory', 'doom_loop', 'lsp', 'codesearch', 'plan_enter', 'plan_exit', 'some_future_tool'];
const RESOURCES = ['src/a.ts', '/work/repo/src/a.ts', '../x', '/etc/passwd', '.env', '/work/repo/.env', 'config/.env.local', 'opencode.json',
  '/work/repo/opencode.json', '.opencode/plugin/x.ts', '.github/workflows/ci.yml', '/work/repo/AGENTS.md', 'key.pem', '*'];

for (const write of [false, true]) test(`generated config (write=${write}): never ask; only read/list/glob/grep${write ? '/edit' : ''} in the repository`, () => {
  const cfg = opencodeConfig({ write }) as { permission: Record<string, unknown> };
  for (const p of PERMISSIONS) for (const r of RESOURCES) assert.notEqual(evaluate(cfg, p, r), 'ask', `${p} ${r}`);
  for (const p of ['bash', 'webfetch', 'websearch', 'task', 'skill', 'question', 'todowrite', 'external_directory', 'doom_loop', 'some_future_tool'])
    for (const r of RESOURCES) assert.equal(evaluate(cfg, p, r), 'deny', `${p} ${r}`);
  assert.equal(evaluate(cfg, 'read', 'src/a.ts'), 'allow'); assert.equal(evaluate(cfg, 'grep', 'src'), 'allow');
  for (const s of ['.env', '/work/repo/.env', 'config/.env.local', 'key.pem']) assert.equal(evaluate(cfg, 'read', s), 'deny', s);
  assert.equal(evaluate(cfg, 'edit', 'src/a.ts'), write ? 'allow' : 'deny');
  for (const r of ['opencode.json', '/work/repo/opencode.json', '.opencode/plugin/x.ts', '.github/workflows/ci.yml', '/work/repo/AGENTS.md', '.env'])
    assert.equal(evaluate(cfg, 'edit', r), 'deny', r);
});

test('generated config: no update, no sharing, no LSP, no formatter, no MCP, no plugin, no instructions; maxTurns → step limit', () => {
  const c = opencodeConfig({ write: true }) as Record<string, unknown>;
  assert.equal(c.autoupdate, false); assert.equal(c.share, 'disabled'); assert.equal(c.lsp, false); assert.equal(c.formatter, false);
  assert.deepEqual(c.mcp, {}); assert.deepEqual(c.plugin, []); assert.deepEqual(c.instructions, []); assert.equal(c.agent, undefined);
  assert.deepEqual((opencodeConfig({ write: false, maxTurns: 7 }) as Record<string, unknown>).agent, { build: { steps: 7 } });
});
