# Compatibility Matrix

**Date:** 2026-11-15. "Native" = runtime reads the artifact directly. "Generated" = Taskquoin renders it from canonical source.

| Capability | Claude Code | Codex CLI (0.157) | Cursor | Copilot | Gemini CLI | OpenCode |
|---|---|---|---|---|---|---|
| Agent Skills (`SKILL.md`) | Native (`.claude/skills/`) | Native (`.agents/skills/`) | Native | Native (`.github/skills`) | Native | Native |
| Project instructions | `CLAUDE.md` | `AGENTS.md` | `AGENTS.md` / rules | `AGENTS.md` / `copilot-instructions.md` | `GEMINI.md` | `AGENTS.md` |
| Sub-agents | Native (`.claude/agents/*.md`) | Native (profiles / multi-agent) | Limited | Custom agents | Limited | Native |
| Permissions | `settings.json` allow/deny/ask (project scope) | `sandbox_mode` + `approval_policy` (project `.codex/config.toml`) | UI | UI | settings | config |
| Hooks | Native (Pre/PostToolUse, Stop…) | Hooks (newer versions) | Partial | No | Partial | Plugins |
| MCP | `.mcp.json` (project) | `config.toml [mcp_servers]` | `.cursor/mcp.json` | `.vscode/mcp.json` | settings | config |
| Headless run | `claude -p` (+ `--output-format stream-json`) | `codex exec` (+ `--json`) | No (CLI beta) | No | `gemini -p` | `opencode run` |
| MVP support | **Yes** | **Yes** | Generated skills only | Generated skills only | Later | Later |

Integration compatibility:

| Integration | Claude | Codex | Notes |
|---|---|---|---|
| Archify | Skill | Skill | Agent Skills format |
| Graphify | CLI + skill | CLI + skill | Use CLI output (JSON) |
| RTK | PreToolUse hook | Codex hook / wrapper | Claude path most mature |
| Agent Standup | Plugin | Session-file reader | Viewer only |
| PentAGI | External service | External service | Not a runtime extension |
