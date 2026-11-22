# Untrusted text in a terminal

A terminal executes what it prints. In Taskquoin the text a human reads before approving was written by an AI agent,
which may itself have been steered by repository content. Treat every byte from outside Taskquoin's own code as hostile.

## What an attacker can do with printed text

| Vector | Bytes | Effect |
|---|---|---|
| Cursor moves, line clears | `ESC [ … A/B/C/D/H/J/K` | Overwrite or erase a warning, a failing test line, a hash |
| Carriage return, backspace | `\r`, `\b` | Rewrite the start of a line ("FAILED" → "PASSED") |
| Clipboard write | `ESC ] 52 ; c ; <base64> BEL` | Puts a command in the clipboard, pasted later by the human |
| Hyperlink | `ESC ] 8 ; ; <url> ST` | Text that says one URL, opens another |
| Title, icon | `ESC ] 0/2 ; … BEL` | Fake window title |
| Terminal queries | `ESC [ c`, `ESC [ 6 n`, `ESC [ 21 t`, DECRQSS | The terminal **answers on stdin**: bytes appear as if the human typed them — fatal in a raw-mode prompt |
| Device strings | `ESC P` (DCS), `ESC _` (APC), `ESC ^` (PM), `ESC X` (SOS) | Terminal-specific actions, sixel, tmux passthrough |
| 8-bit C1 controls | U+0080–U+009F (U+009B = CSI, U+009D = OSC) | Same as the ESC forms in terminals that honour C1 — and missed by filters that look for `\x1b` only |
| Bidi overrides and isolates | U+202A–U+202E, U+2066–U+2069 | Display order differs from logical order ("Trojan Source"): a diff that reads safe and is not |
| Invisible characters | U+00AD, U+115F, U+1160, U+180E, U+200B, U+2060–U+2064, U+3164, U+FEFF, U+FFA0, tags U+E0000–U+E007F | Hidden content, look-alike identifiers (Hangul fillers render as blank letters) |
| Line and paragraph separators | U+2028, U+2029 | A line break that measuring code does not see: broken columns, a line hidden after the cut |
| Arabic letter mark | U+061C | Bidi control missed by filters that only list the U+202x / U+206x ranges |
| Bell | `BEL` | Noise; also the OSC terminator |

## Rules

1. **One choke point.** Neutralise when untrusted text enters the view model (artifact read, event read, process
   output, network reply), never in each renderer. Content cells accept only the neutralised type.
2. **Visible, not silent.** Replace each character with a marker (`‹ESC›`, `‹CR›`, `‹U+202E›`) and count them; show the
   count where the human looks (an event, a banner over the diff). Silent stripping hides that an agent tried.
3. **Two profiles.**
   - `strict` — anything a human judges before a gate (plan, challenge, review, diff, file names and paths, reasons,
     names typed elsewhere): every C0 and C1 control except `\n` and `\t`, DEL, bidi controls and marks, zero-width and
     invisible characters (including ZWJ/ZWNJ: a Hindi or Persian word in a diff then shows a marker — the price of seeing
     everything before approving), U+061C, line/paragraph separators, tag characters.
   - `log` — streaming logs: as `strict`, but keeps ZWJ/ZWNJ (U+200C/U+200D), legitimate in Persian, Hindi and emoji.
   - Single-line contexts (a name, a reason in a table cell) also mark `\n` and `\t`.
4. **Line endings**: `\r\n` is normalised to `\n` before neutralising (Windows files), so only a lone `\r` is marked.
5. **Tabs** are expanded to spaces by the renderer (tab stops of 4 or 8), never passed through: a tab breaks every
   column computation.
6. **Width after neutralisation.** Measure and truncate the neutralised string; a marker is ordinary text.
7. **JSON output** needs no neutralisation (`JSON.stringify` escapes control characters) — keep `--json` byte-identical.
8. **Source files hold no literal control or bidi characters.** Write them as `\u` escapes in code and tests (an
   editor or a tool can turn an escape into the real character — it happened while writing this skill — and a literal
   U+2028 ends a JS regex literal); a test scans the repository for literal C0/C1 (except `\n`, `\t`), bidi and
   invisible characters.
9. **Your own escapes are separate.** The renderer adds its SGR after neutralisation, from tokens only. Nothing from
   content is ever concatenated into an escape sequence (no colour, link or title taken from content).

## Reference neutraliser

```ts
/** Untrusted text made inert and visible. `strict` for what a human judges, `log` for streamed output. */
export type Neutral = string & { readonly __neutral: unique symbol };
const NAMES: Record<number, string> = { 0x07: 'BEL', 0x08: 'BS', 0x0a: 'LF', 0x09: 'TAB', 0x0d: 'CR', 0x1b: 'ESC', 0x7f: 'DEL', 0x9b: 'CSI', 0x9d: 'OSC', 0x90: 'DCS' };
const STRICT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\uffa0\ufff9-\ufffb]|[\u{e0000}-\u{e007f}]/gu;
const LOG = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u115f\u1160\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\u3164\ufeff\uffa0\ufff9-\ufffb]|[\u{e0000}-\u{e007f}]/gu;

export function neutralize(text: string, o: { profile?: 'strict' | 'log'; singleLine?: boolean } = {}): { text: Neutral; marked: number } {
  let marked = 0;
  const mark = (ch: string) => { marked++; const cp = ch.codePointAt(0)!; return `‹${NAMES[cp] ?? 'U+' + cp.toString(16).toUpperCase().padStart(4, '0')}›`; };
  let s = text.replace(/\r\n/g, '\n').replace(o.profile === 'log' ? LOG : STRICT, mark);
  if (o.singleLine) s = s.replace(/[\n\t]/g, mark);
  return { text: s as Neutral, marked };
}
```

`\n` (0x0A) and `\t` (0x09) sit outside both ranges on purpose; `singleLine` marks them. U+FFFD from invalid UTF-8 is
kept (it is visible). Test it with the corpus in `testing.md`.

## In Taskquoin today

- `safe()` in `apps/cli/src/workflow-cli.ts` removes CSI sequences and replaces C0 with `?`: it misses the C1 range
  (U+009B passes through), bidi and invisible characters, and is silent.
- `report()` prints `s.reason` without `safe()`. `s.reason` can hold an agent's final message or stderr (300
  characters), a provider's HTTP error body, workspace file paths, Verify refusal text and adapter exception messages.
- Also printed raw: history outcomes (they include the free-text approver name), doctor gate messages and accepted-risk
  reasons, Ollama model names from a local HTTP reply, OpenCode provider ids and `connect` output, skill file names and
  frontmatter keys in error messages.
- `t()` inserts parameters without escaping: a parameter that carries untrusted text must be neutralised first.
