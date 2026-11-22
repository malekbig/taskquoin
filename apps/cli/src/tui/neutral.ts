/**
 * Untrusted text made inert and visible (reference: .claude/skills/tui-design-expert/untrusted-text.md).
 * A terminal executes what it prints: every string from an agent, a process, a file name, an artifact, the network
 * or a config value goes through here before a human sees it. Each hostile character becomes a visible marker
 * and is counted; nothing is stripped silently. `strict` is for what a human judges, `log` keeps ZWJ/ZWNJ.
 * This file holds no literal control or bidi character: ranges are written as escapes.
 */
import { displayWidth } from '../i18n/width.ts';

/**
 * Text that went through `neutralize()` (or a helper below): the only type a renderer accepts for content from outside.
 * It is a subtype of `string`, so it prints and concatenates like one; a raw `string` is not assignable to it.
 */
export type Neutral = string & { readonly __neutral: unique symbol };

const NAMES: Record<number, string> = { 0x07: 'BEL', 0x08: 'BS', 0x0a: 'LF', 0x09: 'TAB', 0x0d: 'CR', 0x1b: 'ESC', 0x7f: 'DEL', 0x9b: 'CSI', 0x9d: 'OSC', 0x90: 'DCS' };
const STRICT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]|[\u{1bca0}-\u{1bca3}\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;
const LOG = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b\u200e\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0d\ufeff\uffa0\ufff9-\ufffb]|[\u{1bca0}-\u{1bca3}\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;
const OPEN = String.fromCharCode(0x2039), CLOSE = String.fromCharCode(0x203a);

export function neutralize(text: string, o: { profile?: 'strict' | 'log'; singleLine?: boolean } = {}): { text: Neutral; marked: number } {
  let marked = 0;
  const mark = (ch: string): string => {
    marked++;
    const cp = ch.codePointAt(0)!;
    return `${OPEN}${NAMES[cp] ?? 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')}${CLOSE}`;
  };
  let s = text.replace(/\r\n/g, '\n').replace(o.profile === 'log' ? LOG : STRICT, mark);
  if (o.singleLine) s = s.replace(/[\n\t]/g, mark);
  return { text: s as Neutral, marked };
}

/** One-line contexts (a name, a reason, a table cell): newlines and tabs are marked too. */
export const n = (text: string): Neutral => neutralize(text, { singleLine: true }).text;
/** A unit a cut never splits: a whole marker, or one code point. */
const UNIT = new RegExp(`${OPEN}(?:[A-Z]{2,3}|U\\+[0-9A-F]{4,6})${CLOSE}|[\\s\\S]`, 'gu');
/**
 * An already neutral text cut to `max` display columns: what fits is returned as is; otherwise the text ends with `…`
 * (`...` in ASCII) within `max`, and a marker is never split — the cut backs off to the marker's start, so a half
 * marker never hides which character was sent and the ellipsis says that something was cut.
 */
export function cutNeutral(text: Neutral, max: number, o: { ascii?: boolean } = {}): Neutral {
  if (displayWidth(text) <= max) return text;
  const more = o.ascii ? '...' : '\u2026', room = max - displayWidth(more);
  if (room < 0) return '' as Neutral;
  let out = '', w = 0;
  for (const [unit] of text.matchAll(UNIT)) { const uw = displayWidth(unit); if (w + uw > room) break; out += unit; w += uw; }
  return (out + more) as Neutral;
}
/** One-line, then cut to `max` display columns AFTER neutralising: a hostile text cannot overflow its column. */
export function nCut(text: string, max: number, o: { ascii?: boolean } = {}): Neutral {
  return cutNeutral(neutralize(text, { singleLine: true }).text, max, o);
}
/** Whole messages from outside (a thrown error): `log` profile, so Taskquoin's own ZWNJ/ZWJ are not marked. */
export const nLog = (text: string): Neutral => neutralize(text, { profile: 'log', singleLine: true }).text;
/**
 * What `--json` escapes beyond JSON.stringify (which escapes C0, ESC included): only what can act on a terminal or
 * reorder what it displays — DEL and C1, the Bidi_Control characters, and U+2028/U+2029 (line breaks that measuring
 * code does not see). Invisible characters (ZWNJ, ZWJ, variation selectors, tags…) stay: they are data a JSON consumer
 * parses, inert on a terminal, and legitimate in Persian, Hindi and emoji.
 */
const JSON_UNSAFE = /[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g;
/** `--json` output made inert: the parsed value is identical, and the bytes too for any output without those characters. */
export function jsonOut(value: unknown, space: number | string = 2): string {
  return JSON.stringify(value, null, space).replace(JSON_UNSAFE, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}
/** Multi-line content (an artifact): line breaks and tabs kept, everything else neutralised. */
export const nBlock = (text: string): Neutral => neutralize(text).text;
