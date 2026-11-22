/**
 * Plain-text layout helpers (width by display columns, never by code units). Plain text in, plain text out: cut and
 * pad first, paint after. Pass `ellipsis(caps)` (tokens.ts) so an ASCII terminal gets `...`. Text from outside Taskquoin is neutralised (neutral.ts) before it gets here. Pure.
 */
import { t } from '../i18n/index.ts';
import { displayWidth } from '../i18n/width.ts';

const ESC = String.fromCharCode(0x1b);

/** Longest prefix of `s` within `width` columns; a wide character that does not fit is left out whole. */
function prefix(s: string, width: number): string {
  let out = '', w = 0;
  for (const ch of s) {
    const cw = displayWidth(ch);
    if (w + cw > width) break;
    out += ch; w += cw;
  }
  return out;
}

export function cut(s: string, width: number, ellipsis = '…'): string {
  if (width <= 0) return '';
  if (displayWidth(s) <= width) return s;
  const ew = displayWidth(ellipsis);
  if (ew > width) return prefix(ellipsis, width);
  return prefix(s, width - ew) + ellipsis;
}

export function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

/** Exactly `width` columns: cut with an ellipsis, then padded. */
export function fit(s: string, width: number, ellipsis = '…'): string {
  return pad(cut(s, width, ellipsis), width);
}

/** `left` at the left edge, `right` at the right edge, exactly `width` columns; the left is cut first, the right kept. */
export function spread(left: string, right: string, width: number): string {
  const rw = displayWidth(right);
  if (rw + 1 > width) return fit(right, width);
  return pad(cut(left, width - rw - 1), width - rw) + right;
}

const SGR_STICKY = /\x1b\[[0-9;]{0,20}m/y; // Taskquoin's own colour codes, at most 24 characters
const CSI_STICKY = /\x1b\[[0-9;:?<=>]*[ -/]*[@-~]/y; // any other CSI: dropped whole, never left as visible text

/**
 * SGR-aware clip to `width` columns, and the last cleaning before the terminal: colour codes (plain `;` form, up to 24
 * characters) are kept and closed; every other escape sequence, C0 control, DEL and C1 control is dropped.
 */
export function clip(line: string, width: number): string {
  let out = '', w = 0, sgr = false, over = false;
  for (let i = 0; i < line.length;) {
    const cp = line.codePointAt(i)!;
    if (cp === 0x1b) {
      SGR_STICKY.lastIndex = i;
      const m = SGR_STICKY.exec(line);
      if (m) { sgr = true; out += m[0]; i += m[0].length; continue; }
      CSI_STICKY.lastIndex = i;
      const o = CSI_STICKY.exec(line);
      i += o ? o[0].length : 1;
      continue;
    }
    const ch = String.fromCodePoint(cp);
    i += ch.length;
    if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || over) continue;
    const cw = cp < 0x7f ? 1 : displayWidth(ch);
    if (w + cw > width) { over = true; continue; }
    out += ch; w += cw;
  }
  return sgr && over ? out + ESC + '[0m' : out;
}

/** Word wrap by display width; blank lines kept, words longer than a line split (a character is never split). */
export function wrap(s: string, width: number): string[] {
  const max = Math.max(1, width);
  const out: string[] = [];
  for (const para of s.split('\n')) {
    let line = '', w = 0;
    const push = (): void => { out.push(line); line = ''; w = 0; };
    for (const word of para.split(' ').filter((x) => x !== '')) {
      const ww = displayWidth(word);
      if (line !== '' && w + 1 + ww <= max) { line += ' ' + word; w += 1 + ww; continue; }
      if (line !== '') push();
      if (ww <= max) { line = word; w = ww; continue; }
      for (const ch of word) {
        const cw = displayWidth(ch);
        if (w + cw > max && line !== '') push();
        line += ch; w += cw;
      }
    }
    if (line !== '' || para.trim() === '') out.push(line);
  }
  return out;
}

export function expandTabs(s: string, stop = 4): string {
  let out = '', col = 0;
  for (const ch of s) {
    if (ch === '\t') { const n = stop - (col % stop); out += ' '.repeat(n); col += n; }
    else if (ch === '\n') { out += ch; col = 0; }
    else { out += ch; col += displayWidth(ch); }
  }
  return out;
}

const two = (x: number): string => String(x).padStart(2, '0');
const valid = (iso: string | undefined): number | undefined => { const ms = iso ? Date.parse(iso) : NaN; return Number.isFinite(ms) ? ms : undefined; };

/** HH:MM:SS, local time; `?` when unknown (an empty or unparsable time is never formatted as a date). The one copy: the timeline uses it too. */
export function clock(iso: string | undefined): string {
  const ms = valid(iso);
  if (ms === undefined) return '?';
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** For lists: `HH:MM` today, `YYYY-MM-DD HH:MM` another day, `?` when unknown. */
export function localWhen(iso: string, nowMs: number): string {
  const ms = valid(iso);
  if (ms === undefined) return '?';
  const d = new Date(ms), now = new Date(nowMs);
  const hm = clock(iso).slice(0, 5);
  const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return same ? hm : `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${hm}`;
}

/** `49 s`, `1 min 38 s`, `1 h 02 min` (translated units); `?` when not recorded. The one copy: the timeline uses it too. */
export function duration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return '?';
  const s = Math.floor(ms / 1000);
  if (s < 60) return t('timeline.dur.s', { s });
  if (s < 3600) return t('timeline.dur.min', { m: Math.floor(s / 60), s: s % 60 });
  return t('timeline.dur.h', { h: Math.floor(s / 3600), m: two(Math.floor(s / 60) % 60) });
}
