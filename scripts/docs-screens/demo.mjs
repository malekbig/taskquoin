// A demo world for the documentation screenshots: a temporary git repository "calc" whose test fails until sum.js
// exists, an isolated HOME and state directory, and the simulated agents of the end-to-end tests
// (features/support/fakes) on the PATH. Every command is the REAL Taskquoin CLI; only the AI models are simulated.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const CLI = new URL('../../apps/cli/src/main.ts', import.meta.url).pathname;
const FAKES = new URL('../../features/support/fakes/', import.meta.url).pathname;
/** Where this Taskquoin checkout lives: shown as the usual install place, never as this machine's path. */
const TQ_ROOT = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');

export function createDemo(base) {
  const root = realpathSync(mkdtempSync(join(base, 'demo-')));
  const bin = join(root, 'bin'), home = join(root, 'home'), state = join(root, 'state'), repo = join(root, 'calc');
  for (const d of [bin, home, repo]) mkdirSync(d, { recursive: true });
  for (const [name, file] of [['claude', 'fake-claude.cjs'], ['codex', 'fake-codex.cjs'], ['opencode', 'fake-opencode.cjs']]) {
    writeFileSync(join(bin, name), `#!/bin/sh\nexec ${process.execPath} ${FAKES}${file} "$@"\n`); chmodSync(join(bin, name), 0o755);
  }
  const env = { PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, XDG_STATE_HOME: state, LANG: 'C.UTF-8',
    TASKQUOIN_NO_SETUP: '1', TASKQUOIN_NO_ANIMATION: '1', TASKQUOIN_OFFLINE: '1' };
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', env });
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'calc', private: true, scripts: { test: 'node --test' } }, null, 2) + '\n');
  writeFileSync(join(repo, 'sum.test.js'), "const test = require('node:test'); const assert = require('node:assert');\ntest('sum', () => { const sum = require('./sum.js'); assert.strictEqual(sum(2, 3), 5); });\n");
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n');
  git('init', '-q', '-b', 'main'); git('config', 'user.email', 'you@example.com'); git('config', 'user.name', 'you');
  git('add', '.'); git('commit', '-q', '-m', 'calc: a failing test for sum');

  /** Runs `taskquoin <args>` in the demo repository, in `lang`; returns the exit code and what it printed. */
  const tq = (args, lang = 'en', input) => {
    const r = spawnSync(process.execPath, [CLI, ...args], { cwd: repo, env: { ...env, TASKQUOIN_LANG: lang }, encoding: 'utf8', timeout: 300_000, ...(input !== undefined ? { input } : {}) });
    return { code: r.status, stdout: r.stdout ?? '', out: (r.stdout ?? '') + (r.stderr ?? '') };
  };
  /** Paths of this throw-away world, shown as they would be on a user's machine. */
  const normalize = (text) => text
    .split(TQ_ROOT).join('~/taskquoin').split(repo).join('~/calc').split(state).join('~/.local/state').split(home).join('~').split(bin).join('/usr/local/bin')
    .split(root).join('~').split(process.execPath).join('node');
  /** `init`, claude-mem off (the demo has no memory worker), committed — the state a user reaches in the tutorial. */
  const init = (lang) => {
    const r = tq(['init'], lang);
    const p = join(repo, 'taskquoin.yaml');
    writeFileSync(p, readFileSync(p, 'utf8').replace(/claudeMem:\n(\s+)enabled: true/, 'claudeMem:\n$1enabled: false'));
    git('add', '.'); git('commit', '-q', '-m', 'chore: taskquoin init');
    return r;
  };
  return { root, repo, env, tq, git, init, normalize };
}

/** Fails if a screenshot would show anything of the machine that produced it. */
export function assertPublic(text, forbidden) {
  for (const f of forbidden) if (f && text.includes(f)) throw new Error(`docs-screens: "${f}" would appear in a screenshot`);
}
