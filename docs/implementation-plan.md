# Implementation Plan — v0.2

**Date:** 2026-11-15. Supersedes v0.1 after Codex review. Estimates in **engineer-weeks** (ranges), re-estimated after R1. Every milestone exits with: tests run (output attached), adversarial tests run, phase report (implemented / files / tests / security checks / limitations / risks / next).

## MVP (v0.1.0): R0 → R7

| Milestone | Scope | Exit criteria (adversarial where possible) | Est. |
|---|---|---|---|
| **R0 Enforcement contract** | §0 promise, threat model v2 (7 attacker classes), capability vocabulary, measured `capabilities.json` for Claude 2.1.325 & Codex 0.157.1, enforcement classes, ADR-0001..0006 | Every restriction in the default policy names its enforcement mechanism and class; a mandatory→ADVISORY mapping fails `compile` in a test | 1–2 |
| **R1 Two-runtime spike** | `RuntimeExecutor` for both CLIs, one bounded task each ("add a failing test then make it pass in fixture repo"), env allowlist, timeout + process-tree kill, structured result | Version-pinned tests: denied write → `denied`; malformed settings → preflight error (not silent); timeout → killed, no orphan; stream without terminal event → `unknown` | 1–2 |
| **R2 Protected boundary** | Control-plane store outside workspace, PreToolUse hook (CONFIG001 / SCOPE001 / SECRET001 / GIT001), `packages/rules` engine, artifact store | Model-issued writes to config/control store blocked on Claude (permissions + hook, measured); Codex: control store outside writable roots (measured R1.2); subprocess effects on Claude stay ADVISORY (R1.2 model — the original criterion assumed hooks see subprocesses, they do not); hook unit tests ≥ 1 per rule incl. symlink/`..` bypass attempts | 2–4 |
| **R3 Compiler & installer** | `init`, `compile --dry-run` (diff), deterministic generation, atomic writes, manifest, `uninstall` with 3-way merge, `doctor` (versions, trust status, conflicting frameworks e.g. global superpowers hook) | Idempotent compile (byte-identical); interrupted write recovers; user edit to a managed file is preserved and reported; unsupported runtime version rejected | 2–3 |
| **R4 Governed workflow** | State machine, template `feature-governed` (plan → challenge → approve → implement → verify → review → rework≤2 → propose PR), serialized mutations, risk re-evaluation on diff, events, **orchestrator commits after Verify (ADR-0011)**, claude-mem recall before plan / record after run (ADR-0009) | Kill/restart mid-run resumes without re-running `executed` intents; a model claiming "tests pass" while they fail ⇒ `FAILED` by Verify node; 3 bounded retries then `NEEDS_HUMAN` | 2–4 |
| **R5 Skill import** | Full-SHA fetch, safe extraction, tree hash, builtin auditor + malicious fixtures, approve/revoke, 3 evaluated first-party skills (`tdd`, `planning-contract`, `code-review`) | Archive with symlink/`..`/absolute path rejected; modified approved skill ⇒ quarantined & compiled copy removed; no quarantined file readable from a run (test reads store path from inside runtime → denied) | 1–2 |
| **R6 One brokered connector** | GitHub read MCP compiled for agents; `github.pr.create` via Action Broker; approval binding; journal; reconciliation | Cross-repo proposal denied; approval for args A doesn't execute args A′; replay of used nonce denied; simulated network timeout ⇒ `NEEDS_RECONCILIATION`, no duplicate PR in fake API | 1–3 |
| **R7 Pilot & release hardening** | Baseline eval (same task with raw CLI vs Taskquoin: success, escaped defects, unauthorized effects, interventions, cost, latency), docs match behavior, SECURITY.md with residual risks, release provenance (npm provenance, signed tags), CI on Linux/macOS/Windows | No unresolved critical boundary failure; measured benefit reported honestly (even if negative); DoD checklist below green | 2–3 |

**Total MVP: 12–23 engineer-weeks.**

## Phase B (gated by MVP pilot feedback)
Studio read-only (runs, approvals inbox) with browser threat model implemented · Jira read + brokered comment · Graphify/Archify optional skills (via R5 quarantine/approval; Graphify CLI only, never its installer) · **AnyDoc** optional document ingestion for planning (checksum-pinned binary) · agent catalog opt-in (first 6 roles with evals) · Symfony & Node stack packs.

## Phase C (gated: ≥3 hand-authored custom workflows by pilots)
Studio editor (React Flow ⇄ YAML, layout sidecar) · remaining stack packs · RTK guarded (measured token savings vs debugging accuracy, raw-log policy reconciled with metadata-only logging) · Agent Standup viewer (reads the Taskquoin event log, not transcripts) · **Harness** CI connector (Harness SaaS users only, brokered writes) · additional runtimes (Cursor/Copilot/Gemini/OpenCode — currently UNTESTED).

## Separate project
PentAGI isolated extension (own threat model, VM-only, no docker.sock) — not scheduled.

## Testing strategy
- `tests/` offline, free, deterministic: unit (domain, rules), contract (both runtime adapters against recorded fixtures + live behind `AF_E2E=1`), golden (compiled outputs, uninstall), hook tests (bash, stdin JSON fixtures), security regression (malicious skills, archive attacks, bypass attempts), mutation (Stryker on `domain/policy` + `rules`).
- `evals/` paid, explicit, cost-capped: routing (does the right skill fire), outcome (regex/transcript graders first, LLM judge never in gate), **unauthorized-effect count** on an injection corpus.
- Each test file header: *proves* / *does not prove*.

## Definition of Done (v0.1.0) — from master spec §18, made checkable
1. `npm i -g <pkg>@<ver>` + `init` reproducible on 3 OS (CI evidence). 2. Claude + Codex run `feature-governed` end-to-end on example repo (recorded run). 3. Skill validator passes/fails agentskills spec fixtures. 4. `package-lock.json` reviewed, `npm audit` clean or exceptions documented (the project uses npm; CI job `supply-chain`). 5. Test: quarantined skill never compiled/executed. 6. Enforcement matrix tests green. 7. Workflow e2e green. 8. All `tests/` green (output in release notes). 9. Security controls each have a named test. 10. Docs reviewed against behavior by a second model. 11. `init` → `uninstall` on example leaves tree hash unchanged / user edits preserved. 12. SECURITY.md lists residual risks. 13. Gitleaks on repo clean. 14. README contains no "secure"/"safe" without a qualifier. 15. Independent review (Codex + human) recorded in `reviews/`.

## Risks
| Risk | Mitigation |
|---|---|
| Runtime CLIs change flags/paths | Pin supported versions; contract tests; `doctor` refuses unknown versions |
| Hook trust in Codex is user-dependent | `doctor` shows trust status; mandatory policies fail compile when hooks untrusted |
| Benefit vs raw CLI not demonstrated | R7 baseline eval is a release gate; negative result is published |
| Scope pressure (UI, Jira, 20 agents) | Phase gates with explicit criteria |
