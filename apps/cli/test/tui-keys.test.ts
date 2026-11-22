/**
 * PROVES: raw-mode input is decoded into named keys (arrows in both CSI and SS3 forms, paging, home/end, backtab,
 * enter, backspace, a lone ESC, Ctrl+C, multi-byte characters); a chunk with several keys is flagged `multi` (type-ahead
 * or an unbracketed paste); a bracketed paste is one key even split over chunks, never `multi`, dropped above 64 KiB;
 * a terminal reply is `unknown`, never a key. DOES NOT PROVE: what a given terminal sends for a given key.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyDecoder, type Key } from '../src/tui/keys.ts';

const one = (s: string): Key => {
  const d = keyDecoder();
  let r = d.feed(s);
  if (r.length === 0) r = d.flush(); // a lone ESC is held until the caller's timer fires
  assert.equal(r.length, 1, JSON.stringify(s));
  assert.equal(r[0]!.keys.length, 1, JSON.stringify(s));
  assert.equal(r[0]!.multi, false);
  return r[0]!.keys[0]!;
};

const NAMED: [string, string][] = [
  ['\x1b[A', 'up'], ['\x1bOA', 'up'], ['\x1b[B', 'down'], ['\x1bOB', 'down'], ['\x1b[C', 'right'], ['\x1b[D', 'left'],
  ['\x1b[5~', 'pageup'], ['\x1b[6~', 'pagedown'], ['\x1b[H', 'home'], ['\x1b[1~', 'home'], ['\x1b[F', 'end'], ['\x1b[4~', 'end'],
  ['\x1b[Z', 'backtab'], ['\t', 'tab'], ['\r', 'enter'], ['\n', 'enter'], ['\x7f', 'backspace'], ['\b', 'backspace'],
  ['\x1b', 'esc'], ['\x03', 'ctrl-c'],
];
for (const [seq, name] of NAMED) test(`${JSON.stringify(seq)} is ${name}`, () => assert.deepEqual(one(seq), { name }));

test('characters, including multi-byte ones, are one key each', () => {
  assert.deepEqual(one('j'), { name: 'char', ch: 'j' });
  assert.deepEqual(one('é'), { name: 'char', ch: 'é' });
  assert.deepEqual(one('為'), { name: 'char', ch: '為' });
  assert.deepEqual(one('\u{1F600}'), { name: 'char', ch: '\u{1F600}' });
});

test('several keys in one chunk are multi', () => {
  const r = keyDecoder().feed('jj');
  assert.equal(r.length, 1);
  assert.equal(r[0]!.keys.length, 2);
  assert.equal(r[0]!.multi, true);
});

test('a bracketed paste is one paste key, not multi, the carriage return kept in the text', () => {
  const r = keyDecoder().feed('\x1b[200~9c1e04b7aa31\r\x1b[201~');
  assert.deepEqual(r, [{ keys: [{ name: 'paste', text: '9c1e04b7aa31\r' }], multi: false }]);
});

test('a paste split over chunks gives one paste key from the second feed', () => {
  const d = keyDecoder();
  assert.deepEqual(d.feed('\x1b[200~9c1e04'), []);
  assert.deepEqual(d.feed('b7aa31\x1b[20'), []);
  assert.deepEqual(d.feed('1~'), [{ keys: [{ name: 'paste', text: '9c1e04b7aa31' }], multi: false }]);
  assert.deepEqual(d.feed('q'), [{ keys: [{ name: 'char', ch: 'q' }], multi: false }], 'back to normal');
});

test('a paste over 64 KiB gives no key and the decoder recovers', () => {
  const d = keyDecoder();
  assert.deepEqual(d.feed('\x1b[200~' + 'x'.repeat(40_000)), []);
  assert.deepEqual(d.feed('y'.repeat(40_000)), []);
  assert.deepEqual(d.feed('\x1b[201~'), []);
  assert.deepEqual(d.feed('k'), [{ keys: [{ name: 'char', ch: 'k' }], multi: false }]);
});

test('a terminal reply and other sequences are unknown, never characters', () => {
  assert.deepEqual(one('\x1b[?1;2c'), { name: 'unknown', seq: '\x1b[?1;2c' });
  assert.deepEqual(one('\x1b[3~'), { name: 'unknown', seq: '\x1b[3~' });
  assert.equal(one('\x01').name, 'unknown');
  assert.equal(one('\x1bx').name, 'unknown');
});

test('a control, bidi or invisible character typed is never a char key', () => {
  for (const c of ['\x07', '\x04', '\x1f', '\u202e', '\u200b', '\u2028', '\u0085', '\ufeff', '\u200d', '\u{e0041}']) {
    const k = one(c);
    assert.equal(k.name, 'unknown', JSON.stringify(c));
    assert.equal((k as { seq: string }).seq, c);
  }
  assert.deepEqual(one('\x7f'), { name: 'backspace' });
  assert.deepEqual(one('\x03'), { name: 'ctrl-c' });
  assert.equal(one('é').name, 'char');
  assert.equal(one('م').name, 'char');
});

/** Everything the decoder reports for these chunks, then a flush (the caller's timer). */
const all = (chunks: string[]): Key[] => {
  const d = keyDecoder();
  return [...chunks.flatMap((c) => d.feed(c)), ...d.flush()].flatMap((k) => k.keys);
};

const SPLITS: [string, string][] = [
  ['up CSI', '\x1b[A'], ['down SS3', '\x1bOB'], ['pageup', '\x1b[5~'], ['CSI with params', '\x1b[1;5A'], ['backtab', '\x1b[Z'],
  ['terminal reply', '\x1b[?1;2c'], ['paste', '\x1b[200~ab\rc\x1b[201~'], ['paste then key', '\x1b[200~x\x1b[201~q'],
  ['astral character', '\u{1F600}'], ['two keys', 'j\x1b[Bk'],
];
for (const [name, seq] of SPLITS) {
  test(`${name}: split at every offset gives the same keys as unsplit`, () => {
    const whole = all([seq]);
    assert.ok(whole.length > 0);
    for (let k = 1; k < seq.length; k++) {
      assert.deepEqual(all([seq.slice(0, k), seq.slice(k)]), whole, `split at ${k}: ${JSON.stringify(seq.slice(0, k))} | ${JSON.stringify(seq.slice(k))}`);
    }
    for (let k = 1; k < seq.length; k++) for (let m = k + 1; m < seq.length; m++) {
      assert.deepEqual(all([seq.slice(0, k), seq.slice(k, m), seq.slice(m)]), whole, `split at ${k},${m}`);
    }
  });
}

test('a split arrow key is not Esc plus characters', () => {
  assert.deepEqual(all(['\x1b', '[A']), [{ name: 'up' }]);
  assert.deepEqual(all(['\x1b[', 'A']), [{ name: 'up' }]);
  assert.deepEqual(all(['\x1bO', 'B']), [{ name: 'down' }]);
});

test('a split paste start never turns the pasted text into typed keys (no Enter from a paste)', () => {
  const start = '\x1b[200~';
  for (let k = 1; k < start.length; k++) {
    const keys = all([start.slice(0, k), start.slice(k) + 'text\r\x1b[201~']);
    assert.deepEqual(keys, [{ name: 'paste', text: 'text\r' }], `split at ${k}`);
  }
});

test('a lone ESC is held, then Esc by flush() or by the next chunk that does not continue a sequence', () => {
  const d = keyDecoder();
  assert.deepEqual(d.feed('\x1b'), []);
  assert.deepEqual(d.flush(), [{ keys: [{ name: 'esc' }], multi: false }]);
  assert.deepEqual(d.flush(), []);
  assert.deepEqual(d.feed('\x1b'), []);
  assert.deepEqual(d.feed('q'), [{ keys: [{ name: 'esc' }, { name: 'char', ch: 'q' }], multi: true }]);
  assert.deepEqual(d.feed('\x1b'), []);
  assert.deepEqual(d.feed('\x1b'), [{ keys: [{ name: 'esc' }], multi: false }]);
  assert.deepEqual(d.flush(), [{ keys: [{ name: 'esc' }], multi: false }]);
});

test('flush reports an incomplete sequence as unknown, once', () => {
  const d = keyDecoder();
  assert.deepEqual(d.feed('\x1b[1;'), []);
  assert.deepEqual(d.flush(), [{ keys: [{ name: 'unknown', seq: '\x1b[1;' }], multi: false }]);
  assert.deepEqual(d.flush(), []);
});

test('a malformed CSI does not swallow the keys after it', () => {
  assert.deepEqual(all(['\x1b[éq']), [{ name: 'unknown', seq: '\x1b[' }, { name: 'char', ch: 'é' }, { name: 'char', ch: 'q' }]);
  assert.deepEqual(all(['\x1b[1;\x01x']), [{ name: 'unknown', seq: '\x1b[1;' }, { name: 'unknown', seq: '\x01' }, { name: 'char', ch: 'x' }]);
});

test('an endless unfinished CSI is dropped, not held for ever', () => {
  const d = keyDecoder();
  const r = d.feed('\x1b[' + '1;'.repeat(40));
  assert.equal(r[0]!.keys[0]!.name, 'unknown');
  assert.deepEqual(d.feed('q'), [{ keys: [{ name: 'char', ch: 'q' }], multi: false }]);
});
