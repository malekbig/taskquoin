/**
 * Raw-mode key decoding. The decoder is stateful only for a bracketed paste split over chunks. Pure.
 * A 'char' key is never a control, bidi or invisible character (neutral.ts's strict set): those are 'unknown'.
 * 'unknown.seq' and 'paste.text' are raw input: neutralise them before they are shown.
 */
import { neutralize } from './neutral.ts';

export type Key =
  | { name: 'char'; ch: string } | { name: 'paste'; text: string } | { name: 'unknown'; seq: string }
  | { name: 'enter' | 'esc' | 'tab' | 'backtab' | 'backspace' | 'up' | 'down' | 'left' | 'right' | 'pageup' | 'pagedown' | 'home' | 'end' | 'ctrl-c' };

/** `multi`: more than one key in the chunk, so type-ahead or an unbracketed paste. */
export interface KeyChunk { keys: Key[]; multi: boolean }

const ESC = String.fromCharCode(0x1b);
const PASTE_END = ESC + '[201~';
const MAX_PASTE = 64 * 1024;

const LETTER: Record<string, Key['name']> = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end', Z: 'backtab' };
const TILDE: Record<string, Key['name']> = { '1': 'home', '7': 'home', '4': 'end', '8': 'end', '5': 'pageup', '6': 'pagedown' };
const SS3: Record<string, Key['name']> = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' };

const named = (name: Key['name']): Key => ({ name } as Key);

export function keyDecoder(): { feed(chunk: string): KeyChunk[]; flush(): KeyChunk[] } {
  let paste: string | undefined; // inside a bracketed paste: the text so far ('' once over the limit)
  let over = false;
  let pending = ''; // an incomplete escape sequence (or half a surrogate pair) held until the next chunk or flush()

  const wrap = (keys: Key[]): KeyChunk[] => (keys.length ? [{ keys, multi: keys.length > 1 }] : []);

  return {
    feed(chunk: string): KeyChunk[] {
      const keys: Key[] = [];
      let s = chunk;
      if (pending !== '') {
        // A held lone ESC is a real Esc unless this chunk continues a sequence.
        if (pending === ESC && !/^[[O]/.test(chunk)) keys.push(named('esc'));
        else s = pending + chunk;
        pending = '';
      }
      while (s !== '') {
        if (paste !== undefined) {
          const joined = over ? paste.slice(-PASTE_END.length) + s : paste + s;
          const end = joined.indexOf(PASTE_END);
          if (end < 0) {
            if (over || joined.length > MAX_PASTE) { over = true; paste = joined.slice(-PASTE_END.length); } else paste = joined;
            return wrap(keys);
          }
          if (!over && end <= MAX_PASTE) keys.push({ name: 'paste', text: joined.slice(0, end) });
          s = joined.slice(end + PASTE_END.length);
          paste = undefined; over = false;
          continue;
        }
        const c = s[0]!;
        if (c === ESC) {
          if (s.length === 1) { pending = s; break; }
          if (s[1] === '[') {
            let j = 2;
            while (j < s.length && /[0-9;:?<=>]/.test(s[j]!)) j++;
            while (j < s.length && /[ -/]/.test(s[j]!)) j++;
            if (j >= s.length) { // incomplete: wait for the rest
              if (s.length > 64) { keys.push({ name: 'unknown', seq: s }); s = ''; } else pending = s;
              break;
            }
            if (!/[@-~]/.test(s[j]!)) { // malformed: report what was read, go on from the offending character
              keys.push({ name: 'unknown', seq: s.slice(0, j) });
              s = s.slice(j);
              continue;
            }
            const seq = s.slice(0, j + 1), params = /^\x1b\[([0-9;:?<=>]*)/.exec(seq)![1]!, final = s[j]!;
            s = s.slice(j + 1);
            if (final === '~' && params === '200') { paste = ''; over = false; continue; }
            const first = params.split(';')[0]!;
            let name: Key['name'] | undefined;
            if (!/^[0-9;]*$/.test(params) || seq.length !== 3 + params.length) name = undefined;
            else if (final === '~') name = TILDE[first];
            else if (first === '' || first === '1') name = LETTER[final];
            keys.push(name ? named(name) : { name: 'unknown', seq });
            continue;
          }
          if (s[1] === 'O') {
            if (s.length === 2) { pending = s; break; }
            const name = SS3[s[2]!];
            keys.push(name ? named(name) : { name: 'unknown', seq: s.slice(0, 3) });
            s = s.slice(3);
            continue;
          }
          const take = String.fromCodePoint(s.codePointAt(1)!);
          keys.push({ name: 'unknown', seq: ESC + take });
          s = s.slice(1 + take.length);
          continue;
        }
        const cp = s.codePointAt(0)!;
        if (cp >= 0xd800 && cp <= 0xdbff && s.length === 1) { pending = s; break; } // half a pair
        const ch = String.fromCodePoint(cp);
        s = s.slice(ch.length);
        if (ch === '\r' || ch === '\n') keys.push(named('enter'));
        else if (ch === '\t') keys.push(named('tab'));
        else if (ch === '\x7f' || ch === '\b') keys.push(named('backspace'));
        else if (ch === '\x03') keys.push(named('ctrl-c'));
        else keys.push(neutralize(ch).marked === 0 ? { name: 'char', ch } : { name: 'unknown', seq: ch });
      }
      return wrap(keys);
    },
    /** The caller's short timer (about 50 ms) fires this when no more input came: a held lone ESC is the Esc key. */
    flush(): KeyChunk[] {
      const p = pending;
      pending = '';
      if (p === '') return [];
      return wrap([p === ESC ? named('esc') : { name: 'unknown', seq: p }]);
    },
  };
}
