# ADR-0007: Human decisions on v0.2 open questions

## Status
Accepted

## Date
2026-11-15

## Decision (by the project owner)
1. Primary promise: **governed execution** (architecture.md §0).
2. MVP as planned in implementation-plan.md R0–R7; Studio editor deferred (viewer Phase B, editor Phase C).
3. Threat model: a hostile process already running as the same OS user is **out of scope**. Rationale explained to the owner: such a process already has the user's files and credentials; no application-level framework can defend against it. In scope: malicious skills, malicious repository content, injected tool outputs, agents exceeding declared capabilities.
4. Name: **Taskquoin**.
5. Start R0–R1 now.
