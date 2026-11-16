/** PROVES: probeOllama lists local models from <url>/api/tags, and answers undefined — quickly — when nothing answers. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { probeOllama } from '../src/index.ts';

const servers: { close(): void; closeAllConnections(): void }[] = [];
after(() => servers.forEach(s => { s.closeAllConnections(); s.close(); }));
async function serve(handler: Parameters<typeof createServer>[1]) {
  const srv = createServer(handler); await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r())); servers.push(srv);
  return `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
}

test('probeOllama: model names from /api/tags; undefined when refused, hanging or not Ollama', async () => {
  const url = await serve((req, res) => { assert.equal(req.url, '/api/tags'); res.end(JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }, { name: 'llama3.2:3b' }] })); });
  assert.deepEqual(await probeOllama({ url }), ['qwen2.5-coder:7b', 'llama3.2:3b']);
  assert.equal(await probeOllama({ url: 'http://127.0.0.1:9' }), undefined);
  const hang = await serve(() => { /* never answers */ });
  const t0 = Date.now(); assert.equal(await probeOllama({ url: hang, timeoutMs: 200 }), undefined); assert.ok(Date.now() - t0 < 2000);
  const other = await serve((_q, res) => res.end('<html>not ollama</html>'));
  assert.equal(await probeOllama({ url: other }), undefined);
});
