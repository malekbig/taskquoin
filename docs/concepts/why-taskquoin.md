# Why Taskquoin

A coding agent working alone follows instructions, and decides by itself when the work is done. Taskquoin makes the
agent *unable* to do what it must not do, makes *you* decide what it cannot decide alone, and tells you which is which.
This page is a benchmark of measured guarantees: each row ties a risk to the mechanism that handles it and to the
measurement or test that proves it. It also says what Taskquoin costs, where its limits are, and what has not been
measured yet.

- [The role of Taskquoin](#the-role-of-taskquoin)
- [How to read the benchmark](#how-to-read-the-benchmark)
- [Measured guarantees](#measured-guarantees)
- [What it costs](#what-it-costs)
- [Limits](#limits)
- [Not measured yet](#not-measured-yet)
- [Learn more](#learn-more)

Screens come from a demo repository with simulated AI agents (the test doubles of Taskquoin's own test suite); every
command is the real Taskquoin CLI.

## The role of Taskquoin

Instructions in `CLAUDE.md` or `AGENTS.md` decay as the context fills; a check in the loop does not
([ADR-0003](../adr/0003-hooks-enforce-prose-asks.md)). Taskquoin puts the checks in the loop. Every write to disk,
every shell command and every "it's done" claim gets one of three statuses:

1. **Enforced** by a mechanism Taskquoin can name and test: an OS sandbox, a permission rule, a hook.
2. **Approved by you**, with the approval bound to the exact hash you read.
3. **Labelled advisory**, in plain sight: `taskquoin doctor` prints it, and a mandatory restriction that is only
   advisory on your runtime version refuses the agent.

In practice, Taskquoin takes three decisions away from the model:

- **Whether the tests pass.** Taskquoin reruns your test command itself, in a clean room, on the exact tree. The
  agent's "all green" is not evidence.
- **Whether the change is accepted.** You approve twice, the plan and then the diff, each time naming its hash.
- **What is committed.** Taskquoin commits exactly the approved tree on `taskquoin/<run>`. Agents never commit, and
  nothing is pushed.

The [architecture](architecture.md) page explains how the parts fit together.

## How to read the benchmark

The column *How it is enforced* uses these labels:

| Label | Meaning |
|---|---|
| **ENFORCED, measured** | A mechanism outside the model blocks the action, and a live run of the real runtime, on the pinned version, recorded the block. |
| **Workflow rule, tested** | Taskquoin does it itself (it runs the tests, builds the tree, commits). An end-to-end scenario checks it on every test run. |
| **Policy gate, tested** | The check `prepareRun` makes before every agent; checked by scenarios and unit tests. |
| **By construction** | No tool path exists: an API judge only receives text. |

You can see the classes for your own agents and runtime versions at any time. With the default profile:

```shell
$ taskquoin check challenger
Agent challenger (codex)
  ✔ fs.write ENFORCED — read-only sandbox: no filesystem writes
  ✔ net.egress ENFORCED — network_access=false (measured: loopback HTTP 0 hits in read-only and workspace-write); web_search disabled and plugin/app/browser/computer-use features off by flag (documented, not separately measured)
  ✔ config.modify ENFORCED — read-only sandbox: no writes at all
  ✖ connector.write — mandatory restriction "connector.write" (deny-all) on codex 0.157.1: claimed ENFORCED but the mechanism is not measured (inferred). Execution refused (ADR-0002).
  ✔ vcs.commit ENFORCED — the sandbox keeps .git read-only in both modes: git commit fails (measured)
  ✔ vcs.push ENFORCED — no network and no writable root outside the workspace/scratch ⇒ a push reaches neither a network remote nor a local-path remote outside them (measured M3); a bare remote created INSIDE the workspace stays reachable (within the boundary)
```

The *Evidence* column cites three kinds of proof:

- **Live**: a run of the real Claude Code, Codex or OpenCode, recorded in `docs/reports/evidence-*.txt`.
- **Scenario**: one of the 64 Gherkin scenarios in [`features/`](../../features/README.md). They run the real CLI, real
  git and real bubblewrap, with simulated agents, on every `npm test`. Scenarios tagged `@sandbox` need bubblewrap and
  socat, and are skipped with the reason otherwise.
- **Pilot**: a real governed run on a real repository, summarised in `docs/reports/pilots-summary.md`.

> [!NOTE]
> Scenario titles are quoted exactly as written: the executable specification in `features/` is in French. All live
> measurements and pilots come from one reference machine (Linux on WSL2, ext4, bubblewrap 0.6.1). Live probes are
> cooperative: the agent is asked to attempt each forbidden action, which proves that the mechanism blocks it, not that
> an adversarial model could find no other path (`tests/live-contract.e2e.test.ts`: "the prompt is cooperative, the
> boundary is what is tested").

## Measured guarantees

### Files, commands and configuration

| Risk when an agent works alone | What Taskquoin does | How it is enforced (class) | Evidence |
|---|---|---|---|
| The agent writes files it was not asked to touch, or outside the project | Grants writes per glob; every other write is denied | Claude Code permission rules under `dontAsk`, plus Taskquoin's hook. **ENFORCED, measured** | Live, Claude Code 2.1.327 ([evidence][L327]): 3 `Write` denials and 1 `Read` denial; `forbidden/no.txt`, `.claude/settings.json` and the file outside the workspace are not written; the allowed file is (positive control) |
| A command the agent runs writes outside the workspace or into `/tmp` | Commands run in Claude Code's OS sandbox, whose only write root is the workspace | bubblewrap sandbox. **ENFORCED, measured** for the workspace boundary (not per glob) | Live ([evidence][L327], sandbox): writes outside and to `/tmp` exit 2, files absent. Codex writer: `outside=false`, `tmp=false` |
| An allowed command pattern is stretched with `&&`, `;`, `$(…)` or backticks | Allow rules match the whole command | Claude Code `Bash(pattern)` rules. **ENFORCED, measured** | Live ([evidence][L327], bash-operators): 4 of 4 compound commands denied; none of the 4 files created |
| The agent edits its own guardrails: `.claude/settings.json`, `taskquoin.yaml`, `AGENTS.md` | Protected paths are denied when written and refused when landing | sandbox `denyWrite`, hook, landing gate. **ENFORCED, measured** | Live ([evidence][L327], sandbox): the `.claude/` write exits 2, file absent. Scenarios [`workflow-gouverne.feature`][WF] "Une modification de configuration protégée n'atterrit jamais", "Renommer un fichier d'instructions protégé est bloqué à l'atterrissage" |
| A write reaches a protected file through a symlink | The hook checks the physical path | PreToolUse hook (CONFIG001). **ENFORCED, measured** | Live ([evidence][L327], hooks B): blocked by the hook, target `ORIGINAL` |
| The guard crashes and lets everything through | The hook is declared `onFailure: block` and exits 2 on any error | fail closed. **ENFORCED, measured** | Live ([evidence][L327], hooks D): a crashing hook, the file is not created |
| The agent commits, pushes, or skips hooks with `--no-verify` | Agents never commit; `.git` is read-only for them | OS sandbox, plus GIT001 as defense in depth. **ENFORCED, measured** | Live ([evidence][L327], hooks C): `--no-verify` blocked by GIT001; a plain `git commit` fails with `Read-only file system`; `git push` exits 1. Codex writer: commit exits 128, push exits 1, remote unchanged |
| The headless agent inherits your global setup: plugins, MCP servers, hooks | Runs load none of your settings and no MCP server | `--setting-sources ""`, `--strict-mcp-config`. **ENFORCED, measured** | Before isolation, a headless Claude Code run on the reference machine loaded 12 plugins, 13 MCP servers and three hook events; with `--setting-sources ""`, 0 hooks and 0 MCP servers (measurement recorded in `adapters/runtime-claude/src/command.ts`). Now the run's own inventory shows `mcpServers=[]` and the tools `Read, Grep, Glob`, plus `Bash` only when granted (live [evidence][L327], M1) |
| The agent changes a dependency (`node_modules`) so the tests pass with code that is not in the commit | Dependency directories are frozen for agents and fingerprinted | sandbox `denyWrite`, FROZEN001 hook, ctime fingerprint. **ENFORCED, measured** | Live ([evidence][L327], frozen): overwrite, create, mkdir, write through a link and rm inside `node_modules` all fail; the Write tool is denied; the original file is unchanged. Scenario "Une dépendance modifiée pendant le run arrête tout avant la vérification" |

### Network and secrets

| Risk when an agent works alone | What Taskquoin does | How it is enforced (class) | Evidence |
|---|---|---|---|
| Data leaves your machine through a command the agent runs, or through the repository code that command runs | Commands get no network at all, loopback included | Claude Code: OS sandbox with an empty allowlist. Codex: `network_access=false`. **ENFORCED, measured** | Live ([evidence][L327]): Claude sandbox, local HTTP server 0 hits, `curl` exits 7 on loopback and 56 on the internet. Codex read-only and writer: 0 hits (M2, M3) |
| The sandbox is missing, and the agent runs its commands unsandboxed | `failIfUnavailable`: the run is refused | **ENFORCED, measured** | Live ([evidence][R21NL]), bubblewrap and socat absent: `status=failed reason=sandbox-unavailable cost=0` |
| The agent reads `.env` and repeats it | Secret files are denied to the Read tool and to commands | permission rules and sandbox `denyRead`. **ENFORCED, measured** for listed secret files | Live ([evidence][L327]): `canaryLeaked=false`; `cat .env` exits 1 inside the sandbox |
| OpenCode has no OS sandbox of its own | Taskquoin's bubblewrap profile, and no command tool | **ENFORCED, measured** on OpenCode 1.19.5 with a ChatGPT sign-in | Live ([evidence][OC]): no write outside, no shell marker, 0 loopback hits, the environment secret absent from the result; the only host contacted was `chatgpt.com:443` |
| A local tool that Taskquoin runs (a scanner) phones home | A fresh user and network namespace (`unshare -rn`) | **ENFORCED**, tested offline | 0 hits on a local server, against 1 for the positive control ([ADR-0010](../adr/0010-local-first-no-leak.md) §4) |
| A third-party judge receives your secrets or binaries | Placeholders replace secret files and binary changes; you still approve the full diff | **By construction** | Scenario [`juges-api.feature`][JA] "Un secret et un binaire modifiés ne sont jamais envoyés au juge": the canary is in no request, and is in `diff-1` |

### "Done" means verified

| Risk when an agent works alone | What Taskquoin does | How it is enforced (class) | Evidence |
|---|---|---|---|
| The agent says "tests pass" | Taskquoin reruns your test command itself, on the exact tree, in a clean room | **Workflow rule, tested** | Pilot 3 ([report][P3]): Verify caught a broken scenario the agent could not see; its own sandbox skipped 53 tests, the clean room 12. Scenario "Des tests rouges déclenchent au plus deux reprises, puis la main revient à l'humain" |
| The new tests pass without the change (a tautology) | RED proof: the base tree plus only the changed tests must fail, conclusively | **Workflow rule, tested** | Scenarios "Des tests qui passent sans le changement de production ne prouvent rien (preuve RED)", "Une preuve RED dont la sortie est tronquée n'est pas une preuve". Pilots 2 and 3: RED proven, the log read by the reviewer ([P2], [P3]) |
| The tests pass thanks to an ignored file that is never committed | Verify sees only the tree and the read-only dependency directories; ignored files the agent left are listed before your approval | clean room. **Workflow rule, tested** | Scenarios "Un fichier ignoré laissé par l'agent n'est pas vu par la vérification", "Les fichiers ignorés laissés par l'agent sont montrés avant l'approbation du commit". On a real project, the clean room gives the in-place result: 248 tests, 237 pass, 0 fail, 11 skipped ([evidence][CR]) |
| Test code plants a git hook that runs later on your machine | `.git` is read-only in Verify; Taskquoin's git calls run with hooks off | **Workflow rule, tested** | Scenario "Un test ne peut pas poser un hook git pendant la vérification". Pilots 1 and 2: no hook executed ([P1], [P2]) |
| The tests rewrite the code under test | The clean room's tree is recomputed after the run | **Workflow rule, tested** | Scenario "Des tests qui modifient le dépôt pendant la vérification échouent" |
| A link in the tree or in a dependency points outside the repository | Verify refuses, and resolves links inside the sandbox the tests get | **Workflow rule, tested** | 5 scenarios, among them "Un lien symbolique vers l'extérieur du dépôt bloque la vérification" and "Une dépendance qui pointe hors du dépôt bloque la vérification" |
| A secret inside a dependency is visible to the tests | Secret files are masked, even behind a link or inside a dependency's `.git` | **Workflow rule, tested** | Scenarios "Un secret rangé dans une dépendance reste masqué pendant la vérification", "Les secrets d'une dépendance restent masqués même derrière un lien ou dans son .git": the canaries are absent from the log |

### Approvals and commits

| Risk when an agent works alone | What Taskquoin does | How it is enforced (class) | Evidence |
|---|---|---|---|
| You approve something other than what you read, or an old approval is replayed | Each approval names the gate and at least 12 characters of the hash | **Workflow rule, tested** | Scenario "Rejouer une approbation ou approuver sans avoir lu est refusé"; [`console.feature`][CO] "Un hash mal retapé n'approuve rien" |
| The code changes after you approved it | The approval is dropped; Verify and the review run again | **Workflow rule, tested** | Scenario "Si l'arbre change après l'approbation, Taskquoin revérifie et refait la revue" |
| The commit differs from what was tested, reviewed and approved | `git commit-tree` of the approved tree, then a compare-and-swap; nothing is pushed | **Workflow rule, tested** | Pilots 1, 2 and 3: the commit's tree is exactly the approved tree (`ebbf47cd…`, `95efdb06…`, `5a92824e…`); pilots 1 and 2 also record that nothing was pushed ([P1], [P2], [P3]). Scenario "Une demande aboutit à un commit vérifié, après deux approbations humaines" |
| An agent approves its own work | Approvals live in the control store, outside the workspace, and agents cannot write outside the workspace | OS sandbox. **ENFORCED, measured** | Live ([evidence][L327]): writes outside the workspace fail for Claude Code commands and for Codex. [ADR-0015](../adr/0015-console-human-only.md) |
| An ambiguous review is read as a yes | Only one strict final `VERDICT:` line counts; anything else is `CHANGES_REQUESTED` | **Workflow rule, tested** | Scenario "Un verdict ambigu du relecteur vaut un refus" |
| One lenient reviewer outvotes a strict one | Every listed reviewer must approve | **Workflow rule, tested** | Scenario "Un juge par API qui refuse toujours rend la main à l'humain en le nommant" |
| A run starts on top of your uncommitted work | Refused | **Workflow rule, tested** | Scenario "Taskquoin refuse de démarrer sur un dépôt avec des modifications non commitées" |

Every Taskquoin commit states what was checked, in its trailers:

![git log shows the Taskquoin trailers of a commit](../assets/screens/en/commit.svg)

### Policy and supply chain

| Risk when an agent works alone | What Taskquoin does | How it is enforced (class) | Evidence |
|---|---|---|---|
| A guarantee rests on documentation, not on a measurement | Only `measured` mechanisms certify a mandatory restriction; otherwise the agent is refused | **Policy gate, tested** | `taskquoin doctor` refuses the Codex challenger for `connector.write` (inferred). Scenarios [`commandes.feature`][CMD] "doctor certifie chaque agent et refuse celui qui ne peut pas l'être", [`politique.feature`][POL] "Sans acceptation de risque, le challenger Codex est refusé et le run s'arrête avant lui" |
| The repository lowers its own bar | The mandatory floor cannot be removed; risk acceptances come only from `taskquoin accept-risk`, dated, stored outside the repository | **Policy gate, tested** | Scenarios "Le dépôt ne peut pas retirer le plancher de restrictions obligatoires", "Le dépôt ne peut pas s'auto-approuver un risque" |
| A runtime update changes behaviour silently | The matrix is bound to one runtime version; any other version fails every mandatory restriction | **Policy gate, tested** | Unit test "runtime version mismatch fails every mandatory restriction closed" (`packages/domain/test/enforcement.test.ts`); Claude Code 2.1.327 re-measured with every live suite ([evidence][L327]) |
| A downloaded skill runs code or reads secrets | Local import, quarantine and audit, your approval, then a re-hash at every use | **Workflow rule, tested** | Scenarios [`skills.feature`][SK] "un skill externe qui exécute du code téléchargé reste bloqué en quarantaine", "un skill approuvé puis modifié est refusé" |
| A provider outage loses the work, or you pay a judge twice | The run stops in `interrupted`; `taskquoin resume` asks only the judges that have not answered | **Workflow rule, tested** | Scenario "Une panne du fournisseur laisse un run reprenable, sans redemander à Codex": 3 requests before the stop, 1 more after the resume |

## What it costs

### Your time

You read and approve twice per run: the plan, then the diff with the Verify log, the RED log and the review. On the
first pilot, the whole run took about 8 min 30 s, of which about 5 min was spent waiting for the human ([P1]).

| Pilot | Request | Attempts | Time | Model cost |
|---|---|---|---|---|
| [1][P1] | add a `taskquoin version` command | 1 | ≈ 8 min 30 s, about 5 min of it waiting for the human | Claude Code ≈ $0.49 API-equivalent (plan ≈ $0.18, implement ≈ $0.31), run on a subscription, nothing billed; Codex not measured |
| [2][P2] | `taskquoin status --json` | 1 | plan at 20:08:03, commit approval at about 20:19 (UTC) | not reported |
| [3][P3] | `taskquoin show <run>` lists the artifacts | 2 | plan at 21:59:25, commit approval at about 22:25 (UTC) | subscription quotas only, nothing billed; amounts not reported |

> [!NOTE]
> One cost figure from one pilot is not a typical cost. The cost of a governed run against an agent working alone is
> not measured yet: see [Not measured yet](#not-measured-yet).

### Machine time

| What Taskquoin adds | Measured | Source |
|---|---|---|
| Verify in the clean room | 73 s for a 248-test suite, against about 74 s for the same suite in place | [evidence-cleanroom][CR] M3 |
| The RED proof | runs the suite a second time: Verify time doubles | [ADR-0013](../adr/0013-tree-based-governance.md) |
| Materializing the tree | 36 ms for 194 files | [evidence-cleanroom][CR] M2 |
| Fingerprinting the dependencies | 237 to 329 ms for a 749 MB `node_modules` (42,843 entries) | [evidence-cleanroom][CR] M4 |
| The PreToolUse hook | about 120 ms per tool call | [ADR-0003](../adr/0003-hooks-enforce-prose-asks.md), amendment |
| Reworks | up to two more rounds of implement, Verify and review (three attempts in all; five for an OpenCode implementer when the tests fail) | `packages/application/src/workflow/feature-governed.ts` |

### Constraints you accept

- **Linux, with bubblewrap and socat.** Without them, an agent that has a shell is refused before any model call
  (measured, [evidence][R21NL]).
- **A risk acceptance for the Codex challenger.** Its `connector.write` restriction cannot be measured, so
  `taskquoin doctor` refuses it until you run `taskquoin accept-risk`.
- **Verify fails closed.** Tests that need the network, HOME files or secret files fail. Tests that rely on ignored
  files other than the dependency directories fail until you list them under `verify.inherit`. Build outputs are
  rebuilt from scratch ([ADR-0013](../adr/0013-tree-based-governance.md), [ADR-0014](../adr/0014-verify-in-a-clean-room.md)).
- **Repository commit hooks are not run** by Taskquoin; run them yourself when you merge.
- **Each runtime update needs a re-measure.** Until the live suites re-measure the new version, its agents are refused.
  The Claude Code 2.1.327 re-measure reports a cost between $0.018 and $0.213 API-equivalent per suite
  ([evidence][L327]).
- **API judges are pay-per-use**, and a provider's free tier may train on what it receives. Retries wait up to about
  10 s before the run stops in `interrupted` ([ADR-0016](../adr/0016-judges-by-api.md)).

## Limits

These come from the honest-limits sections of the ADRs, from `SECURITY.md` and from the capability matrices. Taskquoin does not make a workflow
"secure": it makes each restriction's class explicit, refuses what it cannot enforce, and keeps the decisions that
matter with you.

**Threat model**

- A hostile process already running as your OS user is out of scope
  ([ADR-0007](../adr/0007-human-decisions-2026-11-15.md)).
- The AI providers receive the code and prompts sent to them, by definition of the exception
  ([ADR-0010](../adr/0010-local-first-no-leak.md)). A `taskquoin.yaml` you approve can send any environment variable
  named in `key: env:NAME` to the provider host it lists: review `providers` like code ([SECURITY.md](../../SECURITY.md)).

**Enforcement**

- Hooks see only the tool calls the model issues, never what an allowed command does in a subprocess; the OS sandbox
  covers subprocesses ([ADR-0003](../adr/0003-hooks-enforce-prose-asks.md)).
- On Claude Code, commands can write anywhere in the workspace: per-glob scope holds for the Edit and Write tools only
  ([ADR-0014](../adr/0014-verify-in-a-clean-room.md), context; `adapters/runtime-claude/src/capabilities.json`). The
  review and the landing gate cover what lands.
- Reads are not confined for an implementer with a shell (apart from listed secret files and the control store), nor
  for Codex, which can read anything your user can (`adapters/runtime-claude/src/capabilities.json`,
  `adapters/runtime-codex/src/capabilities.json`). What a Codex judge reads goes to its provider.
- GIT001 reads the command text (`packages/rules/src/rules.ts`), so a script or an alias can evade it: it is defense in
  depth, and the read-only `.git` is the real control ([ADR-0011](../adr/0011-agents-never-commit.md)). For Grep and
  Glob, the hook checks the search root only, not each result (`adapters/hooks-claude/src/payload.ts`).
- Codex's tool inventory evidence is a model self-report ([ADR-0010](../adr/0010-local-first-no-leak.md)), and Codex
  can only be a read-only reviewer when path-scoped rules are mandatory
  ([ADR-0008](../adr/0008-evidence-is-bound-to-a-mechanism.md)).
- Claude Code's run inventory shows no MCP server, but still lists three plugins (`cc-plugin-agents-md`,
  `cc-plugin-privacy`, `cc-plugin-plugin-authoring`) ([evidence][L327], M1).
- OpenCode: its in-process rules are what keeps its read tool off its own provider's per-run credential; the plugin SDK
  it loads runs in-process; its turn limit is documented, not measured
  ([ADR-0017](../adr/0017-opencode-without-commands.md)).

**Verify and the RED proof** ([ADR-0013](../adr/0013-tree-based-governance.md), [ADR-0014](../adr/0014-verify-in-a-clean-room.md))

- The RED proof is mechanical: it shows that the changed tests fail without the rest of the change, not that they test
  the requested behaviour. That stays the reviewer's and your judgement, with the RED log in hand.
- Production code under `test/` or `tests/` passes as test code; a launch failure that exits with code 1 looks like a
  test failure; a base whose suite already fails proves RED trivially; a test helper outside the test path patterns
  counts as production code.
- A refactor or a docs-only change without a new failing test ends in `needs-human`: `feature-governed` is for
  behaviour changes.
- Tests are code: in Verify they can read host paths the sandbox leaves visible, and a secret-*named directory* is not
  masked. Repositories with submodules are not supported.

**Approvals and state**

- `--as` is attribution, not authentication: Taskquoin records the name you give (`approve()` in
  `packages/application/src/workflow/feature-governed.ts`), and anyone who can run the CLI as your OS user can approve.
- The control store is per machine; sharing approvals in a team is not designed yet
  ([ADR-0005](../adr/0005-control-plane-outside-workspace.md)).
- claude-mem's worker API is unauthenticated on loopback: recalled memory may be stale or poisoned, so Taskquoin gives
  it to the agent as untrusted reference data ([ADR-0009](../adr/0009-claude-mem-as-memory.md)).

**Scope**

- The Action Broker is not implemented: Taskquoin opens no pull request and pushes nothing
  ([ADR-0004](../adr/0004-agents-propose-broker-acts.md)).
- Certified versions are Claude Code 2.1.327, Codex 0.157.1 and OpenCode 1.19.5 with a ChatGPT sign-in; other
  OpenCode sign-ins are refused until their hosts are measured ([ADR-0017](../adr/0017-opencode-without-commands.md)).
- macOS and Windows are not verified ([README](../../README.md)).

## Not measured yet

> [!IMPORTANT]
> A comparative live benchmark is planned: the same tasks given to Claude Code alone, to Codex alone, to GitHub Copilot,
> and through Taskquoin. It will be run on another machine. **No numbers exist for it today.** Nothing on this page
> compares the quality, speed or cost of Taskquoin's output with an agent working alone.

Also not measured:

- **The overall benefit against the raw CLIs.** The first release was scoped so that it could be measured
  ([ADR-0006](../adr/0006-mvp-scope-and-deferrals.md)); it has not been measured yet.
- **A typical cost and duration per run.** One pilot reports a cost; that is a data point, not an average.
- **Some restrictions stay `inferred` or `documented`**, so they cannot certify: Codex `connector.write` (Codex exposes
  no deterministic MCP inventory, hence the risk acceptance), reads by Codex, the read scope of the Claude Code planner,
  and OpenCode's turn limit. The matrices (`adapters/runtime-*/src/capabilities.json`) give the evidence level of
  every entry; `taskquoin check <agent>` shows which mandatory restrictions are certified for that agent.
- **Adversarial probes.** The live probes are cooperative.
- **Other platforms and versions**: macOS, Windows, other runtime versions, OpenCode with API keys, Copilot or local
  models.

## Learn more

- [Architecture](architecture.md): the parts, the layers, the workflow and the trust boundaries
- [Documentation home](../README.md)
- Guides: [Security](../guides/security.md), [Best practices](../guides/best-practices.md); reference:
  [Capabilities](../reference/capabilities.md)
- The evidence: [`docs/reports/`](../reports/), in particular the latest re-measure ([L327]), the clean room ([CR]) and
  the pilots ([P1], [P2], [P3])
- The executable specification: [`features/`](../../features/README.md)
- [Threat model](../security/threat-model.md) and [SECURITY.md](../../SECURITY.md)
- ADRs: [0002 enforcement classes](../adr/0002-enforcement-classes.md),
  [0008 evidence bound to a mechanism](../adr/0008-evidence-is-bound-to-a-mechanism.md),
  [0010 local first, no leak](../adr/0010-local-first-no-leak.md),
  [0011 agents never commit](../adr/0011-agents-never-commit.md),
  [0013 tree-based governance](../adr/0013-tree-based-governance.md),
  [0014 Verify in a clean room](../adr/0014-verify-in-a-clean-room.md),
  [0016 judges by API](../adr/0016-judges-by-api.md),
  [0017 OpenCode without commands](../adr/0017-opencode-without-commands.md)

[L327]: ../reports/evidence-live-claude-2.1.327-2026-11-18.txt
[R21NL]: ../reports/evidence-live-R2.1-no-leak-2026-11-15.txt
[OC]: ../reports/evidence-live-opencode-2026-11-16.txt
[CR]: ../reports/evidence-cleanroom-2026-11-15.txt
[P1]: ../reports/pilots-summary.md#pilot-1
[P2]: ../reports/pilots-summary.md#pilot-2
[P3]: ../reports/pilots-summary.md#pilot-3
[WF]: ../../features/workflow-gouverne.feature
[JA]: ../../features/juges-api.feature
[CO]: ../../features/console.feature
[CMD]: ../../features/commandes.feature
[POL]: ../../features/politique.feature
[SK]: ../../features/skills.feature
