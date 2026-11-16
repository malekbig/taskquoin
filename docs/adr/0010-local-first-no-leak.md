# ADR-0010: Local-first, no leaks — only the AI providers receive data

## Status
Accepted (maintainer decision, 2026-11-15: every tool runs locally except the AI providers; nothing may leak)

## Decision
1. **Allowed egress** for a governed run: the AI providers used by the runtimes (Anthropic for Claude Code, OpenAI for Codex). Nothing else by default.
   *Since ADR-0016*: a project may add judges reached through an OpenAI-compatible API — each provider explicitly listed
   under `providers:` in `taskquoin.yaml` (protected file) is the project's explicit exception; `doctor` lists every
   destination; secrets and binaries are never put in a judge prompt.
2. **Runtimes' non-essential traffic is off**: Claude `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DISABLE_AUTOUPDATER=1`; Codex `analytics.enabled=false`, `otel.exporter="none"`, `web_search="disabled"`, plugins/apps/browser/computer-use off.
3. **Subprocesses have no network**:
   - Claude: Bash runs in Claude Code's native OS sandbox (`sandbox.enabled`, empty `network.allowedDomains`, `filesystem.allowWrite` = granted roots, `allowUnsandboxedCommands: false`, **`failIfUnavailable: true`**). Without bubblewrap + socat the run is refused (measured).
   - Codex: `workspace-write` with `network_access=false`; read-only has no network.
4. **Local tools Taskquoin runs itself** (scanners, Graphify CLI, AnyDoc, RTK…) go through `runLocalTool`: a fresh user + network namespace (`unshare -rn`) — not even loopback (measured offline: 0 hits vs 1 for the positive control). If isolation is unavailable, the tool is not run.
5. **Every integration declares a network profile** (`local`, `ai-provider`, `remote-service`) and is verified before activation. `remote-service` integrations (GitHub, GitLab, Jira…) are disabled and need an explicit, per-connector exception — decision pending with the owner.
6. **Fail closed**: an unknown Codex config key fails the run (`--strict-config`); a missing sandbox refuses the run; an unverifiable claude-mem configuration disables memory.
7. **Config typos and silent fallbacks are leaks**: every mechanism above has a test.

## Honest limits
- The AI providers receive the code and prompts sent to them — by definition of the exception.
- Model-side tools of the runtimes are disabled by flags we verified; the inventory evidence for Codex is a model self-report.
- Same-OS-user hostile processes remain out of scope (ADR-0007).
