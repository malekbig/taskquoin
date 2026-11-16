/**
 * PROVES: capabilities map to Claude Code tool availability and permission rules such that, under
 * --permission-mode dontAsk (deny anything not allowed), the agent gets exactly what it was granted:
 * no capability ⇒ no tool and no allow rule; config/secrets paths always denied. (S1)
 * DOES NOT PROVE: Claude evaluates the rules as we expect — the live positive-control test does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudePermissionsFor, CLAUDE_BASE_DENY } from '../src/permissions.ts';

test('read-only agent: read tools only, no edit/bash allow', () => {
  const p = claudePermissionsFor({ 'fs.read': ['**'] });
  assert.deepEqual(p.tools.sort(), ['Glob', 'Grep', 'Read']);
  assert.deepEqual(p.allow, ['Read(./**)'], 'workspace-anchored, not bare Read (Codex R1.1 P2)');
  assert.ok(!p.allow.some(r => r.startsWith('Edit') || r.startsWith('Bash')));
  for (const d of CLAUDE_BASE_DENY) assert.ok(p.deny.includes(d), `base deny ${d}`);
});

test('fs.write globs become Edit allow rules (cover Write/Edit tools) and add edit tools', () => {
  const p = claudePermissionsFor({ 'fs.read': ['**'], 'fs.write': ['src/**', 'tests/**'] });
  assert.ok(p.tools.includes('Edit') && p.tools.includes('Write'));
  assert.ok(p.allow.includes('Edit(./src/**)') && p.allow.includes('Edit(./tests/**)'));
});

test('shell.run patterns become Bash allow rules; no pattern ⇒ no Bash tool', () => {
  const none = claudePermissionsFor({ 'fs.read': ['**'] });
  assert.ok(!none.tools.includes('Bash'));
  const p = claudePermissionsFor({ 'fs.read': ['**'], 'shell.run': ['npm test', 'npx vitest run *'] });
  assert.ok(p.tools.includes('Bash'));
  assert.ok(p.allow.includes('Bash(npm test)') && p.allow.includes('Bash(npx vitest run *)'));
});

test('vcs and network: denied unless granted', () => {
  const p = claudePermissionsFor({ 'fs.read': ['**'], 'shell.run': ['npm test'] });
  assert.ok(p.deny.includes('Bash(git push *)') && p.deny.includes('Bash(git commit *)'));
  assert.ok(!p.tools.includes('WebFetch') && !p.tools.includes('WebSearch'));
  const n = claudePermissionsFor({ 'fs.read': ['**'], 'net.egress': ['docs.example.com'] });
  assert.ok(n.tools.includes('WebFetch'));
  assert.ok(n.allow.includes('WebFetch(domain:docs.example.com)'));
});

test('a glob trying to reach config or parent dirs is rejected', () => {
  assert.throws(() => claudePermissionsFor({ 'fs.write': ['../**'] }), /outside the workspace/);
  assert.throws(() => claudePermissionsFor({ 'fs.write': ['/etc/**'] }), /outside the workspace/);
  assert.throws(() => claudePermissionsFor({ 'fs.write': ['~/x'] }), /outside the workspace/);
});

test('empty grants are not grants (Codex R1 N2)', () => {
  const p = claudePermissionsFor({ 'fs.read': ['**'], 'fs.write': [], 'shell.run': [], 'net.egress': [] });
  assert.ok(!p.tools.includes('Edit') && !p.tools.includes('Bash') && !p.tools.includes('WebFetch'));
  assert.ok(p.deny.includes('WebFetch'));
});

test('M3: patterns, hosts and globs that could break rule syntax are rejected', () => {
  for (const p of ['npm test) Edit(./**', 'a\nb', 'x(y']) assert.throws(() => claudePermissionsFor({ 'shell.run': [p] }), /shell\.run pattern/);
  for (const h of ['evil.com) Bash(*', 'a b', '-x.com', 'http://x.com']) assert.throws(() => claudePermissionsFor({ 'net.egress': [h] }), /net\.egress host/);
  assert.throws(() => claudePermissionsFor({ 'fs.write': [''] }), /empty/);
  assert.throws(() => claudePermissionsFor({ 'fs.write': ['src/(x)'] }), /fs glob/);
});

test('M4: base deny covers nested secrets/instructions and CI/hook configuration', () => {
  for (const d of ['Read(./**/.env)', 'Read(./**/.env.*)', 'Read(./**/*.pem)', 'Read(./**/*.key)', 'Edit(./**/CLAUDE.md)', 'Edit(./**/AGENTS.md)',
    'Edit(./.github/workflows/**)', 'Edit(./.gitlab-ci.yml)', 'Edit(./.husky/**)', 'Edit(./.pre-commit-config.yaml)', 'Edit(./lefthook.yml)']) {
    assert.ok(CLAUDE_BASE_DENY.includes(d), d);
  }
});

test('base deny is generated from the shared rules lists (one verdict for hook, CI and permissions)', async () => {
  const { PROTECTED_WRITE_GLOBS, SECRET_READ_GLOBS, HOME_SECRET_GLOBS } = await import('@taskquoin/rules');
  for (const g of PROTECTED_WRITE_GLOBS) assert.ok(CLAUDE_BASE_DENY.includes(`Edit(./${g})`), g);
  for (const g of SECRET_READ_GLOBS) assert.ok(CLAUDE_BASE_DENY.includes(`Read(./${g})`), g);
  for (const g of HOME_SECRET_GLOBS) assert.ok(CLAUDE_BASE_DENY.includes(`Read(~/${g})`), g);
});

test('control store is denied by absolute path (honours XDG_STATE_HOME; review L2)', () => {
  const p = claudePermissionsFor({ 'fs.read': ['**'] }, { controlStore: '/srv/state/taskquoin/repos/abc' });
  assert.ok(p.deny.includes('Edit(//srv/state/taskquoin/repos/abc/**)') && p.deny.includes('Read(//srv/state/taskquoin/repos/abc/**)'));
  assert.throws(() => claudePermissionsFor({}, { controlStore: 'relative' }), /absolute/);
});
