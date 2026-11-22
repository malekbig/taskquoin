/**
 * PROVES: paint maps a token through the colour depth (none, 16, 256, truecolor) and the theme with the exact
 * design-system values; glyph and stateToken give one glyph and one token per state with the ASCII fallback;
 * every text token meets 4.5:1 and `line` 3:1 against its theme background (WCAG 2.2 formula, AC-16).
 * DOES NOT PROVE: how a given terminal renders the colours, or that screens use the tokens (renderer tests).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glyph, paint, stateToken, TOKEN_HEX, type StateName, type Token } from '../src/tui/tokens.ts';
import type { Caps } from '../src/tui/caps.ts';

const base: Caps = { interactive: true, colorDepth: 24, charset: 'utf8', theme: 'dark', motion: true, plain: false, columns: 80, rows: 24 };
const c = (o: Partial<Caps>): Caps => ({ ...base, ...o });
const E = '\x1b';

test('paint: depth 0 leaves the text unchanged', () => {
  assert.equal(paint('green', 'ok', c({ colorDepth: 0 })), 'ok');
});
test('paint: truecolor', () => {
  assert.equal(paint('green', 'ok', base), `${E}[38;2;158;206;106mok${E}[39m`);
  assert.equal(paint('green', 'ok', c({ theme: 'light' })), `${E}[38;2;62;122;30mok${E}[39m`);
});
test('paint: 256 colours per theme', () => {
  assert.equal(paint('red', 'x', c({ colorDepth: 8 })), `${E}[38;5;210mx${E}[39m`);
  assert.equal(paint('red', 'x', c({ colorDepth: 8, theme: 'light' })), `${E}[38;5;125mx${E}[39m`);
});
test('paint: 16 colours, orange is yellow plus bold, muted is faint', () => {
  const s = c({ colorDepth: 4 });
  assert.equal(paint('orange', 'x', s), `${E}[1;33mx${E}[22;39m`);
  assert.equal(paint('amber', 'x', s), `${E}[33mx${E}[39m`);
  assert.equal(paint('line', 'x', s), `${E}[90mx${E}[39m`);
  assert.equal(paint('muted', 'x', s), `${E}[2mx${E}[22m`);
});
test('glyphs: UTF-8 and ASCII', () => {
  assert.equal(glyph('ready', base), '●');
  assert.equal(glyph('ready', c({ charset: 'ascii' })), '[ok]');
  assert.equal(glyph('running', base), '◉');
  const utf: Record<StateName, string> = { ready: '●', risk: '◐', blocked: '○', unknown: '?', running: '◉', waiting: '◆', done: '✔', failed: '✖', pending: '·', interrupted: '‖' };
  const asc: Record<StateName, string> = { ready: '[ok]', risk: '[~]', blocked: '[x]', unknown: '[?]', running: '[>]', waiting: '[!]', done: '[v]', failed: '[x]', pending: '[ ]', interrupted: '[=]' };
  for (const s of Object.keys(utf) as StateName[]) {
    assert.equal(glyph(s, base), utf[s]);
    assert.equal(glyph(s, c({ charset: 'ascii' })), asc[s]);
  }
});
test('stateToken: one token per state', () => {
  assert.deepEqual(
    (['ready', 'risk', 'blocked', 'unknown', 'running', 'waiting', 'done', 'failed', 'pending', 'interrupted'] as StateName[]).map(stateToken),
    ['green', 'amber', 'red', 'muted', 'cyan', 'orange', 'green', 'red', 'muted', 'amber'],
  );
});

function lum(hex: string): number {
  const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
test('contrast (AC-16): text tokens >= 4.5:1, line >= 3:1', () => {
  const bg = { dark: '#1A1B26', light: '#FFFFFF' } as const;
  for (const theme of ['dark', 'light'] as const) {
    for (const tok of Object.keys(TOKEN_HEX) as Token[]) {
      const r = ratio(TOKEN_HEX[tok][theme], bg[theme]);
      assert.ok(r >= (tok === 'line' ? 3 : 4.5), `${tok} ${theme} ${r.toFixed(2)}`);
    }
  }
});
