/**
 * Child process for dashboard.test.ts: `dashboard-driver.ts <repo> <state-base> <keys.json>`. Opens the control store
 * READ-ONLY, runs the real dashboard loop over a fake terminal, feeds the keys of keys.json (an array of raw input
 * chunks, one per tick of the event loop), prints `frames <n>` and exits with runDashboard's code. Run under
 * `node --permission --allow-fs-read=*` it can write nothing at all: any write to disk throws.
 */
import { readFileSync } from 'node:fs';
import { openRepoStoreReadOnly } from '@taskquoin/store-fs';
import { runDashboard } from '../../src/dashboard.ts';
import type { DashStatic } from '../../src/dashboard-data.ts';
import type { Signals, TtyIO } from '../../src/tui/screen.ts';

const [repo, base, keysFile] = process.argv.slice(2);
if (!repo || !base || !keysFile) { process.stderr.write('usage: dashboard-driver.ts <repo> <state-base> <keys.json>\n'); process.exit(2); }

const store = openRepoStoreReadOnly(repo, base);
if (!store) { process.stderr.write('no control store\n'); process.exit(2); }
const keys = JSON.parse(readFileSync(keysFile, 'utf8')) as string[];

const writes: string[] = [];
const handlers = new Set<(chunk: string) => void>();
const tty: TtyIO = {
  write: (s) => { writes.push(s); },
  setRawMode: () => {},
  onData: (f) => { handlers.add(f); return () => { handlers.delete(f); }; },
  onResize: () => () => {},
  size: () => ({ columns: 120, rows: 40 }),
};
const signals: Signals = { on: () => signals, off: () => signals, exit: (code) => { process.exit(code); } };
const fixed: DashStatic = {
  version: '0.0.0-test', repo: 'demo', branch: 'main', acceptedRisks: [], checkedAt: new Date(0).toISOString(), runtimeVersions: { claude: '2.1.330' },
  squad: [{ role: 'Planner', who: 'planner · claude', state: 'ready', agent: 'planner', runtime: 'claude' }, { role: 'Tester', who: 'verify · bubblewrap', state: 'blocked', note: 'bubblewrap unavailable' }],
};

const run = runDashboard({
  tty, signals, store, fixed,
  caps: (size) => ({ interactive: true, cursor: true, colorDepth: 24, charset: 'utf8', theme: 'dark', motion: false, plain: false, ...size }),
});
for (const k of keys) {
  await new Promise<void>((r) => setImmediate(r));
  for (const f of [...handlers]) f(k);
}
const code = await run;
process.stdout.write(`frames ${writes.length - 2}\n`);
if ((process as unknown as { permission?: { has(s: string): boolean } }).permission?.has('fs.write') === false) process.stdout.write('writes denied\n');
process.exit(code);
