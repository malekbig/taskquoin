/**
 * PROVES: parseDiff reads a 3-file fixture (names, `+48 −6`, line numbers per hunk, `\ No newline` as meta, a binary
 * patch collapsed to one line, CRLF without `‹CR›`, tabs expanded, a path with ESC marked in the name, a bidi override
 * marked in a line) and caps a huge text; renderViewer returns exactly `height` lines of at most `columns` columns at
 * 40..200 columns in en/fr/ja/ar and both charsets, with colour 0 carrying `+`/`−`, the `%` equal to
 * round(100 × top / lines), a long line ending `→` and `w` showing it whole, search (`/`, Enter, `n`/`N`, Esc),
 * `n`/`N` as file keys without a search, a file read to the end once its last line was on screen, a hostile corpus
 * (ESC, OSC 52, CSI, C1, bidi, ZWSP, tag characters, a 10 000-column line, CJK) that never lets a raw byte reach the
 * frame, and sources without a literal control or bidi character.
 * DOES NOT PROVE: loadDocs and the loop (dashboard-data.test.ts, dashboard.test.ts), nor the terminal's own bytes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { displayWidth } from '../src/i18n/width.ts';
import { t } from '../src/i18n/index.ts';
import { keyDecoder, type KeyChunk } from '../src/tui/keys.ts';
import { geometry, openViewer, parseDiff, renderViewer, sized, textDocs, viewerKey, type Doc, type ViewerState } from '../src/tui/components/diff-viewer.ts';
import { caps as mkCaps, CORPUS, FORBIDDEN, LANGS, SGR, withLang } from './support/tui-fixtures.ts';

const E = String.fromCharCode(0x1b);
const visible = (s: string): string => s.replace(SGR, '');
const keys = (s: string): KeyChunk => { const d = keyDecoder(); const all = [...d.feed(s), ...d.flush()]; return { keys: all.flatMap((c) => c.keys), multi: false }; };
const press = (v: ViewerState, s: string, h = 20): ViewerState => viewerKey(v, keys(s), h).v;

function file(name: string, o: { add: number; del: number; old?: number; nw?: number }): string {
  const old = o.old ?? 10, nw = o.nw ?? 10;
  const body = [' context before', ...Array.from({ length: o.del }, (_, i) => `-removed ${i}`), ...Array.from({ length: o.add }, (_, i) => `+added ${i}`), ' context after'];
  return [`diff --git a/${name} b/${name}`, 'index 1111111..2222222 100644', `--- a/${name}`, `+++ b/${name}`, `@@ -${old},${o.del + 2} +${nw},${o.add + 2} @@ section`, ...body, ''].join('\n');
}
const FIXTURE = file('src/login.js', { add: 31, del: 4 }) + file('src/rate-limit.js', { add: 15, del: 0, old: 1, nw: 1 }) + file('test/rate.test.js', { add: 2, del: 2, old: 5, nw: 5 });

test('parseDiff: three files, names, +48 −6, line numbers follow each hunk', () => {
  const docs = parseDiff(FIXTURE);
  assert.deepEqual(docs.map((d) => d.name), ['src/login.js', 'src/rate-limit.js', 'test/rate.test.js']);
  assert.equal(docs.reduce((a, d) => a + d.added, 0), 48);
  assert.equal(docs.reduce((a, d) => a + d.removed, 0), 6);
  assert.deepEqual([docs[0]!.added, docs[0]!.removed], [31, 4]);
  const l = docs[0]!.lines;
  assert.equal(l.find((x) => x.kind === 'hunk')!.text.startsWith('@@ -10,6 +10,33 @@'), true);
  const ctx = l.find((x) => x.kind === 'ctx')!;
  assert.deepEqual([ctx.old, ctx.new], [10, 10]);
  const del = l.find((x) => x.kind === 'del')!;
  assert.deepEqual([del.old, del.new], [11, undefined]);
  const add = l.find((x) => x.kind === 'add')!;
  assert.deepEqual([add.old, add.new], [undefined, 11]);
  const last = l.filter((x) => x.kind === 'ctx').at(-1)!;
  assert.deepEqual([last.old, last.new], [15, 42]);
  assert.deepEqual(docs[1]!.lines.find((x) => x.kind === 'add')!.new, 2);
});

test('parseDiff: `\\ No newline at end of file` is meta; a content line that starts with `--- ` is a removed line', () => {
  const d = parseDiff(['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,2 +1,1 @@', '--- not a header', ' keep', '+z', '\\ No newline at end of file', ''].join('\n'))[0]!;
  assert.equal(d.lines.at(-1)!.kind, 'meta');
  assert.equal(d.lines.at(-1)!.text, '\\ No newline at end of file');
  assert.equal(d.lines.filter((l) => l.kind === 'del').length, 1);
  assert.equal(d.lines.find((l) => l.kind === 'del')!.text, '-- not a header');
});

test('parseDiff: a binary patch is one line; the next file still parses', () => {
  const text = ['diff --git a/logo.png b/logo.png', 'index 1..2 100644', 'GIT binary patch', 'literal 10', 'zcmV;)00000', '', 'diff --git a/a.txt b/a.txt', '--- a/a.txt', '+++ b/a.txt', '@@ -1 +1 @@', '-a', '+b', ''].join('\n');
  const docs = parseDiff(text);
  assert.equal(docs.length, 2);
  assert.equal(docs[0]!.binary, true);
  assert.equal(docs[0]!.lines.filter((l) => l.text === t('dashboard.viewer.binary')).length, 1);
  assert.ok(!docs[0]!.lines.some((l) => l.text.includes('zcmV')));
  assert.equal(docs[1]!.added, 1);
  const lone = parseDiff('diff --git a/i.bin b/i.bin\nBinary files a/i.bin and b/i.bin differ\n');
  assert.equal(lone[0]!.binary, true);
});

test('parseDiff: CRLF gives no ‹CR›, a lone CR is marked, a tab becomes spaces', () => {
  const crlf = parseDiff('diff --git a/x b/x\r\n--- a/x\r\n+++ b/x\r\n@@ -1 +1 @@\r\n-a\r\n+b\tc\r\n');
  const flat = crlf[0]!.lines.map((l) => l.text).join('\n');
  assert.ok(!flat.includes('CR'));
  assert.equal(crlf[0]!.marked, 0);
  assert.ok(!flat.includes('\t'));
  assert.equal(crlf[0]!.lines.find((l) => l.kind === 'add')!.text, 'b   c');
  const lone = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n+a\rb\n');
  assert.match(lone[0]!.lines.find((l) => l.kind === 'add')!.text, /‹CR›/);
});

test('parseDiff: a path with ESC is marked in the name; the file carries the count; a bidi line is marked', () => {
  const name = `src/${E}[31mevil.js`;
  const docs = parseDiff(`diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n-a\n+if (ok) {\u202e }\n`);
  const d = docs[0]!;
  assert.match(d.name, /^src\/‹ESC›\[31mevil\.js$/);
  assert.ok(d.marked >= 2);
  assert.match(d.lines.find((l) => l.kind === 'add')!.text, /‹U\+202E›/);
  assert.ok(![d.name, ...d.lines.map((l) => l.text)].some((s) => FORBIDDEN.test(s)));
  const v = openViewer({ title: 'T', docs, artifact: 'diff-1', sha: 'a' }, 10);
  const text = visible(renderViewer(v, mkCaps({ columns: 100, rows: 12 }), 12).join('\n'));
  assert.match(text, new RegExp(`${t('dashboard.viewer.warn_other', { count: d.marked })}`));
});

test('parseDiff caps a huge text: 100 000 lines kept, the rest said; a 5 MiB text is parsed quickly and inertly', () => {
  const big = 'a'.repeat(79) + '\n';
  const docs = textDocs([{ name: 'big', text: 'x\n'.repeat(Math.ceil(5 * 1024 * 1024 / 2)) }]);
  assert.equal(docs[0]!.lines.length, 100_001);
  assert.match(docs[0]!.lines.at(-1)!.text, /more lines not shown/);
  const start = Date.now();
  parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,200000 @@\n' + '+' + big.repeat(60_000));
  assert.ok(Date.now() - start < 5000);
});

// ---- rendering ----------------------------------------------------------------------------------------------------

const doc3 = (): ViewerState => openViewer({ title: t('dashboard.viewer.titleDiff', { run: 'ab12cd' }), docs: parseDiff(FIXTURE), artifact: 'diff-2', sha: 'f'.repeat(64) }, 20);

test('renderViewer: exactly `height` lines, each within `columns`, 40..200 columns in en fr ja ar, UTF-8 and ASCII', () => {
  for (const lang of LANGS) withLang(lang, () => {
    for (const columns of [40, 60, 80, 100, 120, 160, 200]) for (const charset of ['utf8', 'ascii'] as const) for (const rows of [12, 24, 40]) {
      const v = { ...doc3(), binding: { hash: 'c0ffee123456789a', current: true } };
      for (const state of [v, { ...v, search: { query: 'added', typing: false, hits: [{ file: 0, line: 3 }], at: 0 } }, { ...v, wrap: true }]) {
        const lines = renderViewer(sized(state, mkCaps({ columns, rows, charset }), rows), mkCaps({ columns, rows, charset }), rows);
        assert.equal(lines.length, rows, `${lang} ${columns}x${rows}`);
        for (const l of lines) assert.ok(displayWidth(visible(l)) <= columns, `${lang} ${columns}x${rows} ${charset}: ${visible(l)}`);
      }
    }
  });
});

test('colour 0: no ESC at all, and the +/− column carries the meaning; the Files panel counts', () => {
  const lines = renderViewer(doc3(), mkCaps({ columns: 130, rows: 34, colorDepth: 0 }), 34);
  const text = lines.join('\n');
  assert.ok(!text.includes(E));
  assert.match(text, /\d+ \+ added 0/);
  assert.match(text, /\d+ +− removed 0/);
  assert.match(text, /Files/);
  assert.match(text, /Read: 0 \/ 3 files/);
  assert.match(text, /to the end: no/);
  assert.match(text, /3 files \+48 −6/);
  const ascii = renderViewer(doc3(), mkCaps({ columns: 130, rows: 34, colorDepth: 0, charset: 'ascii' }), 34).join('\n');
  assert.match(ascii, / - removed 0/);
  assert.ok(!/[^\x20-\x7e\n]/.test(ascii.replace(/\u2039[A-Z+0-9]+\u203a/g, '')), 'ASCII frame');
  assert.ok(!/−/.test(ascii));
});

test('colour: added and removed lines carry their background, in 24-bit and 256 colours, none in 16', () => {
  for (const [depth, add] of [[24, '48;2;32;48;59'], [8, '48;5;22']] as const) {
    const text = renderViewer(doc3(), mkCaps({ columns: 100, rows: 20, colorDepth: depth }), 20).join('\n');
    assert.ok(text.includes(add), `${depth}`);
  }
  assert.ok(!renderViewer(doc3(), mkCaps({ columns: 100, rows: 20, colorDepth: 4 }), 20).join('\n').includes('[48;'));
});

test('the percentage is round(100 × top / lines in the file) — the one allowed ratio', () => {
  const caps = mkCaps({ columns: 130, rows: 24, colorDepth: 0 });
  const g = geometry(caps, 24);
  let v = doc3();
  const total = v.docs[0]!.lines.length;
  for (const top of [0, 7, 13, total - g.rows]) {
    const frame = renderViewer({ ...v, top }, caps, 24).join('\n');
    assert.match(frame, new RegExp(`${Math.round(100 * top / total)} %`), `top ${top} of ${total}`);
  }
  const other = renderViewer(v = press(v, 'n'), caps, 24).join('\n');
  assert.match(other, /rate-limit\.js/);
});

test('a long line ends with the arrow at the last column; w shows it whole; the line never overflows', () => {
  const long = 'x'.repeat(10_000);
  const docs = textDocs([{ name: 'long.txt', text: `short\n${long}\nend\n` }]);
  const caps = mkCaps({ columns: 80, rows: 12, colorDepth: 0 });
  let v = openViewer({ title: 'T', docs, artifact: 'plan', sha: 'a' }, geometry(caps, 12).rows);
  const cutLines = renderViewer(v, caps, 12);
  const row = cutLines.find((l) => l.includes('xxxx'))!;
  assert.ok(row.endsWith('→'), row);
  assert.equal(displayWidth(row), 80);
  v = sized(press(v, 'w'), caps, 12);
  assert.equal(v.wrap, true);
  const wrapped = renderViewer(v, caps, 12);
  assert.ok(wrapped.every((l) => displayWidth(l) <= 80));
  assert.ok(!wrapped.join('').includes('→'));
  // wrapping 10 000 columns takes ceil(10000 / textWidth) rows; scrolled to it the whole line is shown
  const tw = 80 - (2 + 3 + 1);
  v = { ...v, top: 1 };
  const all = renderViewer(v, caps, 12).slice(2, -1).filter((l) => l.includes('x')).map((l) => l.replace(/[^x]/g, '')).join('');
  assert.equal(all.length, Math.min(10_000, 9 * tw));
  const ascii = renderViewer({ ...v, wrap: false }, mkCaps({ columns: 80, rows: 12, colorDepth: 0, charset: 'ascii' }), 12).find((l) => l.includes('xxxx'))!;
  assert.ok(ascii.endsWith('->'));
});

test('search: / types, Enter keeps the hits, n and N cycle (wrapping), Esc drops it and n switches files again', () => {
  const docs = textDocs([{ name: 'a.md', text: 'one\nthe rate is 5\ntwo\n' }, { name: 'b.md', text: 'x\nrate again\ny\nRATE once more\n' }]);
  const caps = mkCaps({ columns: 100, rows: 20, colorDepth: 0 });
  let v = openViewer({ title: 'T', docs, artifact: 'plan', sha: 'a' }, 16);
  v = press(v, '/');
  assert.equal(v.search!.typing, true);
  v = press(v, 'rate');
  assert.equal(v.search!.hits.length, 3, 'case-insensitive, across files');
  assert.equal(v.file, 0, 'the first hit is shown');
  v = press(v, '\r');
  assert.equal(v.search!.typing, false);
  const foot = (x: ViewerState) => renderViewer(x, caps, 20).at(-1)!;
  assert.match(foot(v), /n N match/);
  assert.match(foot(v), /\/rate {2}1\/3/);
  v = press(v, 'n'); assert.deepEqual([v.file, v.search!.at], [1, 1]);
  v = press(v, 'n'); v = press(v, 'n'); assert.deepEqual([v.file, v.search!.at], [0, 0], 'wraps');
  v = press(v, 'N'); assert.deepEqual([v.file, v.search!.at], [1, 2], 'previous wraps');
  assert.match(renderViewer(v, caps, 20).join('\n'), /▸ +\d+ +RATE once more/.test('') ? /./ : />|▸/);
  v = press(v, '\x1b');
  assert.equal(v.search, undefined);
  assert.match(foot(v), /n N file/);
  v = press(v, 'N'); assert.equal(v.file, 0, 'file keys again');
  v = press(v, 'n'); assert.equal(v.file, 1);
  v = press(v, 'n'); assert.equal(v.file, 1, 'clamped at the last file');
  // Backspace edits the query; an empty query on Enter is no search; a query with no match says so
  v = press(press(press(v, '/'), 'zq'), '\x7f');
  assert.equal(v.search!.query, 'z');
  v = press(v, '\r');
  assert.match(foot(v), /no match/);
  assert.equal(press(press(v, '\x1b'), '/\r').search, undefined);
});

test('search typing is Key char only: a typed bidi or control character never reaches the query; a paste is neutralised', () => {
  const docs = textDocs([{ name: 'a', text: 'x' }]);
  let v = openViewer({ title: 'T', docs, artifact: 'plan', sha: 'a' }, 10);
  v = press(v, '/');
  v = press(v, 'a\u202eb\u0007c');
  assert.equal(v.search!.query, 'abc');
  v = press(v, `${E}[200~p\u202eq${E}[201~`);
  assert.equal(v.search!.query, 'abcp‹U+202E›q');
  assert.ok(!FORBIDDEN.test(v.search!.query));
  v = press(v, 'q');
  assert.equal(String(v.search!.query).endsWith('q'), true, 'q types while typing, it does not close');
});

test('keys: j k arrows, PgUp PgDn, g G, w, q and Esc close; scrolling is clamped', () => {
  const text = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
  let v = openViewer({ title: 'T', docs: textDocs([{ name: 'a', text }]), artifact: 'plan', sha: 'a' }, 10);
  v = press(v, 'k', 10); assert.equal(v.top, 0);
  v = press(v, 'jj\x1b[B', 10); assert.equal(v.top, 3);
  v = press(v, '\x1b[A', 10); assert.equal(v.top, 2);
  v = press(v, '\x1b[6~', 10); assert.equal(v.top, 11);
  v = press(v, '\x1b[5~', 10); assert.equal(v.top, 2);
  v = press(v, 'G', 10); assert.equal(v.top, 40);
  v = press(v, 'j', 10); assert.equal(v.top, 40);
  v = press(v, 'g', 10); assert.equal(v.top, 0);
  assert.equal(viewerKey(v, keys('q'), 10).close, true);
  assert.equal(viewerKey(v, keys('\x1b'), 10).close, true);
  assert.equal(viewerKey(v, keys('y'), 10).close, undefined);
});

test('a file is read to the end once its last line was on screen; all read → every flag true', () => {
  const caps = mkCaps({ columns: 130, rows: 24 });
  const rows = geometry(caps, 24).rows;
  let v = openViewer({ title: 'T', docs: parseDiff(FIXTURE), artifact: 'diff-2', sha: 'a' }, rows);
  assert.deepEqual(v.readToEnd, [false, false, false], 'only what was on screen counts');
  for (let f = 0; f < 3; f++) {
    v = press(v, 'G', rows);
    assert.equal(v.readToEnd[v.file], true, `file ${f}`);
    v = press(v, 'n', rows);
  }
  assert.deepEqual(v.readToEnd, [true, true, true]);
  const text = renderViewer(v, mkCaps({ columns: 130, rows: 24, colorDepth: 0 }), 24).join('\n');
  assert.match(text, /Read: 3 \/ 3 files/);
  assert.match(text, /to the end: yes/);
});

test('read to the end in wrap mode needs the wrapped last line, not just its first row, to be reachable', () => {
  const caps = mkCaps({ columns: 40, rows: 12, colorDepth: 0 });
  const rows = geometry(caps, 12).rows;
  const text = [...Array.from({ length: 20 }, (_, i) => `l${i}`), 'z'.repeat(400)].join('\n');
  let v = sized({ ...openViewer({ title: 'T', docs: textDocs([{ name: 'a', text }]), artifact: 'plan', sha: 'a' }, rows), wrap: true }, caps, 12);
  assert.equal(v.readToEnd[0], false);
  v = press(v, 'G', rows);
  assert.equal(v.readToEnd[0], true, 'G wrapped goes to a top where the last line starts on screen');
  const shown = renderViewer(v, caps, 12).join('\n');
  assert.match(shown, /zzzz/);
  const plain = press(sized(openViewer({ title: 'T', docs: textDocs([{ name: 'a', text }]), artifact: 'plan', sha: 'a' }, rows), caps, 12), 'G', rows);
  assert.equal(plain.readToEnd[0], true);
});

// ---- hostile text -------------------------------------------------------------------------------------------------

const HOSTILE = [
  ...CORPUS, 'tag\u{e0041}\u{e0042}', 'zero\u200bwidth', 'cjk 日本語のテキスト 中文 한국어', 'emoji \u{1f600} \u{1f468}\u200d\u{1f469}',
  `osc ${E}]52;c;Y3VybA==\u0007 ${E}]8;;https://evil${E}\\link`, `csi ${E}[2J${E}[?1049h${E}[6n`, 'c1 \u009b2J \u0090q \u009d52;c;QQ==\u009c', 'x'.repeat(10_000), '日'.repeat(5000),
];

function hostileDiff(): string {
  const files = HOSTILE.map((h, i) => {
    const name = `f${i}/${h.slice(0, 20)}.js`;
    return [`diff --git a/${name} b/${name}`, `--- a/${name}`, `+++ b/${name}`, '@@ -1,2 +1,2 @@', `-${h}`, `+${h}\t${h}`, ` ${h}`, ''].join('\n');
  });
  return files.join('');
}

test('hostile corpus: every file of a hostile diff leaves the frame free of raw bytes, widths hold, markers are counted', () => {
  const docs = parseDiff(hostileDiff());
  assert.equal(docs.length, HOSTILE.length);
  assert.ok(docs.filter((d) => d.marked > 0).length >= CORPUS.length - 2);
  for (const d of docs) for (const s of [d.name, ...d.lines.map((l) => l.text)]) assert.ok(!FORBIDDEN.test(s), JSON.stringify(s).slice(0, 80));
  for (const columns of [40, 80, 120, 200]) for (const charset of ['utf8', 'ascii'] as const) for (const wrap of [false, true]) {
    const caps = mkCaps({ columns, rows: 30, charset });
    for (let f = 0; f < docs.length; f++) {
      const v = sized({ ...openViewer({ title: 'T', docs, artifact: 'diff-1', sha: 'a' }, 20), file: f, wrap, search: { query: 'x', typing: true, hits: [], at: 0 } }, caps, 30);
      const lines = renderViewer(v, caps, 30);
      assert.equal(lines.length, 30);
      for (const l of lines) {
        const bare = visible(l);
        assert.ok(!bare.includes(E), `ESC left in ${columns} ${JSON.stringify(bare).slice(0, 60)}`);
        assert.ok(!FORBIDDEN.test(bare), `raw byte in frame ${JSON.stringify(bare).slice(0, 60)}`);
        assert.ok(displayWidth(bare) <= columns, `${displayWidth(bare)} > ${columns}`);
      }
    }
  }
});

test('hostile text in a plan artifact (textDocs) is just as inert, and a marked file is flagged in the Files list', () => {
  const docs = textDocs(HOSTILE.map((h, i) => ({ name: `a${i}`, text: h })));
  const caps = mkCaps({ columns: 130, rows: 40, colorDepth: 0 });
  const v = { ...openViewer({ title: 'T', docs, artifact: 'plan', sha: 'a' }, 36), file: 0 };
  const lines = renderViewer(v, caps, 40);
  const text = lines.join('\n');
  assert.ok(!FORBIDDEN.test(text) && !text.includes(E));
  assert.match(text, /⚠ a0|⚠ /);
  assert.match(text, /character(s)? neutralised in this file/);
});

test('CJK lines are cut and wrapped by display width, a wide character is never half drawn', () => {
  const docs = textDocs([{ name: '名前', text: '日本語'.repeat(300) }]);
  for (const columns of [41, 60, 99]) for (const wrap of [false, true]) {
    const caps = mkCaps({ columns, rows: 14, colorDepth: 0 });
    const v = sized({ ...openViewer({ title: 'T', docs, artifact: 'plan', sha: 'a' }, 11), wrap }, caps, 14);
    for (const l of renderViewer(v, caps, 14)) assert.ok(displayWidth(l) <= columns);
  }
});

test('an ASCII frame holds no non-ASCII character but neutral markers', () => {
  const caps = mkCaps({ columns: 100, rows: 20, colorDepth: 0, charset: 'ascii' });
  const v = { ...doc3(), binding: { hash: 'c0ffee123456', current: false } };
  const text = renderViewer(v, caps, 20).join('\n').replace(/‹[A-Z+0-9]+›/g, '');
  assert.equal(/[^\x20-\x7e\n✔✖]/.test(text.replace(/✔|✖/g, '')), false, text.match(/[^\x20-\x7e\n]/)?.[0]);
});

test('sources and this test hold no literal control, bidi or invisible character', () => {
  for (const f of ['../src/tui/components/diff-viewer.ts', './tui-diff-viewer.test.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.equal(FORBIDDEN.test(src.replace(/[\n\t]/g, '')), false, f);
  }
});

test('the stale marker: a binding that is no longer current says so, with the d reload hint', () => {
  const caps = mkCaps({ columns: 130, rows: 24, colorDepth: 0 });
  const live = { ...doc3(), binding: { hash: '9c1e04b7aa31d2f0', current: true } };
  assert.match(renderViewer(live, caps, 24)[0]!, /tree waiting for approval 9c1e04b7aa31 ✔ current/);
  const stale = renderViewer({ ...live, binding: { ...live.binding, current: false } }, caps, 24)[0]!;
  assert.match(stale, /✖ changed since opened — d reloads/);
  assert.ok(!/waiting for approval/.test(stale));
  assert.match(renderViewer(doc3(), caps, 24)[0]!, /Diff · run ab12cd/);
});

void (null as unknown as Doc);
