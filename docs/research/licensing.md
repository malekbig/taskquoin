# Licensing

**Date:** 2026-11-15. Source: GitHub license API + LICENSE file presence. Not legal advice.

| Repo | License | Redistribute? | Notes |
|---|---|---|---|
| agentskills/agentskills | Apache-2.0 | Yes, with NOTICE | Spec reference only |
| vercel-labs/skills | MIT | Yes | Not bundled |
| anthropics/skills | No root license; per-skill | **Per skill** | Document skills (docx/pdf/pptx/xlsx) are source-available, not OSS — do not bundle |
| anthropics/claude-plugins-official | Apache-2.0 + per-plugin | Per plugin | |
| tt-a1i/archify | Apache-2.0 (also LICENSE-MIT present) | Yes | Confirm which governs before bundling; we don't bundle |
| Graphify-Labs/graphify | Apache-2.0 (also LICENSE-MIT) | Yes | Same caveat |
| firecrawl/anydoc | MIT | Yes | |
| skydr1ft/andrej-karpathy-skills | MIT (copy) | **No** — upstream has no license; copy's MIT grant is dubious | |
| DietrichGebert/ponytail | MIT | Yes | |
| obra/superpowers | MIT | Yes | |
| mattpocock/skills | MIT | Yes | |
| Atoll92/agent-standup | MIT | Yes | |
| ArtemisAI/Harness_Engineering | **None** | **No** | All rights reserved |
| google/artemis | Apache-2.0 | n/a | Rejected |
| harness/harness-skills | Apache-2.0 | Yes | |
| rtk-ai/rtk | Apache-2.0 | Yes | |
| vxcontrol/pentagi | MIT (+ `licenses/` dir for deps) | Yes | Not bundled |
| BULDEE/ai-craftsman-superpowers | Apache-2.0 | Yes, with NOTICE/attribution | Patterns re-implemented; if any script is copied, keep header + add to THIRD_PARTY_NOTICES |

**Framework policy:** Taskquoin bundles **no third-party agent/skill code**; its own build will depend on a small, pinned, audited set of npm packages (and, in Phase B, Studio frontend libraries) listed in THIRD_PARTY_NOTICES. Integrations are references + pinned fetch on explicit approval. Framework license proposal: **Apache-2.0** (patent grant, compatible with most integrations). Craftsmanship skills are original text citing books by title; no protected content copied.
