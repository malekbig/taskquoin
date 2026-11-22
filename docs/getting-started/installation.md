# Installation

Taskquoin runs on your machine, next to the AI tools you already use. This page lists what it needs, installs it from
source (or from npm once it is published), shows the first launch, and explains how to check and remove it. Nothing is
installed globally and nothing outside the Taskquoin folder and one user-level link is touched.

- [Requirements](#requirements)
- [Install from source](#install-from-source)
- [Install from npm](#install-from-npm)
- [First launch](#first-launch)
- [Check the installation with doctor](#check-the-installation-with-doctor)
- [Update](#update)
- [Removal](#removal)
- [Learn more](#learn-more)

> [!NOTE]
> Taskquoin is an alpha release (2026.11). It is tested on Linux, in WSL2 on ext4, with Claude Code 2.1.327, Codex
> 0.157.1 and OpenCode 1.19.5. macOS and native Windows are not verified yet.

## Requirements

| Requirement | Why | Notes |
|---|---|---|
| Node.js 22.18 or newer | Taskquoin is written in TypeScript and runs it natively | `node --version` |
| git | Taskquoin works on a git repository and builds the final commit with git | The working tree must be clean when a run starts |
| Linux or WSL2 | The only platform tested so far | macOS and Windows are not verified |
| `bubblewrap` and `socat` | The command sandbox and the clean room where your tests run | Required for implementation and Verify |
| At least one agent runtime | Someone has to plan and write the code | See below |

### Agent runtimes

Taskquoin does not contain an AI model. It drives the tools you already have and certifies each one on your machine
(see [`doctor`](#check-the-installation-with-doctor)). You need a way to plan and implement, and ideally a different
one to critique and review:

- **Claude Code**, signed in (`claude auth login`): the default planner and implementer. Claude agents need version
  2.1.327; any other version is refused until it is measured ([ADR](../adr/0008-evidence-is-bound-to-a-mechanism.md)).
- **Codex CLI**, signed in: the default independent challenger and reviewer (version 0.157.1).
- **OpenCode** 1.19.5 (`npm install -g opencode-ai@1.19.5`, then `taskquoin connect opencode`): can replace Claude Code
  for planning and coding, and can also review. See [ADR-0017](../adr/0017-opencode-without-commands.md).
- **An API key** for a judge: any OpenAI-compatible provider (OpenRouter, Mistral, DeepSeek, Gemini, OpenAI, a local
  Ollama) can critique plans and review diffs. The key stays in your environment. See
  [ADR-0016](../adr/0016-judges-by-api.md).

> [!TIP]
> The best setup uses two different vendors: one implements, another reviews. If you only have Claude Code,
> `taskquoin init` says so and the reviewer is Claude as well (same model as the implementer).

Install the system packages first. On Debian or Ubuntu (including WSL2):

```shell
$ sudo apt install -y bubblewrap socat
```

## Install from source

This is the supported way today.

```shell
$ git clone <repository URL> ~/taskquoin
$ cd ~/taskquoin
$ npm install --ignore-scripts
$ bin/taskquoin setup
```

What each step does:

1. `git clone` fetches Taskquoin. Any folder works; `~/taskquoin` is the usual place.
2. `npm install --ignore-scripts` installs the dependencies without running any package script.
3. `bin/taskquoin setup` puts a `taskquoin` command on your PATH.

### The launcher and `setup`

`bin/taskquoin` is a small shell script that runs `apps/cli/src/main.ts` with Node. `setup` links it as
`~/.local/bin/taskquoin`, inside your home directory, without `sudo`:

- It never overwrites a file it did not create. If `~/.local/bin/taskquoin` already exists and is not Taskquoin's, it
  leaves it alone and says so.
- If `~/.local/bin` is not on your PATH, it adds one marked block to `~/.bashrc`
  (`# >>> taskquoin >>>` … `# <<< taskquoin <<<`). Open a new terminal afterwards.
- You do not have to run `setup` yourself: the first launch in a terminal does the same thing (see
  [First launch](#first-launch)). Set `TASKQUOIN_NO_SETUP=1` to prevent it.

Taskquoin never modifies `~/.claude` or `~/.codex`.

## Install from npm

An npm package named `taskquoin` is built by `npm run package` (compiled JavaScript, tested once installed under
`node_modules` and under a path with a space). It is prepared but **not published yet**: the first publish waits for the
maintainer's signing key and the npm and GitHub settings. Until then, `npm install -g taskquoin` is not available; use
the source install above.

When it is published, the release comes from a signed tag through a protected workflow, with npm provenance (see
`SECURITY.md`, "Verifying a release"). An npm install needs no shortcut: npm already puts `taskquoin` on your PATH, so
`taskquoin setup` just says so.

## First launch

Open a terminal and type:

```shell
$ taskquoin
```

In a terminal with no arguments, Taskquoin opens its interactive [console](console.md). On the very first launch from a
source checkout it also prints that the shortcut was installed:

```text
✔ shortcut installed: type taskquoin (link ~/.local/bin/taskquoin). Remove with: taskquoin setup --remove
```

Anywhere else (a script, a pipe), `taskquoin` alone prints the list of commands. You can always ask for it:

```shell
$ taskquoin help
$ taskquoin version
taskquoin 2026.11.1
```

![The Taskquoin console at start-up](../assets/screens/en/console.svg)

*Screens come from a demo repository with simulated AI agents (the test doubles of Taskquoin's own test suite); every
command is the real Taskquoin CLI.*

Commands that work on a project (`init`, `doctor`, `run`, …) must be run inside a git repository. The next page,
[Your first governed run](first-run.md), starts from there.

## Check the installation with doctor

`taskquoin doctor` is the command to run whenever something looks wrong. It needs a project with a `taskquoin.yaml`
(created by `taskquoin init`, see [first run](first-run.md)). It reports:

- which runtimes it found and their versions (`Runtime claude: 2.1.327 … ✔`),
- whether the command sandbox, the file sandbox and the local tool isolation work,
- exactly which AI vendors receive your project's code,
- for each agent, every restriction with its enforcement class and the mechanism that was measured.

![taskquoin doctor](../assets/screens/en/doctor.svg)

A line starting with a check mark is certified. A cross means that agent will not start. The verdict at the bottom
counts them: `Verdict: all 3 agents can run.`

Typical causes of a cross, and the fix:

| What `doctor` says | Fix |
|---|---|
| `Runtime claude: ✖ not found on PATH` (or codex, opencode) | Install and sign in to that tool, or remove the agent that uses it from `taskquoin.yaml` |
| The runtime version differs from the measured one | Taskquoin fails closed on an unmeasured version; install the measured version |
| `Bash sandbox (bubblewrap + socat)` is not a check mark | `sudo apt install -y bubblewrap socat` |
| `connector.write` "not measured (inferred)" on Codex | An owner decision, see [`accept-risk`](first-run.md#accept-a-risk-you-understand) |
| A judge's key is missing | `export NAME_OF_THE_KEY=…` in your environment |

## Update

From a source install, update with git:

```shell
$ cd ~/taskquoin
$ git pull
$ npm install --ignore-scripts
```

The `taskquoin` link points at the launcher in that folder, so it keeps working. Run `taskquoin doctor` afterwards:
agent runtime versions are measured per release, and the changelog (`CHANGELOG.md`) lists what changed.

## Removal

Two separate things can be removed, and each removes only what Taskquoin created.

**From a project: `taskquoin uninstall`.** Run it in the repository. It reads the manifest Taskquoin recorded outside the
repository and removes `taskquoin.yaml` only if it is unchanged since `init`. If you edited it, the file is kept and
the command tells you to remove it yourself.

```shell
$ taskquoin uninstall
✔ removed taskquoin.yaml
- control store kept for audit (~/.local/state/taskquoin/repos/73634f4733eaef0b); use --purge-state to remove it
```

The control store (run history, approvals, risk acceptances) is kept for audit. Add `--purge-state` to delete it too:

```shell
$ taskquoin uninstall --purge-state
```

Branches named `taskquoin/<run>` are yours: Taskquoin never deletes them.

**From your machine: `taskquoin setup --remove`.** It removes the `~/.local/bin/taskquoin` link (only if it points to
this launcher) and the marked block it added to `~/.bashrc`, and records that you opted out, so the automatic setup
never comes back. `taskquoin setup` puts it back.

Finally, delete the `~/taskquoin` folder. That is everything: there is no daemon, no global package, no change to
Claude Code or Codex.

## Learn more

- [Your first governed run](first-run.md): the step-by-step tutorial
- [The interactive console](console.md)
- [ADR-0010, local first](../adr/0010-local-first-no-leak.md): everything runs locally; only the AI providers you configure receive code
- [ADR-0002, enforcement classes](../adr/0002-enforcement-classes.md): what `ENFORCED`, `BROKERED`, `ADVISORY` and `UNSUPPORTED` mean
- [ADR-0008, evidence is bound to a mechanism](../adr/0008-evidence-is-bound-to-a-mechanism.md): why an unmeasured runtime version is refused
