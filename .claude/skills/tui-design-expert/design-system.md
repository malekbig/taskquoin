# Taskquoin terminal design system

Dark theme by default, a light theme for light terminals, a 256- and 16-colour mapping, and a no-colour mode that
carries the same information. Taskquoin never paints the terminal background: it uses the user's terminal colours and
only sets foreground colours, plus background colours for selection and diff lines.

## Capabilities: decide once, pass down

Compute a `Capabilities` value at start-up (and on SIGWINCH for the size) and pass it to every renderer. Renderers
never read the environment.

| Question | Rule (first match wins) |
|---|---|
| Interactive? | `stdin.isTTY && stdout.isTTY`. Not interactive → no escape sequence at all: no colour, no cursor movement, no spinner, append-only lines. |
| Colour depth | `NO_COLOR` set and non-empty → none; it removes colour and style codes (SGR) only — a full-screen view in a terminal still positions the cursor and uses the alternate screen. `TERM=dumb` → none, and no cursor movement either. Otherwise `stdout.getColorDepth()` (honours `FORCE_COLOR`, `COLORTERM`, `TERM`) and raise 8 → 24 when `WT_SESSION` is set: Windows Terminal (also through WSL) supports truecolor but sets no `COLORTERM` (measured: `TERM=xterm-256color`, `COLORTERM` empty, Node reports 8). |
| Charset | UTF-8 when the first non-empty of `LC_ALL`, `LC_CTYPE`, `LANG` matches `/utf-?8/i`; otherwise the ASCII glyph column. |
| Theme | `TASKQUOIN_THEME=dark|light`; else `COLORFGBG` when set (last field 0–6 or 8 → dark, 7 or 9–15 → light); else dark. Never query the terminal (OSC 11): the reply arrives on stdin and races with what the human types. |
| Motion | Off when not interactive, `TERM=dumb`, `TASKQUOIN_NO_ANIMATION=1`, or plain mode. |
| Plain mode | `TASKQUOIN_PLAIN=1` (screen readers, logs, CI): no borders, no spinner frames, no redraws; each state change printed once as a sentence. |

Today the CLI emits 24-bit colour whenever `stdout.isTTY && !NO_COLOR`; terminals limited to 256 colours (macOS
Terminal.app) then show wrong colours. Map tokens through the depth.

## Tokens

Text tokens meet 4.5:1 and the border token 3:1 against the reference background of their theme (WCAG 2.2, measured:
dark `#1A1B26`, light `#FFFFFF`), and text stays ≥ 4.5:1 on the selection background. The 256-colour indices are the
nearest xterm colours that still meet those ratios (measured).

| Token | Use | Dark | Light | 256 dark / light | 16 (SGR) |
|---|---|---|---|---|---|
| `fg` | body text | terminal default | terminal default | default | default |
| `muted` | labels, timestamps, metadata, hints | `#9AA5CE` (7.0) | `#5A607A` (6.2) | 110 / 60 | default + faint (2) |
| `line` | borders, rules — never text | `#5F6A99` (3.3) | `#7F87A6` (3.6) | 61 / 103 | 90 |
| `mint` | brand, prompt, focus border, role names | `#5EF2C2` (12.2) | `#0B7A5E` (5.3) | 85 / 29 | 36 |
| `cyan` | running, info, commands and keys | `#7DCFFF` (10.0) | `#0B6FA4` (5.5) | 117 / 25 | 96 |
| `violet` | git refs (branch, tree), secondary brand | `#BB9AF7` (7.4) | `#7340C8` (6.4) | 141 / 62 | 35 |
| `orange` | **a human must act** (approval, action required) | `#FF9E64` (8.4) | `#B5480C` (5.4) | 215 / 130 | 33 + bold |
| `green` | done, READY, ENFORCED, added lines | `#9ECE6A` (9.4) | `#3E7A1E` (5.2) | 149 / 28 | 32 |
| `amber` | accepted risk, ADVISORY, retry, warning | `#E0AF68` (8.5) | `#8A5A00` (5.9) | 179 / 94 | 33 |
| `red` | failed, NOT READY, refused, removed lines, neutralised characters | `#F7768E` (6.5) | `#C21E45` (5.9) | 210 / 125 | 31 |
| `sel` (background) | selected row | `#2B3150` | `#F0F1F7` | 237 / 255 | reverse (7) |
| `addBg` / `delBg` (background) | diff lines | `#20303B` / `#37222C` | `#E6F4EA` / `#FBE9EC` | 22, 52 / 194, 224 | none (the `+`/`−` column carries it) |

In 16 colours, `orange` and `amber` are both yellow: they stay distinct by glyph (`◆` vs `◐`) and by bold.

## States

One state = one glyph + one word + one token, on every screen. The table in `SKILL.md` is the source. Run statuses map
as: `running` → running; `waiting-approval` → waiting for you (the gate named); `needs-human` → waiting for you (the
reason); `failed` → failed; `interrupted` → interrupted; `completed` → done.

**Agent activity** is separate from readiness (a gate verdict): `◉ working · 4m12s` (cyan) or `· idle` (muted). A stored
flag such as "verified" is shown as yes / no / unknown, never as READY.

**Enforcement classes** (ADR-0002) are never styled alike:

| Class | Display | Token |
|---|---|---|
| ENFORCED, measured | `■ ENFORCED` | green |
| ENFORCED, claimed but not measured | `□ ENFORCED (claimed, not measured)` | amber |
| BROKERED | `◧ BROKERED` | cyan |
| ADVISORY | `□ ADVISORY` | amber |
| UNSUPPORTED | `✖ UNSUPPORTED` | red |

## Glyphs

Use only glyphs present in common terminal fonts (Cascadia, Consolas, DejaVu Sans Mono, Menlo, Ubuntu Mono). ASCII
fallback when the charset is not UTF-8:

| Glyph | ASCII | Glyph | ASCII |
|---|---|---|---|
| `● ◐ ○ ✔ ✖ ◆ · ‖ ?` | see the states table | `→` `↳` | `->` `\_` |
| `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` spinner (animated, one per screen) | `- \ \| /` | `…` | `...` |
| `◉` running, static (every other running item) | `[>]` | `▙` (brand) | `#` |
| `╭ ╮ ╰ ╯ ─ │` | `+ + + + - \|` | `▸` (selected row) | `>` |
| `⬆` (an update or fallback notice) | `^` | `✦` (tagline only) | `*` |
| `⚠` (neutralised content, a warning line) | `!` | `■ □ ◧` (enforcement classes) | `[E] [ ] [B]` |

No emoji (variable width, font-dependent), no Nerd Font icons. Known limit: `● ○ ◐ ◆ ·` are East Asian *ambiguous*
width; a CJK terminal set to draw ambiguous characters wide misaligns columns by one. Taskquoin measures them as 1.

## Spacing, borders, typography

- Console: 2-space left gutter. Dashboard: 1 space inside panel borders. Columns separated by ≥ 2 spaces; key/value
  labels padded to the widest label **by display width**. One blank line between groups, never two.
- Panels: rounded light borders (`╭─ Title ─── right ─╮`). Focused panel: `mint` border and bold title; others `line`.
  No double borders, no shadows, no nested boxes.
- Section rule in the console: `── Title ─────────── right ──` in `line`, title bold.
- Bold: titles, the focused selection, and **the hash a human must retype**. Faint/`muted`: metadata. Never underline,
  blink or italic (unreliable across terminals). Inverse only as the 16-colour selection.
- Times: the user's local time (`HH:MM:SS`, or `HH:MM` in lists); full ISO-8601 with offset in details and `--json`.
- Truncate with `…` by display width, never in the middle of an escape sequence or a wide character. Truncation must
  not hide the state word: cut the note, keep `NOT READY`.

## Motion

- At most one *animated* spinner on screen (braille frames at 80–100 ms), beside the running step in focus; every
  other running item uses the static `◉`. Elapsed time updates at most
  once per second.
- No progress bar without a real `done/total` from the model. No percentage derived from time or from the index of a
  step in a loop that can repeat (implement ↔ verify ↔ review).
- Start-up logo reveal ≤ 0.9 s, interactive + colour only, skipped with `TASKQUOIN_NO_ANIMATION=1`, cursor restored in
  `finally` (ADR-0015).
- Redraw only on a change (state file, event, key, resize, tick of a visible timer). Nothing changes → nothing is written.

## Logo

Chosen by the owner on 2026-11-22: **the quoin mark** — a quoin is a corner stone; four stones alternate long and short,
one per brand colour — with the wordmark in a 2-row half-block font. The orange tail of the Q is the human in the loop.

```
██████  ▀█▀ ▄▀▄ █▀▀ █▄▀ ▄▀▄ █ █ ▄▀▄ █ █▄ █
███      █  █▀█ ▄▄█ █ █ ▀▄█ ▀▄▀ ▀▄▀ █ █ ▀█
██████  ✦ YOUR AI DEV SQUAD ✦
███     governed · human in the loop · verifiable
```

- Stones, top to bottom: `mint`, `cyan`, `violet`, `orange`. Wordmark letters: a gradient `mint` → `violet` across the
  9 letters; the Q's bottom-right cell in `orange`. Lines 3–4 to the right of the mark carry the tagline (in `orange`)
  and a `muted` line; the version goes right-aligned on line 1.
- Size: mark + wordmark 42 × 2 cells; with the two text lines, 4 rows. Full and Compact modes only, with colour
  (without colour the four stones merge into one block).
- Minimal mode, no colour, plain mode, `--json` never: one line `▙ taskquoin 2026.11.1 · <repo> (<branch>)`
  (`▙` in `mint` when there is colour).
- The mark (6 × 4) alone may stand for the brand in a narrow header; never stretch or recolour it.

## Modes

| Mode | When | Shows |
|---|---|---|
| Full | ≥ 100 columns and ≥ 24 rows, colour | logo, context block (repo, branch, sandbox, policy), squad table with reasons, action line, categorised `/` menu |
| Compact | 70–99 columns or 16–23 rows | logo, two context lines, squad with short notes, one summary line |
| Minimal | < 70 columns, < 16 rows, no colour, `TERM=dumb` | one-line brand, one summary line, one line per agent |
| Dashboard, wide | ≥ 120 × 30 | panels side by side |
| Dashboard, stacked | 80–119 columns | panels one under the other, model column dropped first |
| Dashboard, narrow | 40–79 columns, ≥ 12 rows | borderless sections, run status and human action first |
| Dashboard, too small | < 40 × 12, or plain mode | one message: the size needed, and `taskquoin status` / the console instead |

Drop order when space shrinks: decoration (logo, tagline) → notes → secondary columns (model, then runtime) → never the
state word, the hash, or the action a human must take.

## Keyboard

- Console (readline): Tab completes `/` commands, ↑/↓ history, the `/` menu opens under the prompt only while a prompt
  waits. Free text never starts anything (ADR-0015). Ctrl+C inside a run does not stop it (it continues to its next gate).
- Dashboard: keys work in both cases (`r`/`R`). `r` runs, `a` agents, `d` diff, `l` log, `v` verify, `p` approvals,
  `?` help, `q` quit (leaving is harmless: read-only); `Tab` cycles panels; `j k ↑ ↓` move; `g G` top/bottom;
  `PgUp PgDn`; `/` search, `n N` next/previous match; `Esc` closes the overlay or form.
- **No key approves, rejects, resumes or starts a run.** A key may open the screen where the human types.
- Raw mode: Ctrl+C (`\x03`) cancels the open form or overlay; with none open it leaves the dashboard (terminal
  restored). A real SIGINT/SIGTERM from outside restores the terminal and exits 130/143. Treat each input chunk as one event: a chunk with more than one key while a form opens is type-ahead or
  a paste and is dropped, never replayed.
- Every shortcut is shown in the footer or the `?` overlay; the footer drops labels before keys when narrow.
