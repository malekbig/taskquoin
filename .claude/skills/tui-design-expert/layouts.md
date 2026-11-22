# Layouts

Plain-text layouts (colour tokens named in brackets where they matter). Data shown is sample data; every value on a
real screen comes from the control plane (see `taskquoin-contracts.md`). Widths are exact: the header of each block
gives the terminal size it was drawn for.

## Console — Full (100 × 30)

```
  ██████  ▀█▀ ▄▀▄ █▀▀ █▄▀ ▄▀▄ █ █ ▄▀▄ █ █▄ █                                              v2026.11.1
  ███      █  █▀█ ▄▄█ █ █ ▀▄█ ▀▄▀ ▀▄▀ █ █ ▀█
  ██████  ✦ YOUR AI DEV SQUAD ✦
  ███     governed · human in the loop · verifiable

  Repository  ~/shop-api   main · clean tree
  Sandbox     ✔ bubblewrap 0.6.1  ✔ socat 1.7.4.1 · clean-room Verify available
  Policy      taskquoin.yaml 5c7269946c4b · 1 accepted risk until 2026-12-31

  ── Squad ─────────────────────────────────────────────────── 1 of 3 agents ready · Verify ready ──
  ○ Architect  planner · claude 2.1.330      NOT READY  matrix measured for claude 2.1.327
  ○ Developer  implementer · claude 2.1.330  NOT READY  matrix measured for claude 2.1.327
  ◐ Reviewer   challenger · codex 0.157.1    READY      accepted risk: connector.write
  ● Tester     verify · bubblewrap 0.6.1     READY      clean room

  ◆ Action required  Claude Code 2.1.330 is not measured by Taskquoin yet (certified: 2.1.327)
                     → /upgrade, or /doctor for the details

  taskquoin › /
    Run          /run <request>   /runs   /use <run>   /status   /resume
    Review       /show [artifact]   /approve <plan|commit>
    Diagnose     /agents   /doctor   /skills   /upgrade
    Console      /help   /quit
    ↑↓ move · Tab complete · Enter choose · Esc close
```

The squad count is the gate's: agents whose verdict is ok now. `[orange]` only for the action line; `[amber]` for the
accepted risk; `[red]` NOT READY.

## Console — Compact (76 × 18)

```
  ██████  ▀█▀ ▄▀▄ █▀▀ █▄▀ ▄▀▄ █ █ ▄▀▄ █ █▄ █                      v2026.11.1
  ███      █  █▀█ ▄▄█ █ █ ▀▄█ ▀▄▀ ▀▄▀ █ █ ▀█
  ██████  ~/shop-api  main · clean
  ███     sandbox ✔ · 1 accepted risk

  ○ Architect  claude 2.1.330    NOT READY  not measured
  ○ Developer  claude 2.1.330    NOT READY  not measured
  ◐ Reviewer   codex 0.157.1     READY      accepted risk
  ● Tester     bubblewrap 0.6.1  READY
  1 of 3 agents ready — /doctor for the details

  taskquoin ›
```

## Console — Minimal (56 columns, or NO_COLOR, or TERM=dumb)

```
▙ taskquoin 2026.11.1 · shop-api (main)
agents 1/3 ready · verify ready · 1 accepted risk
○ Architect NOT READY not measured
○ Developer NOT READY not measured
◐ Reviewer  READY     accepted risk
● Tester    READY
/doctor: details · /help: commands
taskquoin ›
```

ASCII charset: `[x] Architect NOT READY not measured`, `[~] Reviewer READY accepted risk`, `[ok] Tester READY`.

## During `/run` (100 columns)

```
  Run ab12cd  · branch taskquoin/run-20261122T101500-ab12cd                         started 10:15:02
  ✔ Planning               Architect · claude  10:16:40  1 min 38 s  /show plan
  ✔ Adversarial critique   Reviewer · codex    10:17:30        49 s  2 blocking  /show challenge
  ✔ Plan approval          alice (console)     10:20:00  2 min 29 s  3f9a1c07b2e4
  ⠹ Implementation         Developer · claude  running   4 min 12 s  attempt 2
    │ ✖ attempt 1  Verify: tests failing in the clean room          /show verify-1
  · Clean-room Verify · RED proof
  · Review
  · Commit approval
  · Commit

  Ctrl+C does not stop the run (it goes on to the next gate) · /quit leaves the console
```

Times are the state machine's: a step's end is its history entry, its start the previous entry's end. No percentage.
A retry is a nested line under the step it repeats, not a new step.

## `/approve commit` in the console (100 columns)

```
  ◆ Commit approval  run ab12cd — "rate-limit the /login route"
    Bound to the git tree  9c1e04b7aa31   (tree 9c1e04b7aa31d2f04c…)
    Diff                   3 files  +48 −6                                 /show diff-2
    Verify                 ✔ passed in the clean room (exit 0)             /show verify-2
    RED proof              ✔ tests failed on the previous tree             /show red-2
    Review                 ✔ Reviewer: APPROVE                             /show review-2
    Policy                 agents never commit · 1 accepted risk (connector.write)
    Read this session      ✔ diff-2  ✔ review-2  · verify-2

    Approver               alice (via taskquoin console)

  Retype 9c1e04b7aa31 to approve (Enter to cancel): █

  No key approves on its own · the hash is re-read before approving: a changed tree is refused
```

The 12-character hash is bold. "Read this session" is a reminder, not a gate (the gate is the retype).

## Dashboard — main view (120 × 34)

```
 ▙ taskquoin 2026.11.1 │ shop-api  main │ run ab12cd ◉ RUNNING │ governance ✔ · 1 accepted risk                10:24:13

╭─ Pipeline ─────────────────────────────── 3/8 ─╮ ╭─ Agents ────────────────────────────────────────────────────── a ─╮
│ ✔ Planning               1m38s  Architect      │ │ ○ Architect  claude 2.1.330    ?       NOT READY  —               │
│ ✔ Critique                 49s  2 blocking     │ │ ○ Developer  claude 2.1.330    ?       NOT READY  active 4m12s    │
│ ✔ Plan approved          2m29s  alice · 3f9a1c…│ │ ◐ Reviewer   codex 0.157.1     ?       READY      —               │
│ ▸⠹ Implementation        4m12s  attempt 2      │ │ ● Tester     bubblewrap 0.6.1  —       READY      —               │
│    └ ✖ attempt 1 · Verify failed               │ ╰───────────────────────────────────────────────────────────────────╯
│ · Verify · RED proof                           │ ╭─ Events ─────────────────────────────────────────────── l · 7/31 ─╮
│ · Review                                       │ │ 10:24:02  implement  attempt 2: Developer running                 │
│ · Commit approval                              │ │ 10:21:07  security   ⚠ 2 terminal sequences neutralised           │
│ · Commit                                       │ │                      implementer: ‹ESC›]52;c;Y3Vy…‹BEL›writing te…│
╰────────────────────────────────────────────────╯ │ 10:20:01  verify-1   tests failing in the clean room (exit 1)     │
╭─ Approvals ──────────────────────────────── p ─╮ │ 10:17:31  plan       approved by alice (console) · 3f9a1c07       │
│ none waiting                                   │ │ 10:16:41  challenge  Reviewer: 2 blocking findings                │
│ next: commit, after Verify and Review          │ │ 10:15:02  run        started · policy 5c7269946c4b                │
╰────────────────────────────────────────────────╯ │                                                                   │
╭─ Runs ───────────────────────────────────── r ─╮ │                                                                   │
│ ▸◉ ab12cd  rate-limit /login        10:15      │ │                                                                   │
│  ✔ 7f03aa  add npm test             yesterday  │ │                                                                   │
│  ✖ 52c9e1  config migration         Nov 18     │ │                                                                   │
╰────────────────────────────────────────────────╯ ╰───────────────────────────────────────────────────────────────────╯











 r runs  a agents  d diff  l log  v verify  p approvals  ? help  q quit                     read-only · read 10:24:13 ✔
```

Model `?`: the control plane does not record the Claude or Codex model (see contracts). The events pane shows the
neutralised sequences instead of executing or hiding them.

## Diff viewer (120 columns)

```
 ▙ taskquoin │ Diff · run ab12cd │ tree waiting for approval 9c1e04b7aa31 ✔ current                      3 files +48 −6

╭─ Files ──────────────────── 1/3 ─╮ ╭─ src/login.js ────────────────────────────────────────────────── +31 −4 · 12 % ─╮
│ ▸ src/login.js          +31 −4   │ │ @@ -10,7 +10,9 @@ const express = require('express');                           │
│   src/rate-limit.js     +15      │ │   10   10   const app = express();                                              │
│   test/rate.test.js     +2  −2   │ │   11   11   app.use(express.json());                                            │
│                                  │ │   12      − app.post('/login', handler);                                        │
│ 3 files · +48 −6                 │ │        12 + const { rateLimit } = require('./rate-limit');                      │
│                                  │ │        13 +                                                                     │
│ Read: 1 / 3 files                │ │        14 + app.post('/login', rateLimit({ max: 5, windowMs: 60_000 }), handler…│
│ to the end: no                   │ │   13   15                                                                       │
│                                  │ │   14   16   function handler(req, res) {                                        │
╰──────────────────────────────────╯ ╰─────────────────────────────────────────────────────────────────────────────────╯

 j k scroll  n N file  / search  w wrap  p approval  q back
```

"12 %" is a real ratio (lines scrolled past / lines in the file). Without colour the `+`/`−` column carries the meaning.
Long lines: wrap (`w`) or a `→` marker at the cut; a cut never hides that the line continues.

## Approval center (100 columns)

```
╭─ Approval center ──────────────────────────────────────────────────────────────────── 1 waiting ─╮
│ Run          ab12cd · "rate-limit the /login route"                                              │
│ Gate         commit — bound to the exact git tree, not to the message                            │
│ Hash         9c1e04b7aa31  tree 9c1e04b7aa31d2f04c…                                              │
│ To read      ✔ diff-2 (to the end)  ✔ verify-2  ✔ red-2  ✔ review-2                              │
│ Policy       agents never commit · clean-room Verify · 1 accepted risk                           │
│ Status       ◆ waiting for you since 10:31:44 · re-read 10:33:02 ✔ unchanged                     │
│ Approver     alice (via taskquoin dashboard)                                                     │
│                                                                                                  │
│ Retype the hash to approve: 9c1e04█                                                              │
│                                                                                                  │
│ Esc cancels · no key approves on its own · keys typed before this screen are ignored             │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
```

## Stale artifact

```
╭─ Approval center ──────────────────────────────────────────────────────────────────────── stale ─╮
│ ✖ Refused: the tree changed since it was shown                                                   │
│                                                                                                  │
│ shown       9c1e04b7aa31   at 10:31:44                                                           │
│ waiting     77d0e2c41f95   re-verified and re-reviewed at 10:32:58                               │
│                                                                                                  │
│ Nothing was approved. Read the new diff: d (diff-3)                                              │
╰──────────────────────────────────────────────────────────────────────────────────────────────────╯
```

## Terminal too small (dashboard)

```
Taskquoin dashboard needs 40 × 12 — this terminal is 36 × 10.
Enlarge it, or use: taskquoin status
```

## Help overlay (`?`)

```
╭─ Keys ───────────────────────────────────────────╮
│ r runs      a agents     d diff      l log       │
│ v verify    p approvals  ? help      q quit      │
│ Tab next panel   j k move   g G top/bottom       │
│ / search   n N next/previous   Esc close         │
│                                                  │
│ Approving needs the hash typed in the approval   │
│ center — no key approves on its own.             │
╰──────────────────────────────────────────────────╯
```
