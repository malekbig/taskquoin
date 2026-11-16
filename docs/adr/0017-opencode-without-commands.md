# ADR-0017: OpenCode for the acting roles, without commands (project B, step 1)

## Status
Accepted — design approved by the maintainer on 2026-11-16; measured and certified the same day
(`docs/reports/evidence-live-opencode-2026-11-16.txt`).

## Context
ADR-0016 opened the judging roles to any OpenAI-compatible AI. Planning and implementing still required Claude Code
(or Codex). OpenCode is an open-source coding agent that talks to many providers (ChatGPT sign-in, GitHub Copilot, API
keys, local Ollama / LM Studio). It has **no OS sandbox**: its permissions are in-process checks and its shell runs
with the user's full rights (`docs/reports/opencode-interface-1.19.5.md`).

## Decision
1. `runtime: opencode` for every role, with `model: <provider>/<model>` and only `fs.read` / `fs.write`. The
   implementer has **no command**: Taskquoin runs the tests (`verify.command`, clean room, RED proof) and returns the
   log; up to 4 reworks when Taskquoin's tests fail, still 2 when reviewers refuse.
2. OpenCode runs in Taskquoin's bubblewrap profile: HOME hidden, project secrets and instruction files masked, the
   repository's OpenCode config masked and protected, `.git` and frozen paths read-only, the host network kept (it
   must reach its provider; no tool uses the network — measured).
3. A generated config with no path to `ask` (deny by default, then read/list/glob/grep, edit for a writer, secrets and
   protected config denied); no update, sharing, LSP, formatter, MCP or external plugin.
4. Taskquoin's own OpenCode connection (`taskquoin connect opencode`), one per user; each run gets throw-away dirs
   holding only its provider's credential, the models catalogue and the plugin SDK fetched at connect time.
5. Version pinned and measured (OpenCode 1.19.5); hosts measured per provider and sign-in type (`hosts.json`). Only a
   measured provider/sign-in pair is certified (today: ChatGPT sign-in); any other is refused until measured. A host
   outside the provider that cannot be cut would make `net.egress` ADVISORY for that version — the maintainer decides
   with `accept-risk`; none was found.
6. Found by the live demo, for every runtime: reviewers accept an import error of a production file the change ADDS as
   the expected RED for new code (any other missing file is still no proof).

## Consequences
- A developer with only a ChatGPT subscription runs the whole governed workflow; API keys, Copilot and local models
  follow once their hosts are measured.
- Slower convergence than an implementer that runs its own tests (step 2 will add sandboxed commands).
- Residuals: OpenCode's in-process rules are what keeps its read tool off the per-run credential file of its own
  provider; the plugin SDK (npm package, installed at connect time) runs in-process; `maxTurns`
  (`agent.build.steps`) is documented, not measured; a ChatGPT sign-in accepts only some models.
