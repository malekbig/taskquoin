/**
 * PROVES (real git, temp repos) — Codex R4 N1/N2/N5:
 *  - the candidate tree is computed with a TEMPORARY index (the developer's index is untouched);
 *  - NO repository hook ever runs (pre-commit, post-index-change, post-commit traps leave no marker), fsmonitor off;
 *  - changes are read NUL-delimited WITHOUT rename detection (a rename shows its protected source as a deletion),
 *    including names with tabs/newlines;
 *  - gitlinks (submodules) are detected;
 *  - commitTree commits EXACTLY the given tree on the expected parent (compare-and-swap on the branch), and refuses if
 *    the branch moved;
 *  - dirty check and run branch.
 * DOES NOT PROVE: protection against a hostile .git/config (Taskquoin keeps .git out of agents' and Verify's reach).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GitWorkspace } from '../src/index.ts';

const gitBin = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
function repo() {
  const ws = realpathSync(mkdtempSync(join(tmpdir(), 'tq-git-')));
  const g = (...a: string[]) => execFileSync(gitBin, a, { cwd: ws, encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 'o@example.invalid'); g('config', 'user.name', 'owner');
  mkdirSync(join(ws, 'pkg')); writeFileSync(join(ws, 'pkg', 'AGENTS.md'), 'rules\n'); writeFileSync(join(ws, 'a.txt'), 'one\n');
  g('add', '.'); g('commit', '-q', '-m', 'init');
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'tq-git-scratch-')));
  return { ws, g, git: new GitWorkspace({ gitBin, cwd: ws, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' }, scratchDir: scratch }) };
}
const trap = (ws: string, hook: string) => { const p = join(ws, '.git', 'hooks', hook); writeFileSync(p, `#!/bin/sh\ntouch ${join(ws, `HOOK-${hook}`)}\n`); chmodSync(p, 0o755); };

test('clean check and run branch', async () => {
  const { ws, g, git } = repo();
  assert.equal(await git.isClean(), true);
  writeFileSync(join(ws, 'b.txt'), 'x'); assert.equal(await git.isClean(), false);
  g('add', '.'); g('commit', '-q', '-m', 'b');
  const base = await git.startRunBranch('taskquoin/run-1');
  assert.match(base, /^[0-9a-f]{40}$/);
  assert.equal(g('rev-parse', '--abbrev-ref', 'HEAD').trim(), 'taskquoin/run-1');
  await assert.rejects(git.startRunBranch('bad name; rm'), /invalid branch/);
});

test('candidate tree: temp index, new files included, developer index untouched, hooks never run', async () => {
  const { ws, g, git } = repo();
  for (const h of ['pre-commit', 'post-index-change', 'post-commit', 'commit-msg']) trap(ws, h);
  const base = await git.startRunBranch('taskquoin/run-2');
  writeFileSync(join(ws, 'a.txt'), 'one\ntwo\n'); writeFileSync(join(ws, 'new.ts'), 'export const x = 1;\n');
  const tree = await git.candidateTree(base);
  assert.match(tree, /^[0-9a-f]{40}$/);
  assert.equal(g('diff', '--cached', '--name-only').trim(), '', 'developer index untouched');
  const diff = await git.diff(base, tree);
  assert.match(diff, /\+two/); assert.match(diff, /new file mode[\s\S]*new\.ts/);
  const sha = await git.commitTree(tree, base, 'taskquoin/run-2', 'taskquoin: test\n\nTaskquoin-Run: run-2');
  assert.equal(g('rev-parse', `${sha}^{tree}`).trim(), tree, 'exactly the approved tree');
  assert.equal(g('rev-parse', 'taskquoin/run-2').trim(), sha);
  for (const h of ['pre-commit', 'post-index-change', 'post-commit', 'commit-msg']) assert.equal(existsSync(join(ws, `HOOK-${h}`)), false, `${h} must not run`);
});

test('changes: NUL-delimited, no rename detection, odd file names', async () => {
  const { ws, git } = repo();
  const base = await git.startRunBranch('taskquoin/run-3');
  renameSync(join(ws, 'pkg', 'AGENTS.md'), join(ws, 'pkg', 'notes.md'));
  writeFileSync(join(ws, 'we\tird\nname.txt'), 'x');
  const tree = await git.candidateTree(base);
  const ch = await git.changes(base, tree);
  assert.ok(ch.some(c => c.status === 'D' && c.path === 'pkg/AGENTS.md'), JSON.stringify(ch));
  assert.ok(ch.some(c => c.status === 'A' && c.path === 'pkg/notes.md'));
  assert.ok(ch.some(c => c.path === 'we\tird\nname.txt'));
});

test('gitlinks (submodules) are detected', async () => {
  const { ws, g, git } = repo();
  const base = await git.startRunBranch('taskquoin/run-4');
  g('update-index', '--add', '--cacheinfo', `160000,${base},vendored`);
  g('commit', '-q', '-m', 'add gitlink');
  // detection works on any tree (the workflow checks both the base tree and the candidate)
  assert.deepEqual(await git.gitlinks(await git.treeOf(await git.head())), ['vendored']);
});

test('commitTree refuses when the branch moved (compare-and-swap)', async () => {
  const { ws, g, git } = repo();
  const base = await git.startRunBranch('taskquoin/run-5');
  writeFileSync(join(ws, 'a.txt'), 'changed\n');
  const tree = await git.candidateTree(base);
  g('commit', '-q', '--allow-empty', '-m', 'someone else');
  await assert.rejects(git.commitTree(tree, base, 'taskquoin/run-5', 'm'), /branch .* moved/);
});

test('redTree = base + only the changed test files (RED proof: production changes left out)', async () => {
  const { ws, g, git } = repo();
  mkdirSync(join(ws, 'src')); mkdirSync(join(ws, 'test'));
  writeFileSync(join(ws, 'src', 'sum.js'), 'module.exports = () => 0;\n'); g('add', '.'); g('commit', '-q', '-m', 'old');
  const base = await git.startRunBranch('taskquoin/run-7');
  writeFileSync(join(ws, 'src', 'sum.js'), 'module.exports = (a, b) => a + b;\n');
  writeFileSync(join(ws, 'test', 'sum.test.js'), 'test\n'); writeFileSync(join(ws, 'src', 'other_test.go'), 'go test\n');
  const green = await git.candidateTree(base);
  const red = await git.redTree(base, green, (p) => /(^|\/)test\/|_test\.go$|\.test\.js$/.test(p));
  const ch = (await git.changes(base, red)).map(c => c.path).sort();
  assert.deepEqual(ch, ['src/other_test.go', 'test/sum.test.js'], 'only test files differ from base');
  assert.equal(await git.redTree(base, green, () => false), await git.treeOf(base), 'no test changed ⇒ red tree is the base tree');
});

test('clean room (ADR-0014): materialize writes exactly a tree into a fresh directory; dirTree reads it back; ignored entries listed', async () => {
  const { ws, g, git } = repo();
  writeFileSync(join(ws, '.gitignore'), 'node_modules/\n.env\ndist/\n'); mkdirSync(join(ws, 'src'));
  writeFileSync(join(ws, 'src', 'sum.js'), 'module.exports = 1;\n'); symlinkSync('src/sum.js', join(ws, 'link.js'));
  g('add', '.'); g('commit', '-q', '-m', 'app');
  const base = await git.startRunBranch('taskquoin/run-11');
  mkdirSync(join(ws, 'node_modules', 'dep'), { recursive: true }); writeFileSync(join(ws, 'node_modules', 'dep', 'index.js'), 'x');
  mkdirSync(join(ws, 'apps', 'web', 'node_modules'), { recursive: true }); writeFileSync(join(ws, 'apps', 'web', 'node_modules', 'y.js'), 'y');
  writeFileSync(join(ws, '.env'), 'SECRET=1'); writeFileSync(join(ws, 'src', 'sum.js'), 'module.exports = 2;\n');
  const tree = await git.candidateTree(base);
  const room = realpathSync(mkdtempSync(join(tmpdir(), 'tq-room-')));
  await git.materialize(tree, room);
  assert.equal(readFileSync(join(room, 'src', 'sum.js'), 'utf8'), 'module.exports = 2;\n');
  assert.equal(existsSync(join(room, '.env')), false, 'ignored files are not materialized');
  assert.equal(existsSync(join(room, 'node_modules')), false);
  assert.equal(existsSync(join(room, '.git')), false, 'no .git in the clean room');
  assert.equal(await git.dirTree(room, base), tree, 'the clean room is exactly the tree');
  writeFileSync(join(room, 'src', 'sum.js'), 'tampered'); writeFileSync(join(room, '.env'), 'ignored in the room too');
  assert.notEqual(await git.dirTree(room, base), tree, 'a test changing tracked files is detected');
  writeFileSync(join(room, 'src', 'sum.js'), 'module.exports = 2;\n');
  assert.equal(await git.dirTree(room, base), tree, 'ignored files created by tests do not count');
  await assert.rejects(git.materialize(tree, room), /not empty/);
  const idxBefore = statSync(join(ws, '.git', 'index'), { bigint: true });
  const ign = (await git.ignoredEntries()).sort((a, b) => (a.path < b.path ? -1 : 1));
  const idxAfter = statSync(join(ws, '.git', 'index'), { bigint: true });
  assert.equal(idxAfter.mtimeNs, idxBefore.mtimeNs, 'developer index never rewritten'); assert.equal(idxAfter.ino, idxBefore.ino);
  assert.deepEqual(ign, [{ path: '.env', dir: false }, { path: 'apps/web/node_modules', dir: true }, { path: 'node_modules', dir: true }]);
});

test('judges (multi-LLM A3): judgeDiff masks secret and binary files; changedTexts gives the full new text of the other changed files', async () => {
  const { ws, g, git } = repo();
  mkdirSync(join(ws, 'src')); mkdirSync(join(ws, 'config'));
  writeFileSync(join(ws, 'src', 'a.js'), 'one\n'); writeFileSync(join(ws, 'config', '.env.prod'), 'TOKEN=base\n'); writeFileSync(join(ws, 'old.js'), 'old\n');
  g('add', '.'); g('commit', '-q', '-m', 'base');
  const base = await git.startRunBranch('taskquoin/run-12');
  writeFileSync(join(ws, 'src', 'a.js'), 'two\n'); writeFileSync(join(ws, 'config', '.env.prod'), 'TOKEN=CANARY-9931\n');
  mkdirSync(join(ws, 'img')); writeFileSync(join(ws, 'img', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0x00, 0xff]));
  unlinkSync(join(ws, 'old.js')); writeFileSync(join(ws, 'src', 'b.js'), 'b\n');
  const tree = await git.candidateTree(base);
  const isSecret = (p: string) => /(^|\/)\.env/.test(p);
  const d = await git.judgeDiff(base, tree, isSecret);
  assert.match(d, /diff --git a\/src\/a\.js b\/src\/a\.js[\s\S]*\+two/);
  assert.match(d, /\[fichier secret modifié : config\/\.env\.prod — contenu non envoyé\]/);
  assert.match(d, /\[changement binaire : img\/logo\.png\]/);
  assert.match(d, /-old/, 'deletions are shown');
  assert.doesNotMatch(d, /CANARY-9931|TOKEN=base/, 'never the secret content (old or new)');
  assert.deepEqual(await git.changedTexts(base, tree, isSecret, 1_000_000), [{ path: 'src/a.js', text: 'two\n' }, { path: 'src/b.js', text: 'b\n' }]);
  assert.deepEqual(await git.changedTexts(base, tree, isSecret, 5), [{ path: 'src/a.js', text: 'two\n' }, { path: '…', text: '[budget atteint : 1 fichier(s) non inclus]' }]);
  assert.deepEqual(await git.changedTexts(base, tree, isSecret, 3), [{ path: '…', text: '[budget atteint : 2 fichier(s) non inclus]' }]);
});

test('final review: a secret moved or copied to a NON-secret path never reaches a judge (rename .env → settings.txt, copied line)', async () => {
  const { ws, g, git } = repo();
  mkdirSync(join(ws, 'src'));
  writeFileSync(join(ws, '.env'), 'API_TOKEN=CANARY-MOVE-4242\nDB_PASSWORD=CANARY-PW-77\n'); writeFileSync(join(ws, 'src', 'config.js'), 'module.exports = {};\n');
  g('add', '.'); g('commit', '-q', '-m', 'base with a tracked secret');
  const base = await git.startRunBranch('taskquoin/run-13');
  renameSync(join(ws, '.env'), join(ws, 'settings.txt'));
  writeFileSync(join(ws, 'src', 'config.js'), "const x = 1;\nDB_PASSWORD=CANARY-PW-77\nmodule.exports = { x };\n");
  writeFileSync(join(ws, 'src', 'clean.js'), 'module.exports = 2;\n');
  const tree = await git.candidateTree(base);
  const isSecret = (p: string) => /(^|\/)\.env/.test(p);
  const d = await git.judgeDiff(base, tree, isSecret);
  assert.doesNotMatch(d, /CANARY-MOVE-4242|CANARY-PW-77/, d);
  assert.match(d, /\[fichier secret modifié : \.env — contenu non envoyé\]/);
  assert.match(d, /\[fichier masqué : contient des lignes d'un fichier secret — settings\.txt\]/);
  assert.match(d, /\[fichier masqué : contient des lignes d'un fichier secret — src\/config\.js\]/);
  assert.match(d, /\+module\.exports = 2;/, 'other changes still reviewed');
  assert.deepEqual((await git.changedTexts(base, tree, isSecret, 1_000_000)).map(f => f.path), ['src/clean.js']);
});

test('final review: binary detection does not trust .gitattributes — NUL bytes make a change binary', async () => {
  const { ws, g, git } = repo();
  writeFileSync(join(ws, '.gitattributes'), '*.dat diff\n'); g('add', '.'); g('commit', '-q', '-m', 'force text diff for .dat');
  const base = await git.startRunBranch('taskquoin/run-14');
  writeFileSync(join(ws, 'data.dat'), Buffer.concat([Buffer.from('CANARY-BIN-1\n'), Buffer.from([0, 1, 2, 0, 255])]));
  const tree = await git.candidateTree(base);
  const d = await git.judgeDiff(base, tree, () => false);
  assert.match(d, /\[changement binaire : data\.dat\]/); assert.doesNotMatch(d, /CANARY-BIN-1/);
  assert.deepEqual(await git.changedTexts(base, tree, () => false, 1_000_000), []);
});
