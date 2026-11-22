/**
 * PROVES: neutralize() leaves no forbidden character in any hostile string (every one marked and counted), keeps
 * legitimate scripts untouched, keeps ZWJ/ZWNJ only in the `log` profile, marks newline and tab in one-line contexts,
 * normalises CRLF first; nCut cuts by display width after neutralising, never inside a marker, and ends a cut text
 * with an ellipsis within max; jsonOut escapes only what can act on a terminal or reorder its display (DEL, C1, bidi
 * controls, U+2028/U+2029) and is byte-identical to JSON.stringify otherwise.
 * DOES NOT PROVE: that every print site calls it (cli.test.ts drives the real CLI).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cutNeutral, jsonOut, n, nBlock, nCut, neutralize, nLog, type Neutral } from '../src/tui/neutral.ts';
import { displayWidth } from '../src/i18n/width.ts';
import { CORPUS, FORBIDDEN } from './support/tui-fixtures.ts';

const FORBIDDEN_G = new RegExp(FORBIDDEN.source, 'gu');

test('every corpus string is inert and marked, in both profiles and in one-line mode', () => {
  for (const evil of CORPUS) for (const o of [{}, { profile: 'log' as const }, { singleLine: true }]) {
    const r = neutralize(evil, o);
    assert.doesNotMatch(r.text, FORBIDDEN, JSON.stringify(evil));
    assert.ok(r.marked > 0, JSON.stringify(evil));
    const expected = (evil.replace(/\r\n/g, '\n').match(FORBIDDEN_G) ?? []).length;
    assert.equal(r.marked, expected, JSON.stringify(evil));
  }
});

test('markers are visible and named', () => {
  assert.equal(neutralize('a\u001b[2Jb').text, 'a\u2039ESC\u203a[2Jb');
  assert.equal(neutralize('x\ry').text, 'x\u2039CR\u203ay');
  assert.equal(neutralize('\u202e').text, '\u2039U+202E\u203a');
  assert.equal(neutralize('\u009b').text, '\u2039CSI\u203a');
  assert.equal(neutralize('t\u{e0041}').text, 't\u2039U+E0041\u203a');
});

test('CJK, Arabic and ordinary text are unchanged', () => {
  for (const ok of ['为登录页面添加速率限制', 'مرحبا بالعالم', 'plain text, with: punctuation (and) é', '‹']) {
    assert.equal(neutralize(ok).text, ok); assert.equal(neutralize(ok).marked, 0);
  }
});

test('ZWJ/ZWNJ survive in the log profile only', () => {
  const hi = 'नमस्ते\u200dदुनिया', fa = 'می\u200cخواهم';
  assert.equal(neutralize(hi, { profile: 'log' }).marked, 0);
  assert.equal(neutralize(hi).marked, 1);
  assert.equal(neutralize(fa, { profile: 'log' }).text, fa);
  assert.equal(neutralize(fa).marked, 1);
  assert.equal(neutralize('a\u200bb', { profile: 'log' }).marked, 1, 'zero-width space is marked in logs too');
});

test('singleLine marks newline and tab; multi-line keeps them; CRLF is normalised first', () => {
  assert.equal(neutralize('a\nb\tc', { singleLine: true }).text, 'a\u2039LF\u203ab\u2039TAB\u203ac');
  assert.equal(neutralize('a\nb\tc', { singleLine: true }).marked, 2);
  assert.equal(neutralize('a\nb\tc').text, 'a\nb\tc');
  assert.equal(neutralize('a\r\nb').text, 'a\nb');
  assert.equal(neutralize('a\r\nb').marked, 0);
  assert.equal(neutralize('a\rb').marked, 1);
  assert.equal(n('a\r\nb'), 'a\u2039LF\u203ab');
});

test('log profile keeps the emoji variation selectors U+FE0E/U+FE0F but marks the other selectors', () => {
  assert.equal(neutralize('\u2764\ufe0f \u2764\ufe0e', { profile: 'log' }).marked, 0);
  assert.equal(neutralize('\u2764\ufe0f').marked, 1);
  assert.equal(neutralize('a\ufe00', { profile: 'log' }).marked, 1);
});

/** Legitimate text a request, an approver name or a history outcome holds in the 22 languages: never escaped. */
const LEGIT = {
  fa: 'می\u200cخواهم', heart: '\u2764\ufe0f', family: '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}',
  england: '\u{1f3f4}\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}', hi: 'नमस्ते\u200dदुनिया',
  invisible: 'a\u200bb\ufeffc\u3164d\u00ade\u2060f', cjk: '为登录 é',
};
test('jsonOut: byte-identical to JSON.stringify for legitimate text (ZWNJ, emoji selectors, ZWJ sequences, tag flags)', () => {
  for (const [k, v] of Object.entries(LEGIT)) assert.equal(jsonOut({ [k]: v, list: [v, 1, null] }), JSON.stringify({ [k]: v, list: [v, 1, null] }, null, 2), k);
  assert.equal(jsonOut(LEGIT, 0), JSON.stringify(LEGIT, null, 0));
});

test('jsonOut: DEL, C1, the bidi controls and U+2028/U+2029 become \\u escapes, in values and keys; same parsed value', () => {
  const hostile = 'a\u007fb\u009bc\u0085d\u061ce\u200ef\u200fg\u202ah\u202ei\u2066j\u2069k\u2028l\u2029m\u001bn';
  const evil = { k: hostile, ['\u202e']: [hostile] };
  const out = jsonOut(evil);
  assert.doesNotMatch(out, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/);
  assert.ok(out.includes('a\\u007fb\\u009bc\\u0085d\\u061ce\\u200ef\\u200fg\\u202ah\\u202ei\\u2066j\\u2069k\\u2028l\\u2029m\\u001bn'), out);
  assert.ok(out.includes('"\\u202e": ['), out);
  assert.deepEqual(JSON.parse(out), evil);
});

test('nCut neutralises first, then cuts by display width; a cut text ends with an ellipsis within max', () => {
  assert.equal(nCut('abc', 3), 'abc', 'what fits is unchanged, no ellipsis');
  assert.equal(nCut('abcdef', 3), 'ab\u2026');
  assert.equal(nCut('abcdef', 4, { ascii: true }), 'a...');
  assert.equal(nCut('为登录页面', 5), '为登\u2026');
  assert.equal(nCut('为登录页面', 10), '为登录页面');
  assert.equal(nCut('abc', 1), '\u2026'); assert.equal(nCut('abc', 0), '');
  const cut = nCut('\u001b'.repeat(40), 60);
  assert.equal(cut, '\u2039ESC\u203a'.repeat(11) + '\u2026'); assert.ok(displayWidth(cut) <= 60);
  assert.ok(!nCut('\u202e'.repeat(40), 60).includes('\u202e'));
});

test('nCut never ends inside a marker: it backs off to the marker start (both boundaries)', () => {
  assert.equal(nCut('ab\u001b', 4), 'ab\u2026', 'never ab\u2039E');
  assert.equal(nCut('note \u202e', 8), 'note \u2026', 'never note \u2039U+');
  assert.equal(nCut('a\u001b', 6), 'a\u2039ESC\u203a', 'a marker that fits exactly is kept whole');
  assert.equal(nCut('a\u001bb', 7), 'a\u2039ESC\u203ab');
  assert.equal(nCut('a\u001bb', 6), 'a\u2026', 'one column short: the whole marker goes');
  assert.equal(nCut('a\u001bbc', 7), 'a\u2039ESC\u203a\u2026', 'the marker ends right before the ellipsis');
  assert.equal(nCut('\u2039x\u203ay', 2), '\u2039\u2026', 'a literal guillemet is ordinary text');
  for (const evil of CORPUS) for (let max = 0; max <= 40; max++) {
    const out = nCut(evil, max);
    assert.ok(displayWidth(out) <= max, `${max} ${out}`);
    assert.doesNotMatch(out.replace(/\u2026$/, ''), /\u2039(?:[A-Z]{0,3}|U\+[0-9A-F]{0,6})$/, `${max} ${out}`);
    assert.doesNotMatch(out, FORBIDDEN, `${max} ${out}`);
  }
});

test('every helper returns the neutralised type; a raw string is not one (checked by the typecheck)', () => {
  const shown: Neutral[] = [n('a'), nCut('a', 3), nLog('a'), nBlock('a'), neutralize('a').text, cutNeutral(n('abc'), 2)];
  // @ts-expect-error a raw string is not the neutralised type: a renderer that asks for Neutral refuses it
  const raw: Neutral = 'a';
  assert.deepEqual([...shown, raw], ['a', 'a', 'a', 'a', 'a', 'a\u2026', 'a']);
});
