/**
 * PROVES (offline, deterministic): runSandboxedTool (bubblewrap) lets a tool write ONLY inside its writable root,
 * gives it no network (0 hits on a local server, positive control = direct spawn), and hides HOME secret
 * directories (they appear empty). Refuses when bubblewrap is unavailable.
 * DOES NOT PROVE: protection against kernel exploits; tools needing writable paths outside the root fail (by design).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProcess } from '@taskquoin/process-runner';
import { runSandboxedTool, sandboxedToolAvailable } from '../src/index.ts';

/** Fixtures that must live OUTSIDE /tmp (the sandbox's private tmpfs) and be writable both on the host and inside the
 * verification sandbox (where only the repository is writable): a gitignored dir inside the repository. */
const outsideTmp = () => { const b = join(new URL('../../../', import.meta.url).pathname, '.tq-test-tmp'); mkdirSync(b, { recursive: true }); return realpathSync(b); };

let server: Server; let port = 0; let hits = 0;
before(async () => { server = createServer((_q, s) => { hits++; s.end('ok'); }); await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r())); port = (server.address() as { port: number }).port; });
after(() => server.close());
const root = realpathSync(mkdtempSync(join(tmpdir(), 'tq-bwrap-')));
const repo = join(root, 'repo'); const outside = join(root, 'outside'); const home = join(root, 'home');
mkdirSync(repo); mkdirSync(outside); mkdirSync(join(home, '.ssh'), { recursive: true }); writeFileSync(join(home, '.ssh', 'id_test'), 'SECRET');
const env = { PATH: process.env.PATH ?? '', HOME: home };
const js = (code: string) => ({ bin: process.execPath, args: ['-e', code] });
const available = await sandboxedToolAvailable();

test('writes: inside the root only', { skip: !available && 'bubblewrap unavailable' }, async () => {
  const r = await runSandboxedTool({ ...js(`const f=require('fs');f.writeFileSync(${JSON.stringify(join(repo, 'in.txt'))},'x');try{f.writeFileSync(${JSON.stringify(join(outside, 'out.txt'))},'x');console.log('OUT-WRITTEN')}catch(e){console.log('OUT-BLOCKED',e.code)}`), cwd: repo, env, timeoutMs: 20_000, maxOutputBytes: 10_000 }, { writableRoot: repo, home });
  assert.equal(r.status, 'completed', r.stderr);
  assert.ok(existsSync(join(repo, 'in.txt')));
  assert.match(r.stdout, /OUT-BLOCKED/); assert.equal(existsSync(join(outside, 'out.txt')), false);
});

test('network: none (0 hits); positive control reaches the server', { skip: !available && 'bubblewrap unavailable' }, async () => {
  const code = `fetch('http://127.0.0.1:${port}/').then(()=>console.log('REACHED')).catch(()=>console.log('BLOCKED'))`;
  hits = 0; await runProcess({ ...js(code), cwd: repo, env, timeoutMs: 10_000, maxOutputBytes: 1000 }); assert.equal(hits, 1);
  hits = 0; const r = await runSandboxedTool({ ...js(code), cwd: repo, env, timeoutMs: 20_000, maxOutputBytes: 1000 }, { writableRoot: repo, home });
  assert.match(r.stdout, /BLOCKED/); assert.equal(hits, 0);
});

test('HOME secret directories are masked', { skip: !available && 'bubblewrap unavailable' }, async () => {
  const r = await runSandboxedTool({ ...js(`console.log(JSON.stringify(require('fs').readdirSync(${JSON.stringify(join(home, '.ssh'))})))`), cwd: repo, env, timeoutMs: 20_000, maxOutputBytes: 1000 }, { writableRoot: repo, home });
  assert.equal(r.stdout.trim(), '[]');
  assert.deepEqual(readdirSync(join(home, '.ssh')), ['id_test'], 'host files untouched');
});

test('writable root must be absolute and is required', async () => {
  await assert.rejects(runSandboxedTool({ ...js('0'), cwd: repo, env, timeoutMs: 1000, maxOutputBytes: 100 }, { writableRoot: 'rel', home }), /absolute/);
});

test('Unix sockets under masked runtime dirs are unreachable (ro-bind does not stop connect())', { skip: !available && 'bubblewrap unavailable' }, async () => {
  const { createServer: net } = await import('node:net');
  // Outside /tmp (which the sandbox already replaces with a private tmpfs) so the positive control is meaningful.
  const { rmSync } = await import('node:fs');
  const runDir = mkdtempSync(join(outsideTmp(), 'sock-'));
  const sock = join(runDir, 'svc.sock'); let conns = 0;
  const srv = net(c => { conns++; c.end(); }); await new Promise<void>(r => srv.listen(sock, () => r()));
  try {
  const code = `const c=require('net').connect(${JSON.stringify(sock)});c.on('connect',()=>{console.log('CONNECTED');c.end()});c.on('error',e=>console.log('BLOCKED',e.code))`;
  const open = await runSandboxedTool({ ...js(code), cwd: repo, env, timeoutMs: 20_000, maxOutputBytes: 1000 }, { writableRoot: repo, home, maskDirs: [] });
  assert.match(open.stdout, /CONNECTED/, 'positive control: without the mask, a read-only bind still allows connect()');
  const masked = await runSandboxedTool({ ...js(code), cwd: repo, env, timeoutMs: 20_000, maxOutputBytes: 1000 }, { writableRoot: repo, home, maskDirs: [runDir] });
  assert.match(masked.stdout, /BLOCKED/);
  } finally { srv.close(); rmSync(runDir, { recursive: true, force: true }); }
  void conns;
});

test('default masks include /run and XDG_RUNTIME_DIR', async () => {
  const { bwrapArgs } = await import('../src/index.ts');
  const a = bwrapArgs({ writableRoot: repo, home, cwd: repo, maskDirs: undefined });
  assert.ok(a.join(' ').includes('--tmpfs /run'));
});

test('a HOME secret dir that is a SYMLINK (e.g. WSL ~/.aws → /mnt/c/…) is masked at its real target', { skip: !available && 'bubblewrap unavailable' }, async () => {
  const { symlinkSync } = await import('node:fs');
  const { rmSync } = await import('node:fs');
  const real = mkdtempSync(join(outsideTmp(), 'winaws-')); writeFileSync(join(real, 'credentials'), 'SECRET'); // outside /tmp (already a private tmpfs)
  const h2 = mkdtempSync(join(outsideTmp(), 'home2-')); symlinkSync(real, join(h2, '.aws'));
  const r = await runSandboxedTool({ ...js(`console.log(JSON.stringify(require('fs').readdirSync(${JSON.stringify(join(h2, '.aws'))})))`), cwd: repo, env, timeoutMs: 20_000, maxOutputBytes: 1000 }, { writableRoot: repo, home: h2 });
  assert.equal(r.status, 'completed', r.stderr);
  assert.equal(r.stdout.trim(), '[]');
  rmSync(real, { recursive: true, force: true }); rmSync(h2, { recursive: true, force: true });
});

test('R4.1 verify profile: .git read-only, HOME hidden, repo still usable, secret files masked', { skip: !available && 'bubblewrap unavailable' }, async () => {
  const base = mkdtempSync(join(outsideTmp(), 'verify-'));
  const home2 = join(base, 'home'); const repo2 = join(home2, 'proj'); mkdirSync(join(repo2, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(home2, 'private.txt'), 'PRIVATE'); writeFileSync(join(repo2, '.env'), 'TOKEN=SECRET-ENV');
  const code = `const f=require('fs');const r={};
    try{f.writeFileSync('.git/hooks/pre-commit','#!/bin/sh');r.hook='WRITTEN'}catch(e){r.hook=e.code}
    try{r.home=f.readFileSync(${JSON.stringify(join(home2, 'private.txt'))},'utf8')}catch(e){r.home=e.code}
    try{r.env=f.readFileSync('.env','utf8')}catch(e){r.env=e.code}
    f.writeFileSync('out.txt','ok');r.repo='ok';console.log(JSON.stringify(r))`;
  const r = await runSandboxedTool({ ...js(code), cwd: repo2, env, timeoutMs: 20_000, maxOutputBytes: 10_000 },
    { writableRoot: repo2, home: home2, hideHome: true, readOnly: [join(repo2, '.git')], hideFiles: [join(repo2, '.env')] });
  assert.equal(r.status, 'completed', r.stderr);
  const o = JSON.parse(r.stdout);
  assert.notEqual(o.hook, 'WRITTEN', '.git must not be writable during Verify (Codex R4 N1)');
  assert.notEqual(o.home, 'PRIVATE', 'HOME is hidden');
  assert.ok(!String(o.env).includes('SECRET-ENV'), 'project secret files are masked');
  assert.equal(o.repo, 'ok');
  const { rmSync } = await import('node:fs'); rmSync(base, { recursive: true, force: true });
});

test('R4.1 verify profile: own PID namespace — a setsid() descendant dies with the sandbox', { skip: !available && 'bubblewrap unavailable' }, async () => {
  const base = mkdtempSync(join(outsideTmp(), 'pidns-'));
  const marker = join(base, 'LATE');
  const inner = `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'x'),1500)`;
  const code = `const {spawn}=require('child_process');const c=spawn(process.execPath,['-e',${JSON.stringify(inner)}],{detached:true,stdio:'ignore'});c.unref();console.log(JSON.stringify({pids:require('fs').readdirSync('/proc').filter(n=>/^[0-9]+$/.test(n)).length}))`;
  const r = await runSandboxedTool({ ...js(code), cwd: base, env, timeoutMs: 20_000, maxOutputBytes: 10_000 }, { writableRoot: base, home });
  assert.equal(r.status, 'completed', r.stderr);
  assert.ok(JSON.parse(r.stdout).pids < 10, 'only the sandbox processes are visible');
  await new Promise(res => setTimeout(res, 2500));
  assert.equal(existsSync(marker), false, 'a detached descendant must not survive the sandbox');
  const { rmSync } = await import('node:fs'); rmSync(base, { recursive: true, force: true });
});

test('clean room (ADR-0014): the room is mounted AT the repository path; inherited dirs read-only from the real repo; the store stays masked', { skip: !available && 'bubblewrap unavailable' }, async () => {
  const base = outsideTmp(); const r0 = realpathSync(mkdtempSync(join(base, 'room-')));
  const realRepo = join(r0, 'real'); const store = join(r0, 'store'); const room = join(store, 'verify', 'run-1');
  mkdirSync(join(realRepo, 'node_modules', 'dep'), { recursive: true }); mkdirSync(room, { recursive: true });
  writeFileSync(join(realRepo, 'marker'), 'REAL-WORKING-DIR'); writeFileSync(join(realRepo, 'node_modules', 'dep', 'i.js'), 'DEP');
  writeFileSync(join(room, 'marker'), 'CLEAN-ROOM'); writeFileSync(join(store, 'approvals.json'), 'STORE-SECRET');
  writeFileSync(join(room, '.env'), 'ROOM-ONLY-SECRET'); // exists in the room only, not in the working dir (Codex CR3 #1)
  const code = `const f=require('fs');const t=(n,fn)=>{try{fn();console.log(n,'OK')}catch(e){console.log(n,'FAIL',e.code)}};
    console.log('marker',f.readFileSync('marker','utf8'));console.log('dep',f.readFileSync('node_modules/dep/i.js','utf8'));
    t('write-dep',()=>f.writeFileSync('node_modules/dep/i.js','x'));t('write-room',()=>f.writeFileSync('out.txt','y'));
    t('read-store',()=>f.readFileSync(${JSON.stringify(join(store, 'approvals.json'))}));t('read-env',()=>console.log('ENV',f.readFileSync('.env','utf8')));console.log('cwd',process.cwd());`;
  const r = await runSandboxedTool({ ...js(code), cwd: realRepo, env, timeoutMs: 20_000, maxOutputBytes: 10_000 },
    { writableRoot: room, mountAt: realRepo, home, readOnly: [join(realRepo, 'node_modules')], maskDirs: [store], hideFiles: [join(realRepo, '.env')] });
  assert.equal(r.status, 'completed', r.stderr);
  assert.match(r.stdout, /marker CLEAN-ROOM/); assert.match(r.stdout, /dep DEP/);
  assert.match(r.stdout, /write-dep FAIL EROFS/); assert.match(r.stdout, /write-room OK/);
  assert.match(r.stdout, /read-store FAIL ENOENT/, 'the control store is masked although the room lives in it');
  assert.match(r.stdout, /read-env FAIL/); assert.doesNotMatch(r.stdout, /ROOM-ONLY-SECRET/, 'a secret that exists only in the room is masked (existence checked in the room)');
  assert.match(r.stdout, new RegExp(`cwd ${realRepo}`), 'tests see the repository path');
  assert.ok(existsSync(join(room, 'out.txt')) && !existsSync(join(realRepo, 'out.txt')), 'writes land in the room, never in the working dir');
  assert.equal(readdirSync(join(realRepo, 'node_modules', 'dep')).join(), 'i.js');
});
