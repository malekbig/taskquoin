# Best practices

Taskquoin gives you a governed pipeline; how much you get out of it depends on how you feed it and how carefully you
read at the two gates. This page collects habits that work: how to write a request, how big a task should be, what to
read before approving, when to accept a risk, and how to use Taskquoin in a team and in CI.

- [Write a good request](#write-a-good-request)
- [Keep tasks small](#keep-tasks-small)
- [Read before you approve](#read-before-you-approve)
- [Accept a risk deliberately](#accept-a-risk-deliberately)
- [Use it in a team](#use-it-in-a-team)
- [Use it in CI](#use-it-in-ci)
- [Learn more](#learn-more)

## Write a good request

The request is the one thing you control before the plan. The planner reads the repository; you tell it the *what* and
the *how you will know*.

- **State observable behaviour.** "Reject a postcode that is not five digits, with the message `invalid postcode`" gives
  the Developer a test to write first. "Improve validation" does not.
- **Name the place, if you know it.** "In `signup/validate.js`" saves the planner a search.
- **Say what must not change**: public APIs, file formats, the files to leave alone.
- **Ask for behaviour, not for refactors.** The RED proof requires a test that fails before the change. A pure
  refactor or documentation edit ends as `needs-human` (`no failing test demonstrates the change`). Do those yourself.
- **One request, one outcome.** Several unrelated changes in one request mean one large diff, which is harder to review.

```shell
$ taskquoin run "Reject a postcode that is not five digits in signup/validate.js, returning the error 'invalid postcode'. Do not change the public validate() signature."
```

## Keep tasks small

Small tasks are cheaper, converge in fewer attempts and are reviewable.

- Taskquoin gives up after a few automatic reworks (3 attempts; 5 when it runs the tests for an OpenCode implementer)
  and refuses a diff above 200,000 characters (`diff too large to review completely`). Both are signals that the task
  was too big.
- Aim for a diff you can read in one sitting. If the plan lists many unrelated files, **do not approve it**: cancel
  by not approving, and run the first slice only.
- Chain small runs: each commit lands on its own branch `taskquoin/<run id>`; merge it, then start the next run from a
  clean tree.
- Do not edit your working directory, or run `npm install`, while a run is in progress. Use another clone or a
  `git worktree` for your own work.

## Read before you approve

The approval is only as good as your reading. The hash proves *what* you approved; it cannot prove you understood it.

**At the plan gate**, read `plan` and `challenge`. Check that the plan names the tests to write first, that its scope
matches your request and no more, and that the risks it lists are real. Remember the challenge is advice: a
`CHANGES_REQUESTED` there is worth reading, but you decide.

**At the commit gate**, read in this order:

1. `diff-N`: the exact change. This is what will be committed.
2. `red-N`: **does the test fail for the right reason?** An assertion about the requested behaviour is good. A failure on
   a missing helper, a typo or an unrelated import is a mechanical RED that proves little.
3. `verify-N`: the output of the tests run by Taskquoin, not by the model.
4. `review-N`: what the reviewers found, including non-blocking remarks.
5. `ignored-N`, if it exists: files the agent left on your disk outside the diff.

Look especially for tests that assert what the code *does* instead of what it *should* do, edits to files you did not
expect, and anything touching configuration (it would have been refused, but read anyway).

> [!WARNING]
> Do not approve by pasting the hash without reading. The two gates are the point of the tool. If the hash in your
> clipboard came from an automated script, you have removed the human.

## Accept a risk deliberately

An accepted risk is a documented exception, not a convenience. Before you run `accept-risk`:

1. Read the failure message in full: it names the capability, the mechanism and the runtime version.
2. Ask whether the capability matters for **that** agent (a read-only reviewer with no connector does not need
   `connector.write`).
3. Prefer the fix when there is one: install bubblewrap, define the key, connect the provider, install the measured runtime version.
4. Write a reason a colleague can understand in a year, and a short `--expires`.
5. Commit nothing about it: acceptances live outside the repository, so tell your team in your normal channel.

Re-evaluate at expiry and whenever a runtime is upgraded, because the acceptance no longer applies to a new version.
See [Accepted risks](agents-and-runtimes.md#accepted-risks).

## Use it in a team

- **One owner decides policy.** The owner reviews changes to `taskquoin.yaml` like code (it is a normal committed file)
  and is the only person who runs `accept-risk`.
- **Everyone uses the same runtime versions.** The gate is per exact version; a teammate with a newer Claude Code will
  see `NOT READY`.
- **Use `--as` with your real name.** It lands in the commit trailers (`Plan-Approved-By`, `Commit-Approved-By`). The approver is whoever runs `taskquoin approve` on the machine where the run lives, so
  agree on who that is.
- **Use an independent reviewer.** A judge from another model family catches what the implementer's family tends to
  miss; add an API judge or Codex. `doctor` warns when reviewer and implementer share a model.
- **Know where code goes.** `doctor` lists every destination. Listing a provider in `providers` is the project's
  consent to send it code, so review those changes in pull requests.
- **Merge deliberately.** Taskquoin never pushes. Merge `taskquoin/<run id>` yourself (a fast-forward, or a pull
  request), and run the repository's commit hooks then.

## Use it in CI

Approvals are human by design, so Taskquoin does not run unattended end to end. CI is the right place for the checks
that do not need a human:

- **Validate the configuration on every change**: `taskquoin check <agent> --json` parses `taskquoin.yaml` strictly
  and reports whether each agent can run, with exit code 0 or 1.
- **Pin runtime versions** to the measured ones, so the gate matches what you run locally.
- **Protect the file**: require review on `taskquoin.yaml` through your code-owner rules, since it defines what agents may do.
- **Read the audit trail**: `status --json` gives each run's state; commits carry `Taskquoin-Run`, `Taskquoin-Tree`,
  `RED-Proof` and approver trailers to filter on.

> [!NOTE]
> CI needs the control store and the runtimes on its machine for `check` to say more than "not installed". Start with
> the strict parse (`taskquoin doctor` fails fast on an invalid file) and add the rest as it suits you.

## Learn more

- [Configuration](configuration.md), [Approvals](approvals.md), [Verify and the RED proof](verify-and-red-proof.md), [Troubleshooting](troubleshooting.md).
- [ADR-0011: agents never commit](../adr/0011-agents-never-commit.md), [ADR-0013: tree-based governance](../adr/0013-tree-based-governance.md).
