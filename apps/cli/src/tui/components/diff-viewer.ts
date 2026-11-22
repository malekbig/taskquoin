/**
 * The diff and artifact viewer: files, line numbers, search, "read to the end" and a stale marker. A diff is the most
 * hostile text the dashboard shows, so it is neutralised ONCE, when it is parsed (`parseDiff`, `textDocs`): every
 * control, escape, C1, bidi, invisible and tag character becomes a visible, counted marker, CRLF becomes LF and tabs
 * are expanded; the renderers only measure, cut and paint what is already neutral. Nothing here reads or writes a file.
 * A line is never longer than 20 000 characters after parsing and a document keeps its first 100 000 lines, both said
 * on screen. The percentage in the document title is the one real ratio: lines scrolled past / lines in the file.
 */
import { t, tn } from '../../i18n/index.ts';
import { displayWidth } from '../../i18n/width.ts';
import type { Caps } from '../caps.ts';
import type { Key, KeyChunk } from '../keys.ts';
import { cutNeutral, neutralize, type Neutral } from '../neutral.ts';
import { bold, ellipsis, glyph, lineBg, mark, paint } from '../tokens.ts';
import { clip, cut, expandTabs, pad } from '../text.ts';
import { renderFooter } from './status-bar.ts';
import { panel } from './panel.ts';

export interface DocLine { kind: 'hunk' | 'add' | 'del' | 'ctx' | 'meta' | 'text'; old?: number; new?: number; text: string }
export interface Doc { name: string; added: number; removed: number; lines: DocLine[]; marked: number; binary?: true }
export interface ViewerState {
  title: string; docs: Doc[]; file: number; top: number; wrap: boolean;
  search?: { query: string; typing: boolean; hits: { file: number; line: number }[]; at: number };
  readToEnd: boolean[]; artifact: string; sha: string; binding?: { hash: string; current: boolean };
  /** The document area's inner width, set by `sized`; only wrapping needs it to know which lines are on screen. */
  width?: number;
  notice?: string;
}

export const MAX_LINES = 100_000;
export const MAX_LINE = 20_000;
const MAX_HITS = 10_000;
const MAX_QUERY = 100;

// ---- parsing ------------------------------------------------------------------------------------------------------

/** One stored line: cut to MAX_LINE, neutralised (strict), tabs expanded. `marked` counts what was made visible. */
function prep(raw: string): { text: string; marked: number } {
  let r = raw, cutAt = false;
  if (r.length > MAX_LINE) {
    r = r.slice(0, MAX_LINE);
    const c = r.charCodeAt(r.length - 1);
    if (c >= 0xd800 && c <= 0xdbff) r = r.slice(0, -1);
    cutAt = true;
  }
  const z = neutralize(r);
  return { text: expandTabs(z.text) + (cutAt ? '…' : ''), marked: z.marked };
}

const splitLines = (text: string): string[] => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  return lines;
};

const name1 = (raw: string): { text: string; marked: number } => { const z = neutralize(raw, { singleLine: true }); return { text: z.text, marked: z.marked }; };

const stripSide = (p: string, side: 'a' | 'b'): string => {
  let s = p.split('\t')[0]!.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) s = s.slice(1, -1);
  return s.startsWith(`${side}/`) ? s.slice(2) : s;
};

/** `diff --git a/X b/X` → X (a rename keeps the new name through the later `+++` line). */
function gitName(rest: string): string {
  const h = (rest.length - 1) / 2;
  if (Number.isInteger(h) && rest[h] === ' ' && rest.slice(0, h).startsWith('a/') && rest.slice(h + 1).startsWith('b/') && rest.slice(2, h) === rest.slice(h + 3)) return rest.slice(h + 3);
  const at = rest.lastIndexOf(' b/');
  return at >= 0 ? stripSide(rest.slice(at + 1), 'b') : rest;
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** A unified diff (`git diff` output) as one document per file. Neutralises every path and line. */
export function parseDiff(text: string): Doc[] {
  const docs: Doc[] = [];
  const extra = new WeakMap<Doc, number>();
  let cur: Doc | undefined;
  let hunk: { o: number; n: number; ro: number; rn: number } | undefined;
  let binary = false, sawMinus = false, sawPlus = false, nameMarks = 0;

  const start = (name: string): void => {
    const z = name1(name);
    cur = { name: z.text, added: 0, removed: 0, lines: [], marked: z.marked };
    nameMarks = z.marked;
    docs.push(cur); hunk = undefined; binary = false; sawMinus = false; sawPlus = false;
  };
  const rename = (name: string): void => { const z = name1(name); cur!.marked += z.marked - nameMarks; nameMarks = z.marked; cur!.name = z.text; };
  const push = (kind: DocLine['kind'], raw: string, nums: { old?: number; new?: number } = {}): void => {
    const d = cur!;
    if (kind === 'add') d.added++; else if (kind === 'del') d.removed++;
    if (d.lines.length >= MAX_LINES) { extra.set(d, (extra.get(d) ?? 0) + 1); return; }
    const p = prep(raw);
    d.marked += p.marked;
    d.lines.push({ kind, ...nums, text: p.text });
  };
  const note = (): void => {
    if (!binary) { binary = true; cur!.binary = true; cur!.lines.push({ kind: 'meta', text: t('dashboard.viewer.binary') }); }
  };

  for (const raw of splitLines(text)) {
    if (hunk && (hunk.ro > 0 || hunk.rn > 0)) {
      const c = raw[0];
      if (c === '+') { push('add', raw.slice(1), { new: hunk.n++ }); hunk.rn--; continue; }
      if (c === '-') { push('del', raw.slice(1), { old: hunk.o++ }); hunk.ro--; continue; }
      if (c === ' ' || raw === '') { push('ctx', raw.slice(1), { old: hunk.o++, new: hunk.n++ }); hunk.ro--; hunk.rn--; continue; }
      if (c !== '\\') hunk = undefined;
    }
    if (raw.startsWith('diff --git ')) { start(gitName(raw.slice(11))); continue; }
    if (cur && binary) continue; // the base85 block of a binary patch is never shown
    if (raw.startsWith('--- ')) {
      if (!cur || sawMinus) start(stripSide(raw.slice(4), 'a'));
      sawMinus = true;
      continue;
    }
    if (raw.startsWith('+++ ') && cur && !sawPlus) {
      sawPlus = true;
      const p = raw.slice(4).split('\t')[0]!.trim();
      if (p !== '/dev/null') rename(stripSide(p, 'b'));
      continue;
    }
    const h = HUNK.exec(raw);
    if (h) {
      if (!cur) start(t('dashboard.viewer.preamble'));
      hunk = { o: Number(h[1]), n: Number(h[3]), ro: h[2] === undefined ? 1 : Number(h[2]), rn: h[4] === undefined ? 1 : Number(h[4]) };
      push('hunk', raw);
      continue;
    }
    if (raw === 'GIT binary patch' || /^Binary files .* differ$/.test(raw)) { if (!cur) start(t('dashboard.viewer.preamble')); note(); continue; }
    if (!cur) { if (raw.trim() === '') continue; start(t('dashboard.viewer.preamble')); }
    push('meta', raw);
  }
  for (const d of docs) {
    const more = extra.get(d);
    if (more) d.lines.push({ kind: 'meta', text: t('dashboard.viewer.truncated', { count: more }) });
  }
  return docs;
}

/** Plain text (a plan, a challenge, a verify log) as documents, one per name; lines are numbered. */
export function textDocs(named: { name: string; text: string }[]): Doc[] {
  return named.map(({ name, text }): Doc => {
    const z = name1(name);
    const doc: Doc = { name: z.text, added: 0, removed: 0, lines: [], marked: z.marked };
    const lines = text === '' ? [] : splitLines(text);
    lines.forEach((raw, i) => {
      if (i >= MAX_LINES) return;
      const p = prep(raw);
      doc.marked += p.marked;
      doc.lines.push({ kind: 'text', new: i + 1, text: p.text });
    });
    if (lines.length > MAX_LINES) doc.lines.push({ kind: 'meta', text: t('dashboard.viewer.truncated', { count: lines.length - MAX_LINES }) });
    return doc;
  });
}

// ---- units: a marker or a code point is never split -----------------------------------------------------------------

const UNIT = /‹(?:[A-Z]{2,3}|U\+[0-9A-F]{4,6})›|[\s\S]/gu;

function* units(text: string): Generator<[string, number]> {
  for (const [u] of text.matchAll(UNIT)) yield [u, displayWidth(u)];
}

/** `text` cut to `width` columns: a cut line ends with `→` at the last column; never splits a marker. */
function cutLine(text: string, width: number, caps: Caps): string {
  if (width <= 0) return '';
  const arrow = mark('arrow', caps), aw = displayWidth(arrow);
  let out = '', fit = '', w = 0;
  for (const [u, uw] of units(text)) {
    if (w + uw > width) return aw > width ? '' : fit + arrow;
    out += u; w += uw;
    if (w <= width - aw) fit = out;
  }
  return out;
}

/** `text` as rows of at most `width` columns (wrapping): a marker is never split across rows. */
function wrapRows(text: string, width: number): string[] {
  if (width <= 0) return [''];
  const rows: string[] = [];
  let row = '', w = 0;
  for (const [u, uw] of units(text)) {
    if (w + uw > width && row !== '') { rows.push(row); row = ''; w = 0; }
    row += u; w += uw;
  }
  rows.push(row);
  return rows;
}

// ---- geometry -----------------------------------------------------------------------------------------------------

const numWOf = new WeakMap<Doc, number>();
function numW(doc: Doc): number {
  let w = numWOf.get(doc);
  if (w === undefined) {
    let max = 0;
    for (const l of doc.lines) { if (l.old !== undefined && l.old > max) max = l.old; if (l.new !== undefined && l.new > max) max = l.new; }
    w = Math.max(3, String(max).length);
    numWOf.set(doc, w);
  }
  return w;
}
const numbered = (d: Doc): boolean => d.lines.some((l) => l.kind === 'text') && !d.lines.some((l) => l.kind === 'add' || l.kind === 'del' || l.kind === 'ctx');
const gutterW = (d: Doc): number => (numbered(d) ? 2 + numW(d) + 1 : 2 + numW(d) * 2 + 4);

export interface Geometry { wide: boolean; listW: number; width: number; rows: number }
/** The document area: `rows` is what scrolls (before the one-line warning of a file with neutralised characters). */
export function geometry(caps: Caps, height: number): Geometry {
  const wide = caps.columns >= 120 && height >= 8;
  if (wide) return { wide, listW: 36, width: caps.columns - 36 - 1 - 4, rows: Math.max(1, height - 4) };
  return { wide, listW: 0, width: caps.columns, rows: Math.max(1, height - 3) };
}
const rowsFor = (doc: Doc | undefined, base: number): number => Math.max(1, base - (doc && doc.marked > 0 ? 1 : 0));

// ---- the keys -----------------------------------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const cur = (v: ViewerState): Doc | undefined => v.docs[v.file];

/** How many whole logical lines the screen shows from `top` (wrapping makes a line take several rows). */
function linesOnScreen(v: ViewerState, rows: number): number {
  const doc = cur(v);
  if (!doc) return 0;
  if (!v.wrap || v.width === undefined) return Math.min(rows, doc.lines.length - v.top);
  const tw = Math.max(1, v.width - gutterW(doc));
  let used = 0, k = 0;
  for (let i = v.top; i < doc.lines.length; i++) {
    used += wrapRows(doc.lines[i]!.text, tw).length;
    if (used > rows) break;
    k++;
  }
  return Math.max(k, Math.min(1, doc.lines.length - v.top));
}

/** Marks as read to the end every document whose last line is on screen now. `height` as in `viewerKey`. */
export function settle(v: ViewerState, height: number): ViewerState {
  const doc = cur(v);
  if (!doc || v.readToEnd[v.file]) return v;
  if (v.top + linesOnScreen(v, rowsFor(doc, height)) < doc.lines.length) return v;
  const readToEnd = v.readToEnd.slice();
  readToEnd[v.file] = true;
  return { ...v, readToEnd };
}

/** The viewer for freshly loaded documents; the first screen counts as seen. */
export function openViewer(o: { title: string; docs: Doc[]; artifact: string; sha: string; binding?: string }, height: number): ViewerState {
  const v: ViewerState = {
    title: o.title, docs: o.docs, file: 0, top: 0, wrap: false, readToEnd: o.docs.map(() => false), artifact: o.artifact, sha: o.sha,
    ...(o.binding !== undefined ? { binding: { hash: o.binding, current: true } } : {}),
  };
  return settle(v, height);
}

/** Records the document area's width (wrapping needs it to know what is on screen). */
export function sized(v: ViewerState, caps: Caps, height: number): ViewerState {
  const g = geometry(caps, height);
  return v.width === g.width ? v : settle({ ...v, width: g.width }, g.rows);
}

function findHits(docs: Doc[], query: string): { file: number; line: number }[] {
  const q = query.toLowerCase(), hits: { file: number; line: number }[] = [];
  if (q === '') return hits;
  for (let f = 0; f < docs.length; f++) {
    const lines = docs[f]!.lines;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.text.toLowerCase().includes(q)) { hits.push({ file: f, line: i }); if (hits.length >= MAX_HITS) return hits; }
    }
  }
  return hits;
}

function toHit(v: ViewerState, at: number, height: number): ViewerState {
  const s = v.search;
  const hit = s?.hits[at];
  if (!s || !hit) return v;
  const doc = v.docs[hit.file]!, rows = rowsFor(doc, height);
  const inView = hit.file === v.file && hit.line >= v.top && hit.line < v.top + rows;
  const top = inView ? v.top : clamp(hit.line - Math.floor(rows / 3), 0, Math.max(0, doc.lines.length - rows));
  return { ...v, file: hit.file, top, search: { ...s, at } };
}

function typed(v: ViewerState, query: string, height: number): ViewerState {
  const s = v.search!;
  const hits = findHits(v.docs, query);
  return toHit({ ...v, search: { ...s, query, hits, at: 0 } }, 0, height);
}

/** The last top from which scrolling makes sense: unwrapped, the one that fills the screen; wrapped, the last line itself. */
function endTop(v: ViewerState, doc: Doc | undefined, rows: number): number {
  const len = doc?.lines.length ?? 0;
  if (!doc || !v.wrap || v.width === undefined) return Math.max(0, len - rows);
  const tw = Math.max(1, v.width - gutterW(doc));
  let used = 0, top = len;
  while (top > 0) {
    used += wrapRows(doc.lines[top - 1]!.text, tw).length;
    if (used > rows) break;
    top--;
  }
  return Math.max(0, Math.min(len - 1, top));
}

function oneKey(v: ViewerState, key: Key, height: number): { v: ViewerState; close?: true } {
  const doc = cur(v);
  const rows = rowsFor(doc, height);
  const maxTop = endTop(v, doc, rows);
  const s = v.search;
  if (s?.typing) {
    if (key.name === 'esc') { const { search: _s, ...rest } = v; return { v: rest }; }
    if (key.name === 'enter') return { v: s.query === '' ? (({ search: _s, ...rest }) => rest)(v) : { ...v, search: { ...s, typing: false } } };
    if (key.name === 'backspace') return { v: typed(v, [...s.query].slice(0, -1).join(''), height) };
    if (key.name === 'char' && [...s.query].length < MAX_QUERY) return { v: typed(v, s.query + key.ch, height) };
    if (key.name === 'paste') {
      const add = neutralize(key.text, { singleLine: true }).text;
      return { v: typed(v, [...(s.query + add)].slice(0, MAX_QUERY).join(''), height) };
    }
    return { v };
  }
  const to = (top: number): { v: ViewerState } => ({ v: { ...v, top: clamp(top, 0, maxTop) } });
  const file = (f: number): { v: ViewerState } => (f < 0 || f >= v.docs.length || f === v.file ? { v } : { v: { ...v, file: f, top: 0 } });
  switch (key.name) {
    case 'esc':
      if (s) { const { search: _s, ...rest } = v; return { v: rest }; }
      return { v, close: true };
    case 'down': return to(v.top + 1);
    case 'up': return to(v.top - 1);
    case 'pagedown': return to(v.top + Math.max(1, rows - 1));
    case 'pageup': return to(v.top - Math.max(1, rows - 1));
    case 'home': return to(0);
    case 'end': return to(maxTop);
    case 'char': break;
    default: return { v };
  }
  switch (key.ch) {
    case 'q': return { v, close: true };
    case 'j': return to(v.top + 1);
    case 'k': return to(v.top - 1);
    case 'g': return to(0);
    case 'G': return to(maxTop);
    case 'w': return { v: { ...v, wrap: !v.wrap } };
    case '/': return { v: { ...v, search: { query: '', typing: true, hits: [], at: 0 } } };
    case 'n': case 'N': {
      const fwd = key.ch === 'n';
      if (s && s.hits.length > 0) return { v: toHit(v, (s.at + (fwd ? 1 : s.hits.length - 1)) % s.hits.length, height) };
      if (s) return { v };
      return file(v.file + (fwd ? 1 : -1));
    }
    default: return { v };
  }
}

/**
 * Applies the keys of one chunk. `height` is the number of document rows on screen before the one-line warning of a
 * file with neutralised characters (`geometry(caps, rows).rows`). A document is read to the end once its last line was on screen.
 */
export function viewerKey(v: ViewerState, chunk: KeyChunk, height: number): { v: ViewerState; close?: true } {
  let cur_ = v;
  for (const key of chunk.keys) {
    const r = oneKey(cur_, key, height);
    if (r.close) return { v: cur_, close: true };
    cur_ = settle(r.v, height);
  }
  return { v: cur_ };
}

// ---- rendering ----------------------------------------------------------------------------------------------------

const minus = (caps: Caps): string => (caps.charset === 'utf8' ? '−' : '-');
const counts = (a: number, r: number, caps: Caps): string => [a > 0 ? `+${a}` : '', r > 0 ? `${minus(caps)}${r}` : ''].filter((x) => x !== '').join(' ');
/** A translated string on an ASCII terminal: the typographic characters of the catalogs get their ASCII twins. */
const tx = (s: string, caps: Caps): string => (caps.charset === 'utf8' ? s : s.replaceAll('\u00b7', '-').replaceAll('\u2014', '-').replaceAll('\u2026', '...'));
const sep = (caps: Caps): string => ` ${mark('sep', caps)} `;

function percent(doc: Doc, top: number): number {
  return doc.lines.length === 0 ? 0 : Math.round(100 * top / doc.lines.length);
}

function lineRows(v: ViewerState, doc: Doc, caps: Caps, rows: number, width: number): string[] {
  const out: string[] = [];
  const nw = numW(doc), gw = gutterW(doc), num = numbered(doc), tw = Math.max(1, width - gw);
  const hit = v.search?.hits[v.search.at];
  const sign = (k: DocLine['kind']): string => (k === 'add' ? '+' : k === 'del' ? minus(caps) : ' ');
  const n = (x: number | undefined): string => (x === undefined ? ' '.repeat(nw) : String(x).padStart(nw));
  for (let i = v.top; i < doc.lines.length && out.length < rows; i++) {
    const L = doc.lines[i]!;
    let text = L.text;
    if (caps.charset !== 'utf8' && doc.binary && L.kind === 'meta' && text === t('dashboard.viewer.binary')) text = text.replace('—', '-');
    const here = hit !== undefined && hit.file === v.file && hit.line === i;
    const cursor = here ? mark('cursor', caps) : ' ';
    if (L.kind === 'hunk' || L.kind === 'meta') {
      const body = v.wrap ? wrapRows(tx(text, caps), width - 2) : [cutLine(tx(text, caps), width - 2, caps)];
      body.forEach((seg, k) => { if (out.length < rows) out.push(pad(`${k === 0 ? cursor : ' '} ${L.kind === 'hunk' ? paint('cyan', seg, caps) : paint('muted', seg, caps)}`, width)); });
      continue;
    }
    const segs = v.wrap ? wrapRows(text, tw) : [cutLine(text, tw, caps)];
    segs.forEach((seg, k) => {
      if (out.length >= rows) return;
      const lead = k === 0 ? cursor : ' ';
      const gutter = num ? `${lead} ${k === 0 ? n(L.new) : n(undefined)} ` : `${lead} ${k === 0 ? n(L.old) : n(undefined)} ${k === 0 ? n(L.new) : n(undefined)} ${k === 0 ? sign(L.kind) : ' '} `;
      const g = paint('muted', gutter, caps);
      if (L.kind === 'add' || L.kind === 'del') {
        const body = paint(L.kind === 'add' ? 'green' : 'red', pad(seg, tw), caps);
        out.push(lineBg(L.kind, g + body, caps));
      } else out.push(g + seg);
    });
  }
  return out;
}

function header(v: ViewerState, caps: Caps): string {
  const cols = caps.columns;
  const lead = ` ${caps.charset === 'utf8' ? '▙' : '#'} `;
  const a = v.docs.reduce((x, d) => x + d.added, 0), r = v.docs.reduce((x, d) => x + d.removed, 0);
  const right = [tn('dashboard.viewer.filesCount', v.docs.length), counts(a, r, caps)].filter((x) => x !== '').join(' ');
  let room = Math.max(0, cols - displayWidth(lead) - displayWidth(right) - 1);
  const title = cut(tx(v.title, caps), room, ellipsis(caps));
  room -= displayWidth(title);
  let bind = '';
  if (v.binding && room > displayWidth(sep(caps))) {
    const word = v.binding.current
      ? `${t('dashboard.viewer.waiting', { hash: v.binding.hash.slice(0, 12) })} ${glyph('done', caps)} ${t('dashboard.viewer.current')}`
      : `${glyph('failed', caps)} ${t('dashboard.viewer.stale')}`;
    const shown = cut(tx(word, caps), room - displayWidth(sep(caps)), ellipsis(caps));
    bind = sep(caps) + paint(v.binding.current ? 'green' : 'red', shown, caps);
  }
  const left = paint('mint', lead, caps) + bold(title, caps) + bind;
  const used = displayWidth(lead) + displayWidth(title) + displayWidth(bind);
  return left + ' '.repeat(Math.max(1, cols - used - displayWidth(right))) + paint('muted', right, caps);
}

function footer(v: ViewerState, caps: Caps): string {
  const s = v.search;
  const keys: [string, string][] = [
    ['j k', t('dashboard.viewer.key.scroll')], ['n N', s ? t('dashboard.viewer.key.match') : t('dashboard.viewer.key.file')],
    ['/', t('dashboard.viewer.key.search')], ['w', t('dashboard.viewer.key.wrap')], ['p', t('dashboard.viewer.key.approval')], ['q', t('dashboard.viewer.key.back')],
  ];
  let right = '';
  if (v.notice) right = tx(v.notice, caps);
  else if (s) {
    const q = `/${s.query}${s.typing ? mark('caret', caps) : ''}`;
    right = s.hits.length > 0 ? `${q}  ${s.at + 1}/${s.hits.length}` : s.query === '' ? q : `${q}  ${t('dashboard.viewer.searchNone')}`;
  }
  return renderFooter(keys, right, caps, v.notice ? 'amber' : 'muted');
}

function filesBody(v: ViewerState, width: number, rows: number, caps: Caps): string[] {
  const out: string[] = [];
  const list = Math.max(1, rows - 5);
  const start = clamp(v.file - Math.floor(list / 2), 0, Math.max(0, v.docs.length - list));
  for (let i = start; i < Math.min(v.docs.length, start + list); i++) {
    const d = v.docs[i]!;
    const c = counts(d.added, d.removed, caps);
    const warn = d.marked > 0 ? `${mark('warn', caps)} ` : '';
    const lead = `${i === v.file ? mark('cursor', caps) : ' '} ${warn}`;
    const room = Math.max(1, width - displayWidth(lead) - (c === '' ? 0 : displayWidth(c) + 1));
    const name = cutNeutral(d.name as Neutral, room, { ascii: caps.charset !== 'utf8' });
    const gap = ' '.repeat(Math.max(1, width - displayWidth(lead) - displayWidth(name) - displayWidth(c)));
    out.push(paint(d.marked > 0 ? 'red' : 'muted', lead, caps) + (i === v.file ? bold(name, caps) : name) + (c === '' ? '' : gap + paint('muted', c, caps)));
  }
  const a = v.docs.reduce((x, d) => x + d.added, 0), r = v.docs.reduce((x, d) => x + d.removed, 0);
  const read = v.readToEnd.filter(Boolean).length;
  out.push('', paint('muted', cut(`${tn('dashboard.viewer.filesCount', v.docs.length)}${a + r > 0 ? sep(caps) + counts(a, r, caps) : ''}`, width, ellipsis(caps)), caps), '');
  out.push(cut(tx(t('dashboard.viewer.readCount', { k: read, n: v.docs.length }), caps), width, ellipsis(caps)));
  out.push(paint(v.readToEnd[v.file] ? 'green' : 'muted', cut(t(v.readToEnd[v.file] ? 'dashboard.viewer.toEndYes' : 'dashboard.viewer.toEndNo'), width, ellipsis(caps)), caps));
  return out;
}

/** The viewer screen: exactly `height` lines, each within `caps.columns`; everything shown is already neutral. */
export function renderViewer(v: ViewerState, caps: Caps, height: number): string[] {
  const g = geometry(caps, height);
  const doc = cur(v);
  const base = g.rows - (doc && doc.marked > 0 ? 1 : 0);
  const body: string[] = [];
  if (doc) {
    if (doc.marked > 0) body.push(paint('red', cut(`${mark('warn', caps)} ${tn('dashboard.viewer.warn', doc.marked)}`, g.width, ellipsis(caps)), caps));
    body.push(...lineRows(v, doc, caps, Math.max(1, base), g.width));
  }
  const stats = doc ? [counts(doc.added, doc.removed, caps), `${percent(doc, v.top)} %`].filter((x) => x !== '').join(sep(caps)) : '';
  let lines: string[];
  if (g.wide) {
    const mid = height - 2;
    const left = panel({ title: t('dashboard.viewer.files'), right: `${Math.min(v.file + 1, v.docs.length)}/${v.docs.length}`, body: filesBody(v, g.listW - 4, mid - 2, caps), width: g.listW, height: mid, focused: false }, caps);
    const right = panel({ title: doc?.name ?? '', ...(stats ? { right: stats } : {}), body, width: caps.columns - g.listW - 1, height: mid, focused: true }, caps);
    lines = [header(v, caps), ...left.map((l, i) => `${l} ${right[i] ?? ''}`), footer(v, caps)];
  } else {
    const rt = stats;
    const head = `${Math.min(v.file + 1, v.docs.length)}/${v.docs.length} ${doc?.name ?? ''}`;
    const room = Math.max(0, caps.columns - displayWidth(rt) - 1);
    const h2 = cutNeutral(head as Neutral, room, { ascii: caps.charset !== 'utf8' });
    const fileLine = paint('mint', h2, caps) + ' '.repeat(Math.max(1, caps.columns - displayWidth(h2) - displayWidth(rt))) + paint('muted', rt, caps);
    lines = [header(v, caps), fileLine, ...body, footer(v, caps)];
    while (lines.length < height) lines.splice(lines.length - 1, 0, '');
    if (lines.length > height) lines = [...lines.slice(0, height - 1), lines.at(-1)!];
  }
  const out: string[] = [];
  for (let i = 0; i < height; i++) out.push(clip(lines[i] ?? '', caps.columns));
  return out;
}
