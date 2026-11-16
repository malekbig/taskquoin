# Security Policy

Taskquoin 2026.11.0 is alpha software. Please report vulnerabilities **privately** with GitHub's *Report a vulnerability* button (Security tab of this repository) — not in a public issue.

## What Taskquoin claims — and does not
- Every restriction compiled for a runtime carries an **enforcement class** (`ENFORCED`, `BROKERED`, `ADVISORY`, `UNSUPPORTED`), measured per runtime version. `taskquoin doctor` prints the effective matrix. A mandatory restriction that is only ADVISORY on your runtime **refuses to compile**.
- Only the AI providers you configure receive code: Anthropic (Claude Code), OpenAI (Codex) and each provider listed under `providers` in `taskquoin.yaml`. `taskquoin doctor` prints that list. API judges never receive secret files, binaries or keys.
- Taskquoin does **not** make a workflow "secure". A scanner PASS or a positive review is a signal, not proof.

## Threat model
See `docs/security/threat-model.md`. **Out of scope:** a hostile process already running as your OS user (it already has your files and credentials). Use a separate user, VM or container if you need that boundary.

## Residual risks (2026.11.0)
- Tests are code: in Verify they can read host paths the sandbox leaves visible; a secret-*named directory* is not masked (`docs/adr/0014`).
- The RED proof is mechanical (`docs/adr/0013`): production code under `test/`/`tests/` passes as test code; a launch failure exiting with code 1 looks like a test failure; it does not prove the tests assert the requested behaviour.
- Repository commit hooks are not run by Taskquoin.
- Codex's `connector.write` cannot be measured; only the owner can accept that risk (`accept-risk`, dated, stored outside the repository).
- A `taskquoin.yaml` approved by a human can send any environment variable named in `key: env:NAME` to the provider host it lists — review `providers` like code.
- OpenCode agents (`docs/adr/0017`): no command and no network tool (measured), but the OpenCode process keeps the host network to reach its provider (hosts measured per version); its in-process rules keep its read tool off the per-run credential of its own provider; the plugin SDK it loads is installed at connect time.
