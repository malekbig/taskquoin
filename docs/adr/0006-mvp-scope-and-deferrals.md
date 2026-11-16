# ADR-0006: MVP scope — one promise, one workflow, three agents

## Status
Accepted (pending human confirmation of §13 decisions in architecture.md)

## Date
2026-11-15

## Context
v0.1 bundled compiler, workflow engine, skill registry, policy DSL, visual editor, connector hub, integrations and an offensive-security extension. Codex review: NO-GO, "several products bundled".

## Decision
MVP promise: governed execution of the `feature-governed` workflow over Claude Code and Codex with enforced/brokered/advisory classification. Default profile: 3 agents (implementer, challenger, verifier). Deferred: Studio editor (Phase C; viewer in Phase B), Jira write, 20-role catalog, stack packs, RTK, Graphify, Archify, Agent Standup. Separate project: PentAGI. The low-code Studio remains a user requirement and is kept on the roadmap with explicit gates.

## Consequences
- Positive: validates the core premise and measures benefit vs raw CLI before investing in UI.
- Negative: the user's requested UI arrives later; must be communicated clearly.
