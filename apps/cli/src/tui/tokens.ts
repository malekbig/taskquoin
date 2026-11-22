/** Design tokens, state glyphs and painting (ADR-0019; values from the terminal design system). Pure. */
import type { Caps } from './caps.ts';

export type Token = 'muted' | 'line' | 'mint' | 'cyan' | 'violet' | 'orange' | 'green' | 'amber' | 'red';
export type StateName = 'ready' | 'risk' | 'blocked' | 'unknown' | 'running' | 'waiting' | 'done' | 'failed' | 'pending' | 'interrupted';

export const TOKEN_HEX: Record<Token, { dark: string; light: string }> = {
  muted: { dark: '#9AA5CE', light: '#5A607A' },
  line: { dark: '#5F6A99', light: '#7F87A6' },
  mint: { dark: '#5EF2C2', light: '#0B7A5E' },
  cyan: { dark: '#7DCFFF', light: '#0B6FA4' },
  violet: { dark: '#BB9AF7', light: '#7340C8' },
  orange: { dark: '#FF9E64', light: '#B5480C' },
  green: { dark: '#9ECE6A', light: '#3E7A1E' },
  amber: { dark: '#E0AF68', light: '#8A5A00' },
  red: { dark: '#F7768E', light: '#C21E45' },
};

/** xterm-256 index, dark / light. */
const IDX256: Record<Token, [number, number]> = {
  muted: [110, 60], line: [61, 103], mint: [85, 29], cyan: [117, 25], violet: [141, 62],
  orange: [215, 130], green: [149, 28], amber: [179, 94], red: [210, 125],
};

/** 16-colour SGR opening parameters. */
const SGR16: Record<Token, string> = {
  muted: '2', line: '90', mint: '36', cyan: '96', violet: '35', orange: '1;33', green: '32', amber: '33', red: '31',
};

const ESC = '\x1b';

export function paint(token: Token, text: string, caps: Caps): string {
  if (caps.colorDepth === 0) return text;
  const light = caps.theme === 'light';
  if (caps.colorDepth === 24) {
    const hex = TOKEN_HEX[token][light ? 'light' : 'dark'];
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return `${ESC}[38;2;${r};${g};${b}m${text}${ESC}[39m`;
  }
  if (caps.colorDepth === 8) return `${ESC}[38;5;${IDX256[token][light ? 1 : 0]}m${text}${ESC}[39m`;
  if (token === 'muted') return `${ESC}[2m${text}${ESC}[22m`;
  if (token === 'orange') return `${ESC}[1;33m${text}${ESC}[22;39m`;
  return `${ESC}[${SGR16[token]}m${text}${ESC}[39m`;
}

const GLYPHS: Record<StateName, [string, string]> = {
  ready: ['●', '[ok]'], risk: ['◐', '[~]'], blocked: ['○', '[x]'], unknown: ['?', '[?]'], running: ['◉', '[>]'],
  waiting: ['◆', '[!]'], done: ['✔', '[v]'], failed: ['✖', '[x]'], pending: ['·', '[ ]'], interrupted: ['‖', '[=]'],
};

export function glyph(state: StateName, caps: Caps): string {
  return GLYPHS[state][caps.charset === 'utf8' ? 0 : 1];
}

const STATE_TOKEN: Record<StateName, Token> = {
  ready: 'green', risk: 'amber', blocked: 'red', unknown: 'muted', running: 'cyan',
  waiting: 'orange', done: 'green', failed: 'red', pending: 'muted', interrupted: 'amber',
};

export function stateToken(state: StateName): Token {
  return STATE_TOKEN[state];
}
