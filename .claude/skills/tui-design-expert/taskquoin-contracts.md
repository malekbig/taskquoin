# What Taskquoin records, and the contracts a screen must keep

Facts from the code as of 2026-11-22 (file references to re-check before relying on a detail). A screen may show only
what is here or computed live; anything else is "unknown".

## Run state (`packages/application/src/workflow/feature-governed.ts`)

- Nodes: `recall, plan, challenge, approve-plan, implement, verify, red-check, review, approve-commit, commit, record, done`.
- Statuses: `running, waiting-approval, completed, failed, needs-human, interrupted`.
- Logical steps for display: Planning = recall + plan · Adversarial critique = challenge · Plan approval = approve-plan ·
  Implementation = implement · Clean-room Verify = verify · RED proof = red-check · Review = review · Commit approval =
  approve-commit · Commit = commit (+ record, done).
- Loops back to `implement`: verify (tests red or tree changed), red-check (RED not proven), review
  (CHANGES_REQUESTED, at most 2 reworks). `attempts` grows on each entry to implement; the limit is 3 (5 when the
  implementer has no commands). `commit` returns to `verify` when the tree changed after approval (`reverified`): the
  same attempt number, so `verify-N`, `red-N`, `diff-N`, `review-N` are overwritten.
- `history[]` = `{ node, outcome, at }` written when a node is **left** (or the run stops): `at` is an **end** time.
  A step's start = the previous entry's `at`; the run's start is only in the run id (`run-YYYYMMDDTHHMMSS-xxxxxx`, UTC).
  `approve` and `resume` add no history entry.
- `artifacts`: name → sha256. Names: `memory, plan, challenge-<id>, challenge, workspace-baseline, implement-N,
  ignored-N, verify-N, red-N, diff-N, review-N-<id>, review-N`.
- `approvals[node]` = `{ approvedBy, at, binding }`; `lastVerify` = `{ passed, exitCode, treeChanged }`;
  `lastVerdict` = `APPROVE | CHANGES_REQUESTED`; `branch` = `taskquoin/<runId>`; `commit` = the sha once committed.

## Events (`runs/<runId>/events.jsonl`)

One JSON object per line, appended without lock or fsync: a reader must tolerate a **partial last line**. Only scalar
values are kept and strings are cut to 256 characters.

| Type | Fields |
|---|---|
| `node.transition` | runId, node, outcome, next, attempts |
| `run.failed` / `run.waiting-approval` / `run.needs-human` / `run.interrupted` | runId, node (no `run.completed`) |
| `risk.accepted` | runId, agent, capability, approvedBy, expires |
| `agent.finished` | runId, agent, runtime, label, status, costUsd (or null), digest — `tokens` is an object and is **dropped** by the store today |
| `verify.result` | runId, attempt, passed, exitCode, tree, ignoredChanges |
| `red.result` | runId, attempt, redFailed (true/false/null), inconclusive?, tree |
| `approval` | node, approvedBy, binding |

No agent start event, no model field, no duration (`RunResult.durationMs` is never saved). Nothing in the code reads
this file yet.

## Store (`adapters/store-fs`)

- Root: `${XDG_STATE_HOME:-~/.local/state}/taskquoin/repos/<16 hex of sha256(realpath of repo)>/`.
- `runs/<id>/state.json`: temp file + rename, mode 0600 → a reader sees the old or the new complete file.
  `runs/<id>/lock`: pid file; `status` and `show` do not take it.
- Artifacts: content-addressed, mode 0400, written before the state that points to them; `getArtifact` re-hashes and
  throws on mismatch. Listing the directory directly can meet a half-written file — go through state pointers.
- Written in place (can tear): `approvals/risk-acceptances.json`, the skills lock.
- **`repoStore()` creates directories** (`ensureTrustedDir`): a read-only screen must not call it.

## Approvals

- Pending only when `status = waiting-approval`. **Plan** binding = `artifacts.plan` (sha256 of the planner's final
  message; the challenge is not part of it). **Commit** binding = `reviewedTree`, a **git tree id** (not a sha256).
- `approve` accepts a hex prefix of 12–64 characters of the binding and a non-empty name; it stores the full binding.
  The workflow re-checks the binding when it resumes, and the commit node checks that the candidate tree still equals it.
- Console contract (ADR-0015): nothing starts without `/`; `/approve <plan|commit>` re-reads the pending gate right
  before showing it, asks the approver's name **once per session first** (a `/…` line is never a name), then asks to
  retype the 12-character hash; empty input cancels, a different input fails. Recorded as
  `<name> (via taskquoin console)`. In a terminal, lines typed before the prompt are discarded with a notice; piped
  input (scripts, tests) is kept. Ctrl+C does not stop a run. The console is never installed as slash commands inside
  Claude Code or Codex.
- A dashboard approval form keeps all of it: same function, same re-read, same retype (the 12 characters typed go to
  `approve` as `expect`), the name asked once per dashboard session and kept in memory only, recorded
  `<name> (via taskquoin dashboard)`.

## Governance data

- Gate verdicts (`prepareRun` → `ok, resolved[], failures[], warnings, acceptedRisks, ticket`) are **computed each time,
  never stored**. The CLI adds `runtimeFound`. `doctor` counts an agent refused when `!ok`, `!runtimeFound`, or its
  skills have errors; the console banner (`squadOf`) ignores skills — keep both counts consistent on a new screen.
- Enforcement classes: `ENFORCED | BROKERED | ADVISORY | UNSUPPORTED`; a mandatory restriction that is not certified
  (measured for the exact runtime version) is a failure.
- Accepted risks: `approvals/risk-acceptances.json` `{agent, capability, reason, expires, approvedBy, runtimeVersion,
  failureDigest, createdAt}`; one applies only to the same failure digest and runtime version, until its expiry day.
- Sandbox status is **not stored**: `probeHost` starts processes (bwrap test run, `--version` of each runtime). A
  screen computes it once when it opens and on an explicit refresh, never in a render loop.

## Runtimes: what is known

| Runtime | Model | Tokens | Cost |
|---|---|---|---|
| Claude | seen in the init event, not saved | not reported | `costUsd` |
| Codex | not reported | input/output | — |
| OpenCode | seen in the stream, used to refuse a mismatch | summed | summed `costUsd` |
| API judge | the configured model (in the label) | input/output | — |

Only `costUsd` and `label` reach the event log. A screen shows `?` for the model of Claude and Codex agents.

## Tests to build on

`apps/cli/test/console.test.ts` (`session()` captures prompts, out, err), `apps/cli/test/cli.test.ts` (`sandbox()` runs
the real `main.ts`; `seededRepo()` writes a run state), `apps/cli/test/width.test.ts`, the Gherkin runner
(`features/*.feature`, `World.tq(args, input)` runs the real CLI with an isolated HOME and fake runtimes). There is no
PTY harness yet.
