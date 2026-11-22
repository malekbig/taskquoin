# ADR-0018: Run a measured runtime version, and `/upgrade`

## Status
Accepted — design approved by the maintainer on 2026-11-22 (the design of 2026-11-22).

## Context
Claude Code updates itself. On 2026-11-22 it moved from 2.1.327 (measured by Taskquoin) to 2.1.330 (not measured).
From then on `doctor` reported that only one agent of three could run: Architect and Developer were refused, which is
correct under ADR-0002 and ADR-0008 (a proof holds for one exact version). Every user would hit the same stop at each
Claude Code update. Claude's native installer keeps the previous versions side by side
(`~/.local/share/claude/versions/<version>`), while Taskquoin took whichever `claude` the PATH offered.

## Decision
1. **The gate is unchanged**: a governed agent runs only the exact version in the capability matrix. Nothing in the
   matrix, the gate ticket or the executor changes; the executor still re-reads the version before each run.
2. **Binary selection** (`adapters/host-probe/src/probe.ts`). The candidates for `claude` are the PATH binary and the
   file `$HOME/.local/share/claude/versions/<measured version>`. If the PATH version is measured, it is used as before.
   Otherwise, with the machine preference `auto` (default) and a trusted second candidate, that one is used and the
   probe keeps the PATH binary as `installed` for display. Otherwise the PATH binary is used and refused as before,
   with the remedy `/upgrade`. The second candidate must be a regular file (no link), executable, owned by the current
   user, neither it nor its directory writable by group or others, named with the exact measured version, and its
   `--version` must answer that version. The choice (`auto` or `path`) lives in the machine's `preferences.json`,
   never in `taskquoin.yaml`: a repository cannot choose the binary. When that file is there but not used, the probe
   keeps it as `claudeCandidate` with the reason (`link`, `not a file`, `parent not a directory`, `not executable`,
   `not owned`, `writable by others`, `unreadable`, `version mismatch`, `selection path`), also when no `claude` is on
   the PATH; only a path that does not exist (ENOENT, ENOTDIR) counts as missing. `HOME` comes from one helper
   (`absoluteHome`): `$HOME` when absolute, else the account's home when absolute, else none — and then no candidate.
3. **What the user sees** (`apps/cli/src/runtime-notices.ts`, console banner, `doctor`, the `/upgrade` table): one
   banner line stating the installed and the used version and why; a `doctor` line
   `Runtime claude: installed X (not measured) → using Y (measured) (<path>)`; and a required-action line when the
   measured version is not used, with the one command that fixes it — `Claude Code Y is installed but not used:
   <reason> — run <command>` (`chmod go-w <dir> <file>` for a file or folder writable by others, `upgrade auto` for
   the PATH-only choice, `upgrade install` otherwise), or `X is not measured and Y is not installed` with
   `upgrade install`. The console says `/upgrade …`, the shell (`doctor`, `taskquoin upgrade`) `taskquoin upgrade …`.
4. **`taskquoin upgrade [auto|path|install] [--offline]` and `/upgrade`** (`apps/cli/src/upgrade-cli.ts`): a table of
   installed, used and measured versions for claude, codex and opencode; `auto` / `path` store the preference;
   `install` reinstalls the measured Claude Code after a typed yes (the translated word or `yes`; anything else
   cancels). It runs the user's own Claude Code (`claude install <version>`, or `npm install -g
   @anthropic-ai/claude-code@<version>` for an npm install) — **not a governed run**, so the gate's rule does not apply
   — with the current directory set to `$HOME`, outside the repository, so no repository setting applies; with no
   absolute home (`absoluteHome` finds none), install is refused and nothing runs. Consent covers exactly what is
   shown: arguments are shell-quoted when needed, and a command that cannot be shown exactly as it would run (control
   or invisible characters) is refused before the question. It warns that the user's interactive Claude Code version
   may change until its next update. In the console, the installer gets the terminal (readline paused, raw mode off),
   so Ctrl+C stops it. Exit codes stay 0 / 1 / 2: a failing installer prints its code and returns 1; a preferences
   file that cannot be written is reported and returns 1. **This installer uses the network**; `TASKQUOIN_OFFLINE`
   and `--offline` (also for `taskquoin console`) cover only the registry check. For Codex and OpenCode the command is
   printed — only when the tool is installed with another version than the measured one — never run.
5. **The only new network read** (`apps/cli/src/upgrade-check.ts`), an exception to ADR-0010 Decision 1 triggered by
   the user: the npm registry (`https://registry.npmjs.org/taskquoin/latest`), only when the user types `/upgrade` or
   `taskquoin upgrade`, never at startup, in the background or during a run. GET with no cookie or identifier,
   `user-agent: taskquoin`, 5 s timeout, 1 MB limit, strictly validated JSON, strings sanitised before display. The
   published package carries `taskquoin.measured` (the runtime versions it measured), derived from the matrices and
   checked by a test. The update command is shown only for an npm install; a source copy is told `git pull`. A 404
   reads as "not published yet".
6. **The npm name is reserved by the first publication.** Until then `taskquoin` is free on npm and a stranger could
   publish a fake one that `/upgrade` would recommend. The first publication reserves the name and ships `/upgrade`, so
   no user queries npm before the name belongs to the maintainer.

## Consequences
- A Claude Code auto-update no longer stops governed runs while the measured version is still installed; the user is
  told which version runs and why.
- Measuring a new version stays maintainer work (live tests, evidence, matrix).
- Dependency on the native installer keeping old versions; if it cleans up quickly, `/upgrade install` matters more.
- Residuals: `/upgrade install` is network traffic outside any sandbox, run with the user's rights; the registry
  answer is trusted only for a version string and measured versions, never executed. A governed agent cannot plant
  `versions/<measured>`: agents' writes are confined to the workspace (Claude `fs.write` ENFORCED + Bash sandbox,
  Codex `workspace-write`, OpenCode file sandbox), and the trust checks refuse a file or folder others can write.

## Evidence
- `adapters/host-probe/test/probe.test.ts` — selection and the trust checks (link, owner, permissions, lying
  `--version`), `claudeCandidate` and its reasons (0775 folder, PATH-only choice, unreadable), fake `HOME` with
  `versions/`.
- `apps/cli/test/upgrade.test.ts` — table (with the "installed but not used" line), `auto` / `path` (and a save that
  fails), `install` cancelled and confirmed, the shown command is the one run (control characters refused, a space
  quoted), no absolute home refused, a failing installer → 1, `absoluteHome`.
- `apps/cli/test/console.test.ts` — banner notices; the terminal released to the installer (`withTerminalReleased`).
- `apps/cli/test/cli.test.ts` — `doctor` lines (fallback, action with `taskquoin upgrade`, installed but not used),
  `runtimeNotices`, HOME empty / `.` / relative with the real CLI, `console --offline`, an unwritable preferences
  file, the usage listing `upgrade`.
- `apps/cli/test/upgrade-check.test.ts` — local fake registry: up to date, newer, 404, timeout, invalid JSON, terminal
  sequences.
- `tests/package/build.test.ts` — `taskquoin.measured` equals the matrices' versions.
- `features/upgrade.feature` — end to end, with a fake `npm` first on the PATH (cancelled: not run; confirmed: run in
  `HOME`, its failure → exit 1).
