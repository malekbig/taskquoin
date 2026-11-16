#!/usr/bin/env node
// Deterministic stand-in for opencode 1.19.5 `run --format json` (E2E features: zero tokens). It runs INSIDE
// Taskquoin's sandbox (the World copies it next to its shim). Role from the task on stdin: planner → a plan;
// plan or code review → a verdict (CHANGES_REQUESTED for a code review when the request says REVUE-NÉGATIVE);
// implementer → writes sum.js (wrong if the request says CASSÉE) and, for RAPPORT, what it could see in vu.txt.
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('1.19.5\n'); process.exit(0); }
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const canWrite = (f) => { try { fs.writeFileSync(f, 'x'); return true; } catch { return false; } };
let stdin = ''; process.stdin.on('data', d => (stdin += d)); process.stdin.on('end', () => {
  const req = (/<request>\n([\s\S]*?)\n<\/request>/.exec(stdin) || [])[1] || '';
  let text;
  if (/independent code reviewer/.test(stdin)) text = `Review: diff checked.\nVERDICT: ${/REVUE-NÉGATIVE/.test(req) ? 'CHANGES_REQUESTED' : 'APPROVE'}`;
  else if (/independent reviewer/.test(stdin)) text = 'Plan checked.\nVERDICT: APPROVE';
  else if (/Implement the APPROVED plan/.test(stdin)) {
    fs.writeFileSync('sum.js', /CASSÉE/.test(req) ? 'module.exports = (a, b) => a - b;\n' : 'module.exports = (a, b) => a + b;\n');
    if (/RAPPORT/.test(req)) {
      const cfg = read('opencode.json');
      fs.writeFileSync('vu.txt', [`config-du-depot: ${cfg && cfg.trim() ? 'LUE' : 'non lue'}`,
        `dossier-.opencode: ${fs.existsSync('.opencode/agent/evil.md') ? 'visible' : 'invisible'}`,
        `instructions-docs: ${(read('docs/AGENTS.md') || '').trim() ? 'LUES' : 'vides'}`,
        `ecriture-opencode.json: ${canWrite('opencode.json') ? 'ok' : 'refusée'}`,
        `sans-commandes: ${/you CANNOT run any command/.test(stdin) ? 'oui' : 'non'}`].join('\n') + '\n');
    }
    text = 'Implemented sum.js.';
  } else text = `PLAN\n- Goal: ${req.split('\n')[0]}\n- Test first: sum.test.js already fails (RED)\n- Step: create sum.js`;
  emit({ type: 'step_start', part: { type: 'step-start' } });
  emit({ type: 'text', part: { type: 'text', text } });
  emit({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop', tokens: { input: 1, output: 1 }, cost: 0 } });
});
