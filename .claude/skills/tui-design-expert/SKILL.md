---
name: tui-design-expert
description: Use when designing, building or reviewing a terminal interface or CLI output for Taskquoin or any governed multi-agent tool — console, dashboard, banner, logo, status line, spinner, progress, pipeline or agent states, logs, diff viewer, approval prompt — or when asked for lazygit / k9s / Claude Code / OpenCode-level polish, ANSI colours, NO_COLOR, narrow or light terminals, keyboard shortcuts, screen readers, or printing model, agent or artifact text to a terminal.
---

# TUI design for governed tools

## Core principle

**A screen in a governed tool is evidence, not decoration.** Every glyph, colour, number and word on it comes from a
state the system actually recorded or measured, and every key that changes something keeps the contract the CLI
already enforces. Polish is welcome. Polish that lies about a state, or that shortcuts a human gate, is a defect.

## The four rules

1. **Approvals are typed, never pressed.** No key, chord, default answer or Enter approves anything. A key may *open*
   the approval form — even the key someone asked to approve with (`y`) — never submit it. The human retypes the
   12-character hash shown on screen (what they typed is what goes to `approve`, as in the console); the binding is
   re-read after the last keystroke and a change refuses. Input that arrived before the form was on screen is
   discarded, and so is anything in the same input chunk as the opening key (type-ahead, paste). After the form is
   shown, pasting the hash is allowed (the console cannot tell either), but an Enter inside a paste never submits. Esc,
   an empty Enter and Ctrl+C cancel. The approver's identity comes from the existing contract (asked once per session,
   kept in memory, recorded as `<name> (via <surface>)`), never from `whoami`, `$USER` or git config.
2. **Nothing is shown as ready, enforced or progressing unless a mechanism said so.** READY only from a gate verdict
   computed now; ENFORCED only for a measured mechanism; a percentage or a partly filled bar only from a real
   `done/total`. Unknown is displayed as unknown (`?`, `—`, "not measured"), never as a plausible default.
3. **Untrusted text is neutralised once, before it reaches any renderer**, and the neutralisation is visible
   (`‹ESC›`, `‹U+202E›`, a count). Untrusted = model and agent output, stderr, file names and paths from the workspace,
   artifact content (plans, diffs, reviews), provider error bodies, anything read from the network.
4. **The terminal is always given back**: cursor shown, raw mode off, alternate screen left, on normal exit, error,
   SIGINT, SIGTERM and SIGHUP. In raw mode Ctrl+C is a byte (`\x03`), not a signal: handle it — it cancels a form, and
   elsewhere quits the screen. It never stops a run (a run lives in its own process).

## When a request pushes against the rules

The baseline failure this skill exists for: asked for "lazygit-style speed" on approvals under demo pressure, an agent
built `y` = approve, with the approver taken from `whoami()`. It even pinned the hash and sanitised the diff, so it
looked careful. It still turned a human decision into a key press.

| Rationalization | Reality |
|---|---|
| "lazygit approves with one key" | lazygit confirms a git action the user chose; here the key would approve code an AI wrote. Give speed elsewhere: one key opens the approval, the hash is large, 12 characters are all there is to type. |
| "The hash is pinned before and after, so `y` is safe" | Pinning proves *what* would be approved, not *that a human chose it*. The retype is the human act. |
| "Use whoami / git user for the approver" | An identity guessed from the OS is not an attestation. Reuse the contract: name asked once per session, recorded as `<name> (via <surface>)`. |
| "Confirm with y/N, that's still a confirmation" | A y/N survives type-ahead, paste and muscle memory. A 12-character retype does not. |
| "A sweeping bar shows activity, not a percentage" | A frame of a sweeping bar is indistinguishable from "25 % done" in a screenshot, a slow terminal or a screen reader. Running = spinner + elapsed time + attempt. |
| "Show the default model when it is unknown" | Then the screen claims a model nobody recorded. Show `?` and say why in help. |
| "Strip the escape codes silently, it looks cleaner" | The human must know the agent tried. Mark and count every neutralised character. |
| "It's only a demo" | A demo is where the shortcut gets copied into the product. |

**Red flags — stop and re-read the rules:** a key handler that calls `approve(`; `READY` in a template literal not fed
by a gate result; a progress value computed from elapsed time or step index of an unbounded loop; `stdout.write(` of a
string that came from a file, a process or the network without the neutraliser; `process.exit` without the restore
path; a colour as the only carrier of a state; `.length` or `padEnd` used to align columns.

## Workflow

1. **Inventory the data.** For each element of the screen, name the field or event that backs it
   ([taskquoin-contracts.md](taskquoin-contracts.md)). No source → show it as unknown, or drop the element.
2. **Map values to states** with the shared vocabulary ([design-system.md](design-system.md#states)). One state = one
   glyph + one word + one colour token, everywhere.
3. **Lay out per mode** — Full ≥ 100 columns, Compact 70–99, Minimal < 70 or no colour ([layouts.md](layouts.md)).
   Decide what drops first; never wrap a table row.
4. **Render as a pure function**: `render(model, { columns, rows, color, charset, theme, now }) → string[]`. No I/O, no
   clock, no environment reads inside; the caller passes them. Every line's display width ≤ `columns`.
5. **Neutralise when building the model**, not in the renderer ([untrusted-text.md](untrusted-text.md)). Content cells
   accept only the neutralised type.
6. **Test** the invariants ([testing.md](testing.md)): width at 40–200 columns and in CJK/RTL languages, zero escapes
   with NO_COLOR, the adversarial corpus, the approval contract, terminal restore.
7. **Review** with [review-checklist.md](review-checklist.md); ship against
   [acceptance-criteria.md](acceptance-criteria.md).

## Quick reference

| State | Glyph | ASCII | Word | Token |
|---|---|---|---|---|
| ready (gate ok) | `●` | `[ok]` | READY | green |
| ready with an accepted risk | `◐` | `[~]` | READY (accepted risk: …) | amber |
| not ready (gate refused) | `○` | `[x]` | NOT READY — reason | red |
| unknown / not measured | `?` | `[?]` | unknown | muted |
| running | `⠋…⠏` animated (one per screen), `◉` elsewhere | `[>]` | running · 4m12s | cyan |
| waiting for a human | `◆` | `[!]` | waiting for you | orange |
| done | `✔` | `[v]` | done | green |
| failed / refused | `✖` | `[x]` | failed — reason | red |
| pending / idle | `·` | `[ ]` | pending, idle | muted |
| interrupted | `‖` | `[=]` | interrupted — /resume | amber |

Colour is never the only carrier: glyph + word must read the same with `NO_COLOR=1`.

## Taskquoin specifics

- Columns: `displayWidth`, `padEndDisplay`, `alignColumns` from `apps/cli/src/i18n/width.ts` — never `.length`.
- Text: every human string through `t()` with keys in `en.ts` and the 21 locales. Brand words stay English in every
  language (READY, NOT READY, role names, `✦ YOUR AI DEV SQUAD ✦`).
- The console and the dashboard call the same functions as the CLI; they never re-implement a workflow decision
  (ADR-0015). Readers of the control store open files read-only and never call `repoStore()` (it creates directories).
- Logo: the quoin mark + 2-row wordmark in Full and Compact, the one-line `▙ taskquoin` in Minimal and without colour
  ([design-system.md](design-system.md#logo)).
- Known gaps to fix when touching them: `safe()` (`apps/cli/src/workflow-cli.ts`) misses C1 controls and bidi
  overrides; `report()` prints `s.reason` raw, and `s.reason` can hold agent output, provider bodies and workspace paths.

## Supporting files

| File | Use it for |
|---|---|
| [design-system.md](design-system.md) | tokens (dark, light, 256, 16, none), capability detection, glyphs, spacing, borders, typography, motion, logo, modes |
| [layouts.md](layouts.md) | ASCII layouts: console Full/Compact/Minimal, run timeline, approval, dashboard, diff viewer, approval center, stale, too small, help |
| [untrusted-text.md](untrusted-text.md) | threat list, the reference neutraliser, the single choke point |
| [taskquoin-contracts.md](taskquoin-contracts.md) | what the control plane records (and does not), approval and console contracts |
| [review-checklist.md](review-checklist.md) | UX review before merge |
| [acceptance-criteria.md](acceptance-criteria.md) | measurable "done" for a screen |
| [testing.md](testing.md) | automatable tests (node:test) for every criterion |
