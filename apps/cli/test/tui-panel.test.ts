/**
 * PROVES: panels are exactly height x width at 40..200 columns in every language, focused border mint and others line,
 * ASCII charset draws + - | with no non-ASCII character, colour 0 emits no escape, a long title is cut with an ellipsis
 * and the right label kept, sections are borderless rules. DOES NOT PROVE: how a terminal draws the borders.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth } from '../src/i18n/width.ts';
import { panel, section } from '../src/tui/components/panel.ts';
import { TOKEN_HEX } from '../src/tui/tokens.ts';
import { caps, LANGS, withLang } from './support/tui-fixtures.ts';

const E = '\x1b';

const BODY = ['first line', `${E}[32mcoloured${E}[39m`, '为登录页面添加速率限制 and a very long tail that must be clipped for sure', 'x', 'y', 'z'];

test('panel: exactly height x width at 40..200 columns, every language', () => {
  for (const lang of LANGS) for (const width of [40, 60, 80, 100, 120, 200]) for (const height of [1, 2, 3, 6, 12]) {
    const lines = withLang(lang, () => panel({ title: 'Runs 为登录', right: '3/5', body: BODY, width, height, focused: width % 40 === 0 }, caps()));
    assert.equal(lines.length, height);
    for (const l of lines) assert.equal(displayWidth(l), width, JSON.stringify(l));
  }
});

test('panel: focused border is mint, others line; title bold only when focused', () => {
  const f = panel({ title: 'Run', body: ['x'], width: 20, height: 3, focused: true }, caps());
  const u = panel({ title: 'Run', body: ['x'], width: 20, height: 3, focused: false }, caps());
  const [mr, mg, mb] = [1, 3, 5].map((i) => parseInt(TOKEN_HEX.mint.dark.slice(i, i + 2), 16));
  const [lr, lg, lb] = [1, 3, 5].map((i) => parseInt(TOKEN_HEX.line.dark.slice(i, i + 2), 16));
  assert.ok(f[0]!.includes(`${E}[38;2;${mr};${mg};${mb}m`) && f[0]!.includes(`${E}[38;2;94;242;194m`));
  assert.ok(!f[0]!.includes(`38;2;${lr};${lg};${lb}`));
  assert.ok(u[0]!.includes(`${E}[38;2;${lr};${lg};${lb}m`));
  assert.ok(!u[0]!.includes('94;242;194'));
  assert.ok(f[0]!.includes(`${E}[1m`) && !u[0]!.includes(`${E}[1m`));
  assert.ok(f[1]!.includes('94;242;194'), 'side border too');
});

test('panel: ASCII charset draws + - |', () => {
  const lines = panel({ title: 'Run', right: 'r', body: ['x'], width: 16, height: 3, focused: false }, caps({ charset: 'ascii', colorDepth: 0 }));
  assert.deepEqual(lines, ['+- Run ---- r -+', '| x            |', '+--------------+']);
});

test('panel: colour 0 has no escape at all', () => {
  const lines = panel({ title: 'Run', right: '1', body: ['x'], width: 30, height: 5, focused: true }, caps({ colorDepth: 0 }));
  for (const l of lines) assert.doesNotMatch(l, /\x1b/);
  assert.equal(lines[0], '╭─ Run ────────────────── 1 ─╮');
});

test('panel: a title too long is cut with an ellipsis and the right label is kept', () => {
  const [top] = panel({ title: 'A very long title that cannot possibly fit here', right: 'RIGHT', body: [], width: 30, height: 2, focused: false }, caps({ colorDepth: 0 }));
  assert.equal(displayWidth(top!), 30);
  assert.ok(top!.includes('…'));
  assert.ok(top!.includes('RIGHT'));
  const [ascii] = panel({ title: 'A very long title that cannot possibly fit here', right: 'RIGHT', body: [], width: 30, height: 2, focused: false }, caps({ colorDepth: 0, charset: 'ascii' }));
  assert.ok(ascii!.includes('...') && ascii!.includes('RIGHT'));
});

test('panel: tiny sizes never throw and keep the contract', () => {
  for (let w = 0; w < 8; w++) for (let h = 0; h < 4; h++) {
    const lines = panel({ title: 'Title', right: 'r', body: ['abc'], width: w, height: h, focused: true }, caps());
    assert.equal(lines.length, h);
    for (const l of lines) assert.equal(displayWidth(l), w);
  }
});

test('section: borderless, a rule line then the body, exactly height x width', () => {
  for (const width of [40, 80, 120]) {
    const lines = section({ title: 'Agents', right: '4', body: BODY, width, height: 5 }, caps({ colorDepth: 0 }));
    assert.equal(lines.length, 5);
    for (const l of lines) assert.equal(displayWidth(l), width);
    assert.ok(lines[0]!.startsWith('── Agents ─') && lines[0]!.includes(' 4 ──'), lines[0]);
  }
  const a = section({ title: 'Agents', body: [], width: 20, height: 1 }, caps({ colorDepth: 0, charset: 'ascii' }));
  assert.equal(a[0], '-- Agents ----------');
});

test('an ASCII frame holds no non-ASCII character (no ellipsis, border or glyph left in UTF-8)', () => {
  const c = caps({ charset: 'ascii' });
  const lines = [
    ...panel({ title: 'A very long title that cannot possibly fit here', right: 'RIGHT 12345', body: ['plain body', 'x'.repeat(80)], width: 30, height: 6, focused: true }, c),
    ...panel({ title: 'Run', body: [], width: 12, height: 2, focused: false }, c),
    ...section({ title: 'A very long title that cannot possibly fit here', right: 'RIGHT', body: ['body'], width: 30, height: 3 }, c),
  ];
  for (const l of lines) assert.match(l.replace(/\x1b\[[0-9;]*m/g, ''), /^[\x20-\x7e]*$/, JSON.stringify(l));
});
