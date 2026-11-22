# Capabilities reference

For every runtime Taskquoin supports, this page lists what each capability is **really** enforced by, on which runtime
version, and with what evidence. The tables are taken from the `capabilities.json` file each adapter ships; they are the
matrices that `taskquoin doctor` and `taskquoin check` resolve against.

- [How to read the tables](#how-to-read-the-tables)
- [Claude Code](#claude-code) · [Codex](#codex) · [OpenCode](#opencode) · [API judge](#api-judge-runtime-api)
- [Reading the results](#reading-the-results)

> [!NOTE]
> Screens come from a demo repository with simulated AI agents (the test doubles of Taskquoin's own test suite); every
> command is the real Taskquoin CLI.

## How to read the tables

| Column | Meaning |
|---|---|
| Capability | One of the nine [capabilities](../guides/security.md#2-capabilities) |
| Mandatory | `yes` for the built-in floor (`fs.write`, `net.egress`, `config.modify`, `connector.write`, `vcs.commit`, `vcs.push`); a mandatory restriction must be certified or the agent is refused. `policy.mandatory` can add to it |
| When | The condition for this variant. **Variants are tried in the order listed; the first one that matches wins**; the last one of a capability is always unconditional |
| Class | `ENFORCED`, `BROKERED`, `ADVISORY` or `UNSUPPORTED` ([definitions](../guides/security.md#3-enforcement-classes-measured-not-claimed)) |
| Holds for | The restrictions the mechanism really enforces: `deny-all` (the capability is not granted), `scoped` (granted for some paths, commands or hosts), `workspace` (granted for the whole workspace). A restriction outside this set resolves to `ADVISORY` |
| Mechanism | What stops the action |
| Evidence | `measured` (a live contract test on that runtime version; the evidence file is in `docs/reports/`), `documented` (the vendor says so) or `inferred` (reasoning). **Only `measured` can certify a mandatory restriction** |
| Requires | A precondition checked on your machine by `doctor` (`bash-sandbox`: Claude's native sandbox works; `file-sandbox`: Taskquoin's bubblewrap profile works; `landing-gate`: the run goes through the Taskquoin workflow, which never commits protected configuration; `broker-available`: an action broker exists). If it is not met the class becomes `UNSUPPORTED` |

The **scope** of a restriction is derived from the grant: no grant is `deny-all`; a grant of only `**` (or `./**`) on `fs.read` /
`fs.write` is `workspace`; anything else is `scoped`.

A matrix is valid for **one runtime version**. If the installed version differs, every mandatory restriction is
`UNSUPPORTED` and the agent is refused; see
[Security: why an unmeasured version is refused](../guides/security.md#4-the-capability-matrix-and-why-an-unmeasured-version-is-refused).

Reading an example: for Claude Code, `fs.write` has four variants. An agent that holds neither `fs.write` nor `shell.run`
matches the first (the Edit, Write and Bash tools are absent). An agent that holds `shell.run` matches the second: the OS
sandbox confines writes to the workspace, which is enough for a whole-workspace grant (`**`) but not for a narrower glob,
which then resolves to `ADVISORY`. Any other agent falls to the last variant, the permission rules of the built-in file
tools. The first matching variant is final: if its precondition is not met (no `bash-sandbox`), the restriction is
`UNSUPPORTED`; it never falls through to the next variant. Later variants for the same condition (the `inferred` `ADVISORY`
ones) are the honest record of what holds without the mechanism and are not reached while the mechanism is available.

![taskquoin check resolves each mandatory restriction against the matrix](../assets/screens/en/check.svg)

## Claude Code

Measured for **2.1.327**, on 2026-11-18. File: `adapters/runtime-claude/src/capabilities.json`.

15 of 30 variants are `measured`.

| Capability | Mandatory | When | Class | Holds for | Mechanism | Evidence | Requires |
|---|---|---|---|---|---|---|---|
| `fs.read` | no | `shell.run` granted | `ADVISORY` | all scopes | sandbox denyRead blocks listed secret files and the control store; other reads (inside or outside the workspace) are not restricted | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt (rerun on 2.1.327) — R2.1 sandbox probe (bubblewrap 0.6.1, socat 1.7.4.1): .env read blocked by sandbox.filesystem.denyRead | `bash-sandbox` |
| `fs.read` | no | `shell.run` granted | `ADVISORY` | all scopes | an allowed shell command (e.g. npm test running repository code) can read anything the OS user can | inferred | - |
| `fs.read` | no | scope `scoped` | `ADVISORY` | all scopes | Claude has implicit read permission inside the working directory; a narrow Read(glob) allow is not a closed read scope | documented | - |
| `fs.read` | no | otherwise | `ENFORCED` | all scopes | dontAsk + Read(./**) allow (workspace-anchored since R1.2; R1.1 measured the unanchored form) + permissions.deny Read(...) for secrets paths. Re-measure before it can certify | inferred | - |
| `fs.write` | yes | `fs.write`, `shell.run` not granted | `ENFORCED` | deny-all | --tools lists no Edit/Write/Bash: the agent cannot write any file | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt M1 (shell=false): init-event tools=["Read","Grep","Glob"] — no Edit/Write/Bash/WebFetch/WebSearch | - |
| `fs.write` | yes | `shell.run` granted | `ENFORCED` | workspace | Bash subprocesses in the native OS sandbox can write the workspace but not outside it (/tmp included); per-glob scope is NOT enforced for subprocesses | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt (rerun on 2.1.327) — R2.1 sandbox probe (bubblewrap 0.6.1, socat 1.7.4.1): allowed/ written, other/ (not granted, inside workspace) ALSO written, outside and /tmp blocked | `bash-sandbox` |
| `fs.write` | yes | `shell.run` granted | `ADVISORY` | all scopes | an allowed shell command can write anywhere the OS user can; Edit rules only govern built-in file tools | inferred | - |
| `fs.write` | yes | otherwise | `ENFORCED` | all scopes | dontAsk + Edit(./<glob>) allow per granted glob; everything else denied. Defense in depth: Taskquoin PreToolUse hook re-checks the physical path (inline --settings, runs under --setting-sources "") | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt (rerun on 2.1.327) — R1.2 claude boundary (fix/r1.2-hardening): allowed/ written; forbidden/, .claude/settings.json, outside denied (3 structured Write denials); R2 hooks A: Write through a symlink inside allowed/ to a file outside it was denied by Claude permissions alone (symlink resolved); R2 hooks B: also denied by the Taskquoin hook | - |
| `shell.run` | no | otherwise | `ENFORCED` | all scopes | Bash tool only present when shell.run is granted; dontAsk + Bash(<pattern>) allow governs which commands the model may issue. Effects of allowed commands are captured by the shell.run variants of the other capabilities | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt: "claude bash-operators" — echo hello * ran (positive control) and did not extend to &&, ;, $(…), backticks, inside the Bash sandbox | - |
| `net.egress` | yes | `net.egress`, `shell.run` not granted | `ENFORCED` | deny-all | --tools lists no WebFetch, WebSearch or Bash: the agent has no network-capable tool | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt M1 (shell=false): init-event tools=["Read","Grep","Glob"] — no Edit/Write/Bash/WebFetch/WebSearch | - |
| `net.egress` | yes | `shell.run` granted | `ENFORCED` | deny-all | Bash subprocesses run in the native OS sandbox with an empty network allowlist (failIfUnavailable, no unsandboxed escape) | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt (rerun on 2.1.327) — R2.1 sandbox probe (bubblewrap 0.6.1, socat 1.7.4.1): curl to a 127.0.0.1 server: exit 7, 0 hits; curl https://example.com: exit 56 | `bash-sandbox` |
| `net.egress` | yes | `shell.run` granted | `ADVISORY` | all scopes | subprocess network of allowed shell commands is unconstrained on the host | inferred | - |
| `net.egress` | yes | scope `scoped` | `ENFORCED` | all scopes | WebFetch(domain:<host>) allow rules | documented | - |
| `net.egress` | yes | otherwise | `ENFORCED` | all scopes | WebFetch/WebSearch absent from --tools and denied; no Bash without shell.run | inferred | - |
| `vcs.commit` | yes | `shell.run` not granted | `ENFORCED` | deny-all | no Bash tool: the agent cannot invoke git | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt M1 (shell=false): init-event tools=["Read","Grep","Glob"] — no Edit/Write/Bash/WebFetch/WebSearch | - |
| `vcs.commit` | yes | `shell.run` granted | `ENFORCED` | deny-all | Claude's Bash sandbox keeps .git read-only: agents cannot commit; commits are made by the orchestrator on the host after verification | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt (rerun on 2.1.327) — R2.1 hooks C: git commit inside the Bash sandbox fails, .git/index.lock Read-only file system (even with .git in allowWrite) | `bash-sandbox` |
| `vcs.commit` | yes | `shell.run` granted | `ADVISORY` | all scopes | an allowed script can invoke git internally; Bash(git commit *) deny only covers model-issued spellings | inferred | - |
| `vcs.commit` | yes | otherwise | `ENFORCED` | all scopes | no Bash tool without shell.run ⇒ no git invocation by the model | inferred | - |
| `vcs.push` | yes | `shell.run` not granted | `ENFORCED` | deny-all | no Bash tool: the agent cannot invoke git | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt M1 (shell=false): init-event tools=["Read","Grep","Glob"] — no Edit/Write/Bash/WebFetch/WebSearch | - |
| `vcs.push` | yes | `shell.run` granted | `ENFORCED` | deny-all | no network inside the Bash sandbox and no write outside the workspace ⇒ push reaches neither a network remote nor a local remote outside the workspace (measured) | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt: "sandbox" probe push=1 to a local bare remote outside the workspace, remote refs unchanged; loopback 0 hits, internet blocked | `bash-sandbox` |
| `vcs.push` | yes | `shell.run` granted | `ADVISORY` | all scopes | an allowed script can invoke git push internally (network unconstrained on host) | inferred | - |
| `vcs.push` | yes | otherwise | `ENFORCED` | all scopes | no Bash tool without shell.run ⇒ no git invocation by the model | inferred | - |
| `connector.read` | no | scope `scoped` | `UNSUPPORTED` | all scopes | no reviewed connector mechanism before R6; RunRequest accepts no MCP configuration | inferred | - |
| `connector.read` | no | otherwise | `ENFORCED` | all scopes | --setting-sources "" + --strict-mcp-config with no --mcp-config ⇒ zero MCP servers (init event inventory recorded per run) | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt M1: init-event inventory mcp_servers=[] with and without a shell | - |
| `connector.write` | yes | scope `scoped` | `BROKERED` | all scopes | Action Broker executes approved proposals (ADR-0004) — not implemented before R6 | inferred | `broker-available` |
| `connector.write` | yes | otherwise | `ENFORCED` | all scopes | zero MCP servers in agent runs (init event inventory recorded per run) | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt M1: init-event inventory mcp_servers=[] with and without a shell | - |
| `config.modify` | yes | `fs.write`, `shell.run` not granted | `ENFORCED` | deny-all | --tools lists no Edit/Write/Bash: the agent cannot modify any file | measured: docs/reports/evidence-live-claude-2.1.327-2026-11-18.txt M1 (shell=false): init-event tools=["Read","Grep","Glob"] — no Edit/Write/Bash/WebFetch/WebSearch | - |
| `config.modify` | yes | `shell.run` granted | `ENFORCED` | deny-all, scoped, workspace | write-time: sandbox.filesystem.denyWrite on protected config, .git, the control store and every nested CLAUDE.md/AGENTS.md found by a complete workspace scan (run refused if the scan is incomplete); land-time: the workflow never commits a change to any protected path, including new nested instruction files | measured: R2.1 sandbox probe (.claude/settings.json write blocked by denyWrite) + deterministic tests: adapters/runtime-claude/test/executor.test.ts "workspace scan…", packages/application/test/workflow.test.ts "landing gate…" | `bash-sandbox`, `landing-gate` |
| `config.modify` | yes | `shell.run` granted | `ADVISORY` | all scopes | an allowed shell command can modify configuration files | inferred | - |
| `config.modify` | yes | otherwise | `ENFORCED` | all scopes | permissions.deny Edit(./.claude/**, ./.codex/**, ./.agents/**, ./.git/**, ./taskquoin.yaml, ./CLAUDE.md, ./AGENTS.md, ./.mcp.json, control store) — must hold even under a broad fs.write ** grant | inferred | - |

## Codex

Measured for **0.157.1**, on 2026-11-15. File: `adapters/runtime-codex/src/capabilities.json`.

7 of 14 variants are `measured`.

| Capability | Mandatory | When | Class | Holds for | Mechanism | Evidence | Requires |
|---|---|---|---|---|---|---|---|
| `fs.read` | no | otherwise | `ADVISORY` | deny-all, scoped, workspace | the OS sandbox does not restrict reads of user-readable files, inside or outside the workspace | inferred | - |
| `fs.write` | yes | Codex sandbox `read-only` | `ENFORCED` | deny-all, workspace | read-only sandbox: no filesystem writes | measured: docs/reports/evidence-live-R3-2026-11-15.txt M2: read-only — writes inside and outside the workspace absent | - |
| `fs.write` | yes | otherwise | `ENFORCED` | workspace | workspace-write sandbox: writes confined to the workspace PLUS the per-run scratch dir (writable_roots, outside the repository, removed after the run); /tmp and $TMPDIR excluded. R1.1 measured an earlier form (TMPDIR inside the workspace) — re-measure | measured: docs/reports/evidence-live-R3.1-2026-11-15.txt (rerun) — R1.2 codex (fix/r1.2-hardening): workspace write ok, outside write failed, /tmp write failed, per-run scratch TMPDIR usable | - |
| `shell.run` | no | otherwise | `ADVISORY` | deny-all, scoped, workspace | shell is always available to Codex (it reads files through it); command patterns are not enforced; effects are bounded by the sandbox | inferred | - |
| `net.egress` | yes | scope `scoped` | `UNSUPPORTED` | deny-all, scoped, workspace | network is all-or-nothing in the sandbox; no per-host allow | inferred | - |
| `net.egress` | yes | otherwise | `ENFORCED` | deny-all | network_access=false (measured: loopback HTTP 0 hits in read-only and workspace-write); web_search disabled and plugin/app/browser/computer-use features off by flag (documented, not separately measured) | measured: docs/reports/evidence-live-R3-2026-11-15.txt M2 (read-only) and M3 (workspace-write): curl to a 127.0.0.1 server failed, 0 hits | - |
| `vcs.commit` | yes | otherwise | `ENFORCED` | deny-all | the sandbox keeps .git read-only in both modes: git commit fails (measured) | measured: docs/reports/evidence-live-R3-2026-11-15.txt M2 + M3: git commit exit 128, history unchanged | - |
| `vcs.push` | yes | otherwise | `ENFORCED` | deny-all | no network and no writable root outside the workspace/scratch ⇒ a push reaches neither a network remote nor a local-path remote outside them (measured M3); a bare remote created INSIDE the workspace stays reachable (within the boundary) | measured: docs/reports/evidence-live-R3-2026-11-15.txt M3: push to a local bare remote outside the workspace failed, remote refs empty; no network (0 hits) | - |
| `connector.read` | no | scope `scoped` | `UNSUPPORTED` | deny-all, scoped, workspace | no reviewed connector mechanism before R6 | inferred | - |
| `connector.read` | no | otherwise | `ENFORCED` | deny-all | --ignore-user-config drops user [mcp_servers]; project .codex/config.toml must not load (sentinel test) | inferred | - |
| `connector.write` | yes | scope `scoped` | `BROKERED` | deny-all, scoped, workspace | Action Broker (ADR-0004) — not implemented before R6 | inferred | `broker-available` |
| `connector.write` | yes | otherwise | `ENFORCED` | deny-all | no MCP servers configured for agent runs | inferred | - |
| `config.modify` | yes | Codex sandbox `read-only` | `ENFORCED` | deny-all, scoped, workspace | read-only sandbox: no writes at all | measured: docs/reports/evidence-live-R3-2026-11-15.txt M2: read-only — .codex/config.toml write absent | - |
| `config.modify` | yes | otherwise | `ADVISORY` | deny-all, scoped, workspace | writers: .codex/ and .git/ protected by the sandbox, other config paths inside the workspace (taskquoin.yaml, .claude/, AGENTS.md) are not | measured: docs/reports/evidence-live-R3.1-2026-11-15.txt (rerun) — R1.2 codex: forbidden/ inside workspace written; .codex/ and .git/hooks writes failed | - |

## OpenCode

Measured for **1.19.5**, on 2026-11-16. File: `adapters/runtime-opencode/src/capabilities.json`.

10 of 10 variants are `measured`.

| Capability | Mandatory | When | Class | Holds for | Mechanism | Evidence | Requires |
|---|---|---|---|---|---|---|---|
| `fs.read` | no | otherwise | `ENFORCED` | workspace | bubblewrap: HOME hidden, project secret files, instruction files and what secret-named or outward links point to masked, control store masked; OpenCode read rules allow the whole repository and deny secrets — a scoped or deny-all read restriction is NOT enforced (only the whole repository) | measured: docs/reports/evidence-live-opencode-2026-11-16.txt L2: .env read refused, MARKER-LIVE-ENV absent from the result; adapters/runtime-opencode/test/executor.test.ts: HOME hidden, secret and instruction files masked | `file-sandbox` |
| `fs.write` | yes | `fs.write` not granted | `ENFORCED` | deny-all | read-only agent: the repository is bound read-only and OpenCode's edit/write tools are disabled | measured: docs/reports/evidence-live-opencode-2026-11-16.txt L3: read-only agent wrote nothing (no edit tool); adapters/runtime-opencode/test/executor.test.ts: read-only agent cannot write | `file-sandbox` |
| `fs.write` | yes | otherwise | `ENFORCED` | workspace | bubblewrap: only the repository and the per-run OpenCode dir are writable; .git and frozen dependency dirs read-only | measured: docs/reports/evidence-live-opencode-2026-11-16.txt L1 write ok, L2 outside write refused; adapters/runtime-opencode/test/executor.test.ts: outside, .git and frozen paths unwritable | `file-sandbox` |
| `shell.run` | no | otherwise | `ENFORCED` | deny-all | no command tool: the generated config denies every action but read/list/glob/grep(/edit) — bash is absent (debug agent build) | measured: docs/reports/evidence-live-opencode-2026-11-16.txt L2: shell marker absent, no shell tool called | - |
| `net.egress` | yes | otherwise | `ENFORCED` | deny-all | no network tool (webfetch/websearch absent); the OpenCode process itself reaches only the provider's hosts (hosts.json), catalogue and plugin SDK fetched at connect time | measured: docs/reports/evidence-live-opencode-2026-11-16.txt L2: loopback server 0 hits; L4: hosts = chatgpt.com:443 only (no-network sandbox + logging proxy) | - |
| `vcs.commit` | yes | otherwise | `ENFORCED` | deny-all | no command tool and .git bound read-only | measured: adapters/runtime-opencode/test/executor.test.ts: .git read-only inside the sandbox; docs/reports/evidence-live-opencode-2026-11-16.txt L2: no shell | `file-sandbox` |
| `vcs.push` | yes | otherwise | `ENFORCED` | deny-all | no command tool and .git bound read-only | measured: adapters/runtime-opencode/test/executor.test.ts: .git read-only inside the sandbox; docs/reports/evidence-live-opencode-2026-11-16.txt L2: no shell | `file-sandbox` |
| `connector.read` | no | otherwise | `ENFORCED` | deny-all | no MCP server (mcp: {}), no external plugin (OPENCODE_PURE) | measured: docs/reports/evidence-live-opencode-2026-11-16.txt L1-L3: only apply_patch/read tools observed; adapters/runtime-opencode/test/config.test.ts: mcp {}, plugin [] | - |
| `connector.write` | yes | otherwise | `ENFORCED` | deny-all | no MCP server (mcp: {}), no external plugin (OPENCODE_PURE) | measured: docs/reports/evidence-live-opencode-2026-11-16.txt L1-L3: only apply_patch/read tools observed; adapters/runtime-opencode/test/config.test.ts: mcp {}, plugin [] | - |
| `config.modify` | yes | otherwise | `ENFORCED` | deny-all | OpenCode edit rules deny protected config; the repository's OpenCode config is masked; a protected change never lands (landing gate) | measured: docs/reports/evidence-live-opencode-2026-11-16.txt L1: hostile opencode.json/.opencode/AGENTS.md ignored (pwned=[]); adapters/runtime-opencode/test/config.test.ts: edits of protected config denied; adapters/runtime-opencode/test/executor.test.ts: repository OpenCode config masked | `landing-gate` |

## API judge (`runtime: api`)

Measured for version 1 (the adapter itself, no external binary), on 2026-11-16. File: `adapters/runtime-api/src/capabilities.json`.

9 of 9 variants are `measured`.

| Capability | Mandatory | When | Class | Holds for | Mechanism | Evidence | Requires |
|---|---|---|---|---|---|---|---|
| `fs.read` | no | otherwise | `ENFORCED` | deny-all | no tool interface: the adapter sends one text request and reads one text answer — the model gets no file, shell, network, VCS, connector or configuration access; tool calls in an answer fail the run | measured: adapters/runtime-api/test/executor.test.ts (request body without tools; tool_calls → failed; redirect refused) | - |
| `fs.write` | yes | otherwise | `ENFORCED` | deny-all | no tool interface: the adapter sends one text request and reads one text answer — the model gets no file, shell, network, VCS, connector or configuration access; tool calls in an answer fail the run | measured: adapters/runtime-api/test/executor.test.ts (request body without tools; tool_calls → failed; redirect refused) | - |
| `shell.run` | no | otherwise | `ENFORCED` | deny-all | no tool interface: the adapter sends one text request and reads one text answer — the model gets no file, shell, network, VCS, connector or configuration access; tool calls in an answer fail the run | measured: adapters/runtime-api/test/executor.test.ts (request body without tools; tool_calls → failed; redirect refused) | - |
| `net.egress` | yes | otherwise | `ENFORCED` | deny-all | no tool interface: the adapter sends one text request and reads one text answer — the model gets no file, shell, network, VCS, connector or configuration access; tool calls in an answer fail the run | measured: adapters/runtime-api/test/executor.test.ts (request body without tools; tool_calls → failed; redirect refused) | - |
| `vcs.commit` | yes | otherwise | `ENFORCED` | deny-all | no tool interface: the adapter sends one text request and reads one text answer — the model gets no file, shell, network, VCS, connector or configuration access; tool calls in an answer fail the run | measured: adapters/runtime-api/test/executor.test.ts (request body without tools; tool_calls → failed; redirect refused) | - |
| `vcs.push` | yes | otherwise | `ENFORCED` | deny-all | no tool interface: the adapter sends one text request and reads one text answer — the model gets no file, shell, network, VCS, connector or configuration access; tool calls in an answer fail the run | measured: adapters/runtime-api/test/executor.test.ts (request body without tools; tool_calls → failed; redirect refused) | - |
| `connector.read` | no | otherwise | `ENFORCED` | deny-all | no tool interface: the adapter sends one text request and reads one text answer — the model gets no file, shell, network, VCS, connector or configuration access; tool calls in an answer fail the run | measured: adapters/runtime-api/test/executor.test.ts (request body without tools; tool_calls → failed; redirect refused) | - |
| `connector.write` | yes | otherwise | `ENFORCED` | deny-all | no tool interface: the adapter sends one text request and reads one text answer — the model gets no file, shell, network, VCS, connector or configuration access; tool calls in an answer fail the run | measured: adapters/runtime-api/test/executor.test.ts (request body without tools; tool_calls → failed; redirect refused) | - |
| `config.modify` | yes | otherwise | `ENFORCED` | deny-all | no tool interface: the adapter sends one text request and reads one text answer — the model gets no file, shell, network, VCS, connector or configuration access; tool calls in an answer fail the run | measured: adapters/runtime-api/test/executor.test.ts (request body without tools; tool_calls → failed; redirect refused) | - |

## Reading the results

- **A line is a mandatory restriction, not a feature list.** `✔ fs.write ENFORCED — ...` means: this agent does not hold
  `fs.write` (or holds it only for the workspace) and the mechanism shown guarantees it.
- **Why the Claude implementer shows `fs.write` as `workspace`.** Per-glob scope is not enforceable for subprocesses
  (measured): `fs.write: ["src/**"]` constrains Claude's built-in file tools, but a command such as `npm test` can write the
  whole workspace. The workspace boundary, protected configuration and `.git` are enforced; finer scope is not.
- **Why Codex is a reviewer here.** Codex's sandbox enforces a read-only or workspace boundary, no network, and a read-only
  `.git`, but `shell.run` and `fs.read` are advisory and its `connector.write` entry is `inferred`, not measured. That is why
  `doctor` shows `connector.write` refused for a default Codex challenger, and why you can record an
  [accepted risk](../guides/security.md#10-accepted-risks) if you decide the risk is acceptable.
- **OpenCode is the only runtime whose `fs.read` is enforced**, but only for the whole repository: a scoped or deny-all
  read restriction is not enforced.
- **API judges** are enforced by construction: the adapter sends one text request and reads one text answer; a tool call in
  the answer fails the run.
- **A new runtime version is unmeasured until its matrix is re-measured**, whatever the vendor changed.

## Learn more

- [Security](../guides/security.md) · [Configuration: `agents.<id>.capabilities`](configuration.md#agentsidcapabilities)
- Evidence: [Claude Code 2.1.327](../reports/evidence-live-claude-2.1.327-2026-11-18.txt),
  [Codex, workspace-write](../reports/evidence-live-R3-2026-11-15.txt),
  [Codex re-measure](../reports/evidence-live-R3.1-2026-11-15.txt),
  [Claude sandbox](../reports/evidence-live-R2.1-sandbox-2026-11-15.txt),
  [OpenCode 1.19.5](../reports/evidence-live-opencode-2026-11-16.txt)
- ADRs: [0002](../adr/0002-enforcement-classes.md), [0008](../adr/0008-evidence-is-bound-to-a-mechanism.md),
  [0016](../adr/0016-judges-by-api.md), [0017](../adr/0017-opencode-without-commands.md)
