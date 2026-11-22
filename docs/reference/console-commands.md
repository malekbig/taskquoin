# Console commands

`taskquoin console` is an interactive shell over the same commands as the CLI, with `/` commands. Open it with
`taskquoin console`, or by running `taskquoin` alone in a terminal. It adds no workflow logic: each `/` line calls the
same function as the matching CLI command.

- [Principles](#principles)
- [The start-up banner](#the-start-up-banner)
- [Commands](#commands)
- [Approving in the console](#approving-in-the-console)
- [Keys and completion](#keys-and-completion)
- [Behaviours worth knowing](#behaviours-worth-knowing)
- [Exit code](#exit-code)

> [!NOTE]
> Screens come from a demo repository with simulated AI agents (the test doubles of Taskquoin's own test suite); every
> command is the real Taskquoin CLI.

![taskquoin console: the banner, the squad and the prompt](../assets/screens/en/console.svg)

## Principles

- **Human-only.** The console is for you, never for a model. It is not installed as slash commands inside Claude Code or
  Codex, where an agent could type them through its own tools ([ADR-0015](../adr/0015-console-human-only.md)). The real
  boundary stays the control store, which agents cannot write.
- **Nothing starts without a `/`.** Plain text prints a hint and does nothing: `Nothing starts without a command: type
  /run <request> to start a run, or /help.`
- **Command names are never translated**; their descriptions follow your [language](../guides/languages.md).

## The start-up banner

At start the console shows the squad as it really is: each agent of `taskquoin.yaml` with its role, runtime and the
verdict of its gate, plus Taskquoin's own sandboxed Verify as the tester. It is never decorative: a role that cannot run
says why.

```text
 [●] Architect  planner · claude      READY
 [●] Developer  implementer · claude  READY
 [○] Reviewer   challenger · codex    NOT READY — mandatory restriction "connector.write" (deny-all) on codex 0.157.1: c
 [●] Tester     verify · bubblewrap   READY
```

`READY` with a note means the agent runs thanks to a risk you accepted. The animated logo plays only in a terminal with
colours; `NO_COLOR` turns colours off and `TASKQUOIN_NO_ANIMATION=1` turns the animation off.

## Commands

| Command | Arguments | What it does | CLI equivalent |
|---|---|---|---|
| `/run` | `<request>` | Starts a governed run and selects it. Stops at every approval. | `taskquoin run` |
| `/runs` | | Lists the runs. | `taskquoin status` |
| `/use` | `<run>` | Selects the current run (a run id from `/runs`). | |
| `/status` | | Shows the history of the current run and what to approve. | `taskquoin status <run>` |
| `/show` | `[<artifact>]` | Lists the artifacts of the current run, or prints one (`plan`, `diff-N`, `verify-N`, `red-N`...). | `taskquoin show <run> [<artifact>]` |
| `/approve` | `<plan\|commit>` | Approves the pending gate after you retype its hash. | `taskquoin approve` |
| `/resume` | | Resumes the current run if it was interrupted. | `taskquoin resume <run>` |
| `/agents` | | Lists the agents with their runtime, capabilities and skills. | |
| `/doctor` | | Machine state and certification of each agent. | `taskquoin doctor` |
| `/skills` | | Installed skills and their status. | `taskquoin skills list` |
| `/help` | | Lists these commands. | |
| `/quit` | | Leaves the console (`/exit` also works). | |

The prompt shows the current run by its last six characters: `taskquoin [7b8841] ›`; without a run it is `taskquoin ›`.

Details:

- **`/run <request>`** without a request prints the usage and runs nothing. It first forgets the previously selected
  run, so a failed start never silently falls back to an old run; when the new run exists, it becomes current
  (`(current run: <id>)`).
- **`/use <run>`** needs the exact id of an existing run; otherwise `unknown run: <id> — /runs for the list`.
- **`/status`, `/show`, `/resume`, `/approve`** act on the current run and say `no run selected: /run <request> or /use <run>`
  when there is none.
- **`/agents`** prints one line per agent: `<id>  <runtime>  <capabilities>  — skills: <list>`.

## Approving in the console

`/approve plan` and `/approve commit` are deliberately slower than the CLI so that the last thing you type is the hash:

1. The gate must be the one the run is waiting for; otherwise the console says which gate it waits for, or that it is not
   waiting.
2. The first time in a session, it asks for **your name**. A line starting with `/` is never taken as a name (it cancels).
   The name is recorded as `<name> (via taskquoin console)`.
3. It shows the pending hash (12 characters) and what to read first: for the plan, `plan` (and `challenge`); for the
   commit, `diff-N`, `verify-N`, `red-N`, `review-N` (and `ignored-N` when it exists).
4. It asks you to **retype the hash**. Empty input cancels; a different hash approves nothing.

```text
taskquoin [7b8841] › /approve plan
Your name (recorded in the approval): Your Name
To approve: plan of run run-20261122T132603-7b8841 — hash bb8543009fa8
Read first: /show plan  (and: challenge)
Retype bb8543009fa8 to approve (Enter to cancel): bb8543009fa8
```

Because an approval must follow what is shown, lines you typed *before* a prompt appeared (type-ahead during a long
`/run`) are discarded in a terminal, with a notice. Piped input, used by scripts and tests, is kept.

## Keys and completion

| Key | Effect |
|---|---|
| `/` | Shows a menu of every command with its description, filtered as you type |
| `Tab` | Completes a command (`/ap` becomes `/approve `); free text gets no completion |
| `Ctrl-C` | Does not quit: it prints `Ctrl+C is ignored here: /quit to leave. A run in progress continues until its next approval.` |
| `Ctrl-D` | End of input: leaves the console |

## Behaviours worth knowing

- **The configuration is read once.** If `taskquoin.yaml` changes (or disappears) while the console is open, commands are
  refused with `taskquoin.yaml changed since the console was opened: /quit, then run taskquoin console again`, instead of
  running with a stale configuration.
- **No TTY required.** The console also reads from a pipe, so the real flow can be scripted and tested; the menu and
  completion appear only in a terminal.
- **Unknown command**: `unknown command: /xyz — /help for the list`.
- **A command that fails does not close the console**; it is remembered for the exit code.

## Exit code

`0` when every command of the session succeeded, `1` if any command or approval failed (or the console could not start,
for example without `taskquoin.yaml`).

## Learn more

- [CLI reference](cli.md) · [Runs, artifacts and events](runs-artifacts-events.md)
- [Security: the console is human-only](../guides/security.md#9-agents-never-commit-humans-decide)
- [ADR-0015](../adr/0015-console-human-only.md)
