# Changelog

## Unreleased

### Added
- **Console V2 foundations** (`docs/adr/0019`, native ANSI, no dependency): one neutraliser for every string that comes from outside (an agent, a file name, a diff, the network, a config value) — each control, escape, C1, bidirectional or invisible character becomes a visible marker and is counted, never stripped silently; `--json` goes through its own `jsonOut` (escapes only DEL, C1, bidirectional controls and U+2028/2029, so Persian text, emoji and tag flags stay byte-identical); a read-only way to open the control store and a tolerant reader of `events.jsonl` (it reads only the tail); terminal capabilities and design tokens (colour depth, `NO_COLOR`, ASCII fallback, light and dark); a screen that always gives the terminal back (Ctrl+C, SIGTERM, SIGHUP, errors) and a raw key decoder; `RunView` and `SquadView`, the run and the squad projected once for every screen; `agent.started`, duration, model and tokens in the event log.
- **Console V2**: a new home (quoin logo, repository and branch, sandbox, policy digest, the squad with each agent's real verdict, the next action; Full, Compact or Minimal by terminal size), a categorised `/` menu with contextual completion, suggestions and `/help <command>`, a per-repository command history, a prompt that shows a waiting approval, a live timeline that follows the real state machine, `/approve` showing what is bound, what to read and what you read, and the new screens in the 22 languages.
- **The Dashboard** (`taskquoin dashboard [<run>]`, `/dashboard`; guide `docs/guides/dashboard.md`): a live screen that only reads the control store — Pipeline, Approvals, Runs, Agents and Events in a wide, stacked or narrow layout (one message below 40 × 12), refreshed by a 500 ms poll of file stamps, with nothing drawn when nothing changed. A diff and artifact viewer with line numbers, search, `n` / `N`, "read to the end" and a stale marker when the tree under review changes. An approval center where no key approves: you type your name, retype the 12 characters of the hash, the binding is read again at each step and a stale gate is refused; the approval itself is done by `taskquoin approve` in a separate process (private log; the run continues when you quit, and the Dashboard says so). Read-only is tested under `node --permission`; every text from outside is neutralised and counted; without a terminal it refuses and points to `taskquoin status`. The guide's screens exist in 22 languages.
- **npm package** `taskquoin`, built by `npm run package`: compiled JavaScript keeping the repository layout, tested once installed under `node_modules` and under a path with a space. Not on npm yet: the first publish waits for the maintainer's signing key and the npm/GitHub settings (`SECURITY.md`, "Verifying a release").
- **Release provenance**: `.github/workflows/release.yml` publishes to npm with provenance from a tag signed by a key that main's `.github/allowed_signers` lists and that is the commit built, through the protected environment `npm-publish`; the publishing job runs no repository code.
- **CI supply-chain gates**: `npm audit`, registry signatures, gitleaks over the whole history; the npm package installed for real and run.
- **22 languages** for the console and the CLI (`TASKQUOIN_LANG`, otherwise the system locale): English and French by hand, 20 machine-translated languages checked by tests (placeholders, `/commands`, CLDR plurals); columns stay aligned with CJK characters. The planner, the critique and the review write in the run's language. `--json` outputs, the run journal, artifacts, commit trailers, the `VERDICT:` line and the banner's brand stay English.
- **A measured Claude Code runs, and `/upgrade`** (`docs/adr/0018`): when Claude Code auto-updates to an unmeasured version but the measured one is still installed by Claude's native installer, Taskquoin uses it; the banner and `doctor` say which version runs. `taskquoin upgrade [auto|path|install] [--offline]` and `/upgrade` show installed / used / measured versions, switch the choice (machine preference), reinstall the measured Claude Code after a typed yes (your own Claude, outside the repository, over the network), print the Codex and OpenCode commands when those tools are installed with another version, and, only on demand, read the npm registry for a newer Taskquoin. A measured Claude Code that is installed but not used is named with the reason and the command that fixes it. The reinstall runs only in an absolute home, only the exact command shown, and exits 1 when the installer fails. The gate is unchanged.

### Changed
- `taskquoin setup` creates no shortcut for an npm install: npm already put `taskquoin` on the PATH.
- **Claude Code 2.1.327** measured: every live suite rerun with unchanged mechanisms, same results as on 2.1.325 (`docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt`). Claude agents now need 2.1.327; any other version fails closed (`docs/adr/0008`).

### Fixed
- An install path containing a space: the Claude hook entry and the first-party skills were looked up with `%20`.
- **A refused run costs nothing**: `run` checks the gate of every agent the workflow will call (planner, implementer, every challenger and reviewer) before the planner is called and before the run branch exists. The line after the refusal names the remedy: `taskquoin upgrade` for an unmeasured runtime version, `accept-risk` only for a read-only agent (one line per capability), the configuration (`shell.run`, `verify.command`) for an implementer without commands. A runtime that is not installed is said as such.
- **A test command that cannot run is not red tests**: an exit of 126 or more (not found, not executable, a crash), a kill other than the timeout or a sandbox that did not start stops the run once with `needs-human … Verify could not run the test command (exit <n>): <first line>`, without spending the reworks. A timeout is still red tests.
- **A killed run can be resumed**: a run whose Taskquoin process was killed is shown `interrupted` with the reason `process gone (the run was killed)` (English in every language, `--json` included), and `resume` records the interruption and continues at the same node. The workspace baseline is saved before the first implementer starts, so a run killed during its implementation still detects what the killed attempt changed (ADR-0014). The lock of a dead process is taken over under a second lock; a live lock is never displaced, and a takeover that was itself killed is never cleared automatically: the command names the file to delete.
- `taskquoin run Add a sum function` without quotes takes the whole request; `uninstall --purge-state` purges the control store even after a previous `uninstall`; `init` on an unrecognised stack says to set `verify.command` (and `shell.run`, except for an OpenCode implementer); `status <run> --json` has a `reason` field.

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
