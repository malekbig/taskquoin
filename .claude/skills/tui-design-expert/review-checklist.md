# UX review checklist

Run it on every change to a console, dashboard, banner, status line or prompt. Each item is yes/no; a "no" on a
**bold** item blocks the merge.

## Truth
- [ ] **Every READY / NOT READY comes from a gate verdict computed for this screen, with its reason when refused.**
- [ ] **No percentage, filled bar or ETA without a real `done/total` in the model.**
- [ ] **ENFORCED, BROKERED, ADVISORY and "claimed, not measured" look different (glyph, word, token).**
- [ ] Unknown values read as unknown (`?`, `—`, "not measured"), never as a plausible default.
- [ ] Counts on the screen agree with `doctor` (same definition of "ready").
- [ ] Times are labelled with what they are (started, ended, elapsed) and come from recorded timestamps.
- [ ] A retried step shows its attempts nested under it; nothing implies a straight line through a loop.

## Human gates
- [ ] **No key, default answer or Enter approves, rejects, resumes or starts a run.**
- [ ] **Approving needs the hash retyped; the binding is re-read after the last keystroke; a change refuses and says why.**
- [ ] **Keys typed before the prompt are discarded (and the human is told); an Enter inside a paste never submits.**
- [ ] Ctrl+C in raw mode cancels the form, or leaves the screen with the terminal restored; it never touches a run.
- [ ] The approver identity follows the existing contract, recorded with the surface (`via taskquoin console|dashboard`).
- [ ] The screen shows what is bound (plan hash or git tree), what to read, and where to read it.
- [ ] Esc / empty input cancels and says that nothing was approved.

## Untrusted text
- [ ] **Every string from an agent, a process, a file name, an artifact or the network passes through the neutraliser
      before the view model.**
- [ ] Neutralised characters are visible and counted where the human looks.
- [ ] Sources contain no literal control, bidi or invisible character (written as `\u` escapes).
- [ ] No escape sequence is built from content (colours, links, titles come from tokens only).
- [ ] `--json` output is unchanged and still valid JSON.

## Layout
- [ ] Every line ≤ `columns` (display width) at 40, 60, 80, 100, 120 and 200 columns, in en, fr, ja and ar.
- [ ] The drop order keeps the state word, the hash and the human action at every width.
- [ ] Truncation uses `…` and never cuts a wide character or an escape sequence.
- [ ] Below the minimum size the screen says so instead of drawing a broken layout.
- [ ] Resize redraws the whole screen once, with no leftovers.

## Colour and accessibility
- [ ] With `NO_COLOR=1` the output has zero colour codes and reads the same (glyph + word carry every state).
- [ ] `TERM=dumb` and non-TTY: no escapes, no cursor moves, no spinner, append-only.
- [ ] Text tokens ≥ 4.5:1 and borders ≥ 3:1 against the theme background; light theme checked.
- [ ] 256- and 16-colour terminals get mapped tokens, not raw 24-bit codes.
- [ ] Plain mode prints each state change once as a sentence; no box drawing.
- [ ] No emoji, no Nerd Font glyph; ASCII fallback when the charset is not UTF-8.

## Keyboard
- [ ] Every shortcut appears in the footer or the `?` overlay, in the user's language.
- [ ] Keys work in lower and upper case; no shortcut conflicts within one screen.
- [ ] Free text in the console never starts anything (only `/` commands act).

## Motion and lifecycle
- [ ] At most one spinner; elapsed time ≤ 1 update/s; animation off with `TASKQUOIN_NO_ANIMATION=1`.
- [ ] **Cursor shown, raw mode off and alternate screen left on exit, error, SIGINT, SIGTERM, SIGHUP.**
- [ ] No redraw when nothing changed; input never waits for a render or a file read.
- [ ] Memory bounded: logs and events kept in a ring buffer, artifacts read on demand.
- [ ] A read-only screen creates, modifies and locks nothing in the control store, starts no workflow, opens no socket.

## Language
- [ ] Every human string goes through `t()`; brand words stay English; new keys exist in all 22 catalogs.
- [ ] Columns measured with `displayWidth`; RTL languages show no bidi processing of our own.
