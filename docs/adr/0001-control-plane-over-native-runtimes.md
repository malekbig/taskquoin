# ADR-0001: Control plane over native runtimes, no custom LLM loop

## Status
Accepted

## Date
2026-11-15

## Context
Claude Code and Codex already provide agent loops, tool use, sandboxing, hooks, sub-agents and MCP. Rebuilding an execution engine would duplicate them and lag behind.

## Decision
Taskquoin compiles configuration into each runtime's native files and orchestrates by launching headless runs (`claude -p`, `codex exec`) through a versioned `ExecutionContract`. It never calls model APIs directly.

## Consequences
- Positive: leverages native sandboxes/permissions; small trusted codebase; stays current with runtimes.
- Negative: dependent on CLI flag/format stability; enforcement is bounded by what the runtime exposes (hence ADR-0002).

## Evidence
Master spec Layer 2; Codex review §2 ("headless orchestration is sound for bounded jobs").
