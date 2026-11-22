// Draws terminal text (ANSI 24-bit colour codes) as an SVG on the terminal's cell grid: every character is placed
// at its own column (CJK on two), block elements are drawn as rectangles so logos look as in a terminal, and the
// window carries a title. No font is embedded: the viewer's monospace font draws the glyphs.
import { displayWidth } from '../../apps/cli/src/i18n/width.ts';

const BG = [26, 27, 38], FG = [192, 202, 245];
const CW = 9.6, CH = 20, PADX = 18, PADY = 14, BAR = 30;
const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Quadrant bits: 8 upper-left, 4 upper-right, 2 lower-left, 1 lower-right. */
const QUAD = { '▘': 8, '▝': 4, '▖': 2, '▗': 1, '▌': 10, '▐': 5, '▀': 12, '▄': 3, '▙': 11, '▛': 14, '▜': 13, '▟': 7, '▚': 9, '▞': 6, '█': 15 };

function cellsOf(line) {
  const cells = []; let fg = FG, bg = null, bold = false, inv = false;
  for (let i = 0; i < line.length;) {
    const m = /^\x1b\[([0-9;]*)m/.exec(line.slice(i));
    if (m) {
      const p = m[1].split(';').filter(Boolean).map(Number); if (!p.length) p.push(0);
      for (let j = 0; j < p.length; j++) {
        const v = p[j];
        if (v === 0) { fg = FG; bg = null; bold = false; inv = false; } else if (v === 1) bold = true; else if (v === 22) bold = false;
        else if (v === 7) inv = true; else if (v === 27) inv = false; else if (v === 39) fg = FG; else if (v === 49) bg = null;
        else if ((v === 38 || v === 48) && p[j + 1] === 2) { const rgb = p.slice(j + 2, j + 5); if (v === 38) fg = rgb; else bg = rgb; j += 4; }
      }
      i += m[0].length; continue;
    }
    if (line[i] === '\x1b') throw new Error(`svg: unsupported escape sequence in ${JSON.stringify(line.slice(i, i + 12))}`);
    const ch = String.fromCodePoint(line.codePointAt(i)); i += ch.length;
    const w = displayWidth(ch); if (!w) continue;
    cells.push({ ch, fg: inv ? (bg ?? BG) : fg, bg: inv ? fg : bg, bold, w });
  }
  return cells;
}

/** `text`: the screen (lines separated by \n, SGR colour codes allowed); `title`: shown in the window bar. */
export function terminalSvg(text, title) {
  const lines = text.replace(/\n+$/, '').split('\n');
  const cols = Math.max(20, ...lines.map((l) => displayWidth(l)));
  const width = Math.ceil(cols * CW + 2 * PADX), height = BAR + lines.length * CH + 2 * PADY;
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">`,
    `<title>${esc(title)}</title>`,
    `<rect width="${width}" height="${height}" rx="8" fill="${hex(BG)}"/>`,
    `<path d="M0 8a8 8 0 0 1 8-8h${width - 16}a8 8 0 0 1 8 8v${BAR - 8}h-${width}z" fill="#16161e"/>`,
    ...['#f7768e', '#e0af68', '#9ece6a'].map((f, i) => `<circle cx="${16 + i * 17}" cy="${BAR / 2}" r="5" fill="${f}"/>`),
    `<text x="${width / 2}" y="${BAR / 2 + 4.5}" text-anchor="middle" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" font-size="12.5" fill="#787c99">${esc(title)}</text>`,
    `<g font-family="'Cascadia Mono','JetBrains Mono','DejaVu Sans Mono',Menlo,Consolas,'Noto Sans Mono CJK SC','Noto Sans Mono','Segoe UI Symbol','Noto Sans Symbols 2','Apple Symbols',monospace" font-size="16" xml:space="preserve">`];
  lines.forEach((line, r) => {
    const y0 = BAR + PADY + r * CH; let x = 0; let run = null; const runs = [];
    for (const cell of cellsOf(line)) {
      const x0 = +(PADX + x * CW).toFixed(1);
      if (cell.bg) o.push(`<rect x="${x0}" y="${y0}" width="${(cell.w * CW + 0.4).toFixed(1)}" height="${CH + 0.4}" fill="${hex(cell.bg)}"/>`);
      const q = QUAD[cell.ch];
      if (q) {
        const hw = CW / 2, hh = CH / 2, f = hex(cell.fg);
        if (q === 15) o.push(`<rect x="${x0}" y="${y0}" width="${(CW + 0.4).toFixed(1)}" height="${CH + 0.4}" fill="${f}"/>`);
        else for (const [bit, dx, dy] of [[8, 0, 0], [4, hw, 0], [2, 0, hh], [1, hw, hh]]) if (q & bit) o.push(`<rect x="${(x0 + dx).toFixed(1)}" y="${y0 + dy}" width="${(hw + 0.4).toFixed(1)}" height="${hh + 0.4}" fill="${f}"/>`);
        run = null;
      } else if (cell.ch === ' ') run = null;
      else {
        const key = hex(cell.fg) + (cell.bold ? 'b' : '');
        if (!run || run.key !== key) { run = { key, fg: hex(cell.fg), bold: cell.bold, xs: [], text: '' }; runs.push(run); }
        run.xs.push(x0); run.text += cell.ch;
      }
      x += cell.w;
    }
    for (const t of runs) o.push(`<text x="${t.xs.join(' ')}" y="${y0 + 15}" fill="${t.fg}"${t.bold ? ' font-weight="bold"' : ''}>${esc(t.text)}</text>`);
  });
  o.push('</g></svg>');
  return o.join('\n') + '\n';
}
