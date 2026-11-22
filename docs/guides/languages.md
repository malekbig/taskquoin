# Languages

Taskquoin's command line, console and messages are available in 22 languages. The language never changes what
Taskquoin does or what it writes for machines: only the words addressed to you. This page lists the languages, shows how
one is chosen, and explains what stays in English on purpose.

- [Supported languages](#supported-languages)
- [How the language is chosen](#how-the-language-is-chosen)
- [What stays in English](#what-stays-in-english)
- [Agents write in your language](#agents-write-in-your-language)
- [Quality of the translations](#quality-of-the-translations)

> [!NOTE]
> Screens come from a demo repository with simulated AI agents (the test doubles of Taskquoin's own test suite); every
> command is the real Taskquoin CLI.

## Supported languages

| Code | Language | Native name | Translation |
|---|---|---|---|
| `en` | English | English | source text, written by hand |
| `fr` | French | Français | written by hand |
| `es` | Spanish | Español | machine |
| `pt-BR` | Brazilian Portuguese | Português (Brasil) | machine |
| `de` | German | Deutsch | machine |
| `it` | Italian | Italiano | machine |
| `nl` | Dutch | Nederlands | machine |
| `pl` | Polish | Polski | machine |
| `ru` | Russian | Русский | machine |
| `uk` | Ukrainian | Українська | machine |
| `tr` | Turkish | Türkçe | machine |
| `ar` | Arabic | العربية | machine (right to left) |
| `fa` | Persian | فارسی | machine (right to left) |
| `he` | Hebrew | עברית | machine (right to left) |
| `hi` | Hindi | हिन्दी | machine |
| `id` | Indonesian | Bahasa Indonesia | machine |
| `vi` | Vietnamese | Tiếng Việt | machine |
| `th` | Thai | ไทย | machine |
| `zh-CN` | Simplified Chinese | 简体中文 | machine |
| `zh-TW` | Traditional Chinese | 繁體中文 | machine |
| `ja` | Japanese | 日本語 | machine |
| `ko` | Korean | 한국어 | machine |

Columns are aligned by display width, so wide (CJK) characters line up in the console and in `help`.

## How the language is chosen

Taskquoin looks at these sources in order and takes the first one that names a supported language:

1. the environment variable `TASKQUOIN_LANG`;
2. the saved preference, `preferences.json` in the Taskquoin state directory;
3. `LC_ALL`;
4. `LC_MESSAGES`;
5. `LANG`;
6. English.

```console
$ TASKQUOIN_LANG=fr taskquoin doctor     # one command
$ export TASKQUOIN_LANG=de               # a whole shell session
```

The saved preference is a small JSON file next to the control store, `${XDG_STATE_HOME:-~/.local/state}/taskquoin/preferences.json`.
This version has no command that writes it; create it yourself:

```json
{ "language": "fr" }
```

A missing, unreadable or invalid file is ignored.

Values are matched forgivingly: the encoding and modifier are dropped (`fr_FR.UTF-8` is `fr`), case does not matter
(`PT_br`), and a region falls back to its language (`en_GB` is `en`, `fr_CA` is `fr`). `pt` alone gives `pt-BR`; `zh` gives
`zh-CN`, except `zh_TW`, `zh_HK`, `zh_MO` and `zh-Hant`, which give `zh-TW`; the old codes `iw` and `in` mean `he` and `id`.
An unsupported value (`xx`) is skipped and the next source is tried.

`LC_ALL=C` (or `POSIX`, with or without an encoding) forces English, which is what scripts and CI usually want. It is
evaluated after `TASKQUOIN_LANG` and the saved preference, so those two still win over it.

## What stays in English

Some text is English in every language, deliberately:

- **Machine output.** `check --json`, `status --json` and the event log do not depend on the language. The failure messages
  that end up in `check --json` are produced from the English catalog so that the output is byte-identical whatever
  language you use.
- **Command names and options.** `taskquoin run`, `--expect`, `--as`, and the console's `/run`, `/approve`... are never
  translated. A test checks that no translation changes a `/command`.
- **The banner's brand.** The tagline, the slogan and the role names (Architect, Developer, Reviewer, Security, Tester) and
  the words `READY` / `NOT READY` of the console banner. The notes after a status (an accepted risk, why an agent is
  not ready) are translated.
- **Identifiers.** Run ids, hashes, artifact names (`plan`, `diff-1`, `verify-1`...), capability names, node names and
  statuses (`waiting-approval`, `needs-human`).
- **Commit messages and trailers.** `Taskquoin-Run:`, `Plan-Approved-By:`, `RED-Proof:` and the rest.
- **The reason of a run that stops.** `failed`, `needs-human` and `interrupted` come from the workflow engine, not from the
  translated catalog.

## Agents write in your language

When you start a run in a non-English language, Taskquoin tells the agents so. The language is recorded in the run when
it starts (as the English name of the language) and kept by `resume`, so a run keeps one language even if your locale
changes. The planner, the challengers and the reviewers receive this instruction:

> Write your prose for the human in French. Code, identifiers, code comments, commit messages and the VERDICT line stay
> exactly as specified, in English.

In practice: the plan, the challenge and the review you read at the gates are in your language; the code, the comments,
the commit message and the final `VERDICT: APPROVE` / `VERDICT: CHANGES_REQUESTED` line are not. The strict verdict line
is how Taskquoin decides, so it never moves. For an English run no instruction is added.

This is a request to a model, not an enforced rule: an agent can still answer in English, and Taskquoin reads the verdict
line only.

## Quality of the translations

- **English and French are written and maintained by hand.** French is complete: a test requires every English key except
  the English-only and brand ones.
- **The 20 other languages are machine translations.** They have not been reviewed by native speakers.
- **Tests keep them safe, not good.** For every language a test checks that the file parses, that it holds no key unknown to
  English, that each message keeps exactly the same `{parameters}`, and that every `/command` word is unchanged, and that no
  English-only or brand key leaks into a catalog. The tests do not judge whether a translation is accurate or idiomatic.
- **Missing keys fall back to English, one key at a time.** A machine language can be incomplete without breaking
  anything; a corrupt translation file is reported once on stderr and English is used.
- Plural forms follow each language's own rules (for example "1 line" and "2 lines").

If a translation reads badly, English is always one variable away: `TASKQUOIN_LANG=en`.

## Learn more

- [CLI reference](../reference/cli.md)
- [Console commands](../reference/console-commands.md)
- [Security](security.md)
