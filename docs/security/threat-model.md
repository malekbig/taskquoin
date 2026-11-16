# Threat Model v2

**Date:** 2026-11-15 · Scope: Taskquoin control plane, compiled runtime configuration, headless runs, Action Broker, skill supply chain. Replaces the STRIDE summary of `docs/research/security-assessment.md`.

## Assets
A1 Workspace source · A2 User credentials (runtime auth, connector tokens, `~/.ssh`, `~/.aws`, WSL `/mnt/c/Users/*`) · A3 Control-plane state (policy, approvals, skills.lock, audit, broker journal) · A4 External systems reachable via connectors (GitHub, Jira) · A5 Compiled runtime configuration (`.claude/`, `.codex/`, `CLAUDE.md`, `AGENTS.md`) · A6 Approval evidence.

## Attacker classes

| # | Attacker | Vector | In scope | Primary controls |
|---|---|---|---|---|
| T1 | Malicious / compromised **skill** | Instructions, scripts, hooks, MCP declarations in SKILL.md tree | Yes | Quarantine outside workspace; safe extraction; tree hash; deterministic auditor; human approval; compiled copies revocable; capability ceiling of the agent still applies |
| T2 | Malicious **repository content** (tests, package scripts, build tools, lint configs, hooks) | Executes when the agent runs `npm test`, `composer install`… | Yes (bounded) | Codex: OS sandbox (fs + no network) = ENFORCED. Claude: ADVISORY on host → compile warns; `profile: container` (Phase B) for ENFORCED. Control plane outside workspace; `config-protection` hook |
| T3 | Injected **tool / connector output** (issue body, PR comment, web page, MCP response) | Persuades the model to act | Yes | Containment: no write credentials in agent; broker + bound approval; immutable artifacts; Verify node independent of model claims; eval metric = unauthorized effects |
| T4 | Compromised **MCP server / connector** | Over-broad credential, malicious tool schema | Yes | Read-only servers only for agents; fine-grained tokens per connector; reviewed tool-schema snapshot; `--strict-mcp-config` |
| T5 | **Browser-origin** attack on Studio (Phase B) | DNS rebinding, CSRF, XSS via hostile markdown | Yes (Phase B) | Host validation, origin allowlist, auth on every route incl. SSE, no state-changing GET, CSP, token not in URL |
| T6 | **Misconfiguration** by the user/team | Mandatory rule mapped to advisory; untrusted hooks; wrong runtime version | Yes | Enforcement classes fail compile; `doctor` preflight; supported-version pinning |
| T7 | **Hostile process running as the same OS user** | Reads/writes anything the user can | **No** | Documented residual risk. Owner decision ADR-0007 §3. Use OS-level isolation (separate user, VM, container) if required |

## Trust boundaries
B1 Model process ⇄ host filesystem (runtime sandbox / hooks) · B2 Workspace ⇄ control-plane store (`$XDG_STATE_HOME`) · B3 Agent ⇄ external systems (Action Broker) · B4 Quarantine ⇄ approved skills · B5 Taskquoin process ⇄ runtime CLIs (ExecutionContract, env allowlist).

## Non-claims
Taskquoin does not make a workflow "secure". It makes each restriction's enforcement class explicit, refuses to compile mandatory restrictions it cannot enforce, and keeps side effects behind bound approvals. A scanner PASS is a signal, not proof.
