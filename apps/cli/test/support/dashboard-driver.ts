/**
 * Child process for dashboard.test.ts and cli.test.ts: `dashboard-driver.ts <repo> <state-base> <keys.json>
 * [--approve-entry <main.ts>]`. Opens the control store READ-ONLY, runs the real dashboard loop over a fake terminal,
 * feeds the keys of keys.json (an array of raw input chunks, one per tick of the event loop), prints `frames <n>` and
 * exits with runDashboard's code; stderr gets what runDashboard says after the terminal is back. Run under
 * `node --permission --allow-fs-read=*` it can write nothing at all: any write to disk throws. Without
 * `--approve-entry` the approval center opens but its process launcher refuses (and says `spawn attempted`): a
 * read-only run never approves. With it, the real `spawnApprove` starts `taskquoin approve` from that entry.
 * With TQ_DRIVER_TEXT=1 it also prints `text <json>`: everything written to the terminal, escape sequences removed.
 */
import { readFileSync } from 'node:fs';
import { openRepoStoreReadOnly } from '@taskquoin/store-fs';
import { runDashboard } from '../../src/dashboard.ts';
import type { DashStatic } from '../../src/dashboard-data.ts';
import type { Signals, TtyIO } from '../../src/tui/screen.ts';

const args = process.argv.slice(2);
const flag = args.indexOf('--approve-entry');
const entry = flag >= 0 ? args.splice(flag, 2)[1] : undefined;
const [repo, base, keysFile] = args;
if (!repo || !base || !keysFile || (flag >= 0 && !entry)) { process.stderr.write('usage: dashboard-driver.ts <repo> <state-base> <keys.json> [--approve-entry <main.ts>]\n'); process.exit(2); }

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

const refuse = (() => { process.stdout.write('spawn attempted\n'); throw new Error('the read-only driver starts no process'); }) as unknown as typeof import('node:child_process').spawn;
const run = runDashboard({
  tty, signals, store, fixed,
  caps: (size) => ({ interactive: true, cursor: true, colorDepth: 24, charset: 'utf8', theme: 'dark', motion: false, plain: false, ...size }),
  approve: entry ? { node: process.execPath, entry, cwd: repo, env: process.env } : { node: process.execPath, entry: 'none', cwd: repo, env: {}, spawn: refuse },
  err: (s) => { process.stderr.write(s + '\n'); },
});
for (const k of keys) {
  await new Promise<void>((r) => setImmediate(r));
  for (const f of [...handlers]) f(k);
}
const code = await run;
process.stdout.write(`frames ${writes.length - 2}\n`);
process.stdout.write(`center ${writes.some((w) => w.includes('Approval center')) ? 'shown' : 'never'}\n`);
if (process.env.TQ_DRIVER_TEXT === '1') process.stdout.write(`text ${JSON.stringify(writes.join('').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ''))}\n`); // what was on screen, escapes removed
if ((process as unknown as { permission?: { has(s: string): boolean } }).permission?.has('fs.write') === false) process.stdout.write('writes denied\n');
process.exit(code);
