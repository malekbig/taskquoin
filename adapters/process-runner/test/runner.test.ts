/**
 * PROVES: runProcess
 *  - forwards only allowlisted env keys and rejects dangerous ones (LD_PRELOAD, NODE_OPTIONS…) (Codex N9);
 *  - requires an absolute binary path (no PATH lookup of a repository-controlled binary) (N9);
 *  - kills the process group on timeout and on cancellation, escalating to SIGKILL (N3);
 *  - never spawns when the signal is already aborted (N3);
 *  - applies ONE shared byte budget across stdout+stderr, counted in bytes, without corrupting UTF-8 (N4);
 *  - survives a child that closes stdin early (EPIPE).
 * DOES NOT PROVE: containment of descendants that call setsid() (documented); Windows job objects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runProcess, ALLOWED_ENV_KEYS } from '../src/runner.ts';

const node = process.execPath;
const PATH = process.env.PATH ?? '';
const base = { cwd: process.cwd(), env: { PATH }, timeoutMs: 5000, maxOutputBytes: 10_000 };
/** Alive = exists and is not a zombie (a SIGKILLed orphan can linger as Z until init reaps it). */
const alive = (pid: number) => { try { return !/^\d+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, 'utf8')); } catch { return false; } };
const eventuallyDead = async (pid: number) => { for (let i = 0; i < 40 && alive(pid); i++) await new Promise(r => setTimeout(r, 50)); return !alive(pid); };

test('env: only allowlisted keys reach the child', async () => {
  const r = await runProcess({ ...base, bin: node, args: ['-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))'], env: { PATH, HOME: '/h', LANG: 'C.UTF-8' } });
  assert.equal(r.status, 'completed');
  assert.deepEqual(JSON.parse(r.stdout), ['HOME', 'LANG', 'PATH']);
  assert.ok(ALLOWED_ENV_KEYS.includes('TMPDIR'));
});

test('env: dangerous or unknown keys are rejected before spawning', async () => {
  for (const k of ['LD_PRELOAD', 'NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'GITHUB_TOKEN', 'ANTHROPIC_BASE_URL', 'BASH_ENV']) {
    await assert.rejects(runProcess({ ...base, bin: node, args: ['-e', '0'], env: { PATH, [k]: 'x' } }), new RegExp(`env key "${k}" is not allowed`));
  }
});

test('binary must be an absolute path', async () => {
  await assert.rejects(runProcess({ ...base, bin: 'node', args: ['-e', '0'] }), /absolute path/);
});

test('timeout kills parent and grandchild (SIGTERM-resistant child gets SIGKILL)', async () => {
  const script = `process.on('SIGTERM',()=>{});const {spawn}=require('child_process');const c=spawn(process.execPath,['-e','process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write('GC='+c.pid+'\\n');setInterval(()=>{},1000)`;
  const r = await runProcess({ ...base, bin: node, args: ['-e', script], timeoutMs: 700 });
  assert.equal(r.status, 'timeout');
  const pid = Number(/GC=(\d+)/.exec(r.stdout)?.[1]);
  assert.ok(pid > 0);
  assert.equal(await eventuallyDead(pid), true, 'grandchild must be killed (not running; zombie allowed briefly)');
});

test('cancellation escalates to SIGKILL and reports cancelled, not timeout', async () => {
  const ac = new AbortController();
  const p = runProcess({ ...base, bin: node, args: ['-e', `process.on('SIGTERM',()=>{});process.stdout.write('PID='+process.pid+'\\n');setInterval(()=>{},1000)`], timeoutMs: 20_000 }, ac.signal);
  setTimeout(() => ac.abort(), 300);
  const r = await p;
  assert.equal(r.status, 'cancelled');
  const pid = Number(/PID=(\d+)/.exec(r.stdout)?.[1]);
  assert.equal(await eventuallyDead(pid), true);
});

test('already-aborted signal: nothing is spawned', async () => {
  const ac = new AbortController(); ac.abort();
  const r = await runProcess({ ...base, bin: node, args: ['-e', 'require("fs").writeFileSync("/dev/stderr","SPAWNED")'] }, ac.signal);
  assert.equal(r.status, 'cancelled');
  assert.equal(r.exitCode, null);
  assert.equal(r.stderr, '');
});

test('abort listener is removed after completion', async () => {
  const ac = new AbortController();
  await runProcess({ ...base, bin: node, args: ['-e', '0'] }, ac.signal);
  const { EventEmitter } = await import('node:events');
  assert.equal(EventEmitter.getEventListeners(ac.signal, 'abort').length, 0);
});

test('shared byte budget across stdout+stderr, counted in bytes, UTF-8 intact', async () => {
  const r = await runProcess({ ...base, bin: node, maxOutputBytes: 10, args: ['-e', 'process.stdout.write("éééééé"); process.stderr.write("ééééé")'] });
  assert.equal(r.truncated, true);
  assert.ok(Buffer.byteLength(r.stdout) + Buffer.byteLength(r.stderr) <= 10);
  assert.ok(!r.stdout.includes('�') && !r.stderr.includes('�'), 'no replacement chars from split sequences');
});

test('child closing stdin early does not crash the runner', async () => {
  const r = await runProcess({ ...base, bin: node, args: ['-e', 'process.stdin.destroy(); setTimeout(()=>{},100)'], stdin: 'x'.repeat(5_000_000) });
  assert.equal(r.status, 'completed');
});

test('non-zero exit ⇒ failed with exit code', async () => {
  const r = await runProcess({ ...base, bin: node, args: ['-e', 'process.exit(3)'] });
  assert.equal(r.status, 'failed'); assert.equal(r.exitCode, 3);
});
