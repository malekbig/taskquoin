/**
 * PROVES (real processes, temp git repos, fake runtimes, isolated XDG_STATE_HOME):
 *  - init detects the stack, writes taskquoin.yaml, records it in a manifest kept in the control store (outside the
 *    repo), refuses to overwrite and refuses outside a git repository;
 *  - doctor/check run the enforcement gate for every agent and exit 1 when an agent cannot be certified, naming the
 *    capability and the reason (missing bash-sandbox, version mismatch…); owner exceptions are shown as accepted risks;
 *  - uninstall removes only files Taskquoin created and that are unchanged; a user-edited file is kept and reported;
 *    --purge-state removes the control store.
   --json outputs are non-empty and byte-identical in English and French.
 * DOES NOT PROVE: real runtime behaviour (live suites).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { newRun, type RunState } from '@taskquoin/application';
import { putArtifact, repoStore, saveRunState } from '@taskquoin/store-fs';

const main = new URL('../src/main.ts', import.meta.url).pathname;
const gitBin = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

function sandbox(versions = { claude: '2.1.327 (Claude Code)', codex: 'codex-cli 0.157.1' }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tq-cli-')));
  const bin = join(root, 'bin'); mkdirSync(bin);
  for (const [n, out] of Object.entries(versions)) { writeFileSync(join(bin, n), `#!/bin/sh\necho "${out}"\n`); chmodSync(join(bin, n), 0o755); }
  symlinkSync(gitBin, join(bin, 'git'));
  const ws = join(root, 'ws'); mkdirSync(ws);
  const env = { PATH: bin, HOME: root, XDG_STATE_HOME: join(root, 'state'), LANG: 'C.UTF-8' };
  const tq = (...args: string[]) => spawnSync(process.execPath, [main, ...args], { cwd: ws, env, encoding: 'utf8' });
  return { root, ws, env, tq };
}
const git = (cwd: string, ...a: string[]) => execFileSync(gitBin, a, { cwd });
const noMemory = (ws: string) => writeFileSync(join(ws, 'taskquoin.yaml'), readFileSync(join(ws, 'taskquoin.yaml'), 'utf8').replace(/enabled: true/, 'enabled: false'));

test('version: prints "taskquoin <package.json version>", exits 0, works outside a git repo; listed in help', () => {
  const { tq } = sandbox();                       // no `git init` on purpose
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const r = tq('version');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `taskquoin ${version}\n`);
  assert.equal(r.stderr, '');
  assert.match(tq('help').stdout, /^\s+version\s+\S/m);
});

test('help: follows the language (TASKQUOIN_LANG=fr is French); TASKQUOIN_LANG=de is German', () => {
  const { tq, env } = sandbox();
  const en = tq('help').stdout;
  assert.match(en, /create taskquoin\.yaml for the detected stack/);
  const run = (lang: string) => spawnSync(process.execPath, [main, 'help'], { env: { ...env, TASKQUOIN_LANG: lang }, encoding: 'utf8' }).stdout;
  assert.match(run('fr'), /crée taskquoin\.yaml pour la pile détectée/);
  assert.notEqual(run('fr'), en);
  const de = run('de');
  assert.match(de, /gesteuerte Ausführung für Coding-Agenten/);
  assert.notEqual(de, en);
});

test('accept-risk made in English still shows as an accepted risk under TASKQUOIN_LANG=fr (French frame, same capability), exit code unchanged', () => {
  const { ws, env, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  assert.equal(tq('accept-risk', 'challenger', 'connector.write', '--reason', 'x', '--expires', '2099-01-01', '--as', 'owner').status, 0);
  const en = tq('doctor');
  const fr = spawnSync(process.execPath, [main, 'doctor'], { cwd: ws, env: { ...env, TASKQUOIN_LANG: 'fr' }, encoding: 'utf8' });
  assert.equal(fr.status, en.status);
  assert.match(fr.stdout, /⚠ connector\.write risque accepté \(approuvé par owner/);
  assert.match(en.stdout, /⚠ connector\.write accepted risk \(approved by owner/);
  const j = (lang: string) => JSON.parse(spawnSync(process.execPath, [main, 'check', 'challenger', '--json'], { cwd: ws, env: { ...env, TASKQUOIN_LANG: lang }, encoding: 'utf8' }).stdout);
  assert.ok(Object.keys(j('en')).length > 0, '--json output is a non-empty object');
  assert.deepEqual(j('fr'), j('en'), '--json is byte-identical whatever the language');
});

test('init: stack detection, manifest outside the repo, no overwrite, git required', () => {
  const { ws, root, tq } = sandbox();
  assert.equal(tq('init').status, 1, 'outside a git repo');
  git(ws, 'init', '-q'); writeFileSync(join(ws, 'composer.json'), '{}');
  const r = tq('init');
  assert.equal(r.status, 0, r.stderr);
  const y = readFileSync(join(ws, 'taskquoin.yaml'), 'utf8');
  assert.match(y, /stack: php/); assert.match(y, /vendor\/bin\/phpunit/);
  assert.match(r.stdout, /taskquoin doctor/);
  const manifests = execFileSync('sh', ['-c', `find ${join(root, 'state')} -name manifest.json`], { encoding: 'utf8' }).trim().split('\n');
  assert.equal(manifests.length, 1);
  assert.ok(!manifests[0].startsWith(ws));
  assert.equal(tq('init').status, 1, 'refuses to overwrite');
  assert.match(tq('init').stderr, /already exists/);
});

test('doctor: refuses agents that cannot be certified and says why', () => {
  const { ws, tq } = sandbox();
  git(ws, 'init', '-q'); writeFileSync(join(ws, 'package.json'), '{}');
  assert.equal(tq('init').status, 0); noMemory(ws);
  const r = tq('doctor');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /Bash sandbox .*✖/);
  assert.match(r.stdout, /Agent implementer \(claude\)/);
  assert.match(r.stdout, /✖ net\.egress.*bash-sandbox/);
  assert.match(r.stdout, /Agent challenger \(codex\)/);
  assert.match(r.stdout, /Remote connectors \(ADR-0012\): none/);
});

test('check --json and version mismatch', () => {
  const { ws, tq } = sandbox({ claude: '2.1.327 (Claude Code)', codex: 'codex-cli 0.999.0' });
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  const r = tq('check', 'challenger', '--json');
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  assert.equal(j.agent, 'challenger'); assert.equal(j.ok, false);
  assert.ok(j.failures.every((f: { message: string }) => /measured for codex 0\.157\.1, installed 0\.999\.0/.test(f.message)));
  assert.equal(tq('check', 'ghost').status, 2);
});

test('accept-risk: stored in the control store (not the repo), bound to the current failure, shown as accepted risk', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  assert.equal(tq('accept-risk', 'challenger', 'connector.write', '--reason', 'x', '--expires', '2099-99-99', '--as', 'owner').status, 2, 'impossible date');
  assert.equal(tq('accept-risk', 'challenger', 'fs.read', '--reason', 'x', '--expires', '2099-01-01', '--as', 'owner').status, 1, 'nothing failing to accept');
  const r = tq('accept-risk', 'challenger', 'connector.write', '--reason', 'Codex MCP absence not measurable', '--expires', '2099-01-01', '--as', 'owner');
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /bound to this exact failure/);
  assert.ok(!readFileSync(join(ws, 'taskquoin.yaml'), 'utf8').includes('exceptions'), 'nothing written to the repository');
  const stored = execFileSync('sh', ['-c', `find ${join(root, 'state')} -name risk-acceptances.json`], { encoding: 'utf8' }).trim();
  assert.ok(stored && !stored.startsWith(ws));
  const j = JSON.parse(tq('check', 'challenger', '--json').stdout);
  assert.ok(j.acceptedRisks.some((a: { capability: string }) => a.capability === 'connector.write'));
  assert.ok(!j.failures.some((f: { capability: string }) => f.capability === 'connector.write'));
});

test('repository cannot weaken the floor: mandatory: [] still enforces built-in restrictions; exceptions in YAML rejected', () => {
  const { ws, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  const y = readFileSync(join(ws, 'taskquoin.yaml'), 'utf8');
  writeFileSync(join(ws, 'taskquoin.yaml'), y.replace(/mandatory:\n(    - .*\n)+/, 'mandatory: []\n'));
  const j = JSON.parse(tq('check', 'challenger', '--json').stdout);
  assert.ok(j.resolved.some((r: { capability: string }) => r.capability === 'connector.write'), 'floor still evaluated');
  writeFileSync(join(ws, 'taskquoin.yaml'), y.replace('policy:\n', 'policy:\n  exceptions: []\n'));
  assert.equal(tq('check', 'challenger').status, 1);
  assert.match(tq('check', 'challenger').stderr, /accept-risk/);
});

test('uninstall: removes unchanged owned files, keeps user edits, purge-state removes the store', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q');
  assert.equal(tq('init').status, 0);
  writeFileSync(join(ws, 'taskquoin.yaml'), readFileSync(join(ws, 'taskquoin.yaml'), 'utf8') + '# my note\n');
  const kept = tq('uninstall');
  assert.equal(kept.status, 1); assert.match(kept.stdout, /kept taskquoin\.yaml \(modified since init\)/);
  assert.ok(existsSync(join(ws, 'taskquoin.yaml')));
  assert.match(tq('uninstall').stdout, /kept taskquoin\.yaml/, 'manifest kept while a recorded file remains');
  const { ws: ws2, root: root2, tq: tq2 } = sandbox();
  git(ws2, 'init', '-q'); assert.equal(tq2('init').status, 0);
  const r = tq2('uninstall', '--purge-state');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!existsSync(join(ws2, 'taskquoin.yaml')));
  assert.equal(execFileSync('sh', ['-c', `find ${join(root2, 'state')} -name manifest.json | wc -l`], { encoding: 'utf8' }).trim(), '0');
  void root;
});

const PLAN_HASH = 'a1'.repeat(32);
const TREE_HASH = 'c3'.repeat(20);
const LONG_FIRST_LINE = 'Refactor the payment module so that every provider shares one retry policy and logs';
const HISTORY_A: RunState['history'] = [
  { node: 'recall', outcome: 'ok', at: '2026-11-01T10:00:00.000Z' },
  { node: 'plan', outcome: 'ok', at: '2026-11-01T10:01:00.000Z' },
];
const SEEDED: RunState[] = [
  { ...newRun('run-a', 'Add X\nmore detail'), status: 'waiting-approval', current: 'approve-plan', attempts: 0, branch: 'taskquoin/run-a', artifacts: { plan: PLAN_HASH }, history: HISTORY_A },
  { ...newRun('run-b', `${LONG_FIRST_LINE}\nsecond line`), status: 'completed', current: 'done', attempts: 1, branch: 'taskquoin/run-b', commit: 'abc123def456', history: [] },
  { ...newRun('run-c', 'Fix Y'), status: 'waiting-approval', current: 'approve-commit', attempts: 2, branch: 'taskquoin/run-c', reviewedTree: TREE_HASH, history: [] },
];

/** Initialised repository whose control store holds the SEEDED runs (written directly: a real run needs live runtimes). */
function seededRepo() {
  const sb = sandbox();
  git(sb.ws, 'init', '-q'); assert.equal(sb.tq('init').status, 0); noMemory(sb.ws);
  const store = repoStore(sb.ws, join(sb.root, 'state', 'taskquoin'));
  const manifest = execFileSync('sh', ['-c', `find ${join(sb.root, 'state')} -name manifest.json`], { encoding: 'utf8' }).trim();
  assert.equal(store.root, dirname(manifest), 'seeded runs land in the store the CLI reads');
  for (const s of SEEDED) saveRunState(store, s.runId, s);
  return sb;
}

test('status --json lists every run as one JSON array', () => {
  const { tq } = seededRepo();
  const r = tq('status', '--json');
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout);
  assert.ok(Array.isArray(j)); assert.equal(j.length, 3);
  assert.deepEqual(j[0], { runId: 'run-a', status: 'waiting-approval', current: 'approve-plan', attempts: 0, branch: 'taskquoin/run-a', commit: null, request: 'Add X' });
  assert.equal(j[1].commit, 'abc123def456');
  assert.equal(j[1].request, LONG_FIRST_LINE, 'full first line, not the 60-character text cut');
  assert.ok(j.every((x: object) => !('history' in x) && !('pendingApproval' in x)));
  const { ws, tq: tqEmpty } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tqEmpty('init').status, 0); noMemory(ws);
  const e = tqEmpty('status', '--json');
  assert.equal(e.status, 0, e.stderr); assert.deepEqual(JSON.parse(e.stdout), []);
});

test('status <run> --json prints one object with history and the pending approval', () => {
  const { tq } = seededRepo();
  const a = tq('status', 'run-a', '--json');
  assert.equal(a.status, 0, a.stderr);
  assert.deepEqual(JSON.parse(a.stdout), { runId: 'run-a', status: 'waiting-approval', current: 'approve-plan', attempts: 0, branch: 'taskquoin/run-a', commit: null, request: 'Add X',
    history: HISTORY_A, pendingApproval: { gate: 'plan', expectedHash: PLAN_HASH } });
  const b = JSON.parse(tq('status', 'run-b', '--json').stdout);
  assert.equal(b.pendingApproval, null); assert.equal(b.commit, 'abc123def456'); assert.deepEqual(b.history, []);
  const c = JSON.parse(tq('status', 'run-c', '--json').stdout);
  assert.deepEqual(c.pendingApproval, { gate: 'commit', expectedHash: TREE_HASH });
});

test('status <unknown> --json still exits 1 with the same error and nothing on stdout', () => {
  const { tq } = seededRepo();
  for (const args of [['status', 'run-zzz', '--json'], ['status', 'run-zzz']]) {
    const r = tq(...args);
    assert.equal(r.status, 1); assert.match(r.stderr, /taskquoin: unknown run run-zzz/); assert.equal(r.stdout, '');
  }
});

test('status text output is unchanged', () => {
  const { tq } = seededRepo();
  const list = tq('status');
  assert.equal(list.status, 0, list.stderr);
  assert.equal(list.stdout, SEEDED.map(s => `${s.runId}  ${s.status.padEnd(16)} ${s.current.padEnd(15)} ${s.request.split('\n')[0].slice(0, 60)}\n`).join(''));
  const one = tq('status', 'run-a');
  assert.equal(one.status, 0, one.stderr);
  assert.equal(one.stdout, [
    'Run run-a — waiting-approval at approve-plan (attempt 0, branch taskquoin/run-a)',
    '  Review it:   taskquoin show run-a plan  (and: challenge)',
    `  Approve it:  taskquoin approve run-a plan --expect ${PLAN_HASH.slice(0, 12)} --as <your name>`,
    `               (plan sha256 ${PLAN_HASH})`,
    ...HISTORY_A.map(h => `  ${h.at}  ${h.node.padEnd(15)} ${h.outcome}`),
  ].join('\n') + '\n');
});

test('status and check --json are byte-identical whatever the language; the text output is translated', () => {
  const { ws, env, tq } = seededRepo();
  const run = (lang: string, ...a: string[]) => spawnSync(process.execPath, [main, ...a], { cwd: ws, env: { ...env, TASKQUOIN_LANG: lang }, encoding: 'utf8' });
  for (const args of [['status', '--json'], ['status', 'run-a', '--json'], ['check', 'challenger', '--json']]) {
    const en = run('en', ...args), fr = run('fr', ...args);
    assert.ok(JSON.parse(en.stdout) !== undefined && en.stdout.trim().length > 2, `${args.join(' ')}: not empty`);
    assert.equal(fr.stdout, en.stdout, args.join(' ')); assert.equal(fr.status, en.status);
  }
  const t = run('fr', 'status', 'run-a').stdout;
  assert.match(t, /Run run-a — waiting-approval à approve-plan \(tentative 0, branche taskquoin\/run-a\)/);
  assert.match(t, /^  Relire :\s+taskquoin show run-a plan  \(et : challenge\)$/m);
  assert.match(t, /^  Approuver :\s+taskquoin approve run-a plan --expect/m);
  assert.match(run('fr', 'show').stderr, /usage : taskquoin show/);
  assert.match(run('fr', 'status', 'run-zzz').stderr, /taskquoin : run inconnu run-zzz/);
  assert.match(run('fr', 'skills', 'revoke').stderr, /usage : taskquoin skills revoke/);
  assert.match(run('en', 'skills', 'revoke').stderr, /usage: taskquoin skills revoke/);
});

test('uninstall never follows a tampered manifest outside the repository', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0);
  const victim = join(root, 'victim.txt'); writeFileSync(victim, 'keep me');
  const mf = execFileSync('sh', ['-c', `find ${join(root, 'state')} -name manifest.json`], { encoding: 'utf8' }).trim();
  const { createHash } = require('node:crypto') as typeof import('node:crypto');
  const m = JSON.parse(readFileSync(mf, 'utf8')); m.files.push({ path: '../victim.txt', sha256: createHash('sha256').update('keep me').digest('hex') });
  writeFileSync(mf, JSON.stringify(m));
  const r = tq('uninstall');
  assert.equal(r.status, 1); assert.match(r.stderr, /manifest/i);
  assert.ok(existsSync(victim), 'file outside the repository untouched');
  assert.ok(existsSync(join(ws, 'taskquoin.yaml')), 'nothing removed when the manifest is invalid');
});

test('show prints a large artifact completely even through a pipe (no exit before stdout drains — pilot 2)', () => {
  const { ws, root, env, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0);
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  const big = Array.from({ length: 6000 }, (_, i) => `ok ${i} - a test line long enough to matter`).join('\n') + '\n# tests 6000\n';
  const ref = putArtifact(store, Buffer.from(big), { mediaType: 'text/plain', producer: 'test' });
  saveRunState(store, 'run-big', { runId: 'run-big', workflow: 'feature-governed', request: 'x', status: 'completed', current: 'done', revision: 1, attempts: 1, artifacts: { 'verify-1': ref.sha256 }, approvals: {}, history: [] });
  const r = tq('show', 'run-big', 'verify-1');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(big.length > 200_000, 'artifact larger than a pipe buffer');
  assert.equal(r.stdout.trimEnd(), big.trimEnd(), 'every byte reaches the reader');
  // a real OS pipe to a slower reader (spawnSync uses sockets, which never showed the loss)
  const piped = spawnSync('/bin/sh', ['-c', `"${process.execPath}" "${main}" show run-big verify-1 | (sleep 0.3; wc -c)`], { cwd: ws, env: { ...env, PATH: `${env.PATH}:/bin:/usr/bin` }, encoding: 'utf8' });
  assert.equal(Number(piped.stdout.trim()), Buffer.byteLength(big) + 1, 'nothing lost through a pipe (+ the final newline of out())');
});

function runWith(store: ReturnType<typeof repoStore>, runId: string, artifacts: Record<string, string>) {
  saveRunState(store, runId, { runId, workflow: 'feature-governed', request: 'x', status: 'completed', current: 'done', revision: 1, attempts: 1, artifacts, approvals: {}, history: [] });
}

test('show <run> without an artifact lists artifacts sorted by name with their size', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0);
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  const put = (s: string) => putArtifact(store, Buffer.from(s), { mediaType: 'text/plain', producer: 'test' }).sha256;
  runWith(store, 'run-ls', { 'verify-1': put('0123456789'), 'plan': put('abc'), 'diff-1': put('hello'), 'memory': put('é') });
  const r = tq('show', 'run-ls');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'diff-1  5\nmemory  2\nplan  3\nverify-1  10\n', 'sorted by name, size in bytes (é is 2 bytes)');
  assert.equal(tq('show', 'run-ls', 'plan').stdout, 'abc\n', 'show <run> <artifact> unchanged');
  assert.equal(tq('show', 'run-ls', 'nope').status, 1, 'unknown artifact still exits 1');
  runWith(store, 'run-empty', {});
  const e = tq('show', 'run-empty');
  assert.equal(e.status, 0, e.stderr); assert.equal(e.stdout, '');
});

test('show without a run id keeps the usage error and mentions red-N and ignored-N', () => {
  const { ws, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0);
  const r = tq('show');
  assert.equal(r.status, 2);
  assert.match(r.stderr, /usage: taskquoin show/); assert.match(r.stderr, /red-N/); assert.match(r.stderr, /ignored-N/);
});

test('show <unknown run> without an artifact exits 1 with the unknown-run error', () => {
  const { ws, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0);
  const r = tq('show', 'run-nope');
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /taskquoin: unknown run run-nope/);
});

test('setup: the taskquoin shortcut in the user HOME (symlink to the launcher), removable; never automatic without a terminal', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q');
  assert.equal(tq('help').status, 0);
  assert.equal(existsSync(join(root, '.local', 'bin', 'taskquoin')), false, 'no automatic setup when not in a terminal');
  const r = tq('setup');
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /shortcut installed/);
  const link = join(root, '.local', 'bin', 'taskquoin');
  assert.ok(lstatSync(link).isSymbolicLink()); assert.equal(readlinkSync(link), realpathSync(new URL('../../../bin/taskquoin', import.meta.url).pathname));
  assert.match(readFileSync(join(root, '.bashrc'), 'utf8'), /# >>> taskquoin >>>/, 'this sandbox PATH lacks ~/.local/bin: block added');
  assert.match(tq('setup').stdout, /already in place/);
  const rm = tq('setup', '--remove');
  assert.equal(rm.status, 0); assert.equal(existsSync(link), false); assert.doesNotMatch(readFileSync(join(root, '.bashrc'), 'utf8'), /taskquoin/);
});

// ── multi-LLM judges (project A, Task 5) ─────────────────────────────────────────────────────────────────────────
function withJudge(ws: string, provider: Record<string, unknown> = { url: 'https://api.deepseek.com/v1', model: 'deepseek-chat', key: 'env:DEEPSEEK_API_KEY' }) {
  const YAML = require('yaml');
  const p = join(ws, 'taskquoin.yaml'); const raw = YAML.parse(readFileSync(p, 'utf8'));
  raw.providers = { deepseek: provider, local: { url: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' } };
  raw.agents.security = { runtime: 'api', provider: 'deepseek', description: 'Revue de sécurité', prompt: 'Tu es relecteur de sécurité.', capabilities: {} };
  raw.workflow = { challengers: ['challenger'], reviewers: ['challenger', 'security'] };
  raw.memory.claudeMem.enabled = false;
  writeFileSync(p, YAML.stringify(raw)); git(ws, 'add', '.'); git(ws, '-c', 'user.email=o@example.invalid', '-c', 'user.name=o', 'commit', '-q', '-m', 'judges');
}

test('api judges: doctor says where the code goes (no network call); check certifies the api judge when its key is set', () => {
  const { ws, env, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); withJudge(ws);
  (env as Record<string, string>).DEEPSEEK_API_KEY = 'sk-test';
  const d = tq('doctor');
  assert.match(d.stdout, /This project's code is sent to:/);
  assert.match(d.stdout, /Anthropic \(Claude Code\) — planner, implementer/);
  assert.match(d.stdout, /OpenAI \(Codex\) — challenger/);
  assert.match(d.stdout, /api\.deepseek\.com \(deepseek-chat\) — security/);
  const c = JSON.parse(tq('check', 'security', '--json').stdout);
  assert.equal(c.ok, true, JSON.stringify(c.failures));
  assert.ok(c.resolved.every((r: { certified: boolean }) => r.certified), 'every mandatory restriction certified for the api judge');
  assert.doesNotMatch(d.stdout + d.stderr, /sk-test/, 'the key is never printed');
});

test('check --json for an api judge with a missing key is byte-identical in English and French (failure messages stay English)', () => {
  const { ws, env } = sandbox();
  git(ws, 'init', '-q'); assert.equal(spawnSync(process.execPath, [main, 'init'], { cwd: ws, env, encoding: 'utf8' }).status, 0); withJudge(ws);
  const run = (lang: string) => spawnSync(process.execPath, [main, 'check', 'security', '--json'], { cwd: ws, env: { ...env, TASKQUOIN_LANG: lang }, encoding: 'utf8' });
  const [en, fr] = [run('en'), run('fr')];
  assert.match(en.stdout, /DEEPSEEK_API_KEY is missing/);
  assert.ok(JSON.parse(en.stdout).failures.length > 0, 'non-empty JSON');
  assert.equal(fr.stdout, en.stdout);
});

test('api judges: run refuses to start when the key is missing or EMPTY — nothing created, the variable is named (Review Focus)', () => {
  const { ws, env, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); withJudge(ws);
  for (const v of [undefined, '']) {
    if (v === undefined) delete (env as Record<string, string>).DEEPSEEK_API_KEY; else (env as Record<string, string>).DEEPSEEK_API_KEY = v;
    const r = tq('run', 'Ajouter une fonction sum');
    assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, /security/); assert.match(r.stderr, /DEEPSEEK_API_KEY is missing/);
    assert.equal(git(ws, 'branch', '--list', 'taskquoin/*').toString().trim(), '', 'no run branch');
  }
  const c = JSON.parse(tq('check', 'security', '--json').stdout);
  assert.equal(c.ok, false); assert.match(c.failures[0].message, /DEEPSEEK_API_KEY is missing/);
  assert.equal(tq('accept-risk', 'security', 'net.egress', '--reason', 'x', '--expires', '2099-01-01', '--as', 'o').status, 1, 'nothing to accept for an api judge');
});

test('init by installed tools: Claude only → a Claude-only config + detected AIs as commented suggestions; Codex only → says why', () => {
  const only = sandbox({ claude: '2.1.327 (Claude Code)' } as never);
  git(only.ws, 'init', '-q'); (only.env as Record<string, string>).DEEPSEEK_API_KEY = 'sk-never-written';
  const r = only.tq('init');
  assert.equal(r.status, 0, r.stderr);
  const text = readFileSync(join(only.ws, 'taskquoin.yaml'), 'utf8');
  assert.match(text, /# .*api\.deepseek\.com/); assert.doesNotMatch(text, /sk-never-written/);
  assert.match(r.stdout, /DEEPSEEK_API_KEY/); assert.match(r.stdout, /uncomment them/);
  const YAML = require('yaml'); const cfg = YAML.parse(text);
  assert.equal(cfg.agents.challenger.runtime, 'claude'); assert.equal(cfg.providers, undefined, 'nothing active');
  assert.match(only.tq('doctor').stdout, /same model as the implementer/);
  const codex = sandbox({ codex: 'codex-cli 0.157.1' } as never);
  git(codex.ws, 'init', '-q');
  const c = codex.tq('init');
  assert.equal(c.status, 0, c.stderr); assert.match(c.stdout, /install Claude Code or OpenCode/);
});

test('connect opencode: missing → 1; a login stores a provider → listed without secret; --remove deletes it; other targets → usage 2', () => {
  const { root, tq } = sandbox();
  let r = tq('connect', 'opencode'); assert.equal(r.status, 1); assert.match(r.stderr, /OpenCode is not installed/);
  const fake = join(root, 'bin', 'opencode');
  writeFileSync(fake, '#!/bin/sh\n/bin/mkdir -p "$XDG_DATA_HOME/opencode"\nprintf \'{"openai":{"type":"oauth","access":"SECRET-A"}}\' > "$XDG_DATA_HOME/opencode/auth.json"\n'); chmodSync(fake, 0o755);
  r = tq('connect', 'opencode'); assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /openai \(oauth\)/); assert.ok(!(r.stdout + r.stderr).includes('SECRET-A'));
  assert.ok(existsSync(join(root, 'state', 'taskquoin', 'opencode', 'data', 'opencode', 'auth.json')));
  r = tq('connect', 'opencode', '--remove'); assert.equal(r.status, 0); assert.ok(!existsSync(join(root, 'state', 'taskquoin', 'opencode')));
  assert.equal(tq('connect', 'claude').status, 2);
});

test("uninstall --purge-state leaves Taskquoin's OpenCode connection (it belongs to no repository)", () => {
  const { root, ws, tq } = sandbox(); git(ws, 'init', '-q');
  assert.equal(tq('init').status, 0);
  const conn = join(root, 'state', 'taskquoin', 'opencode'); mkdirSync(conn, { recursive: true, mode: 0o700 });
  assert.equal(tq('uninstall', '--purge-state').status, 0);
  assert.ok(existsSync(conn));
});

// ── OpenCode in the CLI (project B) ──────────────────────────────────────────────────────────────────────────────
function ocProject(connected: boolean) {
  const sb = sandbox({ opencode: '1.19.5' } as never); git(sb.ws, 'init', '-q');
  writeFileSync(join(sb.ws, 'package.json'), '{"name":"calc"}');
  assert.equal(sb.tq('init').status, 0); noMemory(sb.ws);
  git(sb.ws, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'); git(sb.ws, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  if (connected) { const d = join(sb.root, 'state', 'taskquoin', 'opencode', 'data', 'opencode'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'auth.json'), JSON.stringify({ openai: { type: 'oauth', access: 'SECRET' } }), { mode: 0o600 }); }
  return sb;
}

test('init with OpenCode only: an all-OpenCode config with verify.command and a hint to choose the model; with nothing: install one', () => {
  const { ws, tq } = sandbox({ opencode: '1.19.5' } as never); git(ws, 'init', '-q'); writeFileSync(join(ws, 'package.json'), '{}');
  const r = tq('init'); assert.equal(r.status, 0, r.stderr);
  const y = readFileSync(join(ws, 'taskquoin.yaml'), 'utf8'); assert.match(y, /runtime: opencode/); assert.match(y, /command: npm test/);
  assert.match(r.stdout, /choose the model/);
  const none = sandbox({} as never); git(none.ws, 'init', '-q');
  assert.match(none.tq('init').stdout, /install Claude Code or OpenCode/);
});

test('doctor: OpenCode runtime and file sandbox lines; where the code goes, with the measured hosts; not connected → connect hint', () => {
  const { tq } = ocProject(false);
  let r = tq('doctor'); assert.equal(r.status, 1);
  assert.match(r.stdout, /Runtime opencode: 1\.19\.5 .*✔/); assert.match(r.stdout, /File sandbox \(bubblewrap\): /);
  assert.match(r.stdout, /openai via OpenCode \(openai\/[^)]+\) — hosts: chatgpt\.com — planner, implementer, challenger/);
  assert.match(r.stdout, /provider "openai" is not connected for Taskquoin — run: taskquoin connect opencode/);
  r = ocProject(true).tq('doctor'); assert.doesNotMatch(r.stdout, /is not connected/);
});

test('run with an OpenCode judge whose provider is not connected is refused before anything changes', () => {
  const { ws, tq } = ocProject(false);
  const before = git(ws, 'branch', '--list').toString();
  const r = tq('run', 'add sum'); assert.equal(r.status, 1); assert.match(r.stderr, /challenger cannot start — .*is not connected/);
  assert.equal(git(ws, 'branch', '--list').toString(), before);
});

test('final review (C1): a provider/sign-in mode whose hosts were never measured is refused by doctor and run', () => {
  const { ws, root, tq } = ocProject(false);
  writeFileSync(join(ws, 'taskquoin.yaml'), readFileSync(join(ws, 'taskquoin.yaml'), 'utf8').replaceAll('openai/gpt-6-astra', 'openrouter/deepseek/deepseek-chat'));
  git(ws, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'openrouter');
  const d = join(root, 'state', 'taskquoin', 'opencode', 'data', 'opencode'); mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'auth.json'), JSON.stringify({ openrouter: { type: 'api', key: 'SECRET' } }), { mode: 0o600 });
  const r = tq('doctor'); assert.equal(r.status, 1);
  assert.match(r.stdout, /connection "openrouter" \(api\) is not measured with OpenCode 1\.19\.5/);
  assert.match(tq('run', 'add sum').stderr, /is not measured/);
});
