/**
 * PROVES: the terminal is given back on every exit path (return, throw, SIGINT, SIGTERM, SIGHUP, process exit): cursor
 * shown, alternate screen left, bracketed paste off, raw mode off, every handler removed, exit codes 130/143/129, restore
 * once, a failing write never changes the exit code; draw writes only changed rows, in one write, and clips to the
 * width; a real SIGTERM to a child process restores the terminal and exits 143.
 * DOES NOT PROVE: how a real terminal renders the sequences (the PTY harness, R5).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { ENTER, nodeTty, RESTORE, withTerminal } from '../src/tui/screen.ts';
import { displayWidth } from '../src/i18n/width.ts';
import { fakeSignals, fakeTty } from './support/tui-fixtures.ts';

const CODES: Record<string, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

for (const how of ['return', 'throw', 'SIGINT', 'SIGTERM', 'SIGHUP', 'exit']) {
  test(`the terminal is given back on ${how}`, async () => {
    const io = fakeTty(), sig = fakeSignals();
    const run = withTerminal(io, sig, async () => {
      assert.equal(io.rawMode, true);
      if (how === 'throw') throw new Error('boom');
      if (how !== 'return') sig.emit(how);
    });
    if (how === 'throw') await assert.rejects(run, /boom/); else await run;
    const out = io.text();
    assert.ok(out.startsWith(ENTER));
    assert.ok(out.lastIndexOf('\x1b[?25h') > out.lastIndexOf('\x1b[?25l'), 'cursor shown last');
    assert.ok(out.lastIndexOf('\x1b[?1049l') > out.lastIndexOf('\x1b[?1049h'), 'alternate screen left');
    assert.ok(out.includes('\x1b[?2004l'), 'bracketed paste off');
    assert.ok(out.endsWith(RESTORE));
    assert.equal(out.split(RESTORE).length - 1, 1, 'restored once');
    assert.equal(io.rawMode, false);
    assert.equal(sig.count(), 0, 'every signal handler removed');
    assert.equal(io.dataHandlers.size + io.resizeHandlers.size, 0);
    assert.deepEqual(sig.exits, CODES[how] === undefined ? [] : [CODES[how]]);
  });
}

test('a write that throws during restore does not change the exit code or hide the error', async () => {
  const io = fakeTty(), sig = fakeSignals();
  io.failWrite = (s) => s === RESTORE;
  await withTerminal(io, sig, async () => { sig.emit('SIGTERM'); });
  assert.deepEqual(sig.exits, [143]);
  assert.equal(io.rawMode, false);
  assert.equal(sig.count(), 0);
  const io2 = fakeTty(); io2.failWrite = (s) => s === RESTORE;
  await assert.rejects(withTerminal(io2, fakeSignals(), async () => { throw new Error('real error'); }), /real error/);
});

test('body result is returned', async () => {
  assert.equal(await withTerminal(fakeTty(), fakeSignals(), async () => 42), 42);
});

test('draw: the same frame twice writes nothing the second time', async () => {
  const io = fakeTty(10, 5), sig = fakeSignals();
  await withTerminal(io, sig, async (s) => {
    io.writes.length = 0;
    assert.equal(s.draw(['one', 'two', 'three']), 3);
    assert.equal(io.writes.length, 1, 'one write per frame');
    io.writes.length = 0;
    assert.equal(s.draw(['one', 'two', 'three']), 0);
    assert.equal(io.writes.length, 0);
  });
});

test('draw: one changed row is one cursor-move + erase-line sequence in one write', async () => {
  const io = fakeTty(10, 5);
  await withTerminal(io, fakeSignals(), async (s) => {
    s.draw(['one', 'two', 'three']);
    io.writes.length = 0;
    assert.equal(s.draw(['one', 'TWO', 'three']), 1);
    assert.equal(io.writes.length, 1);
    assert.equal(io.writes[0], '\x1b[2;1H\x1b[2KTWO');
    assert.equal((io.writes[0]!.match(/\x1b\[\d+;1H\x1b\[2K/g) ?? []).length, 1);
  });
});

test('draw: after invalidate every row is rewritten once; a shorter frame clears the old rows', async () => {
  const io = fakeTty(10, 5);
  await withTerminal(io, fakeSignals(), async (s) => {
    s.draw(['a', 'b', 'c']);
    s.invalidate();
    io.writes.length = 0;
    assert.equal(s.draw(['a', 'b', 'c']), 3);
    assert.equal(io.writes.length, 1);
    assert.equal((io.writes[0]!.match(/\x1b\[\d+;1H\x1b\[2K/g) ?? []).length, 3);
    io.writes.length = 0;
    assert.equal(s.draw(['a']), 2);
    assert.equal(io.writes[0], '\x1b[2;1H\x1b[2K\x1b[3;1H\x1b[2K');
  });
});

test('draw: a resize invalidates the frame', async () => {
  const io = fakeTty(10, 5);
  await withTerminal(io, fakeSignals(), async (s) => {
    s.draw(['a', 'b']);
    for (const f of io.resizeHandlers) f();
    assert.equal(s.draw(['a', 'b']), 5, 'every row of the terminal: the old text may be anywhere');
  });
});

test('draw: a line wider than the terminal is clipped, SGR kept, never half a wide character', async () => {
  const io = fakeTty(5, 3);
  await withTerminal(io, fakeSignals(), async (s) => {
    io.writes.length = 0;
    s.draw(['abcdefghij', '\x1b[31m为登录页面\x1b[39m']);
    const rows = io.writes[0]!.split(/\x1b\[\d+;1H\x1b\[2K/).slice(1);
    assert.equal(rows[0], 'abcde');
    assert.ok(displayWidth(rows[1]!) <= 5);
    assert.ok(rows[1]!.startsWith('\x1b[31m为登'));
    assert.ok(!rows[1]!.includes('录'));
  });
});

test('draw is the last stop: C0, C1, foreign escapes and long or colon SGR never reach the terminal', async () => {
  const io = fakeTty(40, 6);
  await withTerminal(io, fakeSignals(), async (s) => {
    io.writes.length = 0;
    s.draw([
      'a\x07b\x08c\x7fd\x9be\x9df\x85g', '\x1b]0;pwned\x07x', `p${'\x1b'}[38:2:1:2:3mq${'\x1b'}[0m`,
      `p${'\x1b'}[${'1;'.repeat(20)}mq`, '\x1b[2Jcleared', '\x1b[31mok\x1b[0m',
    ]);
    const body = io.writes[0]!.replace(/\x1b\[\d+;1H\x1b\[2K/g, '|');
    assert.equal(body, '|abcdefg|]0;pwnedx|pq\x1b[0m|pq|cleared|\x1b[31mok\x1b[0m');
    assert.doesNotMatch(body.replace(/\x1b\[[0-9;]*m/g, ''), /[\x00-\x1f\x7f-\x9f]/);
  });
});

test('draw: the frame is clipped to the terminal rows', async () => {
  const io = fakeTty(10, 3);
  await withTerminal(io, fakeSignals(), async (s) => {
    io.writes.length = 0;
    assert.equal(s.draw(['1', '2', '3', '4', '5']), 3);
    assert.ok(!io.writes[0]!.includes('4'));
  });
});

test('draw: a failed write leaves nothing assumed painted; the next draw rewrites every row', async () => {
  const io = fakeTty(10, 5);
  await withTerminal(io, fakeSignals(), async (s) => {
    s.draw(['a', 'b']);
    io.failWrite = (w) => w.includes('B');
    assert.throws(() => s.draw(['a', 'B']), /EIO/);
    io.failWrite = undefined;
    io.writes.length = 0;
    assert.equal(s.draw(['a', 'B']), 2, 'not 0: the failed frame was never recorded as painted');
    assert.ok(io.writes[0]!.includes('B'));
  });
});

test('draw: after invalidate or resize, a shorter frame clears the rows the old frame left', async () => {
  const io = fakeTty(10, 6);
  await withTerminal(io, fakeSignals(), async (s) => {
    s.draw(['a', 'b', 'c', 'd']);
    s.invalidate();
    io.writes.length = 0;
    s.draw(['a']);
    assert.deepEqual(io.writes[0]!.match(/\x1b\[(\d+);1H\x1b\[2K/g)!.map((x) => x.match(/\d+/)![0]), ['1', '2', '3', '4']);
    s.draw(['a', 'b', 'c']);
    for (const f of io.resizeHandlers) f();
    io.writes.length = 0;
    s.draw(['z']);
    assert.deepEqual(io.writes[0]!.match(/\x1b\[(\d+);1H\x1b\[2K/g)!.map((x) => x.match(/\d+/)![0]), ['1', '2', '3', '4', '5', '6']);
  });
});

test('a real SIGTERM restores the terminal and exits 143', async () => {
  const child = spawn(process.execPath, [new URL('./support/signal-child.ts', import.meta.url).pathname], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  const ready = new Promise<void>((res) => child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); if (out.includes('READY')) res(); }));
  const closed = new Promise<number | null>((res) => child.on('close', (code) => res(code)));
  await ready;
  child.kill('SIGTERM');
  assert.equal(await closed, 143);
  assert.ok(out.endsWith(RESTORE), JSON.stringify(out));
});

test('nodeTty: raw mode, resume on first subscriber, pause on last, resize, size defaults', () => {
  const calls: string[] = [];
  const stdin = Object.assign(new EventEmitter(), {
    isTTY: true, setRawMode: (on: boolean) => calls.push(`raw ${on}`), setEncoding: (e: string) => calls.push(`enc ${e}`),
    resume: () => calls.push('resume'), pause: () => calls.push('pause'),
  });
  const written: string[] = [];
  const stdout = Object.assign(new EventEmitter(), { columns: 0, rows: 0, write: (s: string) => { written.push(s); return true; } });
  const io = nodeTty(stdin as never, stdout as never);
  io.write('hi'); assert.deepEqual(written, ['hi']);
  io.setRawMode(true); io.setRawMode(false);
  assert.deepEqual(io.size(), { columns: 80, rows: 24 });
  stdout.columns = 120; stdout.rows = 40;
  assert.deepEqual(io.size(), { columns: 120, rows: 40 });
  const got: string[] = [];
  const off1 = io.onData((c) => got.push('a' + c)), off2 = io.onData((c) => got.push('b' + c));
  stdin.emit('data', 'x');
  assert.deepEqual(got, ['ax', 'bx']);
  assert.equal(calls.filter((c) => c === 'resume').length, 1);
  off1(); assert.ok(!calls.includes('pause'));
  off2(); assert.ok(calls.includes('pause'));
  assert.equal(stdin.listenerCount('data'), 0);
  let resized = 0;
  const offR = io.onResize(() => { resized++; });
  stdout.emit('resize'); offR(); stdout.emit('resize');
  assert.equal(resized, 1);
  assert.deepEqual(calls.filter((c) => c.startsWith('raw')), ['raw true', 'raw false']);
});
