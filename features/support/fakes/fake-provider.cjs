#!/usr/bin/env node
// Deterministic stand-in for an OpenAI-compatible provider (E2E features, zero tokens), in its OWN process: the CLI
// under test is run with spawnSync, which blocks the test process. argv: <mode file> <request log>. The mode file
// (approve | refuse | down) is re-read on every request so a scenario can change it; every request body is logged.
const fs = require('fs'); const http = require('http');
const [modeFile, logFile] = process.argv.slice(2);
const srv = http.createServer((req, res) => {
  let body = ''; req.on('data', c => (body += c)); req.on('end', () => {
    fs.appendFileSync(logFile, JSON.stringify({ url: req.url, auth: req.headers.authorization || null, body }) + '\n');
    const mode = fs.readFileSync(modeFile, 'utf8').trim();
    if (mode === 'down') { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"error":"down"}'); }
    const content = mode === 'refuse' ? 'Injection SQL possible dans sum.js.\nVERDICT: CHANGES_REQUESTED' : 'Rien de dangereux.\nVERDICT: APPROVE';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 100, completion_tokens: 10 } }));
  });
});
srv.listen(0, '127.0.0.1', () => process.stdout.write(`PORT ${srv.address().port}\n`));
