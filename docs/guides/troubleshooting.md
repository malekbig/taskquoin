# Troubleshooting

When Taskquoin refuses something, it says why, and the refusal is almost always the system working as designed. This
page maps each real message to its cause and its fix. Messages follow your language, but the table quotes the English
text; run errors (`failed`, `needs-human`, `interrupted`) come from the engine and are never translated.

- [Before a run](#before-a-run)
- [While a run is going](#while-a-run-is-going)
- [At the approval gates](#at-the-approval-gates)
- [Commands](#commands)
- [Learn more](#learn-more)

Start with `taskquoin doctor`: it explains most refusals about agents, runtimes and sandboxes.

## Before a run

| Symptom | Cause | Fix |
|---|---|---|
| `taskquoin: not inside a git repository (Taskquoin commits verified work, ADR-0011)` | you are not in a git repository | `cd` into the repository |
| `taskquoin: taskquoin.yaml not found — run "taskquoin init"` | no configuration | `taskquoin init` |
| `taskquoin: config.<path>: <problem>` (for example `config.agents.planner.maxTurns: expected an integer 1..200`) | the configuration is invalid; the path says where | fix that key ([Configuration](configuration.md)) |
| `taskquoin.yaml already exists — edit it, or remove it yourself to start over (never overwritten)` | `init` never overwrites | edit the file |
| `taskquoin run: the working tree has uncommitted changes — commit or stash them first (Taskquoin never mixes its changes with yours)` | dirty tree | commit or stash |
| `taskquoin.yaml must define agent "implementer"` (or `"planner"`) | a required agent is missing | add it |
| `agent <id> must be read-only (it plans or reviews independently) but is granted <list>` | the planner or a judge has write, shell, network, commit or config capabilities | remove those capabilities |
| `Verdict: 2 of 3 agents can run — refused agents will not be started.` (doctor) and `NOT READY` (console banner) | at least one agent failed its gate | read the `✖` lines of `doctor` and match them below |
| `Runtime claude: 2.1.330 (…) ✖ matrix measured for 2.1.327`, and `mandatory restriction "fs.write" (deny-all) on claude 2.1.330: capability matrix measured for claude 2.1.327, installed 2.1.330` | the installed runtime version has not been measured; every mandatory restriction is refused | install the measured version ([Agents and runtimes](agents-and-runtimes.md#measured-versions)). An `accept-risk` is bound to one version and is not a substitute for measurement |
| `Runtime claude: installed 2.1.330 (not measured) → using 2.1.327 (measured)` | Claude Code updated itself; Taskquoin uses the measured version still installed | nothing to do; `taskquoin upgrade` shows both versions ([Upgrade](upgrade.md)) |
| `◆ Action required  Claude Code 2.1.330 is not measured and 2.1.327 is not installed` (NOT READY after a Claude Code update) | the update replaced the measured version | `taskquoin upgrade` to see the versions, then `taskquoin upgrade install` to reinstall the measured one (or `upgrade auto` if you chose PATH only) |
| `◆ Action required  Claude Code 2.1.327 is installed but not used: it or its folder is writable by group or others — run chmod go-w …` | the file or its folder can be written by others, so it is not trusted | run the printed `chmod go-w <folder> <file>`; if the reason is `the choice is PATH only`, `taskquoin upgrade auto` |
| `Runtime codex: ✖ not found on PATH` and `runtime codex for agent challenger is not installed` | the CLI is not on the PATH | install it, or put another runtime on that agent |
| `Bash sandbox (bubblewrap + socat): ✖ not available — agents with a shell are refused` | bubblewrap or socat missing | `sudo apt install -y bubblewrap socat` |
| `File sandbox (bubblewrap): ✖ not available — Verify and OpenCode agents are refused` | bubblewrap missing | `sudo apt install -y bubblewrap` |
| `Local tool isolation (unshare -rn): ✖ local tools will not run` | user namespaces are unavailable | this tool needs unprivileged user and network namespaces: enable them on the host or use a host that has them |
| `✖ connector.write — mandatory restriction "connector.write" (deny-all) on codex …: claimed ENFORCED but the mechanism is not measured (inferred). Execution refused (ADR-0002).` | an uncertified restriction | read [accepted risks](agents-and-runtimes.md#accepted-risks); if it is acceptable, `taskquoin accept-risk challenger connector.write --reason "…" --expires YYYY-MM-DD --as <name>` |
| `… (owner exception expired on 2026-12-31)` | the acceptance expired | accept again, on purpose, or fix the cause |
| `<NAME> is missing — define it in your environment (the key is never written to the repository)` | an API judge's key variable is not set (`doctor`: `key NAME MISSING`) | `export NAME=…` and run again |
| `provider "openai" is not connected for Taskquoin — run: taskquoin connect opencode` | OpenCode is not signed in for Taskquoin | `taskquoin connect opencode` |
| `connection "<provider>" (<type>) is not measured with OpenCode 1.19.5 — Taskquoin sends no code through it (measured: …)` | this provider and sign-in type has not been measured | use a measured connection, or a different runtime |
| `taskquoin: OpenCode is not installed (not found on the PATH)` | `connect` needs the CLI | `npm install -g opencode-ai@1.19.5` |
| `taskquoin: no provider connected for Taskquoin` | the OpenCode sign-in was cancelled or failed | run `connect opencode` again |
| `agent <id> cannot start — <reasons>` | an agent the workflow will call (planner, implementer, a challenger, a reviewer) fails its gate; every gate is checked before the planner is called, so nothing is spent and no branch is created | fix the reason shown; the next line, when there is one, names the remedy |
| `agent implementer cannot start — mandatory restriction "config.modify" (deny-all) on claude …: claimed ENFORCED but the mechanism is not measured (inferred)`, then `To start implementer: set shell.run … and verify.command … in taskquoin.yaml` | the implementer has no `shell.run`, typically on a stack `init` did not recognise; without it, its protection of `.git`, `.claude/` and `taskquoin.yaml` is not measured | set `shell.run` and `verify.command` in `taskquoin.yaml`. Do not accept this risk: it would waive that protection for the agent that writes |
| `ℹ stack not recognised: set shell.run … and verify.command …` (`init`) | `init` found no `package.json`, `pyproject.toml`, `go.mod`, … | set them before the first run; with an OpenCode implementer `init` names only `verify.command` (OpenCode has no commands) |
| `agent <id> cannot start — skill(s) not usable: …` | a configured skill is missing or invalid | `taskquoin skills list` |
| `taskquoin accept-risk: "fs.write" is not currently failing for planner — nothing to accept` | the restriction holds | nothing to do |
| `taskquoin accept-risk: <agent> is an api judge — its restrictions hold by construction; nothing to accept` | API judges have no risk to accept | fix the real cause (a missing key) |
| `taskquoin accept-risk: --reason, --as and a real --expires date are required` / `--expires is in the past` | missing or invalid option | pass all three, with a future `YYYY-MM-DD` |
| `config.policy.exceptions: risk acceptances are not read from the repository; record them with "taskquoin accept-risk"` | an exception was written in the YAML | remove it and use `accept-risk` |

## While a run is going

| Symptom | Cause | Fix |
|---|---|---|
| `failed … gate refused agent X: …` | the agent cannot be certified now | `taskquoin check X` says why; fix, then start a new run |
| `failed … agent X ended with status …` | the agent crashed, timed out or answered nothing | read the reason; start a new run |
| `needs-human … tests still failing after N attempts` | the limit of automatic reworks (3 attempts; 5 without commands) was reached | take over on the branch `taskquoin/<run>`, or start a new run with a more precise request |
| `needs-human … no failing test demonstrates the change` | the new tests pass without the production change | read `red-N`; write a test that fails before the change. A refactor or docs-only change ends here: commit it yourself |
| `needs-human … RED proof inconclusive: …` | the proof could not run properly (timeout, sandbox, tree) | read `red-N`; your working directory was not touched |
| `needs-human … dependencies changed during the run: …` | `node_modules`, `vendor` or `.venv` changed | reinstall (`npm ci`) and start a new run; do not install during a run |
| `needs-human … Verify could not run the test command (exit 127): … not found` | the test runner is not visible in the clean room, which has no HOME and no network (nvm, volta, `~/.npm-global`, pyenv, `~/.m2`, `~/.gradle`, the Go module cache live under HOME) | install the toolchain outside HOME or inside the repository, then start a new run ([Verify](verify-and-red-proof.md#the-clean-room)). No rework was used |
| `needs-human … Verify could not run the test command (exit <n>): …` with `n` of 126 or more (or `exit none`) | the command is not executable, crashed (134, 139), gave up (255), was killed other than by the timeout, or the sandbox did not start. A runner whose exit code counts its failures also stops here once 126 or more tests fail | read `verify-N`, fix the command or the toolchain, then start a new run. No rework was used |
| `needs-human … Verify refused: … links outside the repository` | a symlink (often `npm link`) points outside | replace it with a real copy (`npm install`) or remove it |
| `needs-human … Verify refused: clean-room scan incomplete (…)` | Taskquoin could not scan for secrets to mask | fix the cause named, for example an unreadable directory |
| `needs-human … verification modified tracked files` | the tests rewrite tracked files | fix the tests; they ran in the clean room, your folder is untouched |
| `needs-human … protected configuration changed: <paths> — Taskquoin never commits such changes` | an agent touched CI, `.claude/`, `AGENTS.md`, `taskquoin.yaml`, … | nothing was committed; inspect the branch |
| `needs-human … diff too large to review completely (N chars > 200000) — split the task` | the reviewers must see the whole diff | split the task ([Best practices](best-practices.md#keep-tasks-small)) |
| `needs-human … trop gros pour le relecteur / critique <id> … maxInputChars` | the request is longer than the provider's `maxInputChars` | shorten the request or raise `maxInputChars` |
| `needs-human … review still requests changes after N attempts` | the reviewers kept refusing | read `review-N`; take over or refine the request |
| `needs-human … submodules are not supported in governed runs` | the tree has a submodule | not supported yet |
| `no test command configured (verify.command, or the implementer's shell.run) — cannot verify, failing closed` (in `verify-N`) | nothing to run | set `verify.command` |
| tests pass on your machine, fail in Taskquoin | they read an ignored file absent from the clean room, the network, or HOME | add the file to `verify.inherit`; do not rely on the network |
| `interrupted … HTTP 503` (or 429, a timeout) | an API judge's provider is down (already retried twice) | `taskquoin resume <run>` later; judges that answered are not asked again |
| `interrupted` for a git or disk error | a technical error | `taskquoin resume <run>` |
| `run <id> is busy (another taskquoin process, pid N)` | another command holds the run | wait for it |
| `interrupted at <node> … process gone (the run was killed)` (`status`) | the Taskquoin process driving the run was killed (Ctrl+C, a closed terminal, SIGKILL, a reboot) | `taskquoin resume <run>`: it records the interruption and continues at the same node, approvals kept |
| `run <id> is blocked by <dir>/lock: if no taskquoin process is running, delete that file and try again` (or `…/lock.takeover`) | the lock names no process, or a takeover of a dead lock was itself killed; Taskquoin never clears such a file by itself, so that two processes can never hold the run | make sure no Taskquoin process runs (`ps`), delete the named file, run the command again |

## At the approval gates

| Symptom | Cause | Fix |
|---|---|---|
| `expected … does not match the pending artifact …… — re-read it before approving` | wrong hash | `taskquoin status <run>`, read with `show`, copy the hash |
| `the expected hash must have at least 12 hex characters` | truncated hash | paste at least 12 |
| `run <id> is not waiting for approve-commit (status …)` | wrong gate or run already past it | `taskquoin status <run>` |
| `switch to taskquoin/<run> first` | you are on another branch | `git switch taskquoin/<run>` |
| `taskquoin.yaml changed since the run started — start a new run` | the configuration changed after the run began | start a new run with the new configuration |
| `working tree changed after approval — re-verified and re-reviewed; approve the new tree` | the tree changed after you approved | read the new `diff-N`, approve the new hash |
| `taskquoin: unknown run <run>` | typo in the run id | `taskquoin status` |
| `no artifact "X" (available: …)` | wrong artifact name | `taskquoin show <run>` lists them |
| `only an interrupted run can be resumed (status needs-human)` | `failed` and `needs-human` runs cannot be resumed | start a new run |

## Commands

| Symptom | Cause | Fix |
|---|---|---|
| `taskquoin check <agent>: known agents: …` | unknown agent id | use one of those listed |
| `usage: taskquoin approve <run> <plan\|commit> --expect <hash shown by status> --as <name>` | a missing argument | pass all four |
| `usage: taskquoin connect opencode [--remove]` | only OpenCode has a connection | use that form |
| a request typed without quotes (`taskquoin run Add a sum function`) | every word after `run` is the request | nothing to do; quote it when it holds a word starting with `--`, which is read as an option |
| `taskquoin: no manifest for this repository — nothing Taskquoin created is recorded` after a first `uninstall` | the manifest was removed with the files | to delete the control store too, `taskquoin uninstall --purge-state` still works |

> [!TIP]
> For scripts and CI, `taskquoin status [<run>] --json` and `taskquoin check <agent> --json` give stable output in
> English whatever the language; `status <run> --json` includes the `reason` a run stopped with (`null` when unset). Exit codes: `0` ok, `1` refused or failed, `2` usage error.

## Learn more

- [Configuration](configuration.md), [Agents and runtimes](agents-and-runtimes.md), [Approvals](approvals.md), [Verify and the RED proof](verify-and-red-proof.md).
- [Runtime versions and upgrades](upgrade.md).
- [ADR-0002](../adr/0002-enforcement-classes.md), [ADR-0014](../adr/0014-verify-in-a-clean-room.md).
