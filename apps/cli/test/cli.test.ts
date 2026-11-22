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
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { newRun, type RunState } from '@taskquoin/application';
import { appendEvent, putArtifact, repoStore, saveRunState } from '@taskquoin/store-fs';

const main = new URL('../src/main.ts', import.meta.url).pathname;
const gitBin = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

function sandbox(versions = { claude: '2.1.327 (Claude Code)', codex: 'codex-cli 0.157.1' }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'tq-cli-')));
  const bin = join(root, 'bin'); mkdirSync(bin);
  for (const [n, out] of Object.entries(versions)) { writeFileSync(join(bin, n), `#!/bin/sh\necho "${out}"\n`); chmodSync(join(bin, n), 0o755); }
  symlinkSync(gitBin, join(bin, 'git'));
  const ws = join(root, 'ws'); mkdirSync(ws);
  const env = { PATH: bin, HOME: root, XDG_STATE_HOME: join(root, 'state'), LANG: 'C.UTF-8', TZ: 'UTC' };
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
    history: HISTORY_A, pendingApproval: { gate: 'plan', expectedHash: PLAN_HASH }, reason: null });
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

test('status text output: the list is unchanged; status <run> shows the timeline between the head and the commands', () => {
  const { tq } = seededRepo();
  const list = tq('status');
  assert.equal(list.status, 0, list.stderr);
  // A first line longer than 60 columns is cut with an ellipsis within the 60 (final review M1).
  const first = (r: string) => { const l = r.split('\n')[0]; return l.length > 60 ? l.slice(0, 59) + '\u2026' : l; };
  assert.equal(list.stdout, SEEDED.map(s => `${s.runId}  ${s.status.padEnd(16)} ${s.current.padEnd(15)} ${first(s.request)}\n`).join(''));
  const one = tq('status', 'run-a');
  assert.equal(one.status, 0, one.stderr);
  const lines = one.stdout.split('\n');
  assert.equal(lines.at(-1), '');
  assert.deepEqual(lines.slice(0, 1), ['Run run-a — waiting-approval at approve-plan (attempt 0, branch taskquoin/run-a)']);
  // The timeline of the real state machine follows the head: 9 steps, the gate waiting, nothing invented.
  assert.equal(lines[1], '  ✔ Planning              done  10:01:00  ?  show plan');
  assert.equal(lines[2], '  ✔ Adversarial critique  done  ?  ?');
  assert.match(lines[3], /^  ◆ Plan approval         waiting  \d+ h \d+ min  a1a1a1a1a1a1$/);
  assert.deepEqual(lines.slice(4, 10), ['Implementation', 'Clean-room Verify', 'RED proof', 'Review', 'Commit approval', 'Commit'].map(x => `  · ${x.padEnd(20)}  pending`));
  assert.ok(!/%/.test(lines.slice(1, 10).join('\n')), 'no percentage');
  assert.deepEqual(lines.slice(10), [
    '  Review it:   taskquoin show run-a plan  (and: challenge)',
    `  Approve it:  taskquoin approve run-a plan --expect ${PLAN_HASH.slice(0, 12)} --as <your name>`,
    `               (plan sha256 ${PLAN_HASH})`,
    ...HISTORY_A.map(h => `  ${h.at}  ${h.node.padEnd(15)} ${h.outcome}`),
    '',
  ]);
});

test('status <run>: the agent of a step comes from the event log; the output has no escape off a terminal and the same JSON bytes', () => {
  const { ws, env, tq } = seededRepo();
  const store = repoStore(ws, join(env.XDG_STATE_HOME, 'taskquoin'));
  const jsonBefore = tq('status', 'run-a', '--json').stdout;
  appendEvent(store, 'run-a', { type: 'agent.started', runId: 'run-a', agent: 'planner', runtime: 'claude' });
  appendEvent(store, 'run-a', { type: 'agent.finished', runId: 'run-a', agent: 'planner', runtime: 'claude', status: 'completed', durationMs: 98_000, model: 'opus' });
  appendEvent(store, 'run-a', { type: 'node.transition', runId: 'run-a', node: 'plan', outcome: 'ok', next: 'challenge' });
  const r = tq('status', 'run-a');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^  ✔ Planning\s+done\s+planner · claude\s+10:01:00\s+\?\s+show plan$/m);
  assert.ok(!r.stdout.includes('\x1b'));
  assert.equal(tq('status', 'run-a', '--json').stdout, jsonBefore, 'the events never reach --json');
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

test('runtimeNotices: fallback when the probe chose the installed measured binary, action when the version differs and nothing measured is installed, none otherwise', async () => {
  const { runtimeNotices } = await import('../src/runtime-notices.ts');
  const h = (claude: { bin: string; version?: string; installed?: { bin: string; version?: string } }) => ({ runtimes: { claude } }) as never;
  const fb = runtimeNotices(h({ bin: '/m', version: '2.1.327', installed: { bin: '/p', version: '9.9.9' } }), '2.1.327');
  assert.deepEqual(fb.map(n => n.kind), ['fallback']);
  assert.match(fb[0].text, /9\.9\.9.*2\.1\.327/);
  const act = runtimeNotices(h({ bin: '/p', version: '9.9.9' }), '2.1.327');
  assert.deepEqual(act.map(n => n.kind), ['action']);
  assert.match(act[0].text, /9\.9\.9.*2\.1\.327/);
  assert.deepEqual(runtimeNotices(h({ bin: '/p', version: '2.1.327' }), '2.1.327'), []);
  assert.deepEqual(runtimeNotices({ runtimes: {} } as never, '2.1.327'), []);
});

test('doctor: the PATH claude is not measured but the measured one is still installed -> says which one runs, no refusal for claude', () => {
  const measured = JSON.parse(readFileSync(new URL('../../../adapters/runtime-claude/src/capabilities.json', import.meta.url), 'utf8')).runtimeVersion as string;
  const { ws, root, tq } = sandbox({ claude: '9.9.9 (Claude Code)', codex: 'codex-cli 0.157.1' });
  const dir = join(root, '.local/share/claude/versions'); mkdirSync(dir, { recursive: true });
  chmodSync(join(root, '.local/share/claude'), 0o755); chmodSync(dir, 0o755);
  writeFileSync(join(dir, measured), `#!/bin/sh\necho "${measured} (Claude Code)"\n`); chmodSync(join(dir, measured), 0o755);
  git(ws, 'init', '-q'); writeFileSync(join(ws, 'package.json'), '{}');
  assert.equal(tq('init').status, 0); noMemory(ws);
  const r = tq('doctor');
  assert.match(r.stdout, new RegExp(`Runtime claude: installed 9\\.9\\.9 \\(not measured\\) → using ${measured.replace(/\./g, '\\.')} \\(measured\\) \\(`));
  assert.doesNotMatch(r.stdout, /Agent implementer \(claude\)[^\n]*\n[^\n]*runtime-version/);
});

test('runtimeNotices: a measured file that is there but not used says why and how to fix it, for the console and the CLI', async () => {
  const { runtimeNotices } = await import('../src/runtime-notices.ts');
  const h = (claude: { bin: string; version?: string } | undefined, reason: string) => ({ runtimes: claude ? { claude } : {}, claudeCandidate: { bin: '/h/v/2.1.327', reason } }) as never;
  let n = runtimeNotices(h({ bin: '/p', version: '9.9.9' }, 'writable by others'), '2.1.327');
  assert.deepEqual(n.map(x => x.kind), ['action']);
  assert.match(n[0].text, /Claude Code 2\.1\.327 is installed but not used: it or its folder is writable by group or others — run chmod go-w \/h\/v \/h\/v\/2\.1\.327/);
  assert.doesNotMatch(n[0].text, /not installed/);
  n = runtimeNotices(h({ bin: '/p', version: '9.9.9' }, 'selection path'), '2.1.327');
  assert.match(n[0].text, /not used: the choice is PATH only — run \/upgrade auto/);
  n = runtimeNotices(h({ bin: '/p', version: '9.9.9' }, 'selection path'), '2.1.327', 'cli');
  assert.match(n[0].text, /run taskquoin upgrade auto/);
  n = runtimeNotices(h(undefined, 'version mismatch'), '2.1.327', 'cli'); // no claude on the PATH: still said
  assert.match(n[0].text, /not used: its --version does not answer that version — run taskquoin upgrade install/);
  const act = runtimeNotices({ runtimes: { claude: { bin: '/p', version: '9.9.9' } } } as never, '2.1.327', 'cli');
  assert.match(act[0].text, /9\.9\.9 is not measured and 2\.1\.327 is not installed — run taskquoin upgrade install/);
});

test('doctor (CLI): an unmeasured claude with nothing measured installed points to taskquoin upgrade; the usage lists upgrade', () => {
  const { ws, tq } = sandbox({ claude: '9.9.9 (Claude Code)', codex: 'codex-cli 0.157.1' });
  git(ws, 'init', '-q'); writeFileSync(join(ws, 'package.json'), '{}');
  assert.equal(tq('init').status, 0); noMemory(ws);
  const r = tq('doctor');
  assert.match(r.stdout, /◆ Action required {2}Claude Code 9\.9\.9 is not measured and \S+ is not installed — run taskquoin upgrade install/);
  assert.doesNotMatch(r.stdout, /— \/upgrade/);
  assert.match(tq('nope').stderr, /usage: taskquoin <[^\n]*\|upgrade \[auto\|path\|install\] \[--offline\]\|/);
});

test('doctor: a measured Claude Code installed but not used says why (versions/ at 0775, or the PATH-only choice) instead of "not installed"', () => {
  const measured = JSON.parse(readFileSync(new URL('../../../adapters/runtime-claude/src/capabilities.json', import.meta.url), 'utf8')).runtimeVersion as string;
  const { ws, root, env, tq } = sandbox({ claude: '9.9.9 (Claude Code)', codex: 'codex-cli 0.157.1' });
  const dir = join(root, '.local/share/claude/versions'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, measured), `#!/bin/sh\necho "${measured} (Claude Code)"\n`); chmodSync(join(dir, measured), 0o755);
  chmodSync(dir, 0o775);
  git(ws, 'init', '-q'); writeFileSync(join(ws, 'package.json'), '{}');
  assert.equal(tq('init').status, 0); noMemory(ws);
  const v = measured.replace(/\./g, '\\.');
  let r = tq('doctor');
  assert.match(r.stdout, new RegExp(`Claude Code ${v} is installed but not used: it or its folder is writable by group or others — run chmod go-w ${dir} ${dir}/${v}`));
  assert.doesNotMatch(r.stdout, /is not installed/);
  chmodSync(dir, 0o755);
  mkdirSync(join(env.XDG_STATE_HOME, 'taskquoin'), { recursive: true });
  writeFileSync(join(env.XDG_STATE_HOME, 'taskquoin', 'preferences.json'), JSON.stringify({ runtimeSelection: { claude: 'path' } }));
  r = tq('doctor');
  assert.match(r.stdout, new RegExp(`Claude Code ${v} is installed but not used: the choice is PATH only — run taskquoin upgrade auto`));
  const fr = spawnSync(process.execPath, [main, 'doctor'], { cwd: ws, env: { ...env, TASKQUOIN_LANG: 'fr' }, encoding: 'utf8' });
  assert.match(fr.stdout, new RegExp(`Claude Code ${v} est installé mais pas utilisé : le choix est « PATH seul » — lancez taskquoin upgrade auto`));
});

/** A preload that makes the account's home (os.userInfo) what TQ_TEST_ACCOUNT_HOME says, before main.ts loads. */
function accountHomePreload(dir: string): string {
  const p = join(dir, 'account-home.mjs');
  writeFileSync(p, "import os from 'node:os'; import { syncBuiltinESMExports } from 'node:module';\nconst real = os.userInfo; os.userInfo = (o) => ({ ...real(o), homedir: process.env.TQ_TEST_ACCOUNT_HOME ?? '' }); syncBuiltinESMExports();\n");
  return p;
}

test('upgrade install with HOME empty, "." or relative (and no absolute account home) is refused: the installer never runs in the repository', () => {
  const { ws, root, env } = sandbox({ claude: '9.9.9 (Claude Code)', codex: 'codex-cli 0.157.1' });
  git(ws, 'init', '-q');
  const marker = join(root, 'npm-ran-in');
  writeFileSync(join(root, 'bin', 'npm'), `#!/bin/sh\npwd > '${marker}'\n`); chmodSync(join(root, 'bin', 'npm'), 0o755);
  const pre = accountHomePreload(root);
  for (const HOME of ['', '.', 'rel']) {
    const r = spawnSync(process.execPath, ['--import', pre, main, 'upgrade', 'install', '--offline'], { cwd: ws, env: { ...env, HOME, TQ_TEST_ACCOUNT_HOME: 'rel' }, input: 'yes\n', encoding: 'utf8' });
    assert.ok(!existsSync(marker), `HOME=${JSON.stringify(HOME)}: npm ran in ${existsSync(marker) ? readFileSync(marker, 'utf8') : ''}`);
    assert.equal(r.status, 1, `HOME=${JSON.stringify(HOME)}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /No absolute home directory/);
  }
});

test('host(): a relative HOME falls back to the account home for the measured Claude Code (same helper as the installer)', () => {
  const measured = JSON.parse(readFileSync(new URL('../../../adapters/runtime-claude/src/capabilities.json', import.meta.url), 'utf8')).runtimeVersion as string;
  const { ws, root, env, tq } = sandbox({ claude: '9.9.9 (Claude Code)', codex: 'codex-cli 0.157.1' });
  const dir = join(root, '.local/share/claude/versions'); mkdirSync(dir, { recursive: true }); chmodSync(dir, 0o755);
  writeFileSync(join(dir, measured), `#!/bin/sh\necho "${measured} (Claude Code)"\n`); chmodSync(join(dir, measured), 0o755);
  git(ws, 'init', '-q'); writeFileSync(join(ws, 'package.json'), '{}');
  assert.equal(tq('init').status, 0); noMemory(ws);
  const r = spawnSync(process.execPath, ['--import', accountHomePreload(root), main, 'doctor'], { cwd: ws, env: { ...env, HOME: 'rel', TQ_TEST_ACCOUNT_HOME: root }, encoding: 'utf8' });
  assert.match(r.stdout, new RegExp(`Runtime claude: installed 9\\.9\\.9 \\(not measured\\) → using ${measured.replace(/\./g, '\\.')} \\(measured\\)`), r.stdout + r.stderr);
});

test('upgrade path with a preferences file that cannot be written: a translated error, exit 1, no temporary file; the console session goes on', () => {
  const { ws, env, tq } = sandbox();
  git(ws, 'init', '-q'); writeFileSync(join(ws, 'package.json'), '{}');
  assert.equal(tq('init').status, 0); noMemory(ws);
  const state = join(env.XDG_STATE_HOME, 'taskquoin');
  mkdirSync(join(state, 'preferences.json'), { recursive: true }); writeFileSync(join(state, 'preferences.json', 'x'), '');
  const fr = spawnSync(process.execPath, [main, 'upgrade', 'path', '--offline'], { cwd: ws, env: { ...env, TASKQUOIN_LANG: 'fr' }, encoding: 'utf8' });
  assert.equal(fr.status, 1, fr.stdout + fr.stderr);
  assert.match(fr.stderr, /Impossible d'enregistrer le choix/);
  assert.deepEqual(readdirSync(state).filter(n => n.endsWith('.tmp')), []);
  const c = spawnSync(process.execPath, [main, 'console'], { cwd: ws, env: { ...env, TASKQUOIN_OFFLINE: '1' }, input: '/upgrade path\n/help\n/quit\n', encoding: 'utf8' });
  assert.match(c.stderr, /Cannot save the choice/);
  assert.match(c.stdout, /\/approve <plan\|commit>/, 'the session went on after the failed save (/help answered)');
  assert.equal(c.status, 1, 'the failed command still fails the session for scripts');
});

test('console --offline: /upgrade never reads the registry (the flag reaches the console, not only TASKQUOIN_OFFLINE)', () => {
  const { ws, root, env, tq } = sandbox();
  git(ws, 'init', '-q'); writeFileSync(join(ws, 'package.json'), '{}');
  assert.equal(tq('init').status, 0); noMemory(ws);
  // fetch is replaced before main.ts loads: a call is recorded and fails, the network is never reached.
  const marker = join(root, 'fetch-called'); const pre = join(root, 'no-fetch.mjs');
  writeFileSync(pre, "import { writeFileSync } from 'node:fs';\nglobalThis.fetch = async (url) => { writeFileSync(process.env.TQ_TEST_FETCH_MARKER, String(url)); throw new TypeError('fetch failed (blocked by the test)'); };\n");
  const r = spawnSync(process.execPath, ['--import', pre, main, 'console', '--offline'], { cwd: ws, env: { ...env, TQ_TEST_FETCH_MARKER: marker }, input: '/upgrade\n/quit\n', encoding: 'utf8' });
  assert.ok(!existsSync(marker), `the registry was read: ${existsSync(marker) ? readFileSync(marker, 'utf8') : ''}`);
  assert.match(r.stdout, /Offline: no check for a newer Taskquoin/);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ---- untrusted text: one neutraliser for everything a human reads (Console V2 R1, task 2) ----
const HOSTILE = 'src/' + String.fromCharCode(0x1b) + '[2J' + String.fromCharCode(0x1b) + ']52;c;ZXZpbA==' + String.fromCharCode(7) + ' a' + String.fromCharCode(0x202e) + 'b';
const hostileClean = (s: string) => !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e]/.test(s);
const MARK_ESC = String.fromCharCode(0x2039) + 'ESC' + String.fromCharCode(0x203a);
const MARK_BIDI = String.fromCharCode(0x2039) + 'U+202E' + String.fromCharCode(0x203a);

test('status <run>: a hostile reason, history outcome and request reach the terminal as markers, never raw', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  saveRunState(store, 'run-x', { ...newRun('run-x', HOSTILE), status: 'failed', current: 'plan', reason: `file ${HOSTILE} refused`,
    history: [{ node: 'plan', outcome: `failed ${HOSTILE}`, at: '2026-11-01T10:00:00.000Z' }] });
  const one = tq('status', 'run-x');
  assert.equal(one.status, 0, one.stderr);
  assert.ok(hostileClean(one.stdout), JSON.stringify(one.stdout));
  assert.ok(one.stdout.includes(`  file src/${MARK_ESC}[2J${MARK_ESC}]52;c;ZXZpbA==${String.fromCharCode(0x2039)}BEL${String.fromCharCode(0x203a)} a${MARK_BIDI}b refused\n`), JSON.stringify(one.stdout));
  assert.ok(one.stdout.includes('failed src/'), 'history outcome shown');
  const list = tq('status');
  assert.ok(hostileClean(list.stdout), JSON.stringify(list.stdout)); assert.ok(list.stdout.includes(MARK_ESC));
});

test('status <run>: a reason made only of control characters is a non-empty line of markers', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  saveRunState(store, 'run-y', { ...newRun('run-y', 'x'), status: 'failed', current: 'plan', reason: String.fromCharCode(0x1b, 0x1b, 0x202e, 7) });
  const r = tq('status', 'run-y');
  assert.ok(hostileClean(r.stdout));
  assert.ok(r.stdout.split('\n').includes('  ' + MARK_ESC + MARK_ESC + MARK_BIDI + String.fromCharCode(0x2039) + 'BEL' + String.fromCharCode(0x203a)), JSON.stringify(r.stdout));
});

test('show: hostile artifact names and content are neutralised (content keeps its line breaks)', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  const put = (s: string) => putArtifact(store, Buffer.from(s), { mediaType: 'text/plain', producer: 'test' }).sha256;
  runWith(store, 'run-z', { [HOSTILE]: put(`line one\n${HOSTILE}\r\nline three\tx`) });
  const ls = tq('show', 'run-z');
  assert.ok(hostileClean(ls.stdout), JSON.stringify(ls.stdout)); assert.ok(ls.stdout.includes(MARK_ESC));
  const body = tq('show', 'run-z', HOSTILE);
  assert.equal(body.status, 0, body.stderr);
  assert.ok(/^[^\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e]*$/.test(body.stdout.replace(/\n/g, '')) && body.stdout.includes('\nline three\tx'), JSON.stringify(body.stdout));
  assert.ok(body.stdout.includes(MARK_BIDI) && body.stdout.startsWith('line one\n'));
  const missing = tq('show', 'run-z', HOSTILE + 'x');
  assert.equal(missing.status, 1); assert.ok(hostileClean(missing.stderr), JSON.stringify(missing.stderr));
});

test('run refusals neutralise untrusted text: markers, no raw control or bidi byte; French accents stay unmarked', () => {
  const ESC = String.fromCharCode(0x1b), RLO = String.fromCharCode(0x202e);
  const raw = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
  const { ws, root, env, tq } = sandbox();
  git(ws, 'init', '-q'); writeFileSync(join(ws, 'package.json'), '{}'); assert.equal(tq('init').status, 0);
  writeFileSync(join(ws, 'taskquoin.yaml'), readFileSync(join(ws, 'taskquoin.yaml'), 'utf8').replace(/enabled: true/, 'enabled: false').replace('- planning-contract', '- style'));
  git(ws, 'add', '.'); git(ws, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'cfg');
  // an approved skill whose copy holds a link with a hostile file name: the refusal names that file
  const hash = 'sha256:' + 'ab'.repeat(32);
  const skills = join(repoStore(ws, join(root, 'state', 'taskquoin')).root, 'skills');
  const copy = join(skills, 'approved', `style-${hash.slice(7, 19)}`); mkdirSync(copy, { recursive: true });
  symlinkSync('/etc/hostname', join(copy, `evil${ESC}[2J${RLO}x`));
  writeFileSync(join(skills, 'skills.lock.json'), JSON.stringify([{ name: 'style', status: 'approved', treeHash: hash }]));
  const r = tq('run', 'add sum');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.doesNotMatch(r.stderr, raw, 'no raw control or bidi byte');
  assert.match(r.stderr, /\u2039ESC\u203a/); assert.match(r.stderr, /\u2039U\+202E\u203a/);
  // French: the translated text keeps its accents, unmarked; only the hostile characters are marked
  const fr = spawnSync(process.execPath, [main, 'run', 'add sum'], { cwd: ws, env: { ...env, TASKQUOIN_LANG: 'fr' }, encoding: 'utf8' });
  assert.equal(fr.status, 1); assert.doesNotMatch(fr.stderr, raw);
  assert.match(fr.stderr, /[éèàêç]/, fr.stderr);
  assert.equal((fr.stderr.match(/\u2039/g) ?? []).length, 2, fr.stderr);
});

test('Verify that cannot start (no test command, tree not materialized) is flagged couldNotRun with the helper message as first line, so the run stops instead of reworking', async () => {
  const { verifyNotRun } = await import('../src/workflow-cli.ts');
  const r = verifyNotRun('no test command configured (verify.command, or the implementer\'s shell.run) — cannot verify, failing closed');
  assert.equal(r.couldNotRun, true); assert.equal(r.passed, false); assert.equal(r.exitCode, null);
  assert.match(r.firstLine, /^no test command configured/);
  const m = verifyNotRun(`could not materialize tree abc in the clean room: boom\nsecond line`);
  assert.equal(m.firstLine, 'could not materialize tree abc in the clean room: boom');
});

test('resume refuses a running run whose lock names a live process, and leaves it untouched (a live lock is never taken over)', () => {
  const { ws, root, tq } = sandbox(); git(ws, 'init', '-q', '-b', 'main'); tq('init');
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  saveRunState(store, 'run-live', { ...newRun('run-live', 'x'), status: 'running', current: 'implement', branch: 'main' });
  const lock = join(store.runs, 'run-live', 'lock'); writeFileSync(lock, `${process.pid}\n`);
  const st = tq('status', 'run-live');
  assert.match(st.stdout, /running/); assert.doesNotMatch(st.stdout, /interrupted/);
  const r = tq('resume', 'run-live');
  assert.equal(r.status, 1); assert.match(r.stderr, new RegExp(`busy.*pid ${process.pid}|pid ${process.pid}`));
  assert.equal(readFileSync(lock, 'utf8'), `${process.pid}\n`, 'the live lock is untouched');
  assert.equal(JSON.parse(readFileSync(join(store.runs, 'run-live', 'state.json'), 'utf8')).status, 'running');
});

test('status reports a running run with a dead lock as interrupted (process gone), in --json too', () => {
  const { ws, root, tq } = sandbox(); git(ws, 'init', '-q', '-b', 'main'); tq('init');
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  saveRunState(store, 'run-dead', { ...newRun('run-dead', 'x'), status: 'running', current: 'implement', branch: 'main' });
  writeFileSync(join(store.runs, 'run-dead', 'lock'), `${spawnSync(process.execPath, ['-e', '']).pid}\n`);
  const st = tq('status', 'run-dead');
  assert.match(st.stdout, /interrupted at implement/); assert.match(st.stdout, /process gone/);
  assert.equal(JSON.parse(tq('status', 'run-dead', '--json').stdout).status, 'interrupted');
  assert.match(tq('status').stdout, /run-dead\s+interrupted/);
});

test('a killed run\'s reason is engine text: status <run> --json is byte-identical under en and fr', () => {
  const { ws, root, env, tq } = sandbox(); git(ws, 'init', '-q', '-b', 'main'); tq('init');
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  saveRunState(store, 'run-dead', { ...newRun('run-dead', 'x'), status: 'running', current: 'implement', branch: 'main' });
  writeFileSync(join(store.runs, 'run-dead', 'lock'), `${spawnSync(process.execPath, ['-e', '']).pid}\n`);
  const en = tq('status', 'run-dead', '--json').stdout;
  const fr = spawnSync(process.execPath, [main, 'status', 'run-dead', '--json'], { cwd: ws, env: { ...env, TASKQUOIN_LANG: 'fr' }, encoding: 'utf8' }).stdout;
  assert.equal(JSON.parse(en).reason, 'process gone (the run was killed)');
  assert.equal(fr, en);
  // the text output keeps its French frame around the same English reason
  const text = spawnSync(process.execPath, [main, 'status', 'run-dead'], { cwd: ws, env: { ...env, TASKQUOIN_LANG: 'fr' }, encoding: 'utf8' }).stdout;
  assert.ok(text.includes('process gone (the run was killed)'), text);
});

for (const [label, content] of [['empty', ''], ['non-numeric', 'abc\n']] as const) {
  test(`a ${label} lock has a holder that cannot be shown dead: status stays running, resume refuses, names the lock file and leaves it`, () => {
    const { ws, root, tq } = sandbox(); git(ws, 'init', '-q', '-b', 'main'); tq('init');
    const store = repoStore(ws, join(root, 'state', 'taskquoin'));
    saveRunState(store, 'run-odd', { ...newRun('run-odd', 'x'), status: 'running', current: 'implement', branch: 'main' });
    const lock = join(store.runs, 'run-odd', 'lock'); writeFileSync(lock, content);
    assert.doesNotMatch(tq('status', 'run-odd').stdout, /interrupted/);
    const r = tq('resume', 'run-odd');
    // no command can clear it: the message names the lock file and says when deleting it is safe
    assert.equal(r.status, 1); assert.match(r.stderr, /blocked by \S*run-odd\/lock: if no taskquoin process is running, delete that file/);
    assert.equal(readFileSync(lock, 'utf8'), content);
    assert.equal(JSON.parse(readFileSync(join(store.runs, 'run-odd', 'state.json'), 'utf8')).status, 'running');
  });
}

// ---- Task 3 fix round: recovery is recorded, pid reuse, takeover mutex ----
function deadSeed(name: string, lockText?: (deadPid: number) => string) {
  const { ws, root, tq } = sandbox(); git(ws, 'init', '-q', '-b', 'main'); tq('init');
  git(ws, 'add', '-A'); git(ws, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  saveRunState(store, name, { ...newRun(name, 'x'), status: 'running', current: 'implement', branch: 'main' });
  const dir = join(store.runs, name); const dead = spawnSync(process.execPath, ['-e', '']).pid!;
  if (lockText) writeFileSync(join(dir, 'lock'), lockText(dead));
  return { ws, root, tq, store, dir, dead };
}
const stateOf = (dir: string) => JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')) as RunState;
const eventsOf = (dir: string) => readdirSync(dir).filter(f => /event/.test(f)).map(f => readFileSync(join(dir, f), 'utf8')).join('\n');

test('resume of a dead lock records the run.interrupted event and an interrupted history entry at the same node, then continues', () => {
  const { tq, dir } = deadSeed('run-rec', d => `${d}\n`);
  tq('resume', 'run-rec');
  const entry = stateOf(dir).history.find(h => h.outcome === 'interrupted');
  assert.ok(entry, 'history entry'); assert.equal(entry!.node, 'implement');
  assert.match(eventsOf(dir), /"type":"run\.interrupted"/);
  assert.ok(!existsSync(join(dir, 'lock')) && !existsSync(join(dir, 'lock.takeover')), 'no lock left behind');
});

test('pid reuse: a live pid whose start time differs from the one in the lock is a dead holder (Linux)', { skip: !existsSync('/proc/self/stat') }, () => {
  const { tq, dir } = deadSeed('run-reuse', () => `${process.pid}\n1\n`);
  assert.match(tq('status', 'run-reuse').stdout, /interrupted at implement/);
  tq('resume', 'run-reuse');
  assert.ok(stateOf(dir).history.some(h => h.outcome === 'interrupted'));
});

test('a stale lock.takeover (its holder died mid-takeover) is never cleared by a resume: it refuses, names the file, and after the owner deletes it the run recovers; a live one makes resume refuse and nothing is displaced', () => {
  const stale = deadSeed('run-st', d => `${d}\n`); writeFileSync(join(stale.dir, 'lock.takeover'), `${stale.dead}\n`);
  const r0 = stale.tq('resume', 'run-st');
  assert.equal(r0.status, 1); assert.match(r0.stderr, /blocked by \S*lock\.takeover: if no taskquoin process is running, delete that file/);
  assert.equal(readFileSync(join(stale.dir, 'lock.takeover'), 'utf8'), `${stale.dead}\n`, 'the stale mutex is left to the owner');
  assert.equal(readFileSync(join(stale.dir, 'lock'), 'utf8'), `${stale.dead}\n`);
  rmSync(join(stale.dir, 'lock.takeover'));
  stale.tq('resume', 'run-st');
  assert.ok(stateOf(stale.dir).history.some(h => h.outcome === 'interrupted'), 'recovered once the owner deleted the stale mutex');
  const live = deadSeed('run-lv', d => `${d}\n`); writeFileSync(join(live.dir, 'lock.takeover'), `${process.pid}\n`);
  const r = live.tq('resume', 'run-lv');
  assert.equal(r.status, 1); assert.match(r.stderr, /busy/);
  assert.equal(readFileSync(join(live.dir, 'lock.takeover'), 'utf8'), `${process.pid}\n`);
  assert.equal(readFileSync(join(live.dir, 'lock'), 'utf8'), `${live.dead}\n`);
  assert.equal(stateOf(live.dir).history.length, 0);
});

/** n processes call withRunLock on one run at the same instant; each winner records its hold as [start, end] (ms). */
function race(store: { runs: string }, dir: string, runId: string, n = 6): Promise<{ holds: [number, number][]; refused: string[] }> {
  const src = new URL('../src/workflow-cli.ts', import.meta.url).href;
  const script = `import { appendFileSync } from 'node:fs';
const { withRunLock } = await import(${JSON.stringify(src)});
const [runs, dir] = process.argv.slice(1);
const t0 = Number(process.env.GO); while (Date.now() < t0) {}
try { await withRunLock({ store: { runs } }, ${JSON.stringify(runId)}, async () => { const a = Date.now(); await new Promise(r => setTimeout(r, 300)); appendFileSync(dir + '/won', a + ' ' + Date.now() + '\\n'); }); }
catch (e) { appendFileSync(dir + '/refused', String(e.message).replace(/\\n/g, ' ') + '\\n'); }`;
  const go = String(Date.now() + 2500);
  const kids = Array.from({ length: n }, () => spawn(process.execPath, ['--input-type=module', '-e', script, store.runs, dir], { env: { ...process.env, GO: go }, stdio: 'inherit' }));
  const lines = (f: string) => { try { return readFileSync(join(dir, f), 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } };
  return Promise.all(kids.map(k => new Promise(r => k.on('exit', r)))).then(() => ({
    holds: lines('won').map(l => l.split(' ').map(Number) as [number, number]), refused: lines('refused') }));
}
/** The property that matters: no two processes ever held the run lock at the same time. */
function noOverlap(holds: [number, number][]) {
  const h = [...holds].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < h.length; i++) assert.ok(h[i][0] >= h[i - 1][1], `two holders overlapped: ${JSON.stringify(h)}`);
}

test('parallel takeovers of one dead lock: no two holds ever overlap, the others are told busy', async () => {
  const { dir, store } = deadSeed('run-par', d => `${d}\n`);
  const { holds, refused } = await race(store, dir, 'run-par');
  assert.ok(holds.length >= 1, 'someone took the dead lock over'); noOverlap(holds);
  assert.equal(holds.length + refused.length, 6); for (const m of refused) assert.match(m, /busy/);
  assert.ok(!existsSync(join(dir, 'lock')) && !existsSync(join(dir, 'lock.takeover')));
});

test('one crash mid-takeover plus racing resumes never yields two holders: a dead lock behind a stale lock.takeover refuses them all, untouched', async () => {
  const { dir, store, dead } = deadSeed('run-crash', d => `${d}\n`); writeFileSync(join(dir, 'lock.takeover'), `${dead}\n`);
  const { holds, refused } = await race(store, dir, 'run-crash');
  assert.deepEqual(holds, [], 'nobody holds a run whose takeover crashed');
  assert.equal(refused.length, 6); for (const m of refused) assert.match(m, /blocked by \S*lock\.takeover/);
  assert.equal(readFileSync(join(dir, 'lock'), 'utf8'), `${dead}\n`); assert.equal(readFileSync(join(dir, 'lock.takeover'), 'utf8'), `${dead}\n`);
});

test('a crash between removing the dead lock and installing the new one (lock absent, stale lock.takeover): status says interrupted, racing resumes hold one at a time and the stale mutex is cleared', async () => {
  const { dir, store, dead, tq } = deadSeed('run-gap'); writeFileSync(join(dir, 'lock.takeover'), `${dead}\n`);
  assert.match(tq('status', 'run-gap').stdout, /interrupted at implement/);
  const { holds } = await race(store, dir, 'run-gap');
  assert.ok(holds.length >= 1); noOverlap(holds);
  assert.ok(!existsSync(join(dir, 'lock.takeover')), 'the stale mutex is cleared by the holder of the run lock');
});

test('status during a takeover (lock absent, live lock.takeover) does not report the run as interrupted', () => {
  const { tq, dir } = deadSeed('run-mid'); writeFileSync(join(dir, 'lock.takeover'), `${process.pid}\n`);
  const o = tq('status', 'run-mid').stdout; assert.match(o, /running/); assert.doesNotMatch(o, /interrupted/);
});

test('run: every positional after the command is the request, joined by single spaces', async () => {
  const { requestFrom } = await import('../src/workflow-cli.ts');
  assert.equal(requestFrom(['run', 'Add', 'a', 'sum', 'function']), 'Add a sum function');
  assert.equal(requestFrom(['run', 'Add a sum function']), 'Add a sum function');
  assert.equal(requestFrom(['run']), undefined);
  const { ws, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0);
  assert.equal(tq('run').status, 2, 'no request: usage');
  assert.match(tq('run', 'Add', 'a', 'sum', 'function').stderr, /^taskquoin run: (?!usage)/i, 'the request reaches the run (refused here: dirty tree or preflight)');
});

test('uninstall --purge-state purges the store even when a previous uninstall already removed the manifest', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0);
  assert.equal(tq('uninstall').status, 0);
  const find = () => execFileSync('sh', ['-c', `find ${join(root, 'state')} -mindepth 3 -maxdepth 3 -type d | wc -l`], { encoding: 'utf8' }).trim();
  assert.notEqual(find(), '0', 'the store directory is still there');
  const r = tq('uninstall', '--purge-state');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(find(), '0');
});

test('init on an unknown stack says how to set shell.run and verify.command', () => {
  const { ws, tq } = sandbox();
  git(ws, 'init', '-q'); writeFileSync(join(ws, 'Cargo.toml'), '[package]\n');
  const r = tq('init');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /verify\.command/); assert.match(r.stdout, /shell\.run/);
});

test('init on an unknown stack with an OpenCode implementer names only verify.command (the parser refuses shell.run for OpenCode)', () => {
  const { ws, tq } = sandbox({ opencode: '1.19.5' } as never);
  git(ws, 'init', '-q'); writeFileSync(join(ws, 'Cargo.toml'), '[package]\n');
  const r = tq('init');
  assert.equal(r.status, 0, r.stderr); assert.match(readFileSync(join(ws, 'taskquoin.yaml'), 'utf8'), /runtime: opencode/);
  assert.match(r.stdout, /verify\.command/); assert.doesNotMatch(r.stdout, /shell\.run/);
});

test('run on a Cargo.toml-only repository: the implementer refusal gives the config remedy (shell.run, verify.command), never an accept-risk waiver for the writing agent', () => {
  const { ws, env, tq } = sandbox();
  git(ws, 'init', '-q'); writeFileSync(join(ws, 'Cargo.toml'), '[package]\n'); assert.equal(tq('init').status, 0); noMemory(ws);
  git(ws, 'add', '.'); git(ws, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'cfg');
  const r = tq('run', 'Add a sum');
  assert.equal(r.status, 1, r.stdout + r.stderr); assert.match(r.stderr, /agent implementer cannot start/);
  assert.doesNotMatch(r.stderr, /accept-risk/);
  assert.match(r.stderr, /shell\.run/); assert.match(r.stderr, /verify\.command/);
  const fr = spawnSync(process.execPath, [main, 'run', 'Add a sum'], { cwd: ws, env: { ...env, TASKQUOIN_LANG: 'fr' }, encoding: 'utf8' });
  assert.doesNotMatch(fr.stderr, /accept-risk/); assert.match(fr.stderr, /shell\.run/); assert.match(fr.stderr, /verify\.command/);
});

test('run with a runtime that is not installed says so, and never sends the owner to taskquoin upgrade', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); writeFileSync(join(ws, 'package.json'), '{}'); assert.equal(tq('init').status, 0); noMemory(ws);
  editConfig(ws, raw => { raw.agents.planner.runtime = 'codex'; }); // the first agent the run calls is a Codex one
  rmSync(join(root, 'bin', 'codex')); // Codex uninstalled after init
  const r = tq('run', 'Add a sum');
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /runtime codex for agent planner is not installed/);
  assert.doesNotMatch(r.stderr, /upgrade/); assert.doesNotMatch(r.stderr, /capability matrix measured for/);
});

test('status <run> --json carries the reason of a failed run (null when unset)', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  saveRunState(store, 'run-f', { ...newRun('run-f', 'Fix Z'), status: 'failed', current: 'verify', reason: 'no test command' });
  saveRunState(store, 'run-g', { ...newRun('run-g', 'Fix W'), status: 'failed', current: 'verify' });
  assert.equal(JSON.parse(tq('status', 'run-f', '--json').stdout).reason, 'no test command');
  assert.equal(JSON.parse(tq('status', 'run-g', '--json').stdout).reason, null);
  assert.ok(Object.keys(JSON.parse(tq('status', 'run-f', '--json').stdout)).pop() === 'reason', 'appended last');
});

// ---- fix round 1 of the task 2 security review ----
const CH = (c: number) => String.fromCharCode(c);
const MK = (name: string) => CH(0x2039) + name + CH(0x203a);
function editConfig(ws: string, f: (raw: any) => void) {
  const YAML = require('yaml'); const p = join(ws, 'taskquoin.yaml');
  const raw = YAML.parse(readFileSync(p, 'utf8')); f(raw); writeFileSync(p, YAML.stringify(raw));
  git(ws, 'add', '.'); git(ws, '-c', 'user.email=o@example.invalid', '-c', 'user.name=o', 'commit', '-q', '-m', 'cfg');
}

test('fa: Taskquoin\'s own Persian text keeps its ZWNJ unmarked, skill errors in a preflight message too', () => {
  const { ws, env, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  editConfig(ws, raw => { raw.agents.challenger.capabilities['fs.write'] = ['**']; });
  const fa = (...a: string[]) => spawnSync(process.execPath, [main, ...a], { cwd: ws, env: { ...env, TASKQUOIN_LANG: 'fa' }, encoding: 'utf8' });
  const r = fa('run', 'x');
  assert.equal(r.status, 1, r.stderr);
  assert.ok(r.stderr.includes(CH(0x200c)), 'the Persian message carries its ZWNJ: ' + r.stderr);
  assert.ok(!r.stderr.includes(MK('U+200C')), r.stderr);
  editConfig(ws, raw => { delete raw.agents.challenger.capabilities['fs.write']; raw.agents.challenger.skills = ['not-approved']; });
  const s = fa('run', 'x');
  assert.equal(s.status, 1, s.stderr);
  assert.ok(!s.stderr.includes(MK('U+200C')), s.stderr);
  assert.ok(s.stderr.includes(CH(0x200c)) && s.stderr.includes('not-approved'), s.stderr);
});

test('an error no command catches is shown with the log profile: a ZWNJ it quotes is kept, a bidi control marked', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  saveRunState(store, 'run-c', newRun('run-c', 'x'));
  // Not JSON: the parser's error quotes the text, and nothing between it and main() catches it.
  writeFileSync(join(store.runs, 'run-c', 'state.json'), 'm' + CH(0x200c) + 'x ' + CH(0x202e) + ' y');
  const r = tq('status', 'run-c');
  assert.equal(r.status, 1);
  assert.ok(r.stderr.startsWith('taskquoin: ') && r.stderr.includes('m' + CH(0x200c) + 'x ' + MK('U+202E') + ' y'), JSON.stringify(r.stderr));
  assert.ok(!r.stderr.includes(CH(0x202e)) && !r.stderr.includes(MK('U+200C')), JSON.stringify(r.stderr));
});

test('uninstall: a manifest error is shown with the log profile — a hostile path marked as a parameter, a ZWNJ the parser quotes kept', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0);
  const mf = execFileSync('sh', ['-c', `find ${join(root, 'state')} -name manifest.json`], { encoding: 'utf8' }).trim();
  const sha = JSON.parse(readFileSync(mf, 'utf8')).files[0].sha256;
  writeFileSync(mf, JSON.stringify({ files: [{ path: 'x' + CH(0x1b) + '[2J' + CH(0x200c), sha256: sha }] }));
  let r = tq('uninstall');
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('"x' + MK('ESC') + '[2J' + MK('U+200C') + '" is not a file Taskquoin creates'), JSON.stringify(r.stderr));
  // Not JSON: the parser's error quotes the text; the whole message gets the log profile, the path above the strict one.
  writeFileSync(mf, 'm' + CH(0x200c) + 'x ' + CH(0x202e) + ' y');
  r = tq('uninstall');
  assert.equal(r.status, 1);
  assert.ok(r.stderr.includes('m' + CH(0x200c) + 'x ' + MK('U+202E') + ' y'), JSON.stringify(r.stderr));
  assert.ok(!r.stderr.includes(CH(0x202e)) && !r.stderr.includes(MK('U+200C')), JSON.stringify(r.stderr));
  assert.ok(existsSync(join(ws, 'taskquoin.yaml')), 'nothing removed');
});

test('status <run>: a hostile configured model, provider model and agent id never reach the terminal raw (Judges line)', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  const evil = 'm' + CH(0x1b) + '[2J' + CH(7) + CH(0x202e) + 'x';
  editConfig(ws, raw => {
    raw.providers = { p: { url: 'https://api.example.com/v1', model: evil, key: 'env:K' } };
    raw.agents.security = { runtime: 'api', provider: 'p', description: 'd', prompt: 'p', capabilities: {} };
    raw.workflow = { challengers: ['challenger'], reviewers: ['challenger', 'security'] };
  });
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  saveRunState(store, 'run-j', { ...newRun('run-j', 'x'), status: 'failed', current: 'plan', history: [] });
  const r = tq('status', 'run-j');
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e]/.test(r.stdout), JSON.stringify(r.stdout));
  assert.ok(r.stdout.includes('security (api: api.example.com/m' + MK('ESC') + '[2J' + MK('BEL') + MK('U+202E') + 'x)'), r.stdout);
});

test('status --json: exact bytes for a plain run, and inert (\\u escapes, same parsed value) for a hostile one', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  saveRunState(store, 'run-p', { ...newRun('run-p', 'Add X'), status: 'failed', current: 'plan', history: [{ node: 'plan', outcome: 'ok', at: '2026-11-01T10:00:00.000Z' }] });
  const plain = JSON.stringify([{ runId: 'run-p', status: 'failed', current: 'plan', attempts: 0, branch: null, commit: null, request: 'Add X' }], null, 2) + '\n';
  assert.equal(tq('status', '--json').stdout, plain, 'byte-identical for a non-hostile run');
  const one = JSON.stringify({ runId: 'run-p', status: 'failed', current: 'plan', attempts: 0, branch: null, commit: null, request: 'Add X',
    history: [{ node: 'plan', outcome: 'ok', at: '2026-11-01T10:00:00.000Z' }], pendingApproval: null, reason: null }, null, 2) + '\n';
  assert.equal(tq('status', 'run-p', '--json').stdout, one);
  // DEL, C1, bidi controls and U+2028/U+2029 are escaped by jsonOut, C0 (ESC) by JSON.stringify itself.
  const evil = 'a' + CH(0x2028) + 'b' + CH(0x202e) + 'c' + CH(0x2066) + 'd' + CH(0x9b) + 'e' + CH(0x7f) + 'f' + CH(0x1b) + 'g' + CH(0x61c) + 'h';
  saveRunState(store, 'run-h', { ...newRun('run-h', evil), status: 'failed', current: 'plan', reason: evil, history: [{ node: 'plan', outcome: evil, at: 'now' }] });
  const raw = tq('status', 'run-h', '--json').stdout;
  assert.ok(/^[\x20-\x7e\n]*$/.test(raw), 'ASCII only: ' + JSON.stringify(raw));
  assert.ok(raw.includes('a\\u2028b\\u202ec\\u2066d\\u009be\\u007ff\\u001bg\\u061ch'), raw);
  assert.deepEqual(JSON.parse(raw).history[0].outcome, evil);
  assert.equal(JSON.parse(raw).reason, evil, 'the reason goes through jsonOut too');
  assert.ok(/^[\x20-\x7e\n]*$/.test(tq('status', '--json').stdout));
});

test('status --json: the full snapshot, byte for byte, for a run in Persian with emoji, a ZWJ family and a tag flag', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  const fa = 'می' + CH(0x200c) + 'خواهم', heart = String.fromCodePoint(0x2764, 0xfe0f), family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
  const england = String.fromCodePoint(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f);
  const request = `${fa} ${heart} ${family} ${england}`, tree = 'f'.repeat(40);
  const history = [{ node: 'challenge', outcome: 'challenged:APPROVE', at: '2026-11-01T10:00:00.000Z' }, { node: 'approve-plan', outcome: `approved-by:${fa} ${heart}`, at: '2026-11-01T10:05:00.000Z' }];
  saveRunState(store, 'run-i', { ...newRun('run-i', `${request}\nsecond line`), status: 'waiting-approval', current: 'approve-commit', attempts: 1, branch: `taskquoin/${fa}`,
    commit: 'c'.repeat(40), reviewedTree: tree, history });
  const summary = { runId: 'run-i', status: 'waiting-approval', current: 'approve-commit', attempts: 1, branch: `taskquoin/${fa}`, commit: 'c'.repeat(40), request };
  assert.equal(tq('status', 'run-i', '--json').stdout, JSON.stringify({ ...summary, history, pendingApproval: { gate: 'commit', expectedHash: tree }, reason: null }, null, 2) + '\n');
  assert.equal(tq('status', '--json').stdout, JSON.stringify([summary], null, 2) + '\n');
});

test('status: a hostile request is cut after neutralising, by display width (60 columns)', () => {
  const { ws, root, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  const store = repoStore(ws, join(root, 'state', 'taskquoin'));
  saveRunState(store, 'run-w', { ...newRun('run-w', CH(0x1b).repeat(40)), status: 'failed', current: 'plan', history: [] });
  const line = tq('status').stdout.trimEnd();
  const request = line.slice(line.indexOf('plan') + 'plan'.length).trim();
  assert.ok(request.length <= 60 && request.length > 40, request.length + ' ' + request);
});

test('doctor and accept-risk: root and capability parameters are neutralised', () => {
  const { ws, env } = sandbox();
  const evilDir = join(ws, 'a' + CH(0x1b) + '[31mb'); mkdirSync(evilDir);
  const run = (...a: string[]) => spawnSync(process.execPath, [main, ...a], { cwd: evilDir, env, encoding: 'utf8' });
  git(evilDir, 'init', '-q'); assert.equal(run('init').status, 0);
  const d = run('doctor');
  assert.ok(!d.stdout.includes(CH(0x1b)), JSON.stringify(d.stdout.slice(0, 200)));
  assert.ok(d.stdout.includes('a' + MK('ESC') + '[31mb'));
  const a = run('accept-risk', 'challenger', 'fs.read' + CH(0x1b) + '[2J', '--reason', 'x', '--expires', '2099-01-01', '--as', 'o');
  assert.ok(!(a.stdout + a.stderr).includes(CH(0x1b)), JSON.stringify(a.stderr));
});

test('console banner and doctor share one definition of ready: a skill error refuses the agent in both, counts agree', () => {
  const { ws, env, tq } = sandbox();
  git(ws, 'init', '-q'); assert.equal(tq('init').status, 0); noMemory(ws);
  const count = () => {
    const d = tq('doctor');
    const m = /Verdict: (\d+) of (\d+) agents can run/.exec(d.stdout);
    const doctorReady = m ? Number(m[1]) : Number(/Verdict: all (\d+)/.exec(d.stdout)?.[1] ?? NaN);
    const c = spawnSync(process.execPath, [main, 'console'], { cwd: ws, env: { ...env, TASKQUOIN_OFFLINE: '1', NO_COLOR: '1' }, input: '/quit\n', encoding: 'utf8' });
    // piped and NO_COLOR: the Minimal home, one line per agent (glyph, role, state word, note); the tester is the last line
    const rows = c.stdout.split('\n').filter(l => /^[●◐○] /.test(l)).slice(0, -1);
    return { doctorReady, bannerReady: rows.filter(l => /^[●◐] \S+\s+READY/.test(l)).length, rows, out: c.stdout };
  };
  const before = count();
  assert.equal(before.bannerReady, before.doctorReady, before.out);
  editConfig(ws, raw => { raw.agents.planner.skills = ['not-approved']; });
  const after = count();
  assert.equal(after.bannerReady, after.doctorReady, after.out);
  assert.ok(after.doctorReady < before.doctorReady, 'the skill error refuses one more agent');
  assert.match(after.rows.find(l => /Architect/.test(l)) ?? '', /^○ Architect\s+NOT READY\s+not-approved/);
});
