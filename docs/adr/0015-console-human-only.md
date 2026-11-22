# ADR-0015: `taskquoin console` — an interactive shell for humans, approvals retyped

## Status
Accepted — owner asked for a console "comme Claude / Codex avec /" and agreed to build it (2026-11-15)

## Date
2026-11-15

## Context
Typing `taskquoin approve <run> <gate> --expect <hash> --as <name>` is precise but heavy. The owner wanted a console
like Claude Code / Codex with `/` commands. Putting these commands INSIDE Claude Code or Codex (as their slash
commands) would let a model type them through its own tools: the human gate would become a model action.

## Decision
1. `taskquoin console` is a thin REPL (`node:readline`, no dependency) over the existing commands: `/run`, `/runs`,
   `/use`, `/status`, `/show`, `/approve`, `/resume`, `/agents`, `/doctor`, `/skills`, `/help`, `/quit`. No new
   workflow logic: each line calls the same function as the CLI.
2. **Nothing starts without `/`**: free text only prints a hint (no implicit run).
3. **`/approve <plan|commit>`** shows the pending hash and what to read, then approves only if the human **retypes** the
   12-character hash; empty or different input approves nothing. The approver's name is asked once per session and
   recorded as `<name> (via taskquoin console)`.
4. The console is **never** installed as slash commands inside Claude Code or Codex.
5. The security boundary is unchanged and is NOT the console: agents cannot write the control store (sandbox
   denyWrite + hook), so they cannot approve through any interface. The console does not require a TTY (a TTY check
   would be a false boundary, and would prevent testing the real flow).

6. **Start-up banner** (owner's design: TASK / Q U O I N / "YOUR AI DEV SQUAD"): the squad lines show the real agents
   and their real gate verdict — Architect (planner), Developer (implementer), Reviewer (challenger, also covers
   security in its review), Tester (Taskquoin's sandboxed Verify) — READY, READY with an accepted risk, or NOT READY
   with the reason; never a decorative READY. 24-bit colours only in a terminal and without `NO_COLOR`. The prompt
   shows the current run; Tab completes `/` commands; typing `/` shows the command menu under the input (only while a
   prompt waits, never over a command's output). A short logo animation (~0.9 s, terminal with colours only, off with
   `TASKQUOIN_NO_ANIMATION=1`, cursor always restored) plays while the squad status is computed. `taskquoin` alone
   opens the console in a terminal (scripts still get the help).

   > **Amended by Console V2 ([ADR-0019](0019-native-ansi-tui.md)), 2026-11-22.** The TASK / Q U O I N banner and its
   > slogan are replaced by the V2 home: the quoin logo with the version and `✦ YOUR AI DEV SQUAD ✦`, the context
   > (repository, sandbox, policy), the squad with each agent's real gate verdict (`●` READY, `◐` READY with an accepted
   > risk, `○` NOT READY with the reason; the tester is still Taskquoin's sandboxed Verify) and an action line. It is
   > Full, Compact or Minimal by the terminal's size and capabilities. The logo animation plays once the home is
   > computed, not while. Colours follow the terminal (16, 256 or 24-bit colours); there are none with `NO_COLOR`,
   > `TERM=dumb` or a pipe, and with `TERM=dumb` there is no `/` menu and no cursor movement either. The `/` menu groups
   > the commands by category. Tab also completes the run id (`/use`), the artifact (`/show`), the pending gate
   > (`/approve`) and the command (`/help`). An unknown command suggests the closest one, and `/help <command>`
   > explains one. The prompt shows `◆ <gate>` when the current run waits for an approval. `/approve` shows what the
   > approval is bound to, what there is to read and what was read in the session before the unchanged retype. The
   > pending binding is read again after the last keystroke, and a change refuses: nothing is approved. Everything else
   > is the same approve path as `taskquoin approve`. History (↑/↓) keeps `/` commands only, per repository: never a
   > name, a hash or free text.

## Consequences
### Positive
- Daily use without long commands; the hash-retyping step makes "approve what you read" explicit.
- Same code paths as the CLI: 3 Gherkin scenarios drive the real CLI end to end through the console.
### Negative
- Long commands (`/run`, `/approve`) block the prompt until the next gate; lines typed meanwhile are queued. Ctrl+C is
  ignored inside the console (a run continues to its next gate); `/quit` or closing the terminal ends it.
- No multi-LLM chat in the console yet (planned separately: text-only reviewers with a provider allowlist).

## Evidence / references
`apps/cli/src/console.ts`, `apps/cli/test/console.test.ts` (pure loop), `features/console.feature` (real CLI).
