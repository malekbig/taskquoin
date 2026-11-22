/**
 * Panels: a rounded light border with the title and a right label in the top rule (focused: `mint` border and bold
 * title, others `line`), and the borderless `section` for narrow terminals. Both return exactly `height` lines of
 * exactly `width` columns. Body text is already neutralised and may carry colour: it is clipped, never re-measured by
 * code units. Pure.
 */
import type { Caps } from '../caps.ts';
import { bold, ellipsis, paint, type Token } from '../tokens.ts';
import { clip, cut, pad } from '../text.ts';
import { displayWidth } from '../../i18n/width.ts';

interface Rule { h: string; left: string; right: string; v: string }
const rule = (caps: Caps): Rule =>
  caps.charset === 'utf8' ? { h: '─', left: '╭', right: '╮', v: '│' } : { h: '-', left: '+', right: '+', v: '|' };

/** `─ Title ──── right ─` of `inner` columns: title cut first, right label kept while it fits. */
function head(title: string, right: string | undefined, inner: number, caps: Caps, token: Token, titleStyle: (s: string) => string): string {
  const h = rule(caps).h;
  const dash = (n: number): string => paint(token, h.repeat(Math.max(0, n)), caps);
  let r = right !== undefined && right !== '' ? right : undefined;
  let budget = (): number => inner - 2 - 2 - (r === undefined ? 0 : displayWidth(r) + 2 + 1);
  if (r !== undefined && budget() < 1) { r = cut(r, Math.max(0, inner - 2 - 2 - 1 - 1 - 2), ellipsis(caps)); if (r === '' || budget() < 1) r = undefined; }
  budget = (): number => inner - 2 - 2 - (r === undefined ? 0 : displayWidth(r) + 2 + 1);
  if (budget() < 1) return dash(inner);
  const t = cut(title, budget(), ellipsis(caps));
  const tw = displayWidth(t);
  const rw = r === undefined ? 0 : displayWidth(r) + 2;
  const fill = inner - 1 - (tw + 2) - rw - 1;
  const muted = (s: string): string => paint('muted', s, caps);
  return dash(1) + paint(token, ' ', caps) + titleStyle(t) + paint(token, ' ', caps) + dash(fill)
    + (r === undefined ? '' : paint(token, ' ', caps) + muted(r) + paint(token, ' ', caps)) + dash(1);
}

export function panel(o: { title: string; right?: string; body: string[]; width: number; height: number; focused: boolean }, caps: Caps): string[] {
  const { width, height } = o;
  if (height <= 0) return [];
  if (width < 4) return Array.from({ length: height }, () => ' '.repeat(Math.max(0, width)));
  const token: Token = o.focused ? 'mint' : 'line';
  const r = rule(caps);
  const edge = (s: string): string => paint(token, s, caps);
  const titleStyle = (s: string): string => (o.focused ? bold(paint('mint', s, caps), caps) : paint('muted', s, caps));
  const out = [edge(r.left) + head(o.title, o.right, width - 2, caps, token, titleStyle) + edge(r.right)];
  if (height === 1) return out;
  const inner = width - 4;
  for (let i = 0; i < height - 2; i++) {
    const text = clip(o.body[i] ?? '', inner);
    out.push(edge(r.v) + ' ' + pad(text, inner) + ' ' + edge(r.v));
  }
  out.push(edge(r.left === '╭' ? '╰' : '+') + paint(token, r.h.repeat(width - 2), caps) + edge(r.left === '╭' ? '╯' : '+'));
  return out;
}

/** Borderless: a `── Title ── right ──` rule, then the body; for 40–79 columns. */
export function section(o: { title: string; right?: string; body: string[]; width: number; height: number }, caps: Caps): string[] {
  const { width, height } = o;
  if (height <= 0) return [];
  const h = rule(caps).h;
  const fill = (n: number): string => paint('line', h.repeat(Math.max(0, n)), caps);
  let line: string;
  if (width < 8) line = fill(width);
  else {
    const rt = o.right !== undefined && o.right !== '' ? cut(o.right, Math.max(1, Math.floor(width / 3)), ellipsis(caps)) : undefined;
    const rw = rt === undefined ? 0 : displayWidth(rt) + 2 + 2;
    const t = cut(o.title, Math.max(1, width - 2 - 2 - 1 - rw), ellipsis(caps));
    const used = 2 + 1 + displayWidth(t) + 1 + (rt === undefined ? 0 : 1 + displayWidth(rt) + 1 + 2);
    line = fill(2) + paint('line', ' ', caps) + bold(t, caps) + paint('line', ' ', caps)
      + (rt === undefined ? fill(width - used) : fill(width - used) + paint('line', ' ', caps) + paint('muted', rt, caps) + paint('line', ' ', caps) + fill(2));
  }
  const out = [line];
  for (let i = 0; i < height - 1; i++) out.push(pad(clip(o.body[i] ?? '', width), width));
  return out;
}
