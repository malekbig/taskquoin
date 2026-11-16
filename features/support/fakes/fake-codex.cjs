#!/usr/bin/env node
// Deterministic stand-in for codex-cli 0.157.1 `exec --json` (E2E features: zero tokens).
// Approves, unless the request contains REVUE-NÉGATIVE and the task is a CODE review (then always CHANGES_REQUESTED).
const fs = require('fs');
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('codex-cli 0.157.1\n'); process.exit(0); }
const out = args[args.indexOf('-o') + 1];
let stdin = ''; process.stdin.on('data', d => (stdin += d)); process.stdin.on('end', () => {
  const codeReview = /independent code reviewer/.test(stdin);
  const verdict = codeReview && /REVUE-NÉGATIVE/.test(stdin) ? 'CHANGES_REQUESTED' : 'APPROVE';
  const skills = [...stdin.matchAll(/<skill name="([^"]+)"/g)].map(m => m[1]);
  const ambiguous = codeReview && /VERDICT-AMBIGU/.test(stdin);
  fs.writeFileSync(out, `Review: ${codeReview ? 'diff checked against the plan' : 'plan checked'}.\nSKILLS-RECEIVED: ${skills.join(',') || 'none'}\nVERDICT: ${verdict}\n${ambiguous ? 'Actually reject this change.\n' : ''}`);
  process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n');
});
