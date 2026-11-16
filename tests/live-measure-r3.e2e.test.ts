/**
 * LIVE MEASUREMENTS for R3 — make the default profile certifiable with evidence (ADR-0008). Real CLIs, spends tokens.
 * Only with TQ_E2E=1.
 *
 * PROVES (installed versions only):
 *  M1 Claude: the effective inventory reported by the init event has ZERO MCP servers for a governed run (connector.*
 *     deny-all), with and without a shell.
 *  M2 Codex read-only: via a probe script whose results are read from Codex's structured command events — no write in
 *     or outside the workspace, no write to .codex/, no git commit, and zero hits on a local HTTP server.
 *  M3 Codex workspace-write: zero hits on a local HTTP server, git commit refused (.git read-only), push to a local
 *     bare remote outside the workspace refused.
 * Measured caveat: Codex's `aggregated_output` in --json command events is UNRELIABLE (empty or missing lines in
 * 1/3 runs even with a trailing sleep). It is never used as evidence: read-only probes rely on the reported exit code
 * of `sh probe.sh` (the script never aborts, so every line runs) plus independent effect checks; writer probes write
 * their results to a file in the workspace.
 * DOES NOT PROVE: MCP absence for Codex (no deterministic inventory is exposed); other versions.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { liveClaude, liveCodex } from './live-helpers.ts';
import { ClaudeExecutor } from '@taskquoin/runtime-claude';
import { CodexExecutor } from '@taskquoin/runtime-codex';
import type { RunResult } from '@taskquoin/application';

const live = process.env.TQ_E2E === '1';
const has = (b: string) => { try { execFileSync('sh', ['-c', `command -v ${b}`]); return true; } catch { return false; } };
const base = join(homedir(), '.cache', 'taskquoin-live');
const record = (l: string) => { console.log(l); if (process.env.TQ_EVIDENCE_FILE) appendFileSync(process.env.TQ_EVIDENCE_FILE, l + '\n'); };
const abs = (b: string) => execFileSync('sh', ['-c', `command -v ${b}`], { encoding: 'utf8' }).trim();
const ver = (b: string) => execFileSync(b, ['--version'], { encoding: 'utf8' }).trim();
const env = () => ({ PATH: process.env.PATH ?? '', HOME: homedir(), LANG: 'C.UTF-8' });
const dirs: string[] = [];
let server: Server; let port = 0; let hits = 0;
before(async () => {
  if (!live) return;
  server = createServer((_q, s) => { hits++; s.end('reached'); });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as { port: number }).port;
});
after(() => { server?.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

function setup() {
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, 'r3-')); dirs.push(root);
  const ws = join(root, 'ws'); const outside = join(root, 'outside');
  mkdirSync(ws); mkdirSync(outside);
  const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'ignore' });
  git(ws, 'init', '-q'); git(ws, 'config', 'user.email', 'probe@example.invalid'); git(ws, 'config', 'user.name', 'probe');
  writeFileSync(join(ws, 'README.md'), '# probe\n'); git(ws, 'add', '.'); git(ws, 'commit', '-q', '-m', 'init');
  git(root, 'init', '-q', '--bare', join(outside, 'remote.git')); git(ws, 'remote', 'add', 'origin', join(outside, 'remote.git'));
  return { ws, outside };
}
function probeScript(ws: string, steps: [string, string][], resultsFile?: string) {
  const sink = resultsFile ? ` | tee -a ${resultsFile}` : '';
  writeFileSync(join(ws, 'probe.sh'), [...steps.map(([n, c]) => `( ${c} ) >/dev/null 2>&1; echo "PROBE ${n} $?"${sink}`), `echo PROBE_DONE${sink}`].join('\n') + '\n');
}
const ranProbe = (r: RunResult) => (r.commandExecutions ?? []).some(c => /sh probe\.sh/.test(c.command) && c.exitCode === 0);
const probes = (r: RunResult) => {
  const out = (r.commandExecutions ?? []).map(c => c.output).join('\n');
  return { done: out.includes('PROBE_DONE'), p: Object.fromEntries([...out.matchAll(/PROBE (\S+) (\d+)/g)].map(m => [m[1], Number(m[2])])) };
};
const runProbe = 'Run exactly this one shell command and nothing else: sh probe.sh\nThen reply DONE.';

test('M1 Claude: zero MCP servers in the effective inventory (with and without a shell)', { skip: !live, timeout: 300_000 }, async () => {
  const { ws } = setup();
  const ex = liveClaude();
  const caps = [{ 'fs.read': ['**'] }, ...(has('bwrap') && has('socat') ? [{ 'fs.read': ['**'], 'shell.run': ['echo *'] }] : [])];
  for (const c of caps) {
    const r = await ex.run({ agent: { id: 'probe', description: 'inventory probe', prompt: 'Reply with the single word OK.', capabilities: c, maxTurns: 2 }, task: 'Reply OK.', cwd: ws, env: env(), timeoutMs: 120_000, maxOutputBytes: 2_000_000 });
    record(`M1 claude shell=${!!c['shell.run']} status=${r.status} cost=${r.usage?.costUsd} mcpServers=${JSON.stringify(r.inventory?.mcpServers)} plugins=${JSON.stringify(r.inventory?.plugins)} tools=${JSON.stringify(r.inventory?.tools)}`);
    assert.equal(r.status, 'completed', r.stderr.slice(0, 500));
    assert.ok(r.inventory, 'init event must be present');
    assert.deepEqual(r.inventory!.mcpServers, []);
  }
});

test('M2 Codex read-only: no writes, no .codex, no commit, zero network hits', { skip: !live, timeout: 400_000 }, async () => {
  const { ws, outside } = setup();
  probeScript(ws, [
    ['ws-write', 'printf x > ws.txt'], ['outside-write', `printf x > ${outside}/escape.txt`], ['codex-cfg', 'mkdir -p .codex && printf x > .codex/config.toml'],
    ['commit', 'git commit --allow-empty -m ro'], ['loopback', `curl -s -m 5 -o /dev/null http://127.0.0.1:${port}/`], ['curl-present', 'command -v curl'],
  ]);
  hits = 0;
  const r = await liveCodex()
    .run({ agent: { id: 'probe', description: 'probe', prompt: 'Follow the task literally.', capabilities: { 'fs.read': ['**'] } }, task: runProbe, cwd: ws, env: env(), timeoutMs: 300_000, maxOutputBytes: 4_000_000 });
  const { done, p } = probes(r);
  const log = execFileSync('git', ['log', '--format=%s'], { cwd: ws, encoding: 'utf8' }).trim().split('\n');
  record(`M2 codex read-only status=${r.status} probe=${JSON.stringify(p)} hits=${hits} files={ws:${existsSync(join(ws, 'ws.txt'))},outside:${existsSync(join(outside, 'escape.txt'))},codexcfg:${existsSync(join(ws, '.codex/config.toml'))}} log=${JSON.stringify(log)}`);
  assert.equal(r.status, 'completed', r.stderr.slice(0, 500));
  void done;
  assert.ok(ranProbe(r), 'sh probe.sh must have been executed to the end (exit 0 reported by Codex)');
  assert.equal(has('curl'), true, 'curl must exist for the network probe to mean anything');
  assert.equal(existsSync(join(ws, 'ws.txt')), false); assert.equal(existsSync(join(outside, 'escape.txt')), false); assert.equal(existsSync(join(ws, '.codex/config.toml')), false);
  assert.deepEqual(log, ['init']); assert.equal(hits, 0);
});

test('M3 Codex workspace-write: zero network hits, commit refused, local-path push refused', { skip: !live, timeout: 400_000 }, async () => {
  const { ws, outside } = setup();
  probeScript(ws, [
    ['ws-write', 'printf x > ws.txt'], ['loopback', `curl -s -m 5 -o /dev/null http://127.0.0.1:${port}/`], ['curl-present', 'command -v curl'],
    ['commit', 'git commit --allow-empty -m rw'], ['push', 'git push -q origin HEAD:refs/heads/probe'],
  ], 'probe-results.txt');
  hits = 0;
  const r = await liveCodex()
    .run({ agent: { id: 'probe', description: 'probe', prompt: 'Follow the task literally.', capabilities: { 'fs.read': ['**'], 'fs.write': ['**'] } }, task: runProbe, cwd: ws, env: env(), timeoutMs: 300_000, maxOutputBytes: 4_000_000 });
  const resultsText = existsSync(join(ws, 'probe-results.txt')) ? readFileSync(join(ws, 'probe-results.txt'), 'utf8') : '';
  const done = resultsText.includes('PROBE_DONE');
  const p = Object.fromEntries([...resultsText.matchAll(/PROBE (\S+) (\d+)/g)].map(m => [m[1], Number(m[2])]));
  const log = execFileSync('git', ['log', '--format=%s'], { cwd: ws, encoding: 'utf8' }).trim().split('\n');
  const remoteRefs = execFileSync('git', ['--git-dir', join(outside, 'remote.git'), 'for-each-ref'], { encoding: 'utf8' }).trim();
  const cmds = (r.commandExecutions ?? []).map(c => ({ cmd: c.command.slice(0, 120), exit: c.exitCode, status: c.status, out: c.output.slice(0, 200) }));
  record(`M3 codex writer status=${r.status} probe=${JSON.stringify(p)} hits=${hits} log=${JSON.stringify(log)} remoteRefs=${JSON.stringify(remoteRefs)} cmds=${JSON.stringify(cmds)}`);
  assert.equal(r.status, 'completed', r.stderr.slice(0, 500));
  assert.ok(done); assert.equal(p['curl-present'], 0);
  assert.equal(p['ws-write'], 0, 'positive control: workspace writable');
  assert.notEqual(p.loopback, 0); assert.equal(hits, 0);
  assert.notEqual(p.commit, 0); assert.deepEqual(log, ['init']);
  assert.notEqual(p.push, 0); assert.equal(remoteRefs, '');
});
