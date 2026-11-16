/**
 * PROVES (local fake HTTP provider, no network): ApiExecutor sends exactly a text request (model, system + user
 * messages, the configured token field, stream:false — no tools, no temperature) to <url>/chat/completions, never
 * follows a redirect, retries only 429/5xx/timeouts/network errors (2 retries, 2 s then 8 s, or a short Retry-After),
 * fails closed on anything else, and never exposes the key (result, errors, command). Its capability matrix certifies
 * every capability as ENFORCED for an agent without capabilities.
 * DOES NOT PROVE: any real provider's behaviour (tests/live-api.e2e.test.ts, with a key).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { capabilitiesDigest, prepareRun, type RunRequest } from '@taskquoin/application';
import { validateCapabilityMatrix } from '@taskquoin/domain';
import { ApiExecutor, TransientProviderError, type ApiProvider } from '../src/index.ts';

const KEY = 'sk-SECRET-123';
const servers: { close(): void; closeAllConnections(): void }[] = [];
after(() => servers.forEach(s => { s.closeAllConnections(); s.close(); }));
type Rec = { method?: string; url?: string; headers: IncomingMessage['headers']; body: string };
async function fakeProvider(handler: (req: Rec, res: ServerResponse, n: number) => void, path = '/v1') {
  const requests: Rec[] = [];
  const srv = createServer((req, res) => { let b = ''; req.on('data', c => (b += c)); req.on('end', () => { const r = { method: req.method, url: req.url, headers: req.headers, body: b }; requests.push(r); handler(r, res, requests.length); }); });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r())); servers.push(srv);
  return { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}${path}`, requests };
}
const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...headers }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
const ok = (content = 'Looks fine.\nVERDICT: APPROVE', extra: Record<string, unknown> = {}) => ({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 11, completion_tokens: 7 }, ...extra });
const caps = {};
const req = (over: Partial<RunRequest> = {}): RunRequest => ({ agent: { id: 'security', description: 'd', prompt: 'ROLE', capabilities: caps }, task: 'TASK', cwd: '/w', env: {}, timeoutMs: 5000, maxOutputBytes: 100_000,
  ticket: { kind: 'taskquoin.gate-ticket.v1', agentId: 'security', runtime: 'api', runtimeVersion: '1', capabilitiesDigest: capabilitiesDigest(caps), issuedAt: new Date().toISOString() }, ...over });
function exec(url: string, over: Partial<ApiProvider> = {}, env: NodeJS.ProcessEnv = { TQ_TEST_KEY: KEY }) {
  const slept: number[] = [];
  const ex = new ApiExecutor({ id: 'p', url, model: 'm', keyEnv: 'TQ_TEST_KEY', maxOutputTokens: 4000, timeoutSeconds: 5, tokenField: 'max_tokens', ...over }, { env, sleep: async (ms) => { slept.push(ms); } });
  return { ex, slept };
}

test('sends exactly model, system+user messages, the token field, stream:false — no tools, no temperature', async () => {
  const p = await fakeProvider((_r, res) => json(res, 200, ok()));
  const r = await exec(p.url).ex.run(req());
  assert.equal(r.status, 'completed'); assert.equal(r.terminalMessage, 'Looks fine.\nVERDICT: APPROVE');
  const body = JSON.parse(p.requests[0].body);
  assert.deepEqual(Object.keys(body).sort(), ['max_tokens', 'messages', 'model', 'stream']);
  assert.deepEqual(body.messages, [{ role: 'system', content: 'ROLE' }, { role: 'user', content: 'TASK' }]);
  assert.equal(body.model, 'm'); assert.equal(body.max_tokens, 4000); assert.equal(body.stream, false);
  assert.equal(p.requests[0].method, 'POST'); assert.equal(p.requests[0].url, '/v1/chat/completions');
  const p2 = await fakeProvider((_r, res) => json(res, 200, ok()));
  await exec(p2.url, { tokenField: 'max_completion_tokens' }).ex.run(req());
  assert.deepEqual(Object.keys(JSON.parse(p2.requests[0].body)).sort(), ['max_completion_tokens', 'messages', 'model', 'stream']);
});

test('Authorization only when a key is configured; the key never appears in the result, errors or command', async () => {
  const p = await fakeProvider((_r, res) => json(res, 200, ok()));
  const r = await exec(p.url).ex.run(req());
  assert.equal(p.requests[0].headers.authorization, `Bearer ${KEY}`);
  assert.ok(!JSON.stringify(r).includes(KEY));
  const local = await fakeProvider((_r, res) => json(res, 200, ok()));
  await exec(local.url, { keyEnv: undefined }, {}).ex.run(req());
  assert.equal(local.requests[0].headers.authorization, undefined, 'no key configured (e.g. Ollama): no header');
  const echo = await fakeProvider((r, res) => json(res, 401, { error: { message: `invalid key ${r.headers.authorization}` } }));
  const bad = await exec(echo.url).ex.run(req());
  assert.equal(bad.status, 'failed'); assert.ok(!JSON.stringify(bad).includes(KEY)); assert.match(bad.stderr, /401/); assert.match(bad.stderr, /\[redacted\]/);
  const missing = await fakeProvider((_r, res) => json(res, 200, ok()));
  for (const env of [{}, { TQ_TEST_KEY: '' }]) {
    const m = await exec(missing.url, {}, env).ex.run(req());
    assert.equal(m.status, 'failed'); assert.match(m.stderr, /TQ_TEST_KEY absente/);
  }
  assert.equal(missing.requests.length, 0, 'nothing sent without the key');
});

test('a trailing slash in the url still targets <url>/chat/completions (Review Focus)', async () => {
  const p = await fakeProvider((_r, res) => json(res, 200, ok()));
  await exec(p.url + '/').ex.run(req());
  assert.equal(p.requests[0].url, '/v1/chat/completions');
});

test('HTTP 200 with an HTML page or JSON without choices → failed with a short message (Review Focus)', async () => {
  const html = await fakeProvider((_r, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>' + 'x'.repeat(5000) + '</body></html>'); });
  const a = await exec(html.url).ex.run(req());
  assert.equal(a.status, 'failed'); assert.ok(a.stderr.length < 400, a.stderr);
  const odd = await fakeProvider((_r, res) => json(res, 200, { error: 'quota' }));
  assert.equal((await exec(odd.url).ex.run(req())).status, 'failed');
});

test('tool calls or empty content → failed (a judge answers with text only)', async () => {
  const tools = await fakeProvider((_r, res) => json(res, 200, { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 't', type: 'function', function: { name: 'x', arguments: '{}' } }] } }] }));
  assert.equal((await exec(tools.url).ex.run(req())).status, 'failed');
  const empty = await fakeProvider((_r, res) => json(res, 200, ok('   ')));
  assert.equal((await exec(empty.url).ex.run(req())).status, 'failed');
});

test('a redirect is refused: the code never goes to another host', async () => {
  const other = await fakeProvider((_r, res) => json(res, 200, ok()));
  const p = await fakeProvider((_r, res) => { res.writeHead(307, { location: other.url + '/chat/completions' }); res.end(); });
  const r = await exec(p.url).ex.run(req());
  assert.equal(r.status, 'failed'); assert.equal(other.requests.length, 0); assert.equal(p.requests.length, 1, 'not retried');
});

test('retries: 429/5xx/network → 2 retries (2 s, 8 s or a short Retry-After); other 4xx never; exhausted → TransientProviderError', async () => {
  const once = await fakeProvider((_r, res, n) => (n === 1 ? json(res, 429, { error: 'slow down' }) : json(res, 200, ok())));
  const a = exec(once.url); assert.equal((await a.ex.run(req())).status, 'completed'); assert.deepEqual(a.slept, [2000]);
  const down = await fakeProvider((_r, res) => json(res, 503, { error: 'down' }));
  const b = exec(down.url); await assert.rejects(b.ex.run(req()), TransientProviderError); assert.deepEqual(b.slept, [2000, 8000]); assert.equal(down.requests.length, 3);
  const bad = await fakeProvider((_r, res) => json(res, 400, { error: 'bad request' }));
  const c = exec(bad.url); assert.equal((await c.ex.run(req())).status, 'failed'); assert.equal(bad.requests.length, 1); assert.deepEqual(c.slept, []);
  const ra = await fakeProvider((_r, res, n) => (n === 1 ? json(res, 429, {}, { 'retry-after': '5' }) : json(res, 200, ok())));
  const d = exec(ra.url); await d.ex.run(req()); assert.deepEqual(d.slept, [5000]);
  const long = await fakeProvider((_r, res, n) => (n === 1 ? json(res, 429, {}, { 'retry-after': '120' }) : json(res, 200, ok())));
  const e = exec(long.url); await e.ex.run(req()); assert.deepEqual(e.slept, [2000], 'Retry-After ≥ 30 s is not waited');
  const f = exec('http://127.0.0.1:9/v1'); await assert.rejects(f.ex.run(req()), TransientProviderError); assert.deepEqual(f.slept, [2000, 8000]);
  const hang = await fakeProvider(() => { /* never answers */ });
  const g = exec(hang.url, { timeoutSeconds: 1 }); await assert.rejects(g.ex.run(req()), TransientProviderError); assert.equal(hang.requests.length, 3);
});

test('refuses without a matching gate ticket, and refuses an agent with capabilities', async () => {
  const p = await fakeProvider((_r, res) => json(res, 200, ok()));
  await assert.rejects(exec(p.url).ex.run(req({ ticket: undefined })), /gate ticket/);
  const granted = { 'fs.read': ['**'] };
  await assert.rejects(exec(p.url).ex.run(req({ agent: { id: 'security', description: 'd', prompt: 'R', capabilities: granted }, ticket: { ...req().ticket!, capabilitiesDigest: capabilitiesDigest(granted) } })), /no capability/);
  assert.equal(p.requests.length, 0);
});

test('usage tokens, model and an identifying (secret-free) command surface in the result', async () => {
  const p = await fakeProvider((_r, res) => json(res, 200, ok()));
  const r = await exec(p.url).ex.run(req());
  assert.equal(r.runtime, 'api'); assert.equal(r.runtimeVersion, '1');
  assert.deepEqual({ i: r.usage?.inputTokens, o: r.usage?.outputTokens }, { i: 11, o: 7 });
  assert.equal(r.inventory?.model, 'm'); assert.deepEqual(r.inventory?.tools, []); assert.deepEqual(r.inventory?.mcpServers, []);
  assert.deepEqual(r.command.args, ['m']); assert.equal(r.command.bin, new URL(p.url).origin);
  assert.match(r.effectiveConfigDigest, /^sha256:/);
});

test('a response larger than maxOutputBytes → failed, truncated', async () => {
  const p = await fakeProvider((_r, res) => json(res, 200, ok('A'.repeat(50_000))));
  const r = await exec(p.url).ex.run(req({ maxOutputBytes: 10_000 }));
  assert.equal(r.status, 'failed'); assert.equal(r.stdoutTruncated, true);
});

test('capabilities.json certifies an api agent (no capabilities) through prepareRun: every mandatory restriction ENFORCED', () => {
  const matrix = validateCapabilityMatrix(JSON.parse(readFileSync(new URL('../src/capabilities.json', import.meta.url), 'utf8')));
  assert.equal(matrix.runtime, 'api'); assert.equal(matrix.runtimeVersion, '1');
  const g = prepareRun({ agentId: 'security', agent: { runtime: 'api', description: 'd', prompt: 'p', capabilities: {} }, mandatory: [], exceptions: [], matrix, facts: { runtimeVersion: '1', satisfied: ['landing-gate'] }, now: new Date() });
  assert.equal(g.ok, true, JSON.stringify(g.failures)); assert.equal(g.ticket?.runtime, 'api');
});

// ── final review fixes ───────────────────────────────────────────────────────────────────────────────────────────
test('final review: a provider echoing the key in its ANSWER never gets it into the result; non-numeric usage is dropped', async () => {
  const p = await fakeProvider((r, res) => json(res, 200, { choices: [{ message: { role: 'assistant', content: `Your key is ${String(r.headers.authorization).slice(7)}\nVERDICT: APPROVE` } }], usage: { prompt_tokens: KEY, completion_tokens: 3 } }));
  const r = await exec(p.url).ex.run(req());
  assert.equal(r.status, 'completed'); assert.ok(!JSON.stringify(r).includes(KEY)); assert.match(r.terminalMessage!, /\[redacted\]/);
  assert.equal(r.usage?.inputTokens, undefined); assert.equal(r.usage?.outputTokens, 3);
});

test('final review: the key is redacted BEFORE any truncation — no fragment of it survives in an error', async () => {
  for (const pad of [190, 195, 199, 200, 201]) {
    const p = await fakeProvider((_r, res) => json(res, 401, 'x'.repeat(pad) + KEY + 'tail'));
    const r = await exec(p.url).ex.run(req());
    assert.equal(r.status, 'failed');
    for (let n = 6; n <= KEY.length; n++) assert.ok(!r.stderr.includes(KEY.slice(0, n)), `pad ${pad}: fragment "${KEY.slice(0, n)}" leaked in ${JSON.stringify(r.stderr)}`);
  }
});

test('final review: an answer cut by the token limit (finish_reason length) fails with a clear, actionable message', async () => {
  const p = await fakeProvider((_r, res) => json(res, 200, { choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'Half a review…' } }] }));
  const r = await exec(p.url, { maxOutputTokens: 4000 }).ex.run(req());
  assert.equal(r.status, 'failed'); assert.match(r.stderr, /coupée.*maxOutputTokens 4000/);
});
