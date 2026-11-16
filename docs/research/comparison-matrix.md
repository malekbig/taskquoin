# Comparison Matrix — overlapping functionality

**Date:** 2026-11-15

| Concern | Candidates | Conflict | Choice |
|---|---|---|---|
| Skill installation | vercel-labs/skills, Graphify installer, superpowers plugin, our installer | Each writes to agent dirs, some globally | **Our installer only** (pinned, project-local, reversible) |
| Engineering discipline (TDD, planning, review) | superpowers, mattpocock/skills, ponytail, karpathy | Overlapping, sometimes contradictory ("always brainstorm" vs "do the least") | First-party skills with explicit activation criteria; one skill per concern |
| Simplicity / anti-overengineering | ponytail, karpathy principles | Ponytail's "laziest dev" vs DDD rigor | `simplicity` skill + rule "DDD only when complexity justifies" |
| Planning | Codex plan mode, Claude plan mode, planning-with-files | Formats differ | Shared **Planning Contract** (markdown + YAML front-matter) both runtimes read |
| Codebase understanding | Graphify, native grep/LSP | Graphify heavier | Native first; Graphify for >50k LOC or on demand |
| Diagrams | Archify, Mermaid | Archify richer | Mermaid in docs (zero-dep); Archify optional |
| Observability | agent-standup, Claude OTel, claude-mem | Transcript access | Own redacted JSONL event log; viewers optional |
| Command-output compression | RTK | Can hide errors | Optional, guarded |
| Skill security scanning | Our auditor, SkillSpector, agentseal | — | Deterministic first-party auditor (required) + SkillSpector (optional) |
| Orchestration UI | none adequate in list | — | Phase B viewer, Phase C editor (Codex: not justified for MVP; user requirement kept on roadmap) |
| Rule enforcement in the loop | ai-craftsman-superpowers hooks, superpowers (prose), CLAUDE.md rules | Prose decays; hooks enforce | First-party hooks following craftsman's exit-0/2 contract; rules shared with CI |
| Capability/compat matrix | craftsman `host-capabilities.json` (measured), our v0.1 matrix (asserted) | Asserted ≠ measured | Adopt measured, versioned `capabilities.json` |
