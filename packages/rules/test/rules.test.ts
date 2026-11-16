/**
 * PROVES: evaluateRules (pure) returns a deny with a stable rule id for:
 *  CONFIG001 — writes to protected configuration (single source shared with the Claude permission compiler);
 *  SCOPE001  — writes outside the agent's fs.write globs or outside the project root;
 *  SECRET001 — reads of secret files inside the project or under HOME;
 *  GIT001    — git commands that switch hooks off (--no-verify, commit -n, core.hooksPath, HUSKY=0, LEFTHOOK=0, SKIP=)
 *              or push/commit when not granted.
 * Paths given to the engine are already canonical (physical) — canonicalisation is tested separately.
 * DOES NOT PROVE: that a runtime invokes the hook (live test), nor shell parsing beyond the documented heuristics.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRules, PROTECTED_WRITE_GLOBS, SECRET_READ_GLOBS, type RulePolicy } from '../src/index.ts';

const policy: RulePolicy = { projectRoot: '/p', home: '/h', writeGlobs: ['src/**', 'tests/**'], vcs: { commit: true, push: false } };
const ids = (r: ReturnType<typeof evaluateRules>) => r.violations.map(v => v.rule);

test('allowed write inside scope passes', () => {
  const r = evaluateRules({ kind: 'write', paths: ['/p/src/a.ts'] }, policy);
  assert.equal(r.decision, 'allow');
});

test('SCOPE001: outside globs, outside project', () => {
  assert.deepEqual(ids(evaluateRules({ kind: 'write', paths: ['/p/docs/x.md'] }, policy)), ['SCOPE001']);
  assert.deepEqual(ids(evaluateRules({ kind: 'write', paths: ['/etc/passwd'] }, policy)), ['SCOPE001']);
  assert.deepEqual(ids(evaluateRules({ kind: 'write', paths: ['/pp/src/a.ts'] }, policy)), ['SCOPE001'], 'prefix of root is not inside root');
});

test('CONFIG001 wins even when the glob would allow it', () => {
  const broad = { ...policy, writeGlobs: ['**'] };
  for (const p of ['/p/.claude/settings.json', '/p/.git/config', '/p/pkg/AGENTS.md', '/p/.github/workflows/ci.yml', '/p/taskquoin.yaml']) {
    assert.ok(ids(evaluateRules({ kind: 'write', paths: [p] }, broad)).includes('CONFIG001'), p);
  }
  assert.ok(PROTECTED_WRITE_GLOBS.includes('.claude/**'));
});

test('FROZEN001: dependency directories inherited by Verify are never writable, whatever the globs (ADR-0014)', () => {
  const frozen = { ...policy, writeGlobs: ['**'], frozenRoots: ['/p/node_modules', '/p/apps/web/node_modules'] };
  for (const p of ['/p/node_modules', '/p/node_modules/yaml/index.js', '/p/apps/web/node_modules/x/y.js']) {
    assert.deepEqual(ids(evaluateRules({ kind: 'write', paths: [p] }, frozen)), ['FROZEN001'], p);
  }
  assert.equal(evaluateRules({ kind: 'write', paths: ['/p/node_modules_extra/a.js'] }, frozen).decision, 'allow', 'prefix is not inside');
  assert.equal(evaluateRules({ kind: 'write', paths: ['/p/src/a.ts'] }, frozen).decision, 'allow');
  assert.equal(evaluateRules({ kind: 'read', paths: ['/p/node_modules/yaml/index.js'] }, frozen).decision, 'allow', 'reading stays allowed');
});

test('one bad path among several denies the whole call', () => {
  assert.equal(evaluateRules({ kind: 'write', paths: ['/p/src/a.ts', '/p/.claude/x'] }, policy).decision, 'deny');
});

test('SECRET001: project secrets and HOME secrets', () => {
  for (const p of ['/p/.env', '/p/apps/api/.env.local', '/p/certs/server.key', '/h/.ssh/id_ed25519', '/h/.aws/credentials', '/h/.codex/auth.json']) {
    assert.deepEqual(ids(evaluateRules({ kind: 'read', paths: [p] }, policy)), ['SECRET001'], p);
  }
  assert.equal(evaluateRules({ kind: 'read', paths: ['/p/src/a.ts'] }, policy).decision, 'allow');
  assert.ok(SECRET_READ_GLOBS.includes('**/.env'));
});

test('GIT001: hook bypass and ungranted push', () => {
  for (const c of ['git commit --no-verify -m x', 'git commit -n -m x', 'git commit -nm x', 'git -c core.hooksPath=/dev/null commit -m x',
    'git config core.hooksPath x', 'HUSKY=0 git commit -m x', 'LEFTHOOK=0 git commit -m x', 'SKIP=lint git commit -m x',
    'npm test && git push origin main', 'git push', 'cd sub; git push --force']) {
    assert.ok(ids(evaluateRules({ kind: 'shell', command: c }, policy)).includes('GIT001'), c);
  }
  for (const c of ['git commit -m "add -n flag docs"', 'git status', 'npm test', 'git log --no-merges']) {
    assert.equal(evaluateRules({ kind: 'shell', command: c }, policy).decision, 'allow', c);
  }
  assert.ok(ids(evaluateRules({ kind: 'shell', command: 'git commit -m x' }, { ...policy, vcs: { commit: false, push: false } })).includes('GIT001'));
});

test('violations carry a human-readable reason naming the path or command', () => {
  const r = evaluateRules({ kind: 'write', paths: ['/p/.claude/settings.json'] }, policy);
  assert.match(r.violations[0].reason, /\.claude\/settings\.json/);
});

test('selectInheritedRoots (ADR-0014, Codex CR #4): collapsed ignored entries by glob; literal owner paths inside an ignored dir; nested roots merged; never a tracked path', async () => {
  const { selectInheritedRoots } = await import('../src/index.ts');
  const entries = [{ path: 'node_modules', dir: true }, { path: 'apps/web/node_modules', dir: true }, { path: 'build', dir: true }, { path: '.env', dir: false }];
  const exists = (p: string) => ['build/deps', 'src/lib'].includes(p);
  assert.deepEqual(selectInheritedRoots(entries, ['**/node_modules'], exists), ['apps/web/node_modules', 'node_modules']);
  assert.deepEqual(selectInheritedRoots(entries, ['**/node_modules', 'build/deps'], exists), ['apps/web/node_modules', 'build/deps', 'node_modules'], 'literal path under the ignored build/');
  assert.deepEqual(selectInheritedRoots(entries, ['src/lib'], exists), [], 'a tracked (not ignored) path is never inherited: it would shadow the tree');
  assert.deepEqual(selectInheritedRoots(entries, ['build/missing'], exists), [], 'absent');
  assert.deepEqual(selectInheritedRoots(entries, ['build', 'build/deps'], exists), ['build'], 'nested roots collapse to the outer one');
});
