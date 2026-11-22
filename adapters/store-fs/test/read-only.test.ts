/**
 * PROVES: openRepoStoreReadOnly never creates anything, returns undefined for a missing store, the same paths as
 * repoStore for an existing one, and refuses an untrusted directory; on an existing store with runs, events and
 * artifacts, opening it and reading its events changes no entry (names, sizes, modes, mtimes, ctimes); readEvents
 * refuses a symlinked events.jsonl, tolerates a partial last line, malformed lines, a missing file, and keeps the
 * last `max` events.
 * DOES NOT PROVE: protection against a hostile process running as the same user (ADR-0007).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendEvent, openRepoStoreReadOnly, putArtifact, readEvents, repoStore, saveRunState } from '../src/index.ts';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'tq-ro-')));
const repo = join(root, 'repo'); mkdirSync(repo);
const list = (d: string): string[] => readdirSync(d, { recursive: true }).map(String).sort();

test('open on a fresh base: undefined and nothing created', () => {
  const base = join(root, 'fresh'); mkdirSync(base);
  const before = list(base);
  assert.equal(openRepoStoreReadOnly(repo, base), undefined);
  assert.deepEqual(list(base), before);
  assert.equal(openRepoStoreReadOnly(repo, join(root, 'absent')), undefined);
  assert.deepEqual(list(root).filter(n => n === 'absent'), []);
});

test('open after repoStore: same paths; refuses a 0777 store dir', () => {
  const base = join(root, 'state');
  const s = repoStore(repo, base);
  const ro = openRepoStoreReadOnly(repo, base);
  assert.deepEqual(ro, s);
  chmodSync(s.root, 0o777);
  assert.throws(() => openRepoStoreReadOnly(repo, base), /writable/);
});

const store = (name: string) => {
  const base = join(root, name);
  const s = repoStore(repo, base);
  mkdirSync(join(s.runs, 'r1'));
  return { s, file: join(s.runs, 'r1', 'events.jsonl') };
};
const line = (i: number) => JSON.stringify({ type: 'x', i });

test('readEvents: partial last line and malformed lines are skipped', () => {
  const { s, file } = store('ev1');
  writeFileSync(file, [line(1), line(2), line(3)].join('\n') + '\n{"type":"verify.res');
  assert.deepEqual(readEvents(s, 'r1'), { events: [1, 2, 3].map(i => ({ type: 'x', i })), skipped: 1, cut: false });
  writeFileSync(file, line(1) + '\nnot json\n[1]\n' + line(2) + '\n');
  const r = readEvents(s, 'r1');
  assert.equal(r.events.length, 2); assert.equal(r.skipped, 2);
});

test('readEvents: max keeps the last ones; missing file is empty', () => {
  const { s, file } = store('ev2');
  writeFileSync(file, Array.from({ length: 1500 }, (_, i) => line(i)).join('\n') + '\n');
  const r = readEvents(s, 'r1');
  assert.equal(r.events.length, 1000); assert.equal(r.events[0]!.i, 500); assert.equal(r.events[999]!.i, 1499);
  assert.equal(r.cut, true); // 500 older lines were dropped
  assert.equal(readEvents(s, 'r1', { max: 2 }).events.length, 2);
  assert.deepEqual(readEvents(s, 'nope'), { events: [], skipped: 0, cut: false });
  assert.throws(() => readEvents(s, '../x'), /invalid run id/);
});

test('readEvents: an unterminated last line that is complete JSON is accepted', () => {
  const { s, file } = store('ev3');
  writeFileSync(file, line(1) + '\n' + line(2));
  assert.deepEqual(readEvents(s, 'r1'), { events: [{ type: 'x', i: 1 }, { type: 'x', i: 2 }], skipped: 0, cut: false });
});

test('readEvents: reads only the tail of a large file; the cut first line is not counted', () => {
  const { s, file } = store('ev4');
  const n = 200_000; // about 10 MB
  writeFileSync(file, Array.from({ length: n }, (_, i) => JSON.stringify({ type: 'x', i, pad: 'p'.repeat(20) })).join('\n') + '\n');
  const r = readEvents(s, 'r1', { max: 10_000_000, tailBytes: 1_000_000 });
  assert.equal(r.skipped, 0);
  assert.ok(r.events.length < 30_000 && r.events.length > 10_000, String(r.events.length));
  assert.equal(r.events[r.events.length - 1]!.i, n - 1);
  const first = r.events[0]!.i as number;
  assert.equal(r.events.length, n - first); // contiguous tail, first line intact
});

test('readEvents refuses a symlinked events.jsonl (never follows it)', () => {
  const { s, file } = store('ev5');
  const target = join(root, 'elsewhere.jsonl'); writeFileSync(target, line(1) + '\n');
  symlinkSync(target, file);
  assert.throws(() => readEvents(s, 'r1'), /symlink; refusing/);
});

test('an existing store is left untouched by openRepoStoreReadOnly and readEvents (names, sizes, modes, times)', () => {
  const base = join(root, 'populated');
  const s = repoStore(repo, base);
  saveRunState(s, 'run-a', { runId: 'run-a', status: 'running' });
  appendEvent(s, 'run-a', { type: 'node.transition', node: 'plan' }); appendEvent(s, 'run-a', { type: 'agent.started', agent: 'planner' });
  putArtifact(s, Buffer.from('plan text'), { mediaType: 'text/plain', producer: 'plan' });
  const snapshot = () => list(base).map(p => { const st = lstatSync(join(base, p)); return `${p} ${st.size} ${st.mode.toString(8)} ${st.mtimeMs} ${st.ctimeMs}`; });
  const before = snapshot();
  assert.ok(before.length > 8, before.join('\n'));
  const ro = openRepoStoreReadOnly(repo, base)!;
  assert.equal(readEvents(ro, 'run-a').events.length, 2);
  assert.deepEqual(readEvents(ro, 'run-none'), { events: [], skipped: 0, cut: false });
  assert.deepEqual(snapshot(), before);
});

test('readEvents: cut is true when the tail read stops short of the file start, false when everything was read', () => {
  const { s, file } = store('ev-cut');
  writeFileSync(file, Array.from({ length: 200 }, (_, i) => line(i)).join('\n') + '\n');
  assert.equal(readEvents(s, 'r1').cut, false);
  assert.equal(readEvents(s, 'r1', { max: 200 }).cut, false);
  assert.equal(readEvents(s, 'r1', { max: 199 }).cut, true);
  const r = readEvents(s, 'r1', { tailBytes: 300 });
  assert.equal(r.cut, true); assert.ok(r.events.length > 0 && r.events.length < 200);
});

test('a FIFO or a device never blocks a read: events.jsonl, an artifact and a link to either are refused through one descriptor; maxBytes refuses unread', (t) => {
  const { s, file } = store('ev-fifo');
  if (spawnSync('mkfifo', [file]).status !== 0) { t.skip('no mkfifo'); return; }
  const fifo = join(root, 'elsewhere.fifo'); assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  const shas = { fifo: '1'.repeat(64), linkFifo: '2'.repeat(64), linkZero: '3'.repeat(64), linkFile: '4'.repeat(64) };
  assert.equal(spawnSync('mkfifo', [join(s.artifacts, shas.fifo)]).status, 0);
  symlinkSync(fifo, join(s.artifacts, shas.linkFifo));
  symlinkSync('/dev/zero', join(s.artifacts, shas.linkZero));
  const real = putArtifact(s, Buffer.from('plan text'), { mediaType: 'text/plain', producer: 'plan' });
  symlinkSync(real.path, join(s.artifacts, shas.linkFile));
  // in a child with a deadline: a read that blocks fails this test instead of hanging the suite
  const code = `const m = await import(process.argv[1]); const s = JSON.parse(process.argv[2]); const out = {};
    const tryIt = (k, f) => { try { f(); out[k] = 'read'; } catch (e) { out[k] = e.code ?? String(e.message); } };
    tryIt('events', () => m.readEvents(s, 'r1'));
    for (const [k, sha] of Object.entries(JSON.parse(process.argv[3]))) tryIt(k, () => m.getArtifact(s, sha));
    tryIt('real', () => m.getArtifact(s, process.argv[4]));
    tryIt('big', () => m.getArtifact(s, process.argv[4], { maxBytes: 4 }));
    try { m.getArtifact(s, process.argv[4], { maxBytes: 4 }); } catch (e) { out.bigSize = e.size; }
    process.stdout.write(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code, new URL('../src/index.ts', import.meta.url).href, JSON.stringify(s), JSON.stringify(shas), real.sha256], { encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 0, `never blocks (signal ${r.signal}): ${r.stderr}`);
  const out = JSON.parse(r.stdout) as Record<string, unknown>;
  assert.equal(out.events, 'ENOTREG');
  assert.equal(out.fifo, 'ENOTREG');
  for (const k of ['linkFifo', 'linkZero', 'linkFile']) assert.equal(out[k], 'ELOOP', k); // never followed
  assert.equal(out.real, 'read');
  assert.equal(out.big, 'EFBIG');
  assert.equal(out.bigSize, 9);
});
