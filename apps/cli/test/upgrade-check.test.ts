/**
 * PROVES: fetchLatest maps a local HTTP server's answers to latest / unpublished / invalid / offline: strict version
 * and measured validation (bad keys and values dropped), a refused redirect, a timeout and a 2 MB body are handled,
 * the request carries user-agent taskquoin and no cookie; newerCalver compares numerically by part.
 * DOES NOT PROVE: behaviour against the real npm registry, TLS, proxies or DNS failures.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fetchLatest, newerCalver, REGISTRY_LATEST } from '../src/upgrade-check.ts';

let server: Server;
let other: Server;
let base = '';
let otherBase = '';
let lastHeaders: IncomingHttpHeaders = {};
const ESC = String.fromCharCode(0x1b);

const listen = (s: Server): Promise<string> =>
  new Promise((res) => s.listen(0, '127.0.0.1', () => res(`http://127.0.0.1:${(s.address() as AddressInfo).port}`)));

before(async () => {
  other = createServer((_q, r) => { r.end('{}'); });
  otherBase = await listen(other);
  server = createServer((q, r) => {
    lastHeaders = q.headers;
    const p = q.url ?? '';
    const json = (o: unknown): void => { r.setHeader('content-type', 'application/json'); r.end(JSON.stringify(o)); };
    if (p === '/ok') return json({ version: '2026.12.0', taskquoin: { measured: { claude: '2.1.330' } } });
    if (p === '/missing') { r.statusCode = 404; return void r.end('{}'); }
    if (p === '/notjson') return void r.end('not json');
    if (p === '/esc') return json({ version: `2026.12.0${ESC}[2J` });
    if (p === '/latestword') return json({ version: '2026.12.0', taskquoin: { measured: { claude: 'latest' } } });
    if (p === '/mixed') return json({ version: '2026.12.0', taskquoin: { measured: { claude: '2.1.330', codex: 'x', evil: '1.2.3', opencode: '0.5.1' } } });
    if (p === '/redirect') { r.statusCode = 302; r.setHeader('location', `${otherBase}/x`); return void r.end(); }
    if (p === '/slow') return void setTimeout(() => json({ version: '2026.12.0' }), 300);
    if (p === '/big') return void r.end('a'.repeat(2 * 1024 * 1024));
    r.statusCode = 500; r.end();
  });
  base = await listen(server);
});
after(() => { server.close(); other.close(); });

test('REGISTRY_LATEST is the npm registry URL', () => {
  assert.equal(REGISTRY_LATEST, 'https://registry.npmjs.org/taskquoin/latest');
});

test('200 with a valid body gives latest with version and measured', async () => {
  assert.deepEqual(await fetchLatest(`${base}/ok`), { kind: 'latest', version: '2026.12.0', measured: { claude: '2.1.330' } });
});

test('404 is unpublished', async () => {
  assert.deepEqual(await fetchLatest(`${base}/missing`), { kind: 'unpublished' });
});

test('non-JSON and a version with an escape sequence are invalid', async () => {
  assert.deepEqual(await fetchLatest(`${base}/notjson`), { kind: 'invalid' });
  assert.deepEqual(await fetchLatest(`${base}/esc`), { kind: 'invalid' });
});

test('invalid measured entries are dropped, not fatal', async () => {
  assert.deepEqual(await fetchLatest(`${base}/latestword`), { kind: 'latest', version: '2026.12.0', measured: {} });
  assert.deepEqual(await fetchLatest(`${base}/mixed`), { kind: 'latest', version: '2026.12.0', measured: { claude: '2.1.330', opencode: '0.5.1' } });
});

test('a redirect is refused and reported offline', async () => {
  const r = await fetchLatest(`${base}/redirect`);
  assert.equal(r.kind, 'offline');
});

test('a slow answer past timeoutMs is offline', async () => {
  const r = await fetchLatest(`${base}/slow`, { timeoutMs: 100 });
  assert.equal(r.kind, 'offline');
});

test('an unreachable host is offline with a short reason', async () => {
  const r = await fetchLatest('http://127.0.0.1:1/x');
  assert.equal(r.kind, 'offline');
  if (r.kind === 'offline') assert.ok(r.reason.length > 0 && !r.reason.includes('\n'));
});

test('a 2 MB body is invalid', async () => {
  assert.deepEqual(await fetchLatest(`${base}/big`), { kind: 'invalid' });
});

test('the request sends user-agent taskquoin and no cookie', async () => {
  await fetchLatest(`${base}/ok`);
  assert.equal(lastHeaders['user-agent'], 'taskquoin');
  assert.equal(lastHeaders['accept'], 'application/json');
  assert.equal(lastHeaders['cookie'], undefined);
});

test('newerCalver compares numerically by part', () => {
  assert.equal(newerCalver('2026.12.0', '2026.11.1'), true);
  assert.equal(newerCalver('2026.11.10', '2026.11.9'), true);
  assert.equal(newerCalver('2026.11.1', '2026.11.1'), false);
  assert.equal(newerCalver('2026.11.1', '2026.12.0'), false);
});
