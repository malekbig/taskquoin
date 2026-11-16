# Changelog

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
