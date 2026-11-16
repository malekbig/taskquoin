# Security Assessment

**Date:** 2026-11-15 · **Scope:** static metadata + selected files. No execution. A PASS here is one signal, never proof of safety.

## Risk scale
- **R1 Low** — markdown-only instructions, no hooks/scripts/network.
- **R2 Moderate** — scripts or hooks present but scoped; local only.
- **R3 High** — persistent hooks that inject instructions or rewrite commands, installers piping network content, transcript access.
- **R4 Critical** — privileged container access, autonomous offensive capability, or exfiltration of code to third parties.

## Findings

| Repo | Risk | Evidence | Concern | Mitigation in framework |
|---|---|---|---|---|
| agentskills/agentskills | R1 | Spec + docs; dev-only hook | None for consumers | Use spec as validation reference, no code import |
| vercel-labs/skills | R2 | `npx skills add` fetches from network and writes into runtime dirs | Unpinned installs, global writes | Do **not** wrap. Our installer pins SHA, writes project-local only |
| anthropics/skills | R2 | Some skills ship Python scripts; mixed licenses | Script execution; license | Reference; per-skill import only after audit |
| anthropics/claude-plugins-official | R2–R3 (per plugin) | hooks.py/hooks.sh in some plugins; `.mcp.json` per external plugin | Each plugin is its own trust unit | Treat as catalog; each plugin independently QUARANTINED |
| tt-a1i/archify | R2 | JS renderer, SECURITY.md present | Renders codebase content into HTML | Optional; local-only rendering |
| Graphify-Labs/graphify | R2–R3 | `install.py` writes integrations into multiple runtimes | Writes outside project if run with defaults | Invoke analysis CLI only; never run its installer from our tool |
| firecrawl/anydoc | R2 | Native Rust binary | Binary provenance | Optional, checksum-pinned |
| skydr1ft/andrej-karpathy-skills | R2 (provenance) | 1-star copy of a famous repo | **Impersonation/typosquat pattern** | BLOCKED; principles re-written first-party |
| DietrichGebert/ponytail | R2 | Skills + band UI hook | Conflicting "minimal code" directives with TDD rigor | Reference principles only |
| obra/superpowers | R3 | SessionStart hook injects "EXTREMELY_IMPORTANT" instructions | Overrides user/agent priorities; conflicts with other frameworks | Not bundled. Document coexistence; detect & warn in `doctor` |
| mattpocock/skills | R1 | Markdown skills | Low | Reference / optional import after audit |
| Atoll92/agent-standup | R3 | Hooks + reads session transcripts | Transcripts contain secrets/prompts | Optional, disabled; our own redacted event log is the source |
| ArtemisAI/Harness_Engineering | R3 + license | Bash guard hooks, 4 MCP configs, pty-mcp-server; **no license** | Cannot legally redistribute; PTY MCP = shell access | Reference ideas only; no code reuse |
| google/artemis | n/a | Android automation | Off-scope | Reject |
| harness/harness-skills | R2 | Targets Harness SaaS APIs | Requires SaaS creds | Optional CI connector, disabled by default |
| rtk-ai/rtk | R3 | `curl \| sh` (verifies release SHA-256), PreToolUse hook **rewrites Bash commands** | Rewriting can hide errors; hook is global if installed via its own installer | Optional; project-scoped hook only; raw-log retention; auto-disable on exit-code mismatch |
| vxcontrol/pentagi | **R4** | `docker.sock` mount + `user: root:root` in compose | Container escape = host root; autonomous offensive agent | Disabled by default. Only in a dedicated VM, rootless Docker / no socket, network allowlist, signed scope file, human approval |
| OmniRoute (unverified "Omniroot") | R4 | Gateway to 375 third-party providers | Source code sent to unknown providers | Excluded; never default |
| NVIDIA/SkillSpector | R2 | Scanner | Scanner is itself third-party code | Optional external scanner, run in container |
| BULDEE/ai-craftsman-superpowers | R2–R3 | 19 bash/python hooks incl. PreToolUse **deny (exit 2)**, `pre-write-check.sh` rewrites pending content via `updatedInput` (adds `strict_types`), `agent-*.sh` spawn headless `claude -p` (Haiku) when `agent_hooks` enabled, writes SQLite metrics under plugin data + 2 bridge files under `~/.claude`; no network from hooks (per SECURITY.md, not fully re-verified) | Hooks are powerful by design; content rewriting on write is a strong intervention; writes under `~/.claude` touch user scope | **Practices adopted, code not bundled.** Hooks re-implemented first-party, exit 0/2 only, no content rewriting in MVP, no writes outside project + control store |

## Framework threat model (STRIDE summary)

| Threat | Example | Control |
|---|---|---|
| **S**poofing | Copy-cat skill repo (see karpathy copy) | Owner allowlist + SHA pin + human approval; popularity ignored |
| **T**ampering | Upstream force-push after approval | Pin to commit SHA + content hash (sha256 of normalized tree) in `skills.lock`; re-verify on every sync |
| **R**epudiation | "Who approved this skill?" | Append-only JSONL audit log with approver, timestamp, hash |
| **I**nfo disclosure | Skill instructs agent to read `~/.aws`, `.env` | Auditor rules + Claude/Codex deny rules on secret paths; WSL symlinks to Windows creds noted |
| **D**oS / cost | Runaway multi-agent fan-out | Risk-tiered workflows, max-agents & budget per run |
| **E**levation | Skill text "ignore previous policy", hooks editing `~/.claude/settings.json` | Policy precedence: framework policy > project config > skill content; auditor blocks writes to global config paths |
| Prompt injection via tool output | Jira ticket or MCP response with instructions | Connector outputs wrapped as untrusted data; write tools require approval |

## Policy precedence (immutable order)
1. Framework built-in security policy (cannot be lowered by lower layers)
2. Organization profile (e.g. `security-strict`)
3. Project `taskquoin.config.yaml`
4. Workflow definition
5. Agent definition
6. Skill content (untrusted, never grants permissions)
