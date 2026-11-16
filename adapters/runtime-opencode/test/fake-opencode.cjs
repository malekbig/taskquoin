#!/usr/bin/env node
// Test double for opencode 1.19.5 (executor tests). Runs INSIDE Taskquoin's sandbox: replays the recorded events
// (fixtures copied next to it) and, in `report` mode, answers with what it could see and do from inside.
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args.includes('--version')) { process.stdout.write('1.19.5\n'); process.exit(0); }
const fixture = (n) => fs.readFileSync(path.join(__dirname, `${n}.ndjson`), 'utf8').split('\n').filter(Boolean);
const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
const canWrite = (f) => { try { fs.writeFileSync(f, 'x'); fs.rmSync(f, { force: true }); return true; } catch { return false; } };
let stdin = '';
process.stdin.on('data', d => (stdin += d));
process.stdin.on('end', () => {
  const env = process.env; const cwd = process.cwd(); const mode = env.TQ_FAKE_MODE || 'ok';
  const auth = path.join(env.XDG_DATA_HOME || '/nonexistent', 'opencode', 'auth.json');
  const out = (lines) => process.stdout.write(lines.join('\n') + '\n');
  if (mode === 'report') {
    let authKeys = null; try { authKeys = Object.keys(JSON.parse(fs.readFileSync(auth, 'utf8'))); } catch { /* none */ }
    const report = {
      argv: args, stdin, envKeys: Object.keys(env).sort(), config: env.OPENCODE_CONFIG_CONTENT ? JSON.parse(env.OPENCODE_CONFIG_CONTENT) : null,
      homeEntries: (() => { try { return fs.readdirSync(env.HOME); } catch { return null; } })(),
      envFile: read(path.join(cwd, '.env')), rootAgents: read(path.join(cwd, 'AGENTS.md')), nestedAgents: read(path.join(cwd, 'sub', 'AGENTS.md')),
      rootConfig: read(path.join(cwd, 'opencode.json')), dotOpencode: fs.existsSync(path.join(cwd, '.opencode', 'agent', 'evil.md')),
      repoWritable: canWrite(path.join(cwd, 'probe-write.txt')), gitWritable: canWrite(path.join(cwd, '.git', 'tq-probe')),
      frozenWritable: env.TQ_FAKE_FROZEN ? canWrite(path.join(env.TQ_FAKE_FROZEN, 'tq-probe')) : null,
      outsideWritable: env.TQ_FAKE_OUTSIDE ? canWrite(env.TQ_FAKE_OUTSIDE) : null,
      storeEntries: env.TQ_FAKE_STORE ? (() => { try { return fs.readdirSync(env.TQ_FAKE_STORE); } catch { return null; } })() : null,
      authKeys, pluginMarker: fs.existsSync(path.join(env.XDG_CONFIG_HOME || '/nonexistent', 'opencode', 'node_modules', 'marker.txt')),
      catalogue: fs.existsSync(env.OPENCODE_MODELS_PATH || '/nonexistent'),
      linkedSecret: read(path.join(cwd, 'credentials.txt')), externalLinked: read(path.join(cwd, 'ext-link')),
      homeLinkTarget: env.TQ_FAKE_HOME_TARGET ? read(env.TQ_FAKE_HOME_TARGET) : null,
      baseEntries: env.TQ_FAKE_BASE ? (() => { try { return fs.readdirSync(env.TQ_FAKE_BASE); } catch { return null; } })() : null,
    };
    return out([JSON.stringify({ type: 'step_start', part: { type: 'step-start' } }), JSON.stringify({ type: 'text', part: { type: 'text', text: JSON.stringify(report) } }),
      JSON.stringify({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop', tokens: { input: 3, output: 2 }, cost: 0 } })]);
  }
  if (mode === 'refresh') {
    const a = JSON.parse(fs.readFileSync(auth, 'utf8')); a.openai.access = 'SECRET-NEW'; fs.writeFileSync(auth, JSON.stringify(a));
  }
  if (mode === 'ok' || mode === 'refresh') { try { fs.writeFileSync(path.join(cwd, 'hello.txt'), 'hi\n'); } catch { /* read-only agent */ } return out(fixture('run-ok')); }
  if (mode === 'denied') return out(fixture('run-denied'));
  if (mode === 'error') { out(fixture('run-error')); process.exit(1); }
  if (mode === 'truncated') { const l = fixture('run-ok'); const last = l.pop(); return out([...l, last.slice(0, 40)]); }
  if (mode === 'model') return out([JSON.stringify({ type: 'step_start', part: { type: 'step-start', providerID: 'openai', modelID: 'other-model' } }), ...fixture('run-ok')]);
  process.exit(2);
});
