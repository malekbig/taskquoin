# Taskquoin documentation

Taskquoin lets AI coding agents — Claude Code, OpenAI Codex, OpenCode and any OpenAI-compatible model — work on your
repository **under rules that are enforced, not suggested**: every sensitive capability is checked against what was
measured for the exact runtime version, your tests run in a clean room with a proof that they matter, and nothing is
committed until **you** approve the exact plan and the exact tree, by hash.

Start with the tutorial; come back to the guides when you need a topic; use the reference when you need a detail.

## Getting started

| Page | What you learn |
|---|---|
| [Installation](getting-started/installation.md) | requirements, install from source or npm, first launch, `doctor`, removal |
| [Your first governed run](getting-started/first-run.md) | **the tutorial**: from a failing test to a verified commit, every step with real screens |
| [The console](getting-started/console.md) | `taskquoin` alone: the squad, the `/` commands, approving by retyping the hash |

### The tutorial in your language

| | | | |
|---|---|---|---|
| [English](getting-started/first-run.md) | [Français](tutorial/fr.md) | [Español](tutorial/es.md) | [Português (Brasil)](tutorial/pt-BR.md) |
| [Deutsch](tutorial/de.md) | [Italiano](tutorial/it.md) | [Nederlands](tutorial/nl.md) | [Polski](tutorial/pl.md) |
| [Русский](tutorial/ru.md) | [Українська](tutorial/uk.md) | [Türkçe](tutorial/tr.md) | [العربية](tutorial/ar.md) |
| [فارسی](tutorial/fa.md) | [עברית](tutorial/he.md) | [हिन्दी](tutorial/hi.md) | [Bahasa Indonesia](tutorial/id.md) |
| [Tiếng Việt](tutorial/vi.md) | [ไทย](tutorial/th.md) | [简体中文](tutorial/zh-CN.md) | [繁體中文](tutorial/zh-TW.md) |
| [日本語](tutorial/ja.md) | [한국어](tutorial/ko.md) | | |

Each translated tutorial shows the screens in its own language. English and French are written by hand; the other
20 are machine translations — the English page is the reference.

## Concepts

| Page | What you learn |
|---|---|
| [Why Taskquoin](concepts/why-taskquoin.md) | the role of a control plane, the guarantees it adds — each with its measured evidence — what it costs, its limits |
| [Architecture](concepts/architecture.md) | the big picture, the layers, the workflow state machine and the trust boundaries, as diagrams |

## Guides

| Guide | Topic |
|---|---|
| [Configuration](guides/configuration.md) | `taskquoin.yaml`, section by section |
| [Agents and runtimes](guides/agents-and-runtimes.md) | Architect, Developer, Reviewer, Tester; Claude Code, Codex, OpenCode, API judges; accepted risks |
| [Approvals](guides/approvals.md) | the two human gates, what a hash binds, refusals, resuming |
| [Verify and the RED proof](guides/verify-and-red-proof.md) | your tests in a clean room, and the proof that they fail without the change |
| [Security](guides/security.md) | capabilities, enforcement classes, sandboxes, hooks, secrets, what is not protected |
| [Upgrade](guides/upgrade.md) | runtime versions, the measured Claude Code, `taskquoin upgrade` and `/upgrade` |
| [Skills](guides/skills.md) | pinned first-party skills, importing and approving your own |
| [Memory](guides/memory.md) | the optional local memory of finished runs |
| [Languages](guides/languages.md) | 22 languages for the console, the CLI and the agents' prose |
| [Troubleshooting](guides/troubleshooting.md) | every message, its cause and its fix |
| [Best practices](guides/best-practices.md) | requests, small tasks, reading before approving, teams |

## Reference

| Reference | Content |
|---|---|
| [CLI](reference/cli.md) | every command, option and exit code |
| [Console commands](reference/console-commands.md) | every `/` command and key |
| [Configuration](reference/configuration.md) | every `taskquoin.yaml` key |
| [Runs, artifacts and events](reference/runs-artifacts-events.md) | statuses, workflow nodes, artifacts, the event log, the control store |
| [Capabilities](reference/capabilities.md) | the measured capability matrix of each runtime |

## Decisions and evidence

- [Architecture decision records](adr/) — why each rule exists (ADR-0001 to ADR-0017).
- [Measured evidence](reports/) — the live measurements behind the capability matrices.

> [!NOTE]
> Screens in this documentation come from a demo repository with simulated AI agents (the test doubles of
> Taskquoin's own test suite); every command shown is the real Taskquoin CLI. They are rebuilt with
> `node scripts/docs-screens/build.mjs <work-dir>`.
