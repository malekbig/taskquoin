/**
 * PROVES: width fixtures counted by hand, cut/fit/spread/clip/wrap never exceed the width and never split a wide
 * character, clip keeps colour and closes it, tabs, local times and durations are formatted honestly (`?` when unknown);
 * durations use the timeline's one format.
 * DOES NOT PROVE: how a real terminal draws ambiguous-width glyphs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth } from '../src/i18n/width.ts';
import { clip, clock, cut, duration, expandTabs, fit, localWhen, pad, spread, wrap } from '../src/tui/text.ts';
import { ellipsis } from '../src/tui/tokens.ts';
import { caps, withLang } from './support/tui-fixtures.ts';

const E = '\x1b';

test('displayWidth fixtures', () => {
  assert.equal(displayWidth('为登录'), 6);
  assert.equal(displayWidth('‹ESC›'), 5);
  assert.equal(displayWidth('é'), 1);
});

test('cut: by display width, never half a wide character', () => {
  assert.equal(cut('为登录页面', 5), '为登…');
  assert.equal(cut('abc', 5), 'abc');
  assert.equal(cut('abcdef', 4), 'abc…');
  assert.equal(cut('abcdef', 4, '...'), 'a...');
  assert.equal(cut('abcdef', 0), '');
  assert.equal(cut('为登录', 2), '…');
  for (let w = 0; w < 12; w++) assert.ok(displayWidth(cut('为a登b录c页面', w)) <= w);
});

test('pad and fit: exact width', () => {
  assert.equal(pad('为', 4), '为  ');
  assert.equal(pad('abcdef', 3), 'abcdef');
  for (const s of ['', 'abc', '为登录页面', 'ééx']) for (let w = 0; w < 10; w++) assert.equal(displayWidth(fit(s, w)), w, `${s} ${w}`);
});

test('spread: left and right on one line of exactly the width, the right label kept', () => {
  assert.equal(spread('ab', 'cd', 8), 'ab    cd');
  assert.equal(displayWidth(spread('为登录页面添加速率限制', 'READY', 14)), 14);
  assert.ok(spread('为登录页面添加速率限制', 'READY', 14).endsWith('READY'));
  assert.equal(displayWidth(spread('a', 'longer than width', 6)), 6);
});

test('clip: keeps SGR, closes with a reset, never wider than n, drops other escapes', () => {
  const line = `${E}[31mred text here${E}[39m`;
  const c = clip(line, 6);
  assert.equal(c, `${E}[31mred te${E}[39m${E}[0m`);
  assert.ok(displayWidth(c) <= 6);
  assert.equal(clip('plain', 10), 'plain');
  assert.equal(clip(`${E}[2Jx`, 5), 'x');
  assert.ok(displayWidth(clip('为登录页面', 5)) <= 5);
  assert.equal(clip(`${E}[1mab${E}[22m`, 5), `${E}[1mab${E}[22m`);
});

test('wrap: lines within the width, long words split, blank lines kept', () => {
  const lines = wrap('the quick brown fox jumps over the lazy dog', 10);
  assert.deepEqual(lines, ['the quick', 'brown fox', 'jumps over', 'the lazy', 'dog']);
  for (const l of wrap('supercalifragilisticexpialidocious 为登录页面添加速率限制', 7)) assert.ok(displayWidth(l) <= 7, l);
  assert.deepEqual(wrap('a\n\nb', 5), ['a', '', 'b']);
  assert.deepEqual(wrap('为', 1), ['为']);
});

test('expandTabs', () => {
  assert.equal(expandTabs('a\tb'), 'a   b');
  assert.equal(expandTabs('ab\tc', 8), 'ab      c');
  assert.equal(expandTabs('为\tx'), '为  x');
  assert.equal(expandTabs('a\nb\tc'), 'a\nb   c');
});

test('clock and localWhen: local, `?` when unknown', () => {
  assert.equal(clock(''), '?');
  assert.equal(clock(undefined), '?');
  assert.equal(clock('nope'), '?');
  const iso = '2026-11-22T10:24:13Z';
  const d = new Date(iso), p = (x: number) => String(x).padStart(2, '0');
  assert.equal(clock(iso), `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`);
  assert.equal(localWhen('', 0), '?');
  assert.equal(localWhen('nope', 0), '?');
  assert.equal(localWhen(iso, d.getTime() + 1000), `${p(d.getHours())}:${p(d.getMinutes())}`);
  const earlier = new Date(d.getTime() - 3 * 86_400_000);
  assert.equal(localWhen(earlier.toISOString(), d.getTime()), `${earlier.getFullYear()}-${p(earlier.getMonth() + 1)}-${p(earlier.getDate())} ${p(earlier.getHours())}:${p(earlier.getMinutes())}`);
});

test('duration: the timeline\'s format (one style in a frame), in English and French', () => {
  assert.equal(duration(undefined), '?');
  assert.equal(duration(NaN), '?');
  assert.equal(duration(-5), '?');
  assert.equal(duration(0), '0 s');
  assert.equal(duration(49000), '49 s');
  assert.equal(duration(60000), '1 min 0 s');
  assert.equal(duration(98000), '1 min 38 s');
  assert.equal(duration(252_000), '4 min 12 s');
  assert.equal(duration(3_720_000), '1 h 02 min');
  assert.equal(duration(7_500_000), '2 h 05 min');
  assert.equal(withLang('fr', () => duration(98000)), '1 min 38 s');
});

test('cut with the ASCII ellipsis from the caps', () => {
  assert.equal(cut('abcdef', 5, ellipsis(caps({ charset: 'ascii' }))), 'ab...');
  assert.equal(cut('abcdef', 5, ellipsis(caps())), 'abcd…');
});

test('clip drops every sequence and control that is not a short plain SGR', () => {
  assert.equal(clip(`a${E}[38:2:255:0:0mb`, 9), 'ab');
  assert.equal(clip(`a${E}[${'1;'.repeat(20)}mb`, 9), 'ab');
  assert.equal(clip(`a${E}]0;title\x07b`, 20), 'a]0;titleb');
  assert.equal(clip('a\x07\x08\x0b\x7f\x9b\x9d\x85b', 9), 'ab');
  assert.equal(clip(`${E}[31;1mred${E}[0m`, 9), `${E}[31;1mred${E}[0m`);
  assert.equal(clip(`x${E}`, 5), 'x');
});
