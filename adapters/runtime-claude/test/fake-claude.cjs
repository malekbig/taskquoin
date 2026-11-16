// Fake `claude`: validates the hardened invocation shape, reads the prompt from stdin, emits stream-json.
// TQ_FAKE_MODE: no-result (omit terminal event) | hang. Echoes the stdin prompt in the result.
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('9.9.9 (Claude Code)\n'); process.exit(0); }
const has = (f) => args.includes(f);
const at = (f) => args[args.indexOf(f) + 1];
const bad = !has('-p') || !has('--strict-mcp-config') || has('--bare') || at('--setting-sources') !== '' || !has('--no-session-persistence') || at('--permission-mode') !== 'dontAsk';
if (bad) { process.stderr.write('bad flags: ' + JSON.stringify(args)); process.exit(64); }
let stdin = ''; process.stdin.on('data', d => stdin += d); process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', tools: at('--tools').split(',').filter(Boolean), mcp_servers: [], plugins: [], skills: [], agents: [at('--agent')] }) + '\n');
  if (process.env.TQ_FAKE_MODE === 'hang') { setTimeout(() => {}, 60000); return; }
  if (process.env.TQ_FAKE_MODE === 'no-result') return;
  let extra = '';
  if (process.env.TQ_FAKE_ECHO_ENV) extra += '\n' + Object.keys(process.env).filter(k => /DISABLE/.test(k)).sort().map(k => k + '=' + process.env[k]).join('\n');
  if (process.env.TQ_FAKE_ECHO_POLICY) {
    const st = JSON.parse(at('--settings')); const cmd = st.hooks.PreToolUse[0].hooks[0].command;
    extra = '\nPOLICY=' + require('fs').readFileSync(/--policy '([^']+)'/.exec(cmd)[1], 'utf8');
  }
  process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, total_cost_usd: 0.002, result: 'prompt=' + stdin + extra,
    permission_denials: [{ tool_name: 'Write', tool_input: { file_path: 'x' } }] }) + '\n');
});
