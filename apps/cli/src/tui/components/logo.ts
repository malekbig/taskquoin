/**
 * The quoin mark and its 2-row wordmark (design-system.md §Logo, chosen by the owner on 2026-11-22). Pure: the caps
 * decide the mode, nothing here reads the process. A quoin is a corner stone: four stones, long and short, one per
 * brand colour; the Q's tail (its bottom-right cell) is orange — the human in the loop.
 */
import type { Caps } from '../caps.ts';
import { paint, type Token } from '../tokens.ts';
import { displayWidth } from '../../i18n/width.ts';
import { t } from '../../i18n/index.ts';

export type HomeMode = 'full' | 'compact' | 'minimal';
/** Full: 100+ columns, 24+ rows; Compact: 70-99 columns or 16-23 rows; Minimal: under 70 columns, under 16 rows, no colour, plain, ASCII. */
export function homeMode(caps: Caps): HomeMode {
  if (caps.colorDepth === 0 || caps.charset === 'ascii' || caps.plain || caps.columns < 70 || caps.rows < 16) return 'minimal';
  return caps.columns < 100 || caps.rows < 24 ? 'compact' : 'full';
}

/** Rows the quoin logo takes in Full and Compact. */
export const LOGO_ROWS = 4;
/** The mark is 6 cells wide, then 2 of gap; the side text of rows 3 and 4 starts here (after the 2-cell indent). */
export const LOGO_SIDE_COL = 2 + 6 + 2;

const STONES: { cells: string; token: Token }[] = [
  { cells: '██████', token: 'mint' }, { cells: '███', token: 'cyan' }, { cells: '██████', token: 'violet' }, { cells: '███', token: 'orange' },
];
/** T A S K Q U O I N, two rows each; I is one cell wide, N four. */
const LETTERS: [string, string][] = [
  ['▀█▀', ' █ '], ['▄▀▄', '█▀█'], ['█▀▀', '▄▄█'], ['█▄▀', '█ █'], ['▄▀▄', '▀▄█'], ['█ █', '▀▄▀'], ['▄▀▄', '▀▄▀'], ['█', '█'], ['█▄ █', '█ ▀█'],
];
const GRADIENT: Token[] = ['mint', 'mint', 'mint', 'cyan', 'cyan', 'cyan', 'violet', 'violet', 'violet'];
const Q = 4;

type Seg = [Token | undefined, string];
const paintSegs = (segs: Seg[], caps: Caps): string => segs.map(([tok, s]) => (tok && s ? paint(tok, s, caps) : s)).join('');

function wordmarkRow(r: 0 | 1): Seg[] {
  const segs: Seg[] = [];
  LETTERS.forEach((l, i) => {
    if (i) segs.push([undefined, ' ']);
    const text = l[r];
    if (r === 1 && i === Q) segs.push([GRADIENT[i], text.slice(0, -1)], ['orange', text.slice(-1)]);
    else segs.push([GRADIENT[i], text]);
  });
  return segs;
}

/** The brand on one line: Minimal mode, no colour, plain mode. `▙` in mint when there is colour (`#` without UTF-8). */
export function brandLine(caps: Caps, version: string): string {
  return `${paint('mint', caps.charset === 'utf8' ? '▙' : '#', caps)} taskquoin ${version}`;
}

/**
 * The logo as lines. Full and Compact (with colour, UTF-8, 70+ columns): the 4-row mark, the 2-row wordmark, the
 * version right-aligned on row 1; rows 3 and 4 carry `side` (already painted and cut to fit by the caller), by default
 * the tagline and the promise. Otherwise one line: `▙ taskquoin <version>`.
 */
export function renderLogo(caps: Caps, version: string, side?: readonly [string, string]): string[] {
  if (homeMode(caps) === 'minimal') return [brandLine(caps, version)];
  const width = Math.min(caps.columns, 100);
  const ver = `v${version}`;
  const rows: string[] = [];
  for (let i = 0; i < LOGO_ROWS; i++) {
    const stone = STONES[i];
    const mark = paint(stone.token, stone.cells, caps) + ' '.repeat(6 - stone.cells.length);
    if (i < 2) {
      const word = wordmarkRow(i as 0 | 1);
      const used = 2 + 6 + 2 + word.reduce((w, [, s]) => w + displayWidth(s), 0);
      const gap = i === 0 ? Math.max(1, width - used - displayWidth(ver)) : 0;
      rows.push('  ' + mark + '  ' + paintSegs(word, caps) + (i === 0 ? ' '.repeat(gap) + paint('muted', ver, caps) : ''));
    } else {
      const text = side?.[i - 2] ?? (i === 2 ? paint('orange', t('console.banner.tagline'), caps) : paint('muted', t('console.banner.promise'), caps));
      rows.push('  ' + mark + '  ' + text);
    }
  }
  return rows;
}
