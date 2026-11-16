/**
 * PROVES: the PreToolUse hook entrypoint, run as a real process with Claude-shaped JSON on stdin:
 *  - exit 0 (defer to permissions) for an allowed write/read/command;
 *  - exit 2 with the rule id on stderr for CONFIG001 / SCOPE001 / SECRET001 / GIT001, including a write that
 *    reaches protected config through a symlink inside an allowed directory;
 *  - FAIL CLOSED (exit 2) on malformed stdin, missing/unreadable policy, unknown tool shape for a write tool;
 *  - unrelated tools (e.g. TodoWrite) pass through.
 * DOES NOT PROVE: that Claude Code invokes the hook — live test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const entry = new URL('../src/main.ts', import.meta.url).pathname;
const root = realpathSync(mkdtempSync(join(tmpdir(), 'tq-hook-')));
const proj = join(root, 'p'); const home = join(root, 'h');
mkdirSync(join(proj, 'allowed'), { recursive: true }); mkdirSync(join(proj, '.claude'), { recursive: true }); mkdirSync(join(home, '.ssh'), { recursive: true });
symlinkSync('../.claude/settings.json', join(proj, 'allowed/link.json'));
const policyFile = join(root, 'policy.json');
mkdirSync(join(proj, 'node_modules', 'dep'), { recursive: true }); symlinkSync('../node_modules/dep/index.js', join(proj, 'allowed/dep-link.js'));
writeFileSync(policyFile, JSON.stringify({ projectRoot: proj, home, writeGlobs: ['allowed/**', 'node_modules/**'], vcs: { commit: true, push: false }, controlStore: join(root, 'store'), frozenRoots: [join(proj, 'node_modules')] }));

const run = (payload: unknown, policy = policyFile) => spawnSync(process.execPath, [entry, '--policy', policy], {
  input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8', env: { PATH: process.env.PATH ?? '' },
});
const pre = (tool_name: string, tool_input: unknown) => ({ hook_event_name: 'PreToolUse', cwd: proj, tool_name, tool_input });

test('allowed actions exit 0', () => {
  assert.equal(run(pre('Write', { file_path: join(proj, 'allowed/a.txt'), content: 'x' })).status, 0);
  assert.equal(run(pre('Edit', { file_path: 'allowed/a.txt', old_string: 'a', new_string: 'b' })).status, 0);
  assert.equal(run(pre('Read', { file_path: join(proj, 'allowed/a.txt') })).status, 0);
  assert.equal(run(pre('Bash', { command: 'git commit -m ok' })).status, 0);
  assert.equal(run(pre('TodoWrite', { todos: [] })).status, 0);
});

test('denials exit 2 with the rule id', () => {
  const cases: [string, unknown, string][] = [
    ['Write', { file_path: join(proj, '.claude/settings.json'), content: '{}' }, 'CONFIG001'],
    ['Write', { file_path: join(proj, 'allowed/link.json'), content: '{}' }, 'CONFIG001'],
    ['MultiEdit', { file_path: join(proj, 'docs.md'), edits: [] }, 'SCOPE001'],
    ['NotebookEdit', { notebook_path: join(root, 'outside.ipynb') }, 'SCOPE001'],
    ['Read', { file_path: join(home, '.ssh/id_ed25519') }, 'SECRET001'],
    ['Grep', { pattern: 'x', path: join(proj, '.env') }, 'SECRET001'],
    ['Bash', { command: 'git commit --no-verify -m x' }, 'GIT001'],
    ['Bash', { command: 'git push' }, 'GIT001'],
    ['Write', { file_path: join(proj, 'node_modules/dep/index.js'), content: 'tampered' }, 'FROZEN001'],
    ['Edit', { file_path: 'allowed/dep-link.js', old_string: 'a', new_string: 'b' }, 'FROZEN001'],
  ];
  for (const [tool, input, rule] of cases) {
    const r = run(pre(tool, input));
    assert.equal(r.status, 2, `${tool} ${JSON.stringify(input)} → ${r.status} ${r.stderr}`);
    assert.match(r.stderr, new RegExp(rule));
  }
});

test('fail closed', () => {
  assert.equal(run('not json').status, 2);
  assert.equal(run('null').status, 2);
  assert.equal(run(pre('Write', { content: 'no path' })).status, 2);
  assert.equal(run(pre('Write', { file_path: join(proj, 'allowed/a.txt') }), join(root, 'missing-policy.json')).status, 2);
  const bad = join(root, 'bad-policy.json'); writeFileSync(bad, '{"projectRoot": 1}');
  const badFrozen = join(root, 'bad-frozen.json');
  writeFileSync(badFrozen, JSON.stringify({ projectRoot: proj, home, writeGlobs: ['allowed/**'], vcs: { commit: true, push: false }, frozenRoots: ['node_modules'] }));
  assert.equal(run(pre('Write', { file_path: join(proj, 'allowed/a.txt') }), badFrozen).status, 2, 'frozenRoots must be absolute paths');
  assert.equal(run(pre('Write', { file_path: join(proj, 'allowed/a.txt') }), bad).status, 2);
});
