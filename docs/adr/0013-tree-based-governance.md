# ADR-0013: The unit of governance is an immutable git tree; no repository code runs on the host

## Status
Accepted (forced by the Codex R4 review: REJECT)

## Context
R4 verified a mutable working tree, reviewed a diff, approved "the pending gate", then staged and committed the live
workspace with repository hooks enabled. Codex showed: Verify gave tests a writable `.git` (plant a `pre-commit` hook →
Taskquoin's host-side `git commit` executes it), the approved diff, verified tree and committed tree could differ,
approvals could be replayed across gates, and the landing gate missed renames/quoted paths/`.gitattributes`.

## Decision
1. **Tree id as the unit**: the candidate is `git write-tree` of a TEMPORARY index (developer's index untouched). Verify,
   review, approval and commit all refer to that tree id. Tests that change the tree fail verification (since
   ADR-0014 they run in a clean room, so the working directory is never changed by them). If the tree changes after approval, the approval is invalidated and verification AND
   review run again before a new approval.
2. **No repository code on the host**: every orchestrator git call runs with `core.hooksPath=/dev/null`,
   `core.fsmonitor=false`, no rename detection, no external diff/textconv; the commit is
   `git commit-tree <approved tree> -p <expected parent>` + compare-and-swap `update-ref` — exactly the approved tree,
   no hooks, no filters. Project checks run in Verify instead.
3. **Verify profile**: bubblewrap with no network, own PID namespace (descendants die with it), `.git` read-only,
   HOME hidden (tmpfs), `/run`/`$XDG_RUNTIME_DIR`/control store masked, project secret files masked, the repository as
   the only writable root.
4. **Approvals name the gate and the hash**: `taskquoin approve <run> <plan|commit> --expect <hash>`; per-run lock;
   `taskquoin.yaml` digest bound to the run; adapter failures leave a resumable `interrupted` state (`taskquoin resume`).
5. **Landing gate**: NUL-delimited, no renames (both sides seen), case-insensitive; `.gitattributes`/`.gitmodules`
   protected; submodules refused.
6. **RED proof by Taskquoin** (added after pilot 1, where the implementer could not observe RED itself; hardened after
   an independent Codex review): after a green Verify, Taskquoin builds the *red tree* = base tree
   + only the changed test files (`TEST_PATH_GLOBS`, deletions included), materializes it in its own clean room
   (ADR-0014), runs the same sandboxed suite and requires a **conclusive failure**: the
   sandbox started (marker printed inside it), the command exited by itself with a code < 126 and its whole output was
   kept. A timeout, a sandbox or launch failure, a signal, a truncated output, or a tree that cannot be materialized is
   **inconclusive → `needs-human`**, never evidence. If the red run passes, the tests do not depend on the change: rework with that feedback (`red-N`), then
   `needs-human`. Since ADR-0014 the green and the red trees are each verified in their own clean room; the working
   directory is never touched (the restores, their ignored-file guard and the concurrent-writer race are gone). The
   red log goes to the reviewer, who must reject a failure that is not an assertion about the requested behaviour
   (import error, missing helper, source-text check). A change touching only files classified as tests (red tree ==
   green tree) skips the proof; the reviewer is told to check none of them is production code and the commit says
   `RED-Proof: not applicable`.
   **What it proves**: the changed tests fail without the non-test changes. **What it does not prove**: that they
   test the requested behaviour — that stays the reviewer's and the human's judgement, with the red log in hand.

## Consequences
- Positive: a Taskquoin commit is, byte for byte, the tree that passed sandboxed tests, was reviewed and approved.
- Positive: "the tests fail without the change" is checked by the orchestrator on the exact trees, not claimed by a
  model, and stated in the commit (`RED-Proof:`).
- Negative (RED proof): a test helper outside `TEST_PATH_GLOBS` counts as production code, so the red tree fails for
  that reason (a mechanical "RED" that only the reviewer/human can see through); a refactor or docs-only change without
  a new failing test ends in `needs-human` (the `feature-governed` template is for behaviour changes); a base whose
  suite already fails for an unrelated reason proves RED trivially; production code under a `test/` or `tests/`
  directory gets the tests-only exemption (flagged to the reviewer); Verify time doubles.
- **Accepted residuals (maintainer, 2026-11-16)**, all disclosed to the reviewer, in
  the commit (`RED-Proof:`) and in the diff the human approves: (1) production code under `test/`/`tests/` passes for
  tests (tests-only exemption); (2) a launch failure that exits with code 1 looks like a test failure; (3) the proof is
  mechanical — it does not establish that the tests assert the requested behaviour.
- Closed by ADR-0014: Verify used to run on the tree **plus ignored files**; it now runs in a clean room with only
  the dependency directories, read-only and frozen for agents.
- Negative: repository commit hooks are not run by Taskquoin (run them yourself when merging); tests needing network,
  HOME files or secret files fail in Verify (fail closed); repositories with submodules are not supported yet.
