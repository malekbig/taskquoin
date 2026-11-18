/**
 * PROVES: displayWidth counts wide CJK/Hangul/fullwidth as 2, combining marks (Mn/Me) and format characters (Cf, e.g. ZWNJ) as 0, spacing marks (Mc) as 1, ignores ANSI escapes;
 * padEndDisplay pads by display width; alignColumns puts every right cell at the same display column even with
 * Chinese/Japanese left or right cells.
 * DOES NOT PROVE: how a given terminal renders emoji or ambiguous-width characters, or that command descriptions are translated (Task 3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignColumns, displayWidth, padEndDisplay } from '../src/i18n/width.ts';

test('displayWidth', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('运行'), 4);
  assert.equal(displayWidth('実行する'), 8);
  assert.equal(displayWidth('한국어'), 6);
  assert.equal(displayWidth('é'), 1);
  assert.equal(displayWidth('é'), 1);
  assert.equal(displayWidth('\x1b[38;2;1;2;3mok\x1b[0m'), 2);
});

test('displayWidth: Mn/Me/Cf are zero width, Mc spacing marks count 1 (wcwidth)', () => {
  assert.equal(displayWidth('e\u0301'), 1); // combining acute (Mn)
  assert.equal(displayWidth('\u0915\u093f'), 2); // Devanagari ka + vowel sign i (Mc)
  assert.equal(displayWidth('\u0938\u092e\u0940\u0915\u094d\u0937\u0915'), 6); // समीक्षक: Mc ी counts 1, virama (Mn) 0
  assert.equal(displayWidth('\u062a\u0648\u0633\u0639\u0647\u200c\u062f\u0647\u0646\u062f\u0647'), 10); // ZWNJ (Cf) is 0
});

test('padEndDisplay pads by display width', () => {
  assert.equal(padEndDisplay('运行', 6), '运行  ');
  assert.equal(padEndDisplay('abc', 2), 'abc');
});

test('alignColumns: right cells start at the same display column', () => {
  const rows: [string, string][] = [['/run <任务>', '运行一个任务'], ['/実行', '実行する'], ['/help', '帮助'], ['/quit', 'quit']];
  const lines = alignColumns(rows);
  const starts = lines.map((l, i) => displayWidth(l.slice(0, l.length - rows[i][1].length)));
  assert.equal(new Set(starts).size, 1);
  assert.equal(starts[0], displayWidth('/run <任务>') + 2);
  assert.equal(alignColumns([['a', 'x'], ['bb', 'y']], 1).join('|'), 'a  x|bb y');
});
