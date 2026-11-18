# Security Policy

Taskquoin is alpha software. Please report vulnerabilities **privately** with GitHub's *Report a vulnerability* button (Security tab of this repository) — not in a public issue.

## What Taskquoin claims — and does not
- Every restriction compiled for a runtime carries an **enforcement class** (`ENFORCED`, `BROKERED`, `ADVISORY`, `UNSUPPORTED`), measured per runtime version. `taskquoin doctor` prints the effective matrix. A mandatory restriction that is only ADVISORY on your runtime **refuses to compile**.
- Only the AI providers you configure receive code: Anthropic (Claude Code), OpenAI (Codex) and each provider listed under `providers` in `taskquoin.yaml`. `taskquoin doctor` prints that list. API judges never receive secret files, binaries or keys.
- Taskquoin does **not** make a workflow "secure". A scanner PASS or a positive review is a signal, not proof.

## Threat model
See `docs/security/threat-model.md`. **Out of scope:** a hostile process already running as your OS user (it already has your files and credentials). Use a separate user, VM or container if you need that boundary.

## Residual risks
- Tests are code: in Verify they can read host paths the sandbox leaves visible; a secret-*named directory* is not masked (`docs/adr/0014`).
- The RED proof is mechanical (`docs/adr/0013`): production code under `test/`/`tests/` passes as test code; a launch failure exiting with code 1 looks like a test failure; it does not prove the tests assert the requested behaviour.
- Repository commit hooks are not run by Taskquoin.
- Codex's `connector.write` cannot be measured; only the owner can accept that risk (`accept-risk`, dated, stored outside the repository).
- A `taskquoin.yaml` approved by a human can send any environment variable named in `key: env:NAME` to the provider host it lists — review `providers` like code.
- OpenCode agents (`docs/adr/0017`): no command and no network tool (measured), but the OpenCode process keeps the host network to reach its provider (hosts measured per version); its in-process rules keep its read tool off the per-run credential of its own provider; the plugin SDK it loads is installed at connect time.

## Verifying a release
- The npm package `taskquoin` is published by `.github/workflows/release.yml`, in two jobs. `build` has no token and no secret: it checks that the tag is signed by a maintainer SSH key listed in `.github/allowed_signers` **on main** and that the tag is the commit being built, runs the full test suite and `npm audit`, and packs the tarball. `publish` runs no repository code: it publishes that tarball with **npm provenance** — the package's npmjs.com page links the exact commit and workflow run that built it.
- The signature is one layer, not the gate: whoever can push a tag also brings that tag's copy of the workflow. The release relies on settings outside this repository: the GitHub environment `npm-publish` (required reviewer, `v*` tags only) to which the npm trusted publisher is bound, a ruleset restricting who creates `v*` tags, and a protected main (it holds the signer list).
- An installed package: `npm audit signatures` does not support global installs — run it in a throwaway project (`npm init -y && npm install taskquoin@<version> && npm audit signatures`), or read `npm view taskquoin@<version> dist.attestations`.
- A tag, with the signers of main (a tag must not bring its own): `git show origin/main:.github/allowed_signers > /tmp/allowed_signers && git -c gpg.format=ssh -c gpg.ssh.allowedSignersFile=/tmp/allowed_signers verify-tag v<version>`.
- CI runs gitleaks over the whole history (`.gitleaks.toml` allows only the test canaries `CANARY-…`) and `npm audit` on pushes to main and on pull requests; no audit exception is accepted today.
