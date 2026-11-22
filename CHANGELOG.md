# Changelog

## Unreleased

### Added
- **npm package** `taskquoin`, built by `npm run package`: compiled JavaScript keeping the repository layout, tested once installed under `node_modules` and under a path with a space. Not on npm yet: the first publish waits for the maintainer's signing key and the npm/GitHub settings (`SECURITY.md`, "Verifying a release").
- **Release provenance**: `.github/workflows/release.yml` publishes to npm with provenance from a tag signed by a key that main's `.github/allowed_signers` lists and that is the commit built, through the protected environment `npm-publish`; the publishing job runs no repository code.
- **CI supply-chain gates**: `npm audit`, registry signatures, gitleaks over the whole history; the npm package installed for real and run.
- **22 languages** for the console and the CLI (`TASKQUOIN_LANG`, otherwise the system locale): English and French by hand, 20 machine-translated languages checked by tests (placeholders, `/commands`, CLDR plurals); columns stay aligned with CJK characters. The planner, the critique and the review write in the run's language. `--json` outputs, the run journal, artifacts, commit trailers, the `VERDICT:` line and the banner's brand stay English.

### Changed
- `taskquoin setup` creates no shortcut for an npm install: npm already put `taskquoin` on the PATH.
- **Claude Code 2.1.327** measured: every live suite rerun with unchanged mechanisms, same results as on 2.1.325 (`docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt`). Claude agents now need 2.1.327; any other version fails closed (`docs/adr/0008`).

### Fixed
- An install path containing a space: the Claude hook entry and the first-party skills were looked up with `%20`.

## 2026.11.1 — 2026-11-17

### Added
- **OpenCode runtime** (`docs/adr/0017`): `runtime: opencode` for planner, implementer and judges, any provider OpenCode supports; the implementer has no command (Taskquoin runs the tests, up to 4 reworks); OpenCode runs in Taskquoin's sandbox (HOME hidden, secrets and the repository's OpenCode config masked, deny-by-default permissions with no `ask`); `taskquoin connect opencode`; `verify.command`; OpenCode 1.19.5 measured and certified live with a ChatGPT sign-in (other sign-ins are refused until measured).

### Fixed
- Reviewers no longer refuse the RED proof of a feature that lives in a new production file (its import error is the expected RED; any other missing file is still no proof).
- The test suite leaves nothing in `/tmp`; CI finds `node` outside `/usr/bin` and reports failed tests as annotations.

## 2026.11.0 — 2026-11-16 — first public release (alpha)

### Added
- **Governed workflow** `taskquoin run`: plan → critique → human approval of the plan (bound to its hash) → implementation in TDD → Verify → review → human approval of the exact diff → commit on `taskquoin/<run>` (never pushed). Automatic rework (up to 2 attempts) when tests are red or a review refuses.
- **Runtimes**: headless Claude Code 2.1.325 and Codex 0.157.1 under a versioned execution contract; per-version capability matrices with enforcement classes (`ENFORCED`, `BROKERED`, `ADVISORY`, `UNSUPPORTED`).
- **Judges by API**: any OpenAI-compatible provider can hold the critique and review roles (`providers` and `workflow` in `taskquoin.yaml`); several judges per role; `Reviewed-By:` trailer; secrets, binaries and keys never sent; `doctor` lists every destination.
- **Verify in a clean room**: your tests run on the exact tree to be committed, without network, dependencies read-only and frozen for agents; **RED proof**: changed tests must fail without the rest of the change.
- **Agents never commit**: Taskquoin builds the commit from the verified, reviewed and approved tree.
- **Commands**: `init` (stack detection, detected AIs proposed), `doctor`, `check`, `accept-risk` (dated, bound to the exact failure, stored outside the repo), `run`, `status [--json]`, `show`, `approve`, `resume`, `skills list|audit|import|approve|revoke`, `setup`, `uninstall`, `version`.
- **Console**: `taskquoin` alone in a terminal opens an interactive shell; approvals require the approver's name and the retyped hash.
- **Skills**: first-party skills pinned by hash (`planning-contract`, `tdd`, `code-review`, `security-review`); local-only import with quarantine and audit.
- **Memory**: optional summary of each finished run sent to a local claude-mem worker.

### Known limitations
- Verified on Linux (WSL2) only; macOS and Windows are untested.
- No automatic push or pull request; no Jira connector; no graphical interface.
- Repository commit hooks are not run by Taskquoin — run them yourself when merging.
- Tests that need network access, files in HOME or secret files fail in Verify (fail closed); repositories with submodules are not supported; Go / Maven / Gradle caches in HOME cannot be resolved offline.
- The RED proof is mechanical: it does not establish that the tests assert the requested behaviour (that is the review's job, and yours).
- Codex's `connector.write` cannot be measured: `doctor` refuses the agent until the owner records a dated `accept-risk`.
- A judge failing for a non-transient reason (invalid key, unknown model, context too long) ends the run after the implementation.
