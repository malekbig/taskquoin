/**
 * PROVES (offline): the tarball `npm pack` makes from the built package runs once unpacked as
 * `<dir with a space>/node_modules/taskquoin` — where Node refuses to strip types, so any TypeScript left would crash:
 *  - it holds the compiled CLI and hook, the runtime assets and the first-party skills, and no .ts, test or docs file;
 *  - `version`, `init` and `doctor` work; doctor finds the installed hook entry (real path, with the space) and
 *    verifies the first-party skills from the installed copy (tree hash = lock);
 *  - the installed PreToolUse hook still fails closed: a write to .claude/settings.json → exit 2, CONFIG001;
 *  - `setup` creates no shortcut: npm already put `taskquoin` on the PATH.
 * DOES NOT PROVE: `npm install -g` with registry resolution (CI job `package`), macOS/Windows (R7).
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackage } from '../../scripts/package/build.ts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const rootVersion = (JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')) as { version: string }).version;
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'tq-pkg-')));
const modules = join(tmp, 'with space', 'node_modules');
const inst = join(modules, 'taskquoin');
const home = join(tmp, 'home');
const bin = join(tmp, 'bin');
let packed: string[] = [];
let built: string[] = [];

const gitBin = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
const env = { PATH: bin, HOME: home, XDG_STATE_HOME: join(tmp, 'state'), TASKQUOIN_NO_ANIMATION: '1', LANG: 'C.UTF-8' };
const tq = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [join(inst, 'apps/cli/src/main.js'), ...args], { cwd, env, encoding: 'utf8' });

before(() => {
  const stage = join(tmp, 'stage');
  built = buildPackage(repo, stage).files;
  const pack = spawnSync('npm', ['pack', stage, '--pack-destination', tmp, '--json', '--ignore-scripts'], { encoding: 'utf8' });
  assert.equal(pack.status, 0, pack.stderr);
  const [info] = JSON.parse(pack.stdout) as { filename: string; files: { path: string }[] }[];
  packed = info.files.map(f => f.path);
  mkdirSync(modules, { recursive: true });
  execFileSync('tar', ['-xzf', join(tmp, info.filename), '-C', tmp]);
  renameSync(join(tmp, 'package'), inst);
  symlinkSync(join(repo, 'node_modules/yaml'), join(modules, 'yaml'));
  mkdirSync(bin); symlinkSync(gitBin, join(bin, 'git'));
  mkdirSync(home);
});

test('the tarball holds the compiled CLI, hook, assets and skills — no TypeScript, tests or docs', () => {
  for (const f of ['apps/cli/src/main.js', 'adapters/hooks-claude/src/main.js', 'adapters/runtime-claude/src/capabilities.json',
    'adapters/runtime-opencode/src/hosts.json', 'skills/first-party.lock.json', 'skills/tdd/SKILL.md', 'LICENSE', 'package.json'])
    assert.ok(packed.includes(f), `missing ${f}`);
  assert.deepEqual(packed.filter(f => f.endsWith('.ts') || /(^|\/)(tests?|docs)\//.test(f)), []);
});

// npm silently drops some files (*.orig, symlinks, node_modules/, CVS/…): a dropped skill file would quarantine the skill.
test('the tarball holds exactly the files the build produced — npm dropped nothing', () => {
  assert.deepEqual([...packed].sort(), built);
});

test('the tarball holds the locale catalogs, and TASKQUOIN_LANG=fr prints French help', () => {
  assert.ok(packed.includes('apps/cli/src/i18n/locales/ja.json'), 'missing ja.json');
  const fr = spawnSync(process.execPath, [join(inst, 'apps/cli/src/main.js'), 'help'], { cwd: tmp, env: { ...env, TASKQUOIN_LANG: 'fr' }, encoding: 'utf8' });
  const en = tq(tmp, 'help');
  assert.equal(fr.status, 0, fr.stderr);
  assert.notEqual(fr.stdout, en.stdout);
  assert.match(fr.stdout, /exécution gouvernée/);
});

test('version prints the root version', () => {
  const r = tq(tmp, 'version');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `taskquoin ${rootVersion}\n`);
});

test('init and doctor: the installed hook entry is found and the first-party skills verify', () => {
  const ws = join(tmp, 'ws'); mkdirSync(ws); execFileSync(gitBin, ['init', '-q'], { cwd: ws });
  const init = tq(ws, 'init');
  assert.equal(init.status, 0, init.stderr);
  assert.ok(existsSync(join(ws, 'taskquoin.yaml')));
  const doc = tq(ws, 'doctor');
  assert.ok(doc.stdout.includes(`PreToolUse hook entry: ✔ (${join(inst, 'adapters/hooks-claude/src/main.js')})`), doc.stdout);
  assert.match(doc.stdout, /✔ planning-contract \(first-party,/);
});

test('the installed hook fails closed: a write to Claude settings exits 2 with CONFIG001', () => {
  const proj = join(tmp, 'proj'); mkdirSync(join(proj, '.claude'), { recursive: true });
  const policy = join(tmp, 'policy.json');
  writeFileSync(policy, JSON.stringify({ projectRoot: proj, home, writeGlobs: ['**'], vcs: { commit: false, push: false } }));
  const payload = { hook_event_name: 'PreToolUse', cwd: proj, tool_name: 'Write', tool_input: { file_path: join(proj, '.claude/settings.json'), content: '{}' } };
  const r = spawnSync(process.execPath, [join(inst, 'adapters/hooks-claude/src/main.js'), '--policy', policy], { input: JSON.stringify(payload), encoding: 'utf8', env });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /CONFIG001/);
});

test('setup creates no shortcut: npm already put taskquoin on the PATH', () => {
  const r = tq(tmp, 'setup');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /installed by npm/);
  assert.equal(existsSync(join(home, '.local/bin/taskquoin')), false);
});
