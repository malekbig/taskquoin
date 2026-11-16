# ADR-0005: Control-plane state lives outside the workspace

## Status
Accepted

## Date
2026-11-15

## Context
Policies, approvals, skills.lock, quarantine and audit logs inside `.taskquoin/` are readable and potentially writable by the agent and by project code (tests, build scripts) it runs (Codex review P0).

## Decision
Mutable control state moves to `$XDG_STATE_HOME/taskquoin/<repo-id>/`. Codex's `workspace-write` sandbox cannot reach it; on Claude it is covered by `permissions.deny` plus the config-protection hook. The repo keeps only reviewable declarations (`taskquoin.yaml`, workflows, agents, a read-only mirror of `skills.lock`) and generated runtime files tracked in a manifest.
A hostile process running as the same OS user is **out of scope** and documented in SECURITY.md.

## Consequences
- Positive: project code and models cannot tamper with evidence or authorization under supported threat model.
- Negative: state is per machine; team sharing of approvals requires Phase B design.
