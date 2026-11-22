/**
 * Heap probe for AC-13: `node --expose-gc apps/cli/test/support/heap-events.ts <runs>/<id>/events.jsonl`.
 * A state.json must sit beside the file. Opens the read-only watcher on that run, polls it while events are appended,
 * and prints `heap growth <MB> MB, <events> events` (events in the model never exceed 1 000 whatever the file holds).
 */
import { appendFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { createWatcher, type DashStatic } from '../../src/dashboard-data.ts';

const file = process.argv[2];
if (!file) { console.error('usage: heap-events.ts <runs>/<id>/events.jsonl'); process.exit(2); }
const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) { console.error('run with --expose-gc'); process.exit(2); }
const dir = dirname(file), runs = dirname(dir);
const store = { root: dirname(runs), runs, artifacts: '', policies: '', approvals: '' };
const fixed: DashStatic = { version: '0', repo: 'r', acceptedRisks: [], squad: [], runtimeVersions: {}, checkedAt: '' };

gc(); gc();
const before = process.memoryUsage().heapUsed;
const w = createWatcher(store, fixed, { runId: basename(dir), now: () => new Date() });
let max = 0;
for (let i = 0; i < 50; i++) {
  appendFileSync(file, JSON.stringify({ type: 'agent.started', ts: new Date().toISOString(), agent: 'implementer', runtime: 'claude', label: 'claude', i }) + '\n');
  w.poll();
  max = Math.max(max, w.model().selected?.events.length ?? 0);
}
gc(); gc();
const held = w.model(); // the watcher and its model stay reachable while measuring
const growth = (process.memoryUsage().heapUsed - before) / 1024 / 1024;
console.log(`heap growth ${growth.toFixed(1)} MB, ${Math.max(max, held.selected?.events.length ?? 0)} events`);
