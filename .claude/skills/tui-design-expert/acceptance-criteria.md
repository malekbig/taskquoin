# Acceptance criteria

Each criterion has a measure and a threshold, and a test in `testing.md` (T-number). A screen is done when all apply.

| # | Criterion | Measure | Threshold | Test |
|---|---|---|---|---|
| AC-1 | Width | max `displayWidth(line)` over every line, widths {40, 60, 80, 100, 120, 200}, languages {en, fr, ja, ar} | ≤ `columns`; dashboard rows = `rows` exactly | T1 |
| AC-2 | No colour | SGR codes with `NO_COLOR=1`; ESC (0x1B) bytes at all with `TERM=dumb` or when stdout is not a TTY | 0; 0 | T2 |
| AC-3 | Same meaning without colour | for each state, `glyph + word` present in the no-colour frame | 100 % of states | T2 |
| AC-4 | Neutralisation | over the corpus × every untrusted sink: characters of C0 (except `\n`, `\t`), DEL, C1, bidi, invisible, tags left in the frame after removing the renderer's own SGR | 0; marked count = corpus count | T3 |
| AC-5 | No single-key approval | approve calls after each key of `y`, `Y`, Enter, Space, `a`, paste of the hash before the prompt | 0 | T4 |
| AC-6 | Binding re-read | binding changed between display and submit → approve calls, refusal message shown | 0 calls; message present | T4 |
| AC-7 | Honest states | random gate results: READY count on screen = count of `ok`; unknown model rendered `?` | equal; 100 % | T5 |
| AC-8 | No invented progress | `%` signs or partly filled bars in frames whose model has no `done/total` | 0 | T5 |
| AC-9 | Terminal restored | after normal exit, thrown error, SIGINT, SIGTERM, SIGHUP: last control writes include show-cursor (`?25h`), leave-alt-screen (`?1049l`) when entered, raw mode off | all present | T6 |
| AC-10 | Read-only | files created, modified or locked under the control store while a dashboard session browses runs (tree hash before/after); child processes started | 0 changes; 0 processes after the initial probe | T7 |
| AC-11 | Render cost | p95 time of one 120 × 40 frame with 10 000 events in the store | < 5 ms | T8 |
| AC-12 | Input latency | key press → next frame written, with a run writing events in parallel | p95 < 50 ms | T8 |
| AC-13 | Bounded memory | heap growth after ingesting 100 000 event lines | < 20 MB; buffer ≤ 1 000 events | T8 |
| AC-14 | Robust reads | partial last line in `events.jsonl`, malformed JSON line, state.json mid-rename | no crash; bad line counted and skipped | T7 |
| AC-15 | Idle | frames written in 5 s with no change and no visible timer | 0 | T8 |
| AC-16 | Contrast | each text token vs its theme background; border token | ≥ 4.5:1; ≥ 3:1 | T9 |
| AC-17 | Language | user-visible strings not from `t()` (except brand words and command names); missing catalog keys | 0; 0 | T9 |
| AC-18 | Non-regression | existing CLI commands, `--json` outputs, exit codes, governance tests, console Gherkin scenarios | unchanged, all pass | full suite |
