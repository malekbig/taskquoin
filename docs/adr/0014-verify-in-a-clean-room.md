# ADR-0014: Verify in a clean room; dependencies inherited read-only and frozen for agents

## Status
Accepted by the maintainer on 2026-11-15 after reading the proposal; implemented the same day (see below)

## Date
2026-11-15

## Context
Verify (and the RED proof, ADR-0013 §6) run the project's tests **in the developer's working directory**: the verified
tree *plus every ignored file* (`node_modules`, `vendor`, `.venv`, build outputs, caches, `.env`…). The implementer
agent can write the whole workspace (Claude's Bash sandbox has no per-glob scope, measured R2.1), ignored files
included. Raised as an open residual by the Codex RED review. Concrete consequences:
1. **Verify is not about the committed tree**: the agent patches `node_modules/<dep>` or creates an ignored file that the
   code `require`s (or plants a newer `.class` in `target/` so Maven skips recompiling); tests pass; the commit does
   not contain what made them pass. The reviewer never sees it (not in the diff).
2. **Persistence outside the diff**: a tampered dependency, an ignored `.envrc` (direnv), a stale `dist/app.js` stays on
   the developer's disk after the run and runs later, unsandboxed, on the developer's machine.
3. The working tree is restored around the RED proof, which needed `restoreTree(tree, base)`, a guard against losing
   ignored files, and still leaves a race with a concurrent writer (ADR-0013 residual).

## Decision
1. **Clean room**: Verify and the RED proof never run in the working directory. Taskquoin materializes the tree to test
   (green, then red) with `git checkout-index` from a temporary index into a fresh directory **outside the workspace**
   (`<control store>/verify/<run>-<n>`, not writable by agents), and bubblewrap mounts it **at the repository's path**
   (tests see the same cwd). Same profile as today otherwise: no network, own PID namespace, HOME hidden, `/run` and
   the control store masked, `.git` read-only. Tests that change tracked files are detected by computing the tree of
   the clean room after the run. The directory is deleted afterwards.
2. **Inherited, read-only**: only the dependency directories are carried over from the working directory, mounted
   **read-only**: per stack by default (`**/node_modules` for node, `vendor` for php, `.venv`/`venv` for python;
   nothing for go, maven, gradle — their caches live in HOME, already hidden), plus an owner-controlled
   `verify.inherit` list in `taskquoin.yaml` (a protected file) for anything else a project really needs (e.g.
   `dist/`). Every other ignored file — build outputs, caches, `.env` — is simply **absent** in Verify.
3. **Frozen for agents**: the inherited paths are added to the implementer's `sandbox.filesystem.denyWrite` (Bash
   subprocesses, OS-enforced) and to a new hook rule for Edit/Write/MultiEdit/NotebookEdit (lexical + physical path,
   like CONFIG001). Backstop: a metadata fingerprint of the inherited paths (path, inode, size, mode, **ctime**) taken
   before `implement` and compared before Verify; any difference → `needs-human` "dependencies changed during the
   run". ctime cannot be set back by an unprivileged process, so `touch -d` cannot hide a write.
4. **Shown, not hidden**: ignored files the agent created or changed outside the inherited paths (same ctime
   fingerprint, before/after `implement`) are listed in an `ignored-N` artifact, given to the reviewer and shown at the
   commit approval ("not in the diff, still on your disk"). Taskquoin does not delete them.
5. **Simplification**: since Verify and RED no longer touch the working tree, the restores around them, the
   ignored-file deletion guard and the concurrent-writer race of ADR-0013 §6 disappear.

## Consequences
### Positive
- What is verified and red-checked is exactly the tree that is committed, plus read-only dependencies that no agent
  could change; ignored secrets (`.env`) are not even visible to tests.
- An agent can no longer leave a tampered dependency behind; other ignored files it leaves are listed to the human.
- Less code on the riskiest path (no restore dance, no deletion guard).
### Negative
- Tests that rely on ignored files other than the stack's dependency directories (a prebuilt `dist/`, a local
  `.env.test`) fail in Verify until the owner lists them in `verify.inherit` — fail closed, but a first-run surprise.
- Build outputs are rebuilt from scratch in Verify (slower for compiled stacks; measured identical for node).
- The agent's own test runs cannot write into dependency directories (e.g. `node_modules/.cache`); runners that
  insist may fail inside the agent's sandbox (Verify, the authority, is unaffected).
- bubblewrap 0.6.1 (the reference machine) has no overlay: dependencies are strictly read-only in Verify too.
- Still out of scope: go/maven/gradle caches in HOME (Verify cannot resolve them offline — pre-existing limitation).

## Implementation notes (2026-11-15)
- Baseline taken **once per run**, at the first `implement` (artifact `workspace-baseline`): a resumed attempt is
  compared with the original state, so an interrupted attempt cannot bless its own dependency changes.
- Dependency digests are per first-level child of each inherited root (names what changed: `node_modules/dep`);
  ignored entries are listed with `git status --ignored=matching` (`--no-optional-locks`: the developer's index is
  never written).
- `restoreTree` and its ignored-file deletion guard are gone: nothing restores the working directory any more.
- After two independent Codex review passes: Verify **refuses** (needs-human) a tree or an
  inherited dir containing a symlink that resolves outside the repository — resolved **inside the very sandbox the
  tests get** (`find -type l` + `realpath -m`), so a resolution emulated on the host cannot drift from what tests see;
  an inherited path with a symlink on any component is refused before the implementer starts; secrets inside inherited
  dirs (their `.git` included, and behind secret-named links) are masked, and denied to agents; literal
  `verify.inherit` paths inside an ignored directory are inherited (`selectInheritedRoots`, never a tracked path); a
  Codex `workspace-write` role refuses frozen paths.
- Residual: a secret-NAMED directory (or a secret-named link to a directory) is not masked — the secret globs name
  files (`.env`, `*.pem`, `*.key`).
- Residual: tests are code — they can still read any host path left visible by the sandbox (`--ro-bind / /` minus
  HOME, /tmp, /run, the control store and masks), e.g. `require('/opt/x')`; such a reference is in the reviewed diff.
  Narrowing the Verify view to system directories (and `/mnt/*` on WSL) is a separate, measurable follow-up.
- Code: `apps/cli/src/workflow-cli.ts` (verify, workspace), `packages/application/src/workflow/feature-governed.ts`
  (verify, red-check, implement), `adapters/git` (`materialize`, `dirTree`, `ignoredEntries`), `adapters/local-tool`
  (`mountAt`, `fingerprint.ts`), `packages/rules` (FROZEN001), `adapters/runtime-claude` (`frozenPaths`),
  `packages/config` (`verify.inherit`, `inheritGlobs`). 4 Gherkin scenarios in `features/workflow-gouverne.feature`.

## Evidence / references
Measured on the reference machine, 2026-11-15 (`docs/reports/evidence-cleanroom-2026-11-15.txt`):
- M1 bubblewrap 0.6.1: no `--overlay`/`--tmp-overlay`; ext4: no reflink copies → read-only binds only.
- M2 materialization of the pilot tree (194 files) with `checkout-index --prefix`: 36 ms.
- M3 clean room on the pilot (tree bound at the repo path, `.git` + `node_modules` read-only, HOME hidden): full suite
  248 tests / 237 pass / 0 fail / 11 skipped — identical to the in-place Verify; 73 s vs ~74 s; `node_modules` not
  writable; tree writable; the real working directory untouched; workspace-package symlinks
  (`node_modules/@taskquoin/* → ../../packages/*`) resolve into the clean room.
- M4 fingerprint of a real 749 MB `node_modules` (42,843 entries, another local project, metadata only): ~230 ms,
  stable digest across runs.
- M5 `touch -d 2020-01-01` after a write restores mtime but ctime moves forward; `utime(0, 0)` also bumps ctime.
- Already measured (R2.1, `tests/live-sandbox.e2e.test.ts`): Claude's `sandbox.filesystem.denyWrite` on a directory
  (`.claude/`) blocks Bash-subprocess writes.
- M6 LIVE (Claude Code 2.1.325, ≈ $0.15 API-equivalent estimate, `docs/reports/evidence-live-ADR-0014-2026-11-15.txt`): with `node_modules`
  frozen, Bash overwrite / create / mkdir / write through a workspace symlink / rm inside it all fail and the file is
  unchanged; the Write tool into it is denied by the hook (FROZEN001); the workspace stays writable (positive control);
  writing a workspace package through `node_modules/lib → ../packages/lib` succeeds (tracked source, by design).
