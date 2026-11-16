# ADR-0011: Agents never commit; the orchestrator commits after verification

## Status
Accepted (forced by measurement, 2026-11-15)

## Context
With Claude Code's native Bash sandbox (ADR-0010), `.git` is read-only for subprocesses even when listed in `sandbox.filesystem.allowWrite` (measured: `.git/index.lock: Read-only file system`). Codex's sandbox also refuses writes to `.git` (R1.1). Letting agents commit would also let them decide what "done" is.

## Decision
Agents produce changes in the working tree; they never create commits or push. The workflow's Verify node runs the declared checks on the host; on success, the orchestrator commits (author: the owner's git identity, trailer: run id) and pushes only through the Action Broker with a bound approval (ADR-0004). `vcs.commit` / `vcs.push` grants are therefore not given to agents in the default profile.

## Consequences
- Positive: a commit always means "verified by Taskquoin", never "claimed by a model"; `--no-verify` style bypasses are moot inside agents (GIT001 stays as defense in depth).
- Negative: agents cannot build multi-commit histories themselves; the orchestrator squashes per task.
