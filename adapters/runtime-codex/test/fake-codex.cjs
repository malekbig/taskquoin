// Fake `codex exec`: validates hardened flags, reads stdin, emits --json events.
// TQ_FAKE_MODE: no-message | empty-message | no-turn | big-message. TQ_FAKE_ECHO_TMPDIR=1 echoes TMPDIR.
const fs = require('fs'); const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('codex-cli 9.9.9\n'); process.exit(0); }
const bad = args[0] !== 'exec' || args.includes('--profile') || args.some(a => a.startsWith('--dangerously')) || !args.includes('--ignore-user-config') || !args.includes('--ignore-rules') || args.at(-1) !== '-';
if (bad) { process.stderr.write('bad flags: ' + JSON.stringify(args)); process.exit(64); }
const o = args[args.indexOf('-o') + 1]; const mode = process.env.TQ_FAKE_MODE;
let stdin = ''; process.stdin.on('data', d => stdin += d); process.stdin.on('end', () => {
  if (mode === 'remove-scratch-base' && process.env.TMPDIR) fs.rmSync(require('path').dirname(process.env.TMPDIR), { recursive: true, force: true });
  process.stdout.write(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'sh probe.sh', aggregated_output: 'PROBE x 0\n', exit_code: 0, status: 'completed' } }) + '\n');
  if (mode !== 'no-message') fs.writeFileSync(o, mode === 'empty-message' ? '' : mode === 'big-message' ? 'y'.repeat(3 * 1024 * 1024) : 'stdin=' + stdin + (process.env.TQ_FAKE_ECHO_TMPDIR ? '\nTMPDIR=' + process.env.TMPDIR : ''));
  if (mode !== 'no-turn') process.stdout.write(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 2 } }) + '\n');
});
