/**
 * OpenCode in Taskquoin's file sandbox, without commands (project B step 1, spec §5.3): version and ticket checked,
 * only fs.read / fs.write, the generated config (no `ask`), HOME hidden, the repository's secrets, instruction files and
 * OpenCode config masked, `.git` and frozen paths read-only, a per-run OpenCode directory holding only the model
 * provider's credential, the host network kept (OpenCode must reach its provider; it has no tool that uses the network).
 */
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { normalizeGrants } from '@taskquoin/domain';
import { HOME_SECRET_GLOBS } from '@taskquoin/rules';
import { assertTicket, invocationDigest, type BinarySpec, type RunRequest, type RunResult, type RuntimeExecutor } from '@taskquoin/application';
import { verifyBinaryVersion } from '@taskquoin/process-runner';
import { defaultMaskDirs, runSandboxedTool, sandboxedToolAvailable, scanWorkspace, type SandboxProfile } from '@taskquoin/local-tool';
import { opencodeConfig } from './config.ts';
import { mergeBackCredential, prepareRunDirs } from './credentials.ts';
import { binaryMounts } from './mounts.ts';
import { parseOpenCodeStream } from './stream.ts';
import { CONFIG_ENV, isolationEnv, pluginDir, runArgs, type OpenCodeDirs } from './facts.ts';

export { binaryMounts } from './mounts.ts';
const OPENCODE_CAPS = new Set(['fs.read', 'fs.write']);
const ROOT_HIDDEN = ['AGENTS.md', 'CLAUDE.md', 'opencode.json', 'opencode.jsonc'];

export interface OpenCodeExecutorOptions {
  /** Taskquoin's own OpenCode connection (userOpenCodeDirs). */ userDirs: OpenCodeDirs;
  /** Where per-run dirs are created and removed — outside every repository and outside the masked control store. */ runBase: string;
  /** The repository's control store, masked from the agent. */ controlStore: string;
  /** Test seam; defaults to the real bubblewrap probe. */ sandboxAvailable?: () => Promise<boolean>;
}

export class OpenCodeExecutor implements RuntimeExecutor {
  readonly runtime = 'opencode' as const;
  private version?: Promise<string>;
  private readonly binary: BinarySpec;
  private readonly o: OpenCodeExecutorOptions;
  constructor(binary: BinarySpec, o: OpenCodeExecutorOptions) { this.binary = binary; this.o = o; }

  async run(req: RunRequest, signal?: AbortSignal): Promise<RunResult> {
    this.version ??= verifyBinaryVersion(this.binary.bin, this.binary.prefixArgs, req.env);
    const verified = await this.version;
    if (verified !== this.binary.version) throw new Error(`opencode binary is ${verified}, declared ${this.binary.version}`);
    assertTicket(req.ticket, 'opencode', verified, req.agent.capabilities, req.agent.id);
    const grants = normalizeGrants(req.agent.capabilities);
    const extra = Object.keys(grants).filter(k => !OPENCODE_CAPS.has(k));
    if (extra.length) throw new Error(`refusing: OpenCode agents only read and write files in this version (granted: ${extra.join(', ')})`);
    const model = req.agent.model;
    if (!model || model.indexOf('/') < 1) throw new Error('refusing: an OpenCode agent needs a model <provider>/<model>');
    if (!(await (this.o.sandboxAvailable ?? sandboxedToolAvailable)())) throw new Error("refusing: bubblewrap unavailable — OpenCode agents never run outside Taskquoin's sandbox");
    const home = req.env.HOME;
    if (!home || !isAbsolute(home) || !existsSync(home)) throw new Error('refusing: HOME must be an existing absolute path (it is hidden from OpenCode)');
    const scan = scanWorkspace(req.cwd);
    if (!scan.complete) throw new Error(`refusing: workspace scan incomplete (${scan.problem}) — cannot mask every secret`);
    // What a secret-NAMED link points to (`.env.local -> credentials.txt`) and what a link leaving the repository points
    // to are masked as well (final review, Codex HIGH 1 — same rule as the Claude executor, Codex CR2 #3 / R4 N10).
    const linkFiles: string[] = []; const linkDirs: string[] = [];
    // HOME secrets that are links (WSL: ~/.aws → /mnt/c/…): hiding HOME hides the link, not its target (Claude I2).
    const homeSecretLinks = HOME_SECRET_GLOBS.map(g => join(home, g.replace(/\/\*\*$/, ''))).filter(p => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } });
    for (const l of [...scan.secretLinks, ...scan.externalLinks, ...homeSecretLinks]) {
      let t: string; try { t = realpathSync(l); } catch { continue; } // dangling: nothing to read
      (statSync(t).isDirectory() ? linkDirs : linkFiles).push(t);
    }
    const provider = model.slice(0, model.indexOf('/'));
    const write = !!grants['fs.write'];
    const stateRoot = realpathSync(dirname(dirname(this.o.userDirs.config)));
    const run = prepareRunDirs(this.o.userDirs, this.o.runBase, provider);
    const cleanupErrors: string[] = [];
    let result: RunResult;
    try {
      const env = { ...req.env, ...isolationEnv(run.dirs), [CONFIG_ENV]: JSON.stringify(opencodeConfig({ write, ...(req.agent.maxTurns ? { maxTurns: req.agent.maxTurns } : {}) })) };
      const userModules = join(pluginDir(this.o.userDirs), 'node_modules'); const runModules = join(pluginDir(run.dirs), 'node_modules');
      if (existsSync(userModules)) mkdirSync(runModules, { recursive: true });
      const profile: SandboxProfile = {
        writableRoot: req.cwd, home, hideHome: true, shareNetwork: true, extraWritable: [run.root],
        // The control-store base (every provider's credential, other repositories' stores) when it is not under HOME (Claude I3).
        hideDirs: [stateRoot].filter(d => existsSync(d) && !(d === home || d.startsWith(home + '/'))),
        readOnly: [...(write ? [] : [req.cwd]), join(req.cwd, '.git'), ...(req.frozenPaths ?? []), ...binaryMounts(this.binary.bin, req.env.PATH ?? '', home),
          ...(this.binary.prefixArgs ?? []).filter(isAbsolute).map(p => dirname(p))],
        readOnlyAt: existsSync(userModules) ? [{ src: userModules, dst: runModules }] : [],
        hideFiles: [...scan.secretFiles, ...scan.instructionFiles, ...ROOT_HIDDEN.map(f => join(req.cwd, f)), ...linkFiles],
        maskDirs: [...defaultMaskDirs(), this.o.controlStore, join(req.cwd, '.opencode'), ...linkDirs],
      };
      const args = [...(this.binary.prefixArgs ?? []), ...runArgs(model)];
      const p = await runSandboxedTool({ bin: this.binary.bin, args, cwd: req.cwd, env, timeoutMs: req.timeoutMs, maxOutputBytes: req.maxOutputBytes,
        stdin: `${req.agent.prompt}\n\n${req.task}` }, profile, signal);
      const s = parseOpenCodeStream(p.stdout.split('\n'));
      const otherModel = s.model && s.model !== model ? s.model : undefined;
      // Every outcome carries a readable message naming the provider (Review Focus 5, final review I4); a stream that
      // ends without a final step is a failure, never a silent `unknown`.
      const status: RunResult['status'] = p.status === 'timeout' || p.status === 'cancelled' ? p.status
        : otherModel || s.error || p.status === 'failed' || !s.completed ? 'failed' : 'completed';
      const tail = p.stderr.trim() ? ` — ${p.stderr.trim().slice(-300)}` : '';
      const terminalMessage = otherModel ? `OpenCode answered with ${otherModel}, not the configured ${model} — refused`
        : s.error ? `OpenCode (${provider}): ${s.error}`
        : p.status === 'timeout' || p.status === 'cancelled' ? `OpenCode (${provider}): ${p.status}`
        : p.status === 'failed' ? `OpenCode (${provider}) exited with code ${p.exitCode}${tail}`
        : !s.completed ? `OpenCode (${provider}): the stream ended without a final step (exit ${p.exitCode}${p.truncated ? ', output truncated at maxOutputBytes' : ''})${tail}`
        : s.text ?? `OpenCode completed without a final message (tools: ${s.toolCalls.map(t => t.name).join(', ') || 'none'})`;
      result = {
        status, runtime: 'opencode', runtimeVersion: this.binary.version, exitCode: p.exitCode, ...(terminalMessage !== undefined ? { terminalMessage } : {}),
        ...(s.usage ? { usage: s.usage } : {}), command: { bin: this.binary.bin, args, cwd: req.cwd }, effectiveConfigDigest: invocationDigest(this.binary.bin, args, env),
        toolCalls: s.toolCalls, permissionDenials: s.denials, unsupported: [], stdoutTruncated: p.truncated, stderr: p.stderr, durationMs: p.durationMs,
      };
    } finally {
      const m = mergeBackCredential(this.o.userDirs, run.dirs, provider, run.initial); if (m) cleanupErrors.push(m);
      try { rmSync(run.root, { recursive: true, force: true }); } catch (e) { cleanupErrors.push(`run dir cleanup failed: ${(e as Error).message}`); }
    }
    return cleanupErrors.length ? { ...result, cleanupErrors } : result;
  }
}
