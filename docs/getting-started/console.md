# The interactive console

The console is an interactive shell over the same commands you have seen in the [first run](first-run.md). You type
`/run`, read the plan, `/approve` it, and so on, without retyping the run id each time. It adds no workflow logic: every
`/command` calls the same code as the matching `taskquoin` command. It is made for humans only, and its design makes
that hard to get wrong.

- [Start the console](#start-the-console)
- [The home screen and the squad](#the-home-screen-and-the-squad)
- [The commands](#the-commands)
- [Completion, history and the prompt](#completion-history-and-the-prompt)
- [Approving in the console](#approving-in-the-console)
- [Ctrl+C, quitting and input you did not mean to send](#ctrlc-quitting-and-input-you-did-not-mean-to-send)
- [Scripting the console with piped input](#scripting-the-console-with-piped-input)
- [Languages](#languages)
- [Learn more](#learn-more)

> [!NOTE]
> Screens come from a demo repository with simulated AI agents (the test doubles of Taskquoin's own test suite); every
> command is the real Taskquoin CLI.

## Start the console

Inside a git repository that has a `taskquoin.yaml`:

```shell
$ taskquoin
```

With no arguments, in a terminal, `taskquoin` opens the console, the way `claude` or `codex` do. `taskquoin console`
does the same, and also works when you want to be explicit. In a script or a pipe, `taskquoin` alone prints the help
instead.

In a terminal with colors, once the home screen is ready, its logo is revealed from left to right in under a second.
Colors follow what the terminal supports (16, 256 or 24-bit colors). These environment variables change the display:

| Variable | Effect |
|---|---|
| `TASKQUOIN_NO_ANIMATION=1` | No start-up animation |
| `NO_COLOR` (set and not empty) | No colors, and so no animation and the minimal home screen; the `/` menu still shows |
| `TERM=dumb` | No colors, no animation, no `/` menu: plain lines only, with no escape code at all |
| `TASKQUOIN_PLAIN=1` | Plain mode, for screen readers and logs: the minimal home screen, no animation, no `/` menu |

A pipe gets plain lines too: without a terminal on both sides there is no color, no animation and no menu.

The console reads `taskquoin.yaml` once, when it starts. If the file changes or disappears while the console is open,
every command is refused with `taskquoin.yaml changed since the console was opened: /quit, then run taskquoin console
again`. This avoids running a command with a stale configuration.

## The home screen and the squad

![The console home screen: the logo, the repository, the policy and the squad, then the /help list](../assets/screens/en/console.svg)

The home screen opens with the quoin logo, the version and `✦ YOUR AI DEV SQUAD ✦`, then **the context**: the
repository (its path, branch and whether the working tree is clean), the sandbox (bubblewrap, socat and whether the
clean-room Verify is available) and the policy (the digest of `taskquoin.yaml` and the accepted risks, with the first
expiry date). Below it comes **the squad: your real agents and their real status**. Each line is the state mark, the
role, `agent · runtime`, the status word and, when there is one, the note. This is the demo repository in a terminal
100 columns wide:

```text
  ── Squad ─────────────────────────────────────────────────── 3 of 3 agents ready · Verify ready ──
  ● Architect  planner · claude      READY
  ● Developer  implementer · claude  READY
  ◐ Reviewer   challenger · codex    READY      accepted risk: connector.write
  ● Tester     verify · bubblewrap   READY
```

If an agent is `NOT READY`, an **Action required** line says how many and points to `/doctor`. The layout follows the
terminal. The **full** screen needs about 100 columns, 24 rows and colors. The **compact** one (70 to 99 columns, or 16
to 23 rows) puts the context next to the logo and keeps short notes. The **minimal** one comes with a narrow or short
terminal, no colors, plain mode or an ASCII locale: one brand line, one summary line (agents ready, Verify, accepted
risks), one line per agent, then `/doctor: details · /help: commands`. Nothing is ever wider than the terminal.

The role is the agent's job: `planner` is the Architect, `implementer` the Developer, `challenger` the Reviewer and
`security` the Security reviewer; any other agent shows its own name. After the runtime, an API judge shows
`api:<provider>` and an OpenCode agent `opencode:<provider>`.

The status is never decorative. It is the same gate verdict that `taskquoin doctor` computes:

| Status | Meaning |
|---|---|
| `● READY` (green) | The agent is certified on this machine: every mandatory restriction is enforced by a measured mechanism |
| `◐ READY` and `accepted risk: <capability>` (amber) | It can run, but only thanks to a risk you accepted with `taskquoin accept-risk` |
| `○ NOT READY` and the reason (red) | It will not start. The reason is the start of the gate's message: `not measured (certified 2.1.327)` for a runtime version Taskquoin has not measured, `<runtime> not found` when the tool is not installed |

The mark and the word always go together, so the state reads the same without colors.

The last line, the **Tester**, is not an AI. It is Taskquoin's own clean-room Verify (`verify · bubblewrap`), the thing
that runs your tests. It is `READY` when bubblewrap is available and `NOT READY` with `bubblewrap unavailable` when it is
not; without it no run can be verified. Install the packages as described in [Installation](installation.md).

The brand (the tagline `✦ YOUR AI DEV SQUAD ✦`, the role names, `READY` and `NOT READY`) stays in English in every
language; the notes that follow are translated. Use `/doctor` for the full detail behind any status.

## The commands

Plain text never starts anything. Only lines beginning with `/` do anything; anything else answers `Nothing starts
without a command: type /run <request> to start a run, or /help.` This is deliberate: a stray sentence must never
launch a paid agent run.

```text
taskquoin › /help
Commands (anything else is ignored: nothing runs without /):
  /run <request>                start a governed run (stops at every approval)
  /runs                         list the runs
  /use <run>                    select the current run
  /status                       history of the current run
  /resume                       resume the current run if it was interrupted
  /show [<artifact>]            list the artifacts, or display one (plan, diff-N, verify-N, red-N…)
  /approve <plan|commit>        approve: shows the pending hash, you retype it
  /agents                       the agents and their rights
  /doctor                       machine state and agent certification
  /skills                       installed skills and their status
  /upgrade [auto|path|install]  AI tool versions: show, choose the one in use, reinstall the measured Claude Code
  /help                         this help
  /quit                         quit the console
Tab completes a command; typing / shows this menu.
```

One by one:

**`/run <request>`** starts a governed run, exactly like `taskquoin run "<request>"`. It prints one line per step as
the run goes, stops at the first approval and makes that run the **current run**. The prompt then shows the last six
characters of the run id and, while the run waits for an approval, `◆` and the gate: `taskquoin [235eaf ◆ plan] ›`.
`/run` without a request prints its usage. Starting a run first forgets the previously selected one, so a command can
never fall back silently to an older run. If the run could not be created (a dirty working tree, say), no run is
selected and you are told so.

```text
taskquoin › /run Add a sum function
  ✔ 21:19:04  recall  no-memory  →  plan
  ◉ 21:19:04  started: planner · claude
  ✔ 21:19:04  finished: planner · claude  0 s
  ✔ 21:19:04  plan  planned  →  challenge
  ◉ 21:19:04  started: challenger · codex
  ✔ 21:19:04  finished: challenger · codex  0 s
  ✔ 21:19:04  challenge  challenged:APPROVE  →  approve-plan
Run run-20261122T211904-235eaf — waiting-approval at approve-plan (attempt 0, branch taskquoin/run-20261122T211904-235eaf)
  plan approval required
  ✔ Planning              done  planner · claude  21:19:04  0 s  /show plan
  ✔ Adversarial critique  done  challenger · codex  21:19:04  0 s  /show challenge
  ◆ Plan approval         waiting  0 s  964c04e09ebe
  · Implementation        pending
  …
(current run: run-20261122T211904-235eaf)
taskquoin [235eaf ◆ plan] ›
```

**`/runs`** lists every run with its status, node and request, like `taskquoin status`.

**`/use <run>`** selects an existing run as the current one, by its full id. An unknown id answers
`unknown run: <id> — /runs for the list`. Use it to come back to a run from another session.

**`/status`** shows the history of the current run and, at a gate, the pending approval, like
`taskquoin status <run>`.

**`/show [<artifact>]`** with no argument lists the current run's artifacts with their sizes. With one, it prints it:
`/show plan`, `/show challenge`, `/show diff-1`, `/show verify-1`, `/show red-1`, `/show review-1`, and
`/show ignored-1` when it exists.

**`/approve <plan|commit>`** approves the pending gate. It does more than the command-line version asks of you; see the
next section.

**`/resume`** continues the current run if it was interrupted (like `taskquoin resume <run>`). On a run that is not
interrupted it says so and does nothing.

**`/agents`** lists the agents, their runtime, their capabilities and their skills:

```text
planner      claude  fs.read  — skills: planning-contract
implementer  claude  fs.read, fs.write, shell.run  — skills: tdd
challenger   codex   fs.read  — skills: code-review
```

**`/doctor`** is `taskquoin doctor`: machine state, where your code is sent, and every agent's certification.

**`/skills`** is `taskquoin skills list`: the pinned first-party skills and any you imported.

**`/help`** prints the list above, in your language; **`/help <command>`** explains one (`/help approve`). **`/quit`**
(or `/exit`) leaves the console.

Commands that need a run (`/status`, `/show`, `/approve`, `/resume`) answer `no run selected: /run <request> or /use <run>`
until you have started or selected one. An unknown command suggests the closest one when it is a typo away, and
otherwise points to `/help`:

```text
taskquoin › /stauts
unknown command /stauts — did you mean /status?
taskquoin › /zzz
unknown command: /zzz — /help for the list
taskquoin › /help approve
/approve <plan|commit>
  approve: shows the pending hash, you retype it
```

Imports, risk acceptances and OpenCode connection stay on the command line (`taskquoin skills import`,
`taskquoin accept-risk`, `taskquoin connect opencode`): they are setup decisions, not part of the day-to-day loop.

## Completion, history and the prompt

Type `/` and a menu of the commands appears under the input line, grouped under **Run**, **Review**, **Diagnose** and
**Console**, each command with its description. It narrows as you type: `/s` shows `/status`, `/show` and `/skills`.
The menu is only drawn while the prompt is waiting for input, disappears when you press Enter or type a space (you
are then in the arguments), and is never drawn with `TERM=dumb`, in plain mode or in a pipe.

**Tab** completes the command name (`/ap` then Tab gives `/approve `), then its argument:

| You type | Tab proposes |
|---|---|
| `/use ` | the run ids |
| `/show ` | the artifacts of the current run (`plan`, `diff-1`, `verify-1`…) |
| `/approve ` | the gate the current run really waits for, and nothing when it waits for none |
| `/help ` | the command names |

Free text gets no completion.

**↑ and ↓** recall the commands you typed before in this repository, in a terminal (piped input is not recorded). The
history is kept per repository in the control store (`console-history`, readable by you only, the last 500 commands).
Only lines starting with `/` are ever kept: your name typed at the approval, a retyped hash and free text never are,
neither in the file nor in the session's ↑.

**The prompt** says where you are: `taskquoin ›` with no run selected, `taskquoin [235eaf] ›` with a current run, and
`taskquoin [235eaf ◆ commit] ›` while that run waits for the commit approval (`◆ plan` for the plan).

The command list, the menu, the completion and `/help` all come from one table in `apps/cli/src/console.ts`, so they
cannot disagree. Command names are never translated, only their descriptions.

## Approving in the console

Approval is where the console is stricter than the command line. In the command line you copy the hash from `status`.
In the console you must **retype it**, which forces you to look at it.

```text
taskquoin [235eaf ◆ plan] › /show plan
PLAN
- Goal: Add a sum function
- Test first: sum.test.js already fails (RED)
- Step: create sum.js
SKILLS-RECEIVED: planning-contract
taskquoin [235eaf ◆ plan] › /approve plan
Your name (recorded in the approval): alice
  ◆ Plan approval  run 235eaf
    Bound to the plan  964c04e09ebe   (964c04e09ebe1c44125a…)
    Plan               · to read  /show plan
    Critique           ✔ APPROVE  /show challenge
    Policy             agents never commit · 1 accepted risk (connector.write)
    Read this session  ✔ plan  · challenge

    Approver           alice (via taskquoin console)
Retype 964c04e09ebe to approve (Enter to cancel): 964c04e09ebe
```

At the commit gate the same screen is bound to the git tree and lists the diff, Verify, the RED proof and the review
(`Read this session` remembers the `plan` you read at the first gate):

```text
taskquoin [235eaf ◆ commit] › /show diff-1
diff --git a/sum.js b/sum.js
…
taskquoin [235eaf ◆ commit] › /approve commit
  ◆ Commit approval  run 235eaf
    Bound to the git tree  909645eeb0a1   (909645eeb0a1716e60fd…)
    Diff                   · to read  /show diff-1
    Verify                 ✔ passed   /show verify-1
    RED proof              ✔ proven   /show red-1
    Review                 ✔ APPROVE  /show review-1
    Policy                 agents never commit · 1 accepted risk (connector.write)
    Read this session      ✔ diff-1  · verify-1  · red-1  · review-1  ✔ plan

    Approver               alice (via taskquoin console)
Retype 909645eeb0a1 to approve (Enter to cancel): 909645eeb0a1
```

What happens, step by step:

1. **The run must be waiting for that gate.** `/approve commit` on a run waiting for the plan answers
   `run … is not waiting for the commit approval (it is waiting for: plan)` and asks for nothing. `/approve` with
   anything other than `plan` or `commit` prints its usage.
2. **Your name is asked once per session**, *before* the hash, so that the last thing you type before approving is the
   hash. It is recorded with the approval as `alice (via taskquoin console)`, which tells a reader which door was used.
   A line starting with `/` is never accepted as a name: it cancels (`cancelled: a command is not a name — nothing is
   approved.`). Later `/approve` calls in the same session do not ask again.
3. **The pending approval is re-read** just before it is shown. The screen says what the approval is **bound to**, as
   the run recorded it: the hash of the plan, or the git tree that Verify and the review saw. It lists **what there is
   to read** with the state of each item (to read, passed, failed, proven…: `plan`, `critique`, or `diff`, `verify`,
   `RED proof`, `review`, and `Ignored files` with `outside the diff` when the agent created, changed or removed
   git-ignored files: they are not in the diff, not verified and not committed), **what you read in this session**
   with `/show`, the policy (agents never commit, the accepted risks) and the approver. "Read this session" is
   a reminder, not a gate: the typed hash is the gate.
4. **You retype the 12-character hash.** An empty line cancels (`cancelled: nothing is approved.`). Any other text that is
   not exactly the hash answers `the hash does not match: nothing is approved.`, and nothing happens.
5. **The pending approval is read again after your last key.** If it changed since the screen was shown (another session
   approved, or a re-review recorded a new tree), nothing is approved: `the tree waiting for approval changed after it
   was shown: nothing is approved — run /approve commit again to see the new one.` (or the same for the plan).
6. **Otherwise the console runs the same approval as `taskquoin approve <run> <gate> --expect <hash>`**, with the same
   checks and the same messages, and prints the result. On another branch it answers `switch to taskquoin/<run id>
   first`. If your working tree differs from the tree that was reviewed (an untracked file, a `coverage/` folder left by
   a local test run), the approval is recorded and the commit step sees the difference: it re-verifies and re-reviews the
   new tree, commits nothing, and waits for a new approval (`working tree changed after approval — re-verified and
   re-reviewed; approve the new tree`); `/approve commit` again shows the new tree. For the plan, the run continues
   through implementation, Verify and review and stops at the commit gate; for the commit, it prints the commit.

![A console session: /show diff-1, then /approve commit shows what is bound, what to read and what was read, cancelled at the retype](../assets/screens/en/console-approve.svg)

The timeline (`/status`, and the steps shown after `/run`) lists the real steps of the run with their state, the agent
that ran, the duration and the artifact to read. **Times are your local clock** (the timezone of your machine), not UTC.

> [!WARNING]
> Read before you retype. The hash binds your approval to the artifact (the plan, or the git tree), but only reading it
> makes the approval meaningful. The console cannot read for you.

### Why the console is human-only

The console is never installed as slash commands inside Claude Code or Codex, where a model could type them
([ADR-0015](../adr/0015-console-human-only.md)). The boundary that really matters is the control store: agents cannot
write to it, so they cannot approve at all. The console makes the human path safe on top of that: nothing starts without
a `/`, and an approval needs your name and the retyped hash.

### Type-ahead is discarded

A `/run` can take minutes. Anything you type while it works is waiting in the terminal's buffer, and it must not answer
an approval question that appears later. In a terminal, lines typed before a prompt is shown are **discarded** with a
notice:

```text
(2 lines typed before the prompt were ignored)
```

So an approval is always answered after the question has been displayed, never by keys pressed earlier.

## Ctrl+C, quitting and input you did not mean to send

- **Ctrl+C does not quit the console.** It prints `(Ctrl+C is ignored here: /quit to leave. A run in progress continues
  until its next approval.)`. Use `/quit` (or `/exit`) to leave. This protects you from killing a run half-way by
  reflex.
- **End of input** (Ctrl+D in a terminal, the end of a pipe) leaves the console, too.
- **Exit code.** The console exits with `0` if everything succeeded and `1` if any command or approval failed during the
  session, so a script can tell.
- Leaving the console does not stop the state of a run: a run waiting for approval stays waiting, and you can approve it
  from the command line or from a new console session (`/use <run>`).

## Scripting the console with piped input

When standard input is not a terminal, the console reads lines from the pipe, shows no menu, does not animate, and
**keeps** the lines (no one is there to discard type-ahead). That makes the console scriptable and is how Taskquoin
tests it:

```shell
$ printf '/help\n/runs\n/quit\n' | taskquoin console
```

A script can drive a whole approval by providing the answers in order: the command, the name, the hash. Piped input is
treated like `taskquoin approve --expect` in a script: you chose the hash in advance. Note that every line is consumed
as the answer to the prompt that is waiting: a `/show` sent where the hash was expected counts as a wrong hash and
cancels the approval.

```shell
$ printf '/use run-20261122T211904-235eaf\n/approve plan\nalice\n964c04e09ebe\n/quit\n' | taskquoin console
```

> [!TIP]
> For unattended use, the command-line `taskquoin approve <run> <gate> --expect <hash> --as <name>` is simpler than the
> console, and `taskquoin status <run> --json` gives a machine-readable state. `--json` outputs are English and
> identical in every language.

## Languages

The console and the CLI speak 22 languages: English, French, Spanish, Brazilian Portuguese, German, Italian, Dutch,
Polish, Russian, Ukrainian, Turkish, Arabic, Persian, Hebrew, Hindi, Indonesian, Vietnamese, Thai, Simplified and
Traditional Chinese, Japanese and Korean. The language is chosen in this order:

1. the `TASKQUOIN_LANG` environment variable (`TASKQUOIN_LANG=ja taskquoin`);
2. the saved preference in `preferences.json` in the state directory
   (`${XDG_STATE_HOME:-~/.local/state}/taskquoin/`), for example `{"language":"fr"}`;
3. your system locale (`LC_ALL`, `LC_MESSAGES`, `LANG`; `C` and `POSIX` give English);
4. English.

English and French are written by hand; the other 20 are machine translations checked by tests (every placeholder and
`/command` is kept, and plural forms follow each language's rules). Columns stay aligned with Chinese, Japanese and
Korean characters. The planner, the critique and the review are also written in the run's language.

What always stays in English: every `--json` output, the run journal, the artifacts, the commit trailers, the agents'
`VERDICT:` line, the engine's run messages (`failed`, `needs-human`, `interrupted`) and the banner's brand. A reader on
another team can therefore audit a commit made in any language.

## Learn more

- [Your first governed run](first-run.md): the same workflow with commands, step by step
- [Installation](installation.md)
- [ADR-0015, the console is human-only](../adr/0015-console-human-only.md)
- [ADR-0013, tree-based governance](../adr/0013-tree-based-governance.md)
- [ADR-0011, agents never commit](../adr/0011-agents-never-commit.md)
