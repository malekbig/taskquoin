# Repository Inventory

**Assessment date:** 2026-11-15
**Method:** GitHub REST API (metadata, default-branch HEAD, recursive tree listing) + targeted raw-file reads.
**Limits:** No code was cloned or executed. Transitive dependency analysis, issue triage and release-signature checks were **not performed** in this pass (see "Checks not performed"). SHAs are the default-branch HEAD on the assessment date; they are *candidate pins*, not approvals.

## Requested repositories

| # | Repository | Canonical? | License (API) | Stars | Last push | Lang | HEAD SHA (candidate pin) | SECURITY.md | Notable surface |
|---|---|---|---|---|---|---|---|---|---|
| 1 | agentskills/agentskills | Yes — spec owner | Apache-2.0 | 27.3k | 2026-11-04 | Python | `83021e2be457` | No | `.claude/hooks/session-start.sh` (repo-internal dev hook) |
| 2 | vercel-labs/skills | Yes | MIT | 39.4k | 2026-11-12 | TS | `b716f9dc2ba3` | No | `npx skills` installer (network, writes into agent dirs) |
| 3 | anthropics/skills | Yes | **None at repo root** (per-skill licenses; some document skills are source-available, not OSS) | 195k | 2026-11-14 | Python | `1780c5e5a552` | No | 20 SKILL.md, scripts in some skills |
| 4 | anthropics/claude-plugins-official | Yes | Apache-2.0 (directory); external plugins carry own licenses | 47.4k | 2026-11-14 | Python | `b5b01ac4f889` | Per-plugin | 57 skills, hooks (`claude-security/hooks/*`), many `.mcp.json` |
| 5 | tt-a1i/archify | Yes | Apache-2.0 (+ LICENSE-MIT file) | 96.6k | 2026-11-15 | JS | `a7ed6fd6657d` | Yes | 5 skills, diagram renderer |
| 6 | Graphify-Labs/graphify | Yes | Apache-2.0 (+ LICENSE-MIT file) | 148k | 2026-11-14 | Python | `d4a5b323ef85` | Yes | `graphify/install.py` writes per-runtime integrations |
| 7 | firecrawl/anydoc | Yes | MIT | 23.5k | 2026-11-13 | Rust | `e56a49bf3062` | No | Native binary, 1 skill; local conversion |
| 8 | skydr1ft/andrej-karpathy-skills | **No — 1-star copy**. Canonical lineage: `forrestchang/andrej-karpathy-skills` (now surfaced as `multica-ai/andrej-karpathy-skills`, 233k, no license) | MIT (copy) / None (upstream) | 1 | 2026-08-18 | — | `0726f8a19c2b` | No | 8 skills, plugin.json |
| 9 | DietrichGebert/ponytail | Yes | MIT | 191k | 2026-10-29 | JS | `96608e078b2d` | No | 13 skills, Claude + Codex plugin manifests, `hooks/band/*.ts` UI hook |
| 10 | obra/superpowers | Yes | MIT | 318k | 2026-11-03 | Shell | `22f0b463e7a5` | No | SessionStart hook injecting instructions, 15 skills |
| 11 | mattpocock/skills | Yes | MIT | 325k | 2026-11-13 | Shell | `5863806dd4e1` | No | 39 skills |
| 12 | Atoll92/agent-standup | Yes | MIT | 375 | 2026-11-15 | HTML | `d7557a74b5c0` | No | Claude plugin + hooks reading session transcripts |
| 13 | ArtemisAI/Harness_Engineering | Yes (template) | **None** → all rights reserved | 14 | 2026-02-28 | Shell | `3c7cfab4250b` | No | `.claude/hooks/*.py`, 4× `.mcp.json`, pty-mcp-server |
| 14 | google/artemis | Yes | Apache-2.0 | 17.5k | 2026-10-01 | Python | `351ca8422f7b` | No | **Android UI automation** — not an agent-orchestration tool |
| 15 | harness/harness-skills | Yes (Harness Inc.) | Apache-2.0 | 134 | 2026-11-12 | Python | `9c274a3c1ceb` | No | 74 skills, Codex + Cursor plugin manifests; targets Harness SaaS |
| 16 | rtk-ai/rtk | Yes | Apache-2.0 | 86.6k | 2026-11-14 | Rust | `2a786dca60fa` | Yes | `curl \| sh` installer (verifies SHA-256 of release), `PreToolUse` rewrite hook for Bash |
| 17 | vxcontrol/pentagi | Yes | MIT | 34.2k | 2026-11-13 | Go | `cffed9485aa1` | No | docker-compose mounts **`/var/run/docker.sock`** and runs `user: root:root` |
| 18 | BULDEE/ai-craftsman-superpowers *(added on user request)* | Yes | Apache-2.0 | 35 | 2026-11-02 | Shell/Py | `303e43b09625a9ffe34bc7e9ab4d842589a7bd0e` | **Yes** (detailed: lists every hook, event, what it writes) | 19 command hooks / 12 events, 12 agents, 22 skills, `bin/craftsman-*`, CI adapters (GitHub/GitLab/Jenkins/Bitbucket), 31 ADRs, evals with graders, `host-capabilities.json` measured per runtime version; Claude + Codex + Grok + Hermes |

## Discovered / disambiguated

| Requested name | Resolution | Status |
|---|---|---|
| Omniroot | No credible "Omniroot" agent framework. Most likely **OmniRoute** (`cheaper-inference/OmniRoute`, MIT, 87.6k) — an AI gateway routing to 375 providers. Other hits: rootkit detector, 5-star LangChain agent. | **UNVERIFIED** — likely OmniRoute; excluded |
| Codex Planning | No canonical project. Codex has native plan mode. Community: `OthmanAdi/planning-with-files` (MIT, 28k), `maxkura/Ask_Why` (MIT, 117). | Native Codex capability preferred; community = REFERENCE |
| Artemist | Not found as distinct project. `google/artemis` is Android automation. | **UNVERIFIED** |
| Agent Standup alternatives | Claude Code native status line / hooks; OpenTelemetry export from Claude Code; `claude-mem` standup skill. | REFERENCE |
| DDD / Clean / Hexagonal / Uncle-Bob skills | `ciembor/agent-rules-books` (MIT, 3.3k), `luckys/agent-skills` (MIT, 6), `aligundogdu/symfony-hexagonal-skill` (no license), `dev-toolings/superpowers-symfony` (MIT). | REFERENCE only; write first-party originals |
| Mutation / contract testing skills | Only low-signal repos (<20 stars). | Write first-party |
| Threat-modeling skills | `inerthel-agi/security-hardening` (Apache-2.0, 7), `ridges0315/security-audit` (no license). | Write first-party (STRIDE) |
| Skill supply-chain security | **`NVIDIA/SkillSpector`** (Apache-2.0, 26k) — scanner for agent skills; `getagentseal/agentseal` (NOASSERTION). | SkillSpector = INTEGRATE candidate (optional scanner) |

## Checks not performed (honest gaps)

- Release signature / provenance (Sigstore, SLSA) verification.
- Transitive dependency vulnerability scan (requires cloning + OSV-Scanner).
- Line-by-line review of every hook and script (only presence and selected lines inspected).
- Issue tracker review for open security reports.
- Star counts are not evidence of safety (requirement #20); several counts look anomalous for repo age and were not used in decisions.
