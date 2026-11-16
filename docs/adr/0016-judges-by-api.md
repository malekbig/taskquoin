# ADR-0016: Any AI can judge — text-only judges through an OpenAI-compatible API (multi-LLM, project A)

## Status
Accepted — the maintainer approved the design on 2026-11-16, with one goal: Taskquoin must work for every developer
who uses AI, with the AIs they already have.

## Date
2026-11-16

## Context
Taskquoin only knew Claude Code and Codex. A developer arrives with *their* AIs (a Claude or ChatGPT subscription, a
DeepSeek / Mistral / Gemini / OpenRouter key, a local Ollama). Roles that **judge** (plan challenge, diff review,
security review) only need text in and a verdict out; roles that **act** (planner, implementer) need a certified agent
with tools (project B: OpenCode).

## Decision
1. New runtime `api` (`adapters/runtime-api`): one `POST <url>/chat/completions` per judgement — system + user messages,
   the configured token field, `stream:false`; no tools, no temperature; redirects refused; 429/5xx/timeouts retried
   twice then the run is **interrupted** (resumable, judges that already answered are not asked again).
2. Certified **by construction** (no tool path): every capability ENFORCED for an api judge, which may hold no
   capability, and is never `planner` or `implementer`.
3. **Consent is the project's**: only providers listed under `providers:` in `taskquoin.yaml` (a protected file) receive
   code; https only (http only on loopback); the key is a reference `env:NAME`, read at call time, never written, logged
   or shown. `init` only *suggests* detected AIs as commented lines; uncommenting them is the consent.
4. `workflow.challengers` / `workflow.reviewers`: every reviewer must give a strict APPROVE; a missing key stops the run
   before anything is created.
5. **No secret, no binary in any judge prompt** (Codex included): secret-named files and binary changes are replaced by
   placeholders; the human still approves the full diff. Text-only judges also get the changed files' new text, within
   the provider's `maxInputChars`.

## Consequences
### Positive
- Any OpenAI-compatible model (and local Ollama) can review; a real Security role; nothing changes for existing projects.
- `doctor` lists every destination of the project's code.
### Negative
- API keys are pay-per-use (subscriptions are not); a provider's free tier may train on what it receives.
- A text-only judge cannot open the repository: it judges the diff and the changed files only.
- Retries wait up to ~10 s before a run is interrupted.

## Evidence / references
`adapters/runtime-api/test/executor.test.ts` (request shape, no tools, redirect refused, retries, key never exposed,
matrix through prepareRun); `packages/config/test/config.test.ts`; `packages/application/test/workflow.test.ts`
(all reviewers must approve, resumable per judge, masked diff); `features/juges-api.feature` (5 scenarios with a fake
provider in its own process — no secret or binary ever sent); `tests/live-api.e2e.test.ts` (optional, owner's key).
