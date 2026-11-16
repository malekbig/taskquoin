/**
 * PROVES (offline, deterministic, no model): a tool started through runLocalTool has NO network — not even loopback —
 * because it runs in a fresh user+network namespace (`unshare -rn`). A local HTTP server counts hits: 0 through
 * runLocalTool, 1 through a direct spawn (positive control). DNS resolution also fails inside.
 * DOES NOT PROVE: isolation on systems without unprivileged user namespaces (runLocalTool then refuses to run).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { runProcess } from '@taskquoin/process-runner';
import { runLocalTool, localToolIsolationAvailable } from '../src/index.ts';

let server: Server; let port = 0; let hits = 0;
before(async () => { server = createServer((_q, s) => { hits++; s.end('ok'); }); await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r())); port = (server.address() as { port: number }).port; });
after(() => server.close());
const fetchScript = (url: string) => `fetch(${JSON.stringify(url)}).then(r=>{console.log('REACHED',r.status)}).catch(e=>{console.log('BLOCKED',e.cause?.code??e.message);process.exit(3)})`;
const env = { PATH: process.env.PATH ?? '' };
// Inside an agent's own sandbox, nested user/network namespaces cannot be created (pilot 1): skip with the reason there.
const iso = await localToolIsolationAvailable();
const needs = iso ? {} : { skip: 'user/network namespaces unavailable here (nested sandbox?) — run on the host' };

test('isolation is available on this host (taskquoin doctor reports it)', needs, async () => {
  assert.equal(iso, true);
});

test('positive control: a direct spawn reaches the local server', needs, async () => {
  hits = 0;
  const r = await runProcess({ bin: process.execPath, args: ['-e', fetchScript(`http://127.0.0.1:${port}/`)], cwd: process.cwd(), env, timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.match(r.stdout, /REACHED 200/); assert.equal(hits, 1);
});

test('runLocalTool: loopback unreachable, zero hits', needs, async () => {
  hits = 0;
  const r = await runLocalTool({ bin: process.execPath, args: ['-e', fetchScript(`http://127.0.0.1:${port}/`)], cwd: process.cwd(), env, timeoutMs: 10_000, maxOutputBytes: 10_000 });
  assert.match(r.stdout, /BLOCKED/); assert.equal(r.exitCode, 3); assert.equal(hits, 0);
});

test('runLocalTool: DNS / external hosts unreachable', needs, async () => {
  const r = await runLocalTool({ bin: process.execPath, args: ['-e', fetchScript('https://example.com/')], cwd: process.cwd(), env, timeoutMs: 15_000, maxOutputBytes: 10_000 });
  assert.match(r.stdout, /BLOCKED/);
});

test('relative binary refused (same rule as the runner)', async () => {
  await assert.rejects(runLocalTool({ bin: 'node', args: [], cwd: process.cwd(), env, timeoutMs: 1000, maxOutputBytes: 100 }), /absolute/);
});
