/**
 * Test world for the E2E features: a temporary git repository, an isolated HOME / XDG_STATE_HOME (the owner's real
 * control store and claude-mem are never touched), fake `claude` / `codex` on PATH, and the REAL Taskquoin CLI, git,
 * npm and bubblewrap verification — except where a scenario puts a fake `npm` first on the PATH (`fakeNpm`, the
 * /upgrade install scenarios: the real `npm install -g` must never run, even if a cancellation regressed).
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const CLI = new URL('../../apps/cli/src/main.ts', import.meta.url).pathname;
const LAUNCHER = new URL('../../bin/taskquoin', import.meta.url).pathname;
const FAKES = new URL('./fakes/', import.meta.url).pathname;

export class World {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'tq-feature-')));
  /** Glob characters in the path on purpose: no part of Taskquoin may treat the repository path as a pattern (Codex CR3 #2). */
  repo = join(this.root, 'repo*');
  env: Record<string, string>;
  last?: { status: number | null; stdout: string; stderr: string };
  runId?: string;
  initialBranch?: string;
  skillDir?: string;
  commitsAtStart?: number;
  lastApproval?: [string, string, string];
  /** A fake OpenAI-compatible provider in its own process (multi-LLM A scenarios). */
  provider?: { proc: ChildProcess; url: string; modeFile: string; logFile: string };

  /** One line per real (non-version) call of a fake runtime, in order. */
  callLog = join(this.root, 'runtime-calls');
  calls(): string[] { try { return readFileSync(this.callLog, 'utf8').split('\n').filter(Boolean); } catch { return []; } }

  constructor() {
    const bin = join(this.root, 'bin'); mkdirSync(bin); mkdirSync(join(this.root, 'home'));
    for (const [name, file] of [['claude', 'fake-claude.cjs'], ['codex', 'fake-codex.cjs']]) {
      // Every call that is not a version probe is recorded: a scenario can prove an agent was never called.
      writeFileSync(join(bin, name), `#!/bin/sh\ncase "$1" in --version) ;; *) echo "${name}" >> '${this.callLog}' ;; esac\nexec ${process.execPath} ${FAKES}${file} "$@"\n`); chmodSync(join(bin, name), 0o755);
    }
    // OpenCode runs inside Taskquoin's sandbox (HOME hidden): its fake lives next to its shim, outside the repository.
    copyFileSync(`${FAKES}fake-opencode.cjs`, join(bin, 'fake-opencode.cjs'));
    writeFileSync(join(bin, 'opencode'), `#!/bin/sh\nexec ${process.execPath} ${join(bin, 'fake-opencode.cjs')} "$@"\n`); chmodSync(join(bin, 'opencode'), 0o755);
    // node's own directory too: on CI runners node lives in a tool cache, not in /usr/bin (the launcher runs `node`)
    this.env = { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: join(this.root, 'home'), XDG_STATE_HOME: join(this.root, 'state'), LANG: 'C.UTF-8', TASKQUOIN_OFFLINE: '1' };
  }
  /** Where the fake npm writes its working directory (line 1) and its arguments (line 2) when it is run. */
  npmTrace = join(this.root, 'npm-ran');
  /** A fake `npm` in the World's bin, ahead of the real one: it leaves a trace and fails (exit 1), installing nothing. */
  fakeNpm() {
    const p = join(this.root, 'bin', 'npm');
    writeFileSync(p, `#!/bin/sh\npwd > '${this.npmTrace}'\necho "$*" >> '${this.npmTrace}'\nexit 1\n`); chmodSync(p, 0o755);
  }
  git(...a: string[]) { return execFileSync('git', a, { cwd: this.repo, encoding: 'utf8', env: this.env }); }
  tq(args: string[], input?: string) {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: this.repo, env: this.env, encoding: 'utf8', timeout: 170_000, ...(input !== undefined ? { input } : {}) });
    this.last = { status: r.status, stdout: r.stdout, stderr: r.stderr };
    const m = /Run (run-[\w-]+) —/.exec(r.stdout); if (m) this.runId = m[1];
    return this.last;
  }
  launcher(args: string[]) {
    const r = spawnSync(LAUNCHER, args, { cwd: this.repo, env: this.env, encoding: 'utf8', timeout: 60_000 });
    this.last = { status: r.status, stdout: r.stdout, stderr: r.stderr };
    return this.last;
  }
  async startProvider(mode: string) {
    const modeFile = join(this.root, 'provider-mode'); const logFile = join(this.root, 'provider-requests.jsonl');
    writeFileSync(modeFile, mode); writeFileSync(logFile, '');
    const proc = spawn(process.execPath, [join(FAKES, 'fake-provider.cjs'), modeFile, logFile], { stdio: ['ignore', 'pipe', 'inherit'] });
    const port = await new Promise<number>((res, rej) => {
      proc.stdout!.on('data', (d: Buffer) => { const m = /PORT (\d+)/.exec(d.toString()); if (m) res(Number(m[1])); });
      proc.on('exit', (c) => rej(new Error(`fake provider exited (${c})`)));
    });
    this.provider = { proc, url: `http://127.0.0.1:${port}/v1`, modeFile, logFile };
  }
  providerRequests(): { url: string; auth: string | null; body: string }[] {
    return readFileSync(this.provider!.logFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  }
  cleanup() { this.provider?.proc.kill(); rmSync(this.root, { recursive: true, force: true }); }
}
