# OpenCode 1.19.5 — measured interface (plan Task 1, 2026-11-16)

Reference machine (WSL2, ext4), `opencode-ai@1.19.5` installed by `npm install -g` (user prefix `~/.npm-global`, with the
owner's consent). Every run below executed in bubblewrap **without network** except a logging HTTP CONNECT proxy
(`tests/opencode-probe.mjs`): the hosts listed are complete for runs. HOME hidden; per-run XDG dirs holding only the
copied `openai` credential; a hostile scratch repository (`.env`, `opencode.json` allowing everything with marker
instructions, `.opencode/agent/evil.md`, `AGENTS.md` asking to create a marker file, a file outside the repository).

## Installation and binary
- `bin/opencode` → `lib/node_modules/opencode-ai/bin/opencode.exe`: a native, dynamically linked x86-64 ELF copied by
  the package's postinstall. Sandbox mounts: the package root, read-only.

## Commands and switches (`--help`)
- `opencode run [message..] --format json --model <provider>/<model>`; the message can come from **stdin** (measured).
  `--auto` (auto-approve) defaults to false and is never used. `--pure`: no external plugins.
- `opencode providers login -p openai -m "ChatGPT Pro/Plus (headless)"` (alias `auth`): device-code sign-in.
  Other labels: `ChatGPT Pro/Plus (browser)`, `API key`, `API key (service account)`.
- `opencode debug paths|config|agent <name>`: resolved paths, config and agent permissions (used for these checks).
- XDG roots are honoured: `<XDG_*_HOME>/opencode` for config, data, cache, state; tmp `/tmp/opencode`.
- Environment switches used: `OPENCODE_CONFIG_CONTENT` (generated config), `OPENCODE_DISABLE_PROJECT_CONFIG`
  (measured: the repository's `opencode.json` is not merged), `OPENCODE_DISABLE_CLAUDE_CODE`,
  `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_MODELS_PATH`, `OPENCODE_DISABLE_LSP_DOWNLOAD`,
  `OPENCODE_PURE`. **Not usable:** `OPENCODE_DISABLE_DEFAULT_PLUGINS` removes the ChatGPT sign-in plugin shipped with OpenCode
  ("Provider not found: openai"). Without a local catalogue (`OPENCODE_MODELS_PATH`) and with the fetch disabled,
  OpenCode knows no provider.

## Credentials
- `<data>/opencode/auth.json`, mode 0600, `{ "<provider>": { "type": "oauth" | "api", … } }`. The ChatGPT entry has
  `access`, `refresh`, `expires`, `accountId`, `type: "oauth"` (only field names were read). Access token lifetime at
  sign-in: 240 h.

## Permissions
- Built-in `build` agent (used by `run`): starts with `"*" → allow`, then `ask` for `doom_loop`, `external_directory`,
  `.env` reads. The config's `permission` object is appended **after** these rules (last match wins), so
  `{ "*": "deny", "read": {…}, "edit": {…}, "glob", "grep", "list": "allow" }` leaves only read/glob/grep/list/edit/write
  tools (`debug agent build`: bash, webfetch, websearch, task, skill, todowrite, question disabled).
- With that config (run `denied`): shell and web fetch are **absent** (no tool); reading `../outside.txt` and `.env` is
  refused (tool_use `status: "error"`, "The user has specified a rule which prevents you from using this specific tool
  call"); nothing was created; the secret never appeared.
- Without any config (run `ask-default`): reading outside the repository hits `ask`, which `run` **rejects** ("The user
  rejected permission to use this specific tool call").
- `agent.build.steps` is reflected by `debug agent build` (runtime honouring: measured in Task 8).
- Across every run, none of the hostile repository's marker files was created (`AGENTS.md`, `opencode.json`,
  `.opencode/agent`).

## Events (`--format json`, fixtures in `adapters/runtime-opencode/test/fixtures/`)
- One JSON object per line: `step_start`; `tool_use` (`part.tool`, `part.state.status` `completed|error`,
  `part.state.input`, `output` or `error`); `step_finish` (`part.reason` `tool-calls|stop`, `part.tokens`
  `{ total, input, output, reasoning, cache: { read, write } }`, `part.cost`); `text` (`part.text`); `error`
  (`error.name`, `error.data.message`, `error.data.statusCode`). No event names the model that answered.
- Edits by GPT models go through the `apply_patch` tool (allowed by `edit`).

## Models with a ChatGPT account
- Refused with HTTP 400 "not supported when using Codex with a ChatGPT account": `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.5`,
  `gpt-5.3-codex-spark`. Accepted: `gpt-6-astra` (the owner's Codex model). `run-error.ndjson` is the 400 case.

## Hosts contacted
| When | Hosts | Code sent? |
|---|---|---|
| Run, ChatGPT sign-in, plugin SDK pre-installed read-only | `chatgpt.com:443` | yes (the provider) |
| Run with a fresh config dir | `chatgpt.com:443`, `registry.npmjs.org:443` (npm install of `@opencode-ai/plugin@1.19.5`) | no code to npm — avoided by pre-installing |
| Sign-in (`providers login`, owner's interactive action, not proxied) | `auth.openai.com` (device flow); the models catalogue from models.dev; `registry.npmjs.org` (plugin SDK, 64 MB) | no code |

Design consequences (rulings in the plan ledger): runs get the catalogue and the plugin SDK installed at connect time,
read-only; `OPENCODE_DISABLE_DEFAULT_PLUGINS` is not set; measurements and suggestions use a model the account accepts.
