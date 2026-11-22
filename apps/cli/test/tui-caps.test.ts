/**
 * PROVES: detectCaps turns a stdin/stdout/env snapshot into one Caps value following the design system rules:
 *  NO_COLOR (non-empty only), TERM=dumb, Windows Terminal WT_SESSION raising 8 to 24, non-TTY, charset from
 *  LC_ALL > LC_CTYPE > LANG, theme from TASKQUOIN_THEME then COLORFGBG, motion and plain switches, 80x24 defaults.
 * DOES NOT PROVE: that a real terminal honours the result, or anything about rendering (see tui-tokens.test.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCaps } from '../src/tui/caps.ts';

type Out = { isTTY?: boolean; columns?: number; rows?: number; getColorDepth?: (env: Record<string, string | undefined>) => number };
function caps(env: Record<string, string | undefined> = {}, stdout: Out = {}, stdinTTY = true) {
  return detectCaps({ stdinTTY, stdout: { isTTY: true, getColorDepth: () => 24, ...stdout }, env });
}

test('NO_COLOR non-empty forces colour off; empty does not', () => {
  assert.equal(caps({ NO_COLOR: '1' }).colorDepth, 0);
  assert.equal(caps({ NO_COLOR: '' }).colorDepth, 24);
});
test('TERM=dumb: no colour, no motion, no cursor movement', () => {
  const c = caps({ TERM: 'dumb' });
  assert.equal(c.colorDepth, 0);
  assert.equal(c.motion, false);
  assert.equal(c.cursor, false);
});
test('cursor movement: a terminal on both sides and not TERM=dumb; NO_COLOR, no animation or plain mode keep it', () => {
  assert.equal(caps().cursor, true);
  assert.equal(caps({ NO_COLOR: '1', TASKQUOIN_NO_ANIMATION: '1', TASKQUOIN_PLAIN: '1' }).cursor, true);
  assert.equal(caps({}, { isTTY: false }).cursor, false);
  assert.equal(caps({}, {}, false).cursor, false);
});
test('colour depth comes from getColorDepth(env); WT_SESSION raises 8 to 24 only', () => {
  assert.equal(caps({ WT_SESSION: 'x' }, { getColorDepth: () => 8 }).colorDepth, 24);
  assert.equal(caps({}, { getColorDepth: () => 8 }).colorDepth, 8);
  assert.equal(caps({ WT_SESSION: 'x' }, { getColorDepth: () => 4 }).colorDepth, 4);
  assert.equal(caps({}, { getColorDepth: () => 1 }).colorDepth, 0);
  let seen: Record<string, string | undefined> | undefined;
  caps({ FORCE_COLOR: '2' }, { getColorDepth: (e) => { seen = e; return 8; } });
  assert.equal(seen?.FORCE_COLOR, '2');
});
test('no getColorDepth: depth 0', () => {
  assert.equal(detectCaps({ stdinTTY: true, stdout: { isTTY: true }, env: {} }).colorDepth, 0);
});
test('not a TTY: not interactive, no colour, no motion', () => {
  for (const c of [caps({}, { isTTY: false }), caps({}, {}, false)]) {
    assert.equal(c.interactive, false);
    assert.equal(c.colorDepth, 0);
    assert.equal(c.motion, false);
  }
  assert.equal(caps().interactive, true);
  assert.equal(caps().motion, true);
});
test('charset: LC_ALL wins over LC_CTYPE and LANG; first non-empty decides', () => {
  assert.equal(caps({ LANG: 'C' }).charset, 'ascii');
  assert.equal(caps({ LC_ALL: 'fr_FR.UTF-8', LANG: 'C' }).charset, 'utf8');
  assert.equal(caps({ LC_ALL: 'C', LANG: 'en_US.UTF-8' }).charset, 'ascii');
  assert.equal(caps({ LC_ALL: '', LANG: 'en_US.utf8' }).charset, 'utf8');
  assert.equal(caps({ LC_CTYPE: 'en_US.UTF-8' }).charset, 'utf8');
  assert.equal(caps({}).charset, 'ascii');
});
test('theme: TASKQUOIN_THEME, then COLORFGBG, else dark', () => {
  assert.equal(caps({}).theme, 'dark');
  assert.equal(caps({ TASKQUOIN_THEME: 'light' }).theme, 'light');
  assert.equal(caps({ TASKQUOIN_THEME: 'dark', COLORFGBG: '0;15' }).theme, 'dark');
  assert.equal(caps({ COLORFGBG: '0;15' }).theme, 'light');
  assert.equal(caps({ COLORFGBG: '15;0' }).theme, 'dark');
  assert.equal(caps({ COLORFGBG: '15;default;7' }).theme, 'light');
  assert.equal(caps({ COLORFGBG: '15;8' }).theme, 'dark');
  assert.equal(caps({ COLORFGBG: 'nonsense' }).theme, 'dark');
});
test('motion and plain switches', () => {
  assert.equal(caps({ TASKQUOIN_NO_ANIMATION: '1' }).motion, false);
  const p = caps({ TASKQUOIN_PLAIN: '1' });
  assert.equal(p.plain, true);
  assert.equal(p.motion, false);
  assert.equal(caps().plain, false);
});
test('size defaults to 80x24 and follows the stream', () => {
  assert.deepEqual([caps().columns, caps().rows], [80, 24]);
  const c = caps({}, { columns: 132, rows: 43 });
  assert.deepEqual([c.columns, c.rows], [132, 43]);
});
