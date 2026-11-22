#!/usr/bin/env node
// Deterministic stand-in for Claude Code 2.1.327 in headless stream-json mode (E2E features: zero tokens).
// Behaviour by agent: planner → returns a plan; implementer → writes sum.js (wrong if the request says CASSÉE; also a
// nested AGENTS.md if it says CONFIG). It is NOT sandboxed: the features test Taskquoin's orchestration, not Claude.
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('2.1.327 (Claude Code)\n'); process.exit(0); }
const at = (f) => args[args.indexOf(f) + 1];
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
let stdin = ''; process.stdin.on('data', d => (stdin += d)); process.stdin.on('end', () => {
  const agent = at('--agent'); const tools = (at('--tools') || '').split(',').filter(Boolean);
  emit({ type: 'system', subtype: 'init', tools, mcp_servers: [], plugins: [], skills: [], agents: [agent] });
  const req = (/<request>\n([\s\S]*?)\n<\/request>/.exec(stdin) || [])[1] || '';
  const agentsJson = JSON.parse(at('--agents') || '{}'); const prompt = (agentsJson[agent] || {}).prompt || '';
  const skills = [...prompt.matchAll(/<skill name="([^"]+)"/g)].map(m => m[1]);
  let result = '';
  if (agent === 'af-planner') result = `PLAN\n- Goal: ${req.split('\n')[0]}\n- Test first: sum.test.js already fails (RED)\n- Step: create sum.js`;
  else if (agent === 'af-implementer') {
    fs.writeFileSync('sum.js', /CASSÉE/.test(req) ? 'module.exports = (a, b) => a - b;\n' : 'module.exports = (a, b) => a + b;\n');
    if (/CONFIG/.test(req)) { fs.mkdirSync('pkg/new', { recursive: true }); fs.writeFileSync('pkg/new/AGENTS.md', '# injected instructions\n'); }
    if (/SUIVI/.test(req)) fs.writeFileSync('side.test.js', "require('node:test')('side effect', () => require('fs').writeFileSync('side-effect.txt', 'x'));\n");
    if (/PIÈGE-GIT/.test(req)) fs.writeFileSync('hook.test.js', "require('node:test')('plant', () => { try { require('fs').writeFileSync('.git/hooks/pre-commit', '#!/bin/sh\\ntouch /tmp/pwned\\n', { mode: 0o755 }); } catch {} });\n");
    if (/RENOMME/.test(req) && fs.existsSync('docs/AGENTS.md')) fs.renameSync('docs/AGENTS.md', 'docs/notes.md');
    if (/BAVARD/.test(req)) fs.writeFileSync('sum.test.js', "const fs = require('fs'); if (!fs.existsSync('sum.js')) process.stdout.write('x'.repeat(3000000));\nrequire('node:test')('sum', () => require('node:assert').equal(require('./sum')(1, 2), 3));\n");
    if (/PATCHER/.test(req)) fs.writeFileSync('node_modules/dep/index.js', 'module.exports = () => 5; // patched by the agent\n');
    if (/VIA-DEP/.test(req)) fs.writeFileSync('sum.js', "module.exports = require('dep');\n");
    if (/CACHÉ/.test(req)) { fs.writeFileSync('impl.local.js', 'module.exports = (a, b) => a + b;\n'); fs.writeFileSync('sum.js', "module.exports = require('./impl.local.js');\n"); }
    if (/TRACE/.test(req)) fs.writeFileSync('debug.local.js', 'console.log("left behind");\n');
    if (/LIEN-EXTERNE/.test(req)) fs.symlinkSync('/etc/hostname', 'ext.txt');
    if (/LIT-SECRET/.test(req)) fs.writeFileSync('leak.test.js', "require('node:test')('leak', () => { let v; try { v = require('fs').readFileSync('node_modules/dep/.env', 'utf8'); } catch (e) { v = 'DENIED ' + e.code; } console.log('DEP-ENV:' + v); });\n");
    if (/LIEN-DÉTOURNÉ/.test(req)) { fs.symlinkSync('.', 'a'); fs.symlinkSync('a/../outside-dir/app.js', 'payload.js'); }
    if (/LIT-SECRET-LIEN/.test(req)) fs.writeFileSync('leak2.test.js', "require('node:test')('leak2', () => { for (const f of ['node_modules/dep/.env', 'node_modules/dep/.git/.env']) { let v; try { v = require('fs').readFileSync(f, 'utf8'); } catch (e) { v = 'DENIED ' + e.code; } console.log('READ ' + f + ':' + v); } });\n");
    if (/ENV-VERS-DEP/.test(req)) { fs.symlinkSync('node_modules/dep/credentials.txt', '.env'); fs.writeFileSync('leak3.test.js', "require('node:test')('leak3', () => { let v; try { v = require('fs').readFileSync('.env', 'utf8'); } catch (e) { v = 'DENIED ' + e.code; } console.log('READ .env:' + v); });\n"); }
    if (/SECRET-ET-BINAIRE/.test(req)) { fs.writeFileSync('.env.local', 'TOKEN=CANARY-JUDGE-5511\n'); fs.writeFileSync('logo.bin', Buffer.from([0x89, 0x50, 0x00, 0x01, 0xff, 0x00])); }
    if (/TAUTOLOGIE/.test(req)) fs.writeFileSync('sum.test.js', "require('node:test')('sum', () => require('node:assert').ok(true));\n");
    result = 'Implemented sum.js; ran npm test.';
  } else result = 'unknown agent';
  result += `\nSKILLS-RECEIVED: ${skills.join(',') || 'none'}`;
  emit({ type: 'result', subtype: 'success', is_error: false, num_turns: 1, total_cost_usd: 0, result, permission_denials: [] });
});
