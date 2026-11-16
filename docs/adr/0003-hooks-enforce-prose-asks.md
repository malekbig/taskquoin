# ADR-0003: Rules that matter are hooks, not instructions

## Status
Accepted

## Date
2026-11-15

## Context
Instructions in CLAUDE.md/AGENTS.md decay as context fills (documented by ai-craftsman-superpowers: "a prompt asks, this enforces"). Security- and architecture-relevant rules need a check in the loop.

## Decision
Mandatory rules are implemented as PreToolUse/Stop command hooks (bash + python3 stdlib) with the contract: exit 0 = allow, exit 2 = deny, never exit 1; stdin only; no network; no writes to the source tree; a gate that cannot run denies for sensitive operations. The same `packages/rules` engine runs in hooks, in `taskquoin ci`, and as reviewer criteria. Instructions remain for guidance only.

## Consequences
- Positive: enforcement survives long sessions and compaction; one verdict in editor and CI.
- Negative: Codex loads hooks only after the user trusts them (`/hooks`); hooks add latency per tool call (budget: <100 ms).

## Evidence
BULDEE/ai-craftsman-superpowers @ 303e43b: `hooks/config-protection.sh`, `hooks/git-bypass-guard.sh`, SECURITY.md hook table, ADR-0023, ADR-0029.

## Amendment (2026-11-15, R2)
- Hooks are written in **Node/TypeScript**, not bash + python3: the hook imports `@taskquoin/rules`, the same engine used by the permission compiler and the future CI gate (one verdict). Measured start-up ≈ 120 ms per tool call (above the 100 ms budget; precompilation is a later optimisation).
- Claude: the hook is declared in inline `--settings`, so it runs under `--setting-sources ""` (measured). Exit 0 defers to permissions, exit 2 denies; the entry point catches every error and exits 2 (Claude treats other non-zero codes as non-blocking).
- Measured on 2.1.325: Claude's own permission check already resolves symlinks; the hook's physical-path check is defense in depth there. The hook's distinct value is GIT001 (hook-bypass flags inside an allowed `git commit *` pattern) — measured.
- Codex: hooks need persisted trust, unavailable under `--ignore-user-config`; Codex relies on its OS sandbox.
- Hooks see model-issued tool calls only, never what an allowed command does in a subprocess.
