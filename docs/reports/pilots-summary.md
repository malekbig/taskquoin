# Pilot runs — public summary

Three governed runs made by the maintainer on Taskquoin's own repository (November 2026), with the real Claude Code
and Codex. The detailed working notes stay private; this page keeps only the facts the documentation relies on.
Amounts are API-equivalent estimates reported by Claude Code; the runs used subscriptions and nothing was billed.

## Pilot 1

- Request: add a `taskquoin version` command. One implementation attempt.
- Duration: about 8 min 30 s for the whole run, about 5 min of it waiting for the human.
- Cost: Claude Code ≈ $0.49 (plan ≈ $0.18, implementation ≈ $0.31); Codex not measured.
- After the commit: the commit's tree is exactly the approved tree (`ebbf47cd…`); no git hook ran; nothing was pushed;
  the working tree was clean.

## Pilot 2

- Request: `taskquoin status --json`. One implementation attempt.
- Timeline (UTC): plan at 20:08:03, commit approval at about 20:19.
- After the commit: commit tree = approved tree (`95efdb06…`); clean tree; no hook; nothing pushed.

## Pilot 3

- Request: `taskquoin show <run>` lists the artifacts. Two implementation attempts (`RED-Proof: proven (attempt 2)`).
- Timeline (UTC): plan at 21:59:25, commit approval at about 22:25.
- Verify, the authority on tests, caught a scenario the agent could not run in its own sandbox: tests needing
  bubblewrap were skipped there (53 skipped) and ran in the clean room (12 skipped).
- After the commit: commit tree = approved tree (`5a92824e…`); clean tree.
