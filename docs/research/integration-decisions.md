# Integration Decisions

**Date:** 2026-11-15. Decisions: **INTEGRATE** (optional adapter, pinned) · **ADAPT** (re-implement idea first-party) · **REFERENCE** (link, cite) · **REPLACE** (we build our own) · **REJECT**.
No external component is installed automatically. Every INTEGRATE starts QUARANTINED until a human approves it in `skills.lock`.

| Component | Decision | Candidate pin | Rationale |
|---|---|---|---|
| Agent Skills spec (agentskills) | **ADAPT** (validator follows spec) | `83021e2be457` | Single canonical format for Claude, Codex and others |
| vercel-labs/skills | REFERENCE | — | Overlaps our installer; unpinned by default |
| anthropics/skills | REFERENCE (selective import after audit) | `1780c5e5a552` | Mixed licensing; skill-creator patterns useful |
| claude-plugins-official | REFERENCE / catalog source | `b5b01ac4f889` | Each plugin is its own trust unit |
| Archify | **INTEGRATE** (optional) | `a7ed6fd6657d` | Architecture diagrams, Apache-2.0 |
| Graphify | **INTEGRATE** (optional, analysis CLI only) | `d4a5b323ef85` | Codebase graph; never run its multi-runtime installer |
| AnyDoc | **INTEGRATE** (optional) | `e56a49bf3062` | Ingest Word/PDF specs into planning |
| karpathy skills (skydr1ft) | **REJECT** (copy) → ADAPT principles | — | Non-canonical copy; canonical has no license |
| Ponytail | REFERENCE | — | Minimalism principle adopted in our `simplicity` skill |
| Superpowers | REFERENCE + coexistence detection | — | Aggressive session hook conflicts with our policy precedence |
| mattpocock/skills | REFERENCE / optional import | `5863806dd4e1` | Clean markdown skills |
| Agent Standup | **INTEGRATE** (optional viewer, off by default) | `d7557a74b5c0` | Visualization only; our event log is source of truth |
| Harness_Engineering (ArtemisAI) | REFERENCE (ideas only) | — | No license → no reuse |
| google/artemis | **REJECT** | — | Android UI automation, off-scope |
| harness/harness-skills | **INTEGRATE** (optional CI connector) | `9c274a3c1ceb` | For Harness CI users only |
| RTK | **INTEGRATE** (optional, project-scoped) | `2a786dca60fa` | Token savings; guarded by raw-log + correctness checks |
| PentAGI | **INTEGRATE** (isolated extension, disabled) | `cffed9485aa1` | Only in dedicated VM, no docker.sock, signed scope |
| OmniRoute ("Omniroot"?) | **REJECT** (unverified identity, data egress) | — | Sends source to third-party providers |
| NVIDIA/SkillSpector | **INTEGRATE** (optional 2nd scanner) | to pin | Complements our deterministic auditor |
| planning-with-files | REFERENCE | — | File-based plan persistence idea, adopted in planning contract |
| Security tools (Semgrep CE, Gitleaks, OSV-Scanner, Trivy, Syft/Grype) | **INTEGRATE** via detection (not bundled) | tool versions recorded | Used if present; `doctor` reports missing |
| CodeQL | Optional (license restricts use on non-OSS private code w/o GHAS) | — | Document license constraint |
| OWASP ZAP | Optional DAST, authorized targets only | — | Needs scope file |
| **BULDEE/ai-craftsman-superpowers** | **ADAPT** (practices + patterns; Apache-2.0 allows reuse with attribution if code is ever copied) | `303e43b09625a9ffe34bc7e9ab4d842589a7bd0e` | Adopted: hook-based enforcement ("a prompt asks, this enforces"), one rule engine for hooks+CI+reviewer, measured `host-capabilities.json`, fail-closed exit 0/2 contract, config-protection & git-bypass-guard & test-dismissal-guard patterns, ADR discipline, offline deterministic `tests/` vs paid explicit `evals/` with regex/transcript graders, CLAUDE.md priority hierarchy guide. Not adopted in MVP: content rewriting on write, model-based hooks, SQLite metrics, Grok/Hermes adapters |

## Network profile (ADR-0010, 2026-11-15) — "local except the AIs"
| Integration | Profile | How it stays local | Verified |
|---|---|---|---|
| claude-mem | local (its observer uses the Claude AI provider) | loopback worker only; refused if cloud sync/hosted memory configured | adapter tests; owner's config: cloud sync empty |
| Graphify | local — check whether its semantic extraction calls an LLM provider | `runLocalTool` (no network); LLM mode only through an allowed AI provider | to verify before Phase B |
| Archify | local | rendered by the local skill; generated pages must not load CDN assets in governed mode | to verify before Phase B |
| AnyDoc | local (Rust binary) | `runLocalTool` | to verify before Phase B |
| RTK | local binary (check telemetry) | project-scoped hook; `runLocalTool` for its own calls | to verify before Phase C |
| Agent Standup | local viewer (check CDN assets) | reads Taskquoin event log only | to verify before Phase C |
| Gitleaks, Syft, Semgrep CE (local rules, `--metrics=off`) | local | `runLocalTool` | to verify (R8) |
| Trivy, Grype, OSV-Scanner | local scan, **remote vulnerability DB download** | DB updated in a separate, explicit step; scans run offline | to verify (R8) |
| GitHub, GitLab, Jira, Context7, Harness | **remote-service** | disabled; explicit per-connector exception required (owner decision pending) | — |
| PentAGI | remote/offensive | separate project | — |
