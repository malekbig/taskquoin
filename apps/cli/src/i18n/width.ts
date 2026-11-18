/** Terminal display width: ANSI escapes take no column, East Asian wide/fullwidth characters take 2, nonspacing/enclosing marks and format characters (ZWNJ) 0, spacing marks 1. */
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const ZERO = /[\p{Mn}\p{Me}\p{Cf}]/u;

function isWide(cp: number): boolean {
  return (cp >= 0x1100 && cp <= 0x115f) // Hangul Jamo
    || (cp >= 0x2e80 && cp <= 0x303e) // CJK radicals, symbols and punctuation
    || (cp >= 0x3041 && cp <= 0x33ff) // Hiragana, Katakana, CJK compatibility
    || (cp >= 0x3400 && cp <= 0x4dbf) // CJK extension A
    || (cp >= 0x4e00 && cp <= 0x9fff) // CJK unified
    || (cp >= 0xa000 && cp <= 0xa4cf) // Yi
    || (cp >= 0xac00 && cp <= 0xd7a3) // Hangul syllables
    || (cp >= 0xf900 && cp <= 0xfaff) // CJK compatibility ideographs
    || (cp >= 0xfe30 && cp <= 0xfe6f) // CJK compatibility forms
    || (cp >= 0xff00 && cp <= 0xff60) // fullwidth forms
    || (cp >= 0xffe0 && cp <= 0xffe6)
    || (cp >= 0x20000 && cp <= 0x3fffd); // CJK extensions B+
}

export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s.replace(ANSI, '')) {
    if (ZERO.test(ch)) continue;
    w += isWide(ch.codePointAt(0)!) ? 2 : 1;
  }
  return w;
}

export function padEndDisplay(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

/** Two columns: the left cell padded by display width to the widest left cell + `gap`, then the right cell. */
export function alignColumns(rows: readonly (readonly [string, string])[], gap = 2): string[] {
  const w = Math.max(0, ...rows.map(([l]) => displayWidth(l))) + gap;
  return rows.map(([l, r]) => padEndDisplay(l, w) + r);
}
