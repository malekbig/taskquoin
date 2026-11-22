/**
 * PROVES: binaries are found only through absolute PATH entries and resolved to real paths; versions are parsed from
 * `--version`; bash-sandbox is false when bubblewrap/socat are not on PATH; git root is detected. The measured Claude
 * Code of the native installer is used only when trusted, answering the measured version and with `auto`; when it is
 * there but not used, `claudeCandidate` keeps the reason (link, writable by others, version mismatch, selection path,
 * unreadable) — also with no `claude` on the PATH; only ENOENT/ENOTDIR count as missing.
 * DOES NOT PROVE: anything about the real runtimes (fakes are used).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeVersionsDir, findOnPath, probeHost, untrustedReason } from '../src/index.ts';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'tq-probe-')));
const bin = join(root, 'bin'); mkdirSync(bin);
const fake = (name: string, out: string) => { const p = join(bin, name); writeFileSync(p, `#!/bin/sh\necho "${out}"\n`); chmodSync(p, 0o755); };
fake('claude', '2.1.325 (Claude Code)'); fake('codex', 'codex-cli 0.157.1');
const gitBin = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

test('relative PATH entries are ignored', () => {
  assert.equal(findOnPath('claude', `bin:${bin}`), join(bin, 'claude'));
  assert.equal(findOnPath('claude', 'bin'), undefined);
});

test('probeHost: versions, no sandbox without bwrap/socat, git root', async () => {
  const ws = join(root, 'ws'); mkdirSync(ws); execFileSync(gitBin, ['init', '-q'], { cwd: ws });
  const PATH = `${bin}:${gitBin.replace(/\/git$/, '')}`;
  const h = await probeHost({ cwd: ws, PATH, HOME: root });
  assert.deepEqual(h.runtimes.claude, { bin: join(bin, 'claude'), version: '2.1.325' });
  assert.deepEqual(h.runtimes.codex, { bin: join(bin, 'codex'), version: '0.157.1' });
  if (!PATH.split(':').some(d => { try { return !!findOnPath('bwrap', d) && !!findOnPath('socat', d); } catch { return false; } })) assert.equal(h.bashSandbox, false);
  assert.equal(h.gitRoot, ws);
});

test('probeHost: OpenCode found with its version; fileSandbox = Taskquoin\'s own bubblewrap profile usable', async () => {
  fake('opencode', '1.19.5');
  const h = await probeHost({ cwd: root, PATH: `${bin}:/usr/bin:/bin`, HOME: root });
  assert.deepEqual(h.runtimes.opencode, { bin: join(bin, 'opencode'), version: '1.19.5' });
  const { sandboxedToolAvailable } = await import('@taskquoin/local-tool');
  assert.equal(h.fileSandbox, await sandboxedToolAvailable());
});

// Measured-version fallback: a fake HOME holding Claude's native-installer layout; versions are fake data.
const mk = (pathVersion: string | undefined) => {
  const home = join(realpathSync(mkdtempSync(join(tmpdir(), 'tq-probe-h-'))), 'home'); mkdirSync(home);
  const pbin = join(home, 'pbin'); mkdirSync(pbin);
  if (pathVersion) { const p = join(pbin, 'claude'); writeFileSync(p, `#!/bin/sh\necho "${pathVersion} (Claude Code)"\n`); chmodSync(p, 0o755); }
  const vdir = claudeVersionsDir(home); mkdirSync(vdir, { recursive: true }); chmodSync(vdir, 0o755);
  const cand = (v: string, out = v, mode = 0o755) => { const p = join(vdir, v); writeFileSync(p, `#!/bin/sh\necho "${out} (Claude Code)"\n`); chmodSync(p, mode); return p; };
  return { home, pbin, vdir, cand, PATH: `${pbin}:/usr/bin:/bin` };
};
const run = (e: ReturnType<typeof mk>, selection: 'auto' | 'path' = 'auto', HOME = e.home) =>
  probeHost({ cwd: e.home, PATH: e.PATH, HOME, claude: { measured: '2.1.327', selection } }).then(h => h.runtimes.claude);

test('fallback: PATH not measured, candidate measured -> candidate, PATH kept as installed', async () => {
  const e = mk('2.1.330'); const c = e.cand('2.1.327');
  assert.deepEqual(await run(e), { bin: c, version: '2.1.327', installed: { bin: join(e.pbin, 'claude'), version: '2.1.330' } });
});
test('fallback: selection path keeps the PATH binary', async () => {
  const e = mk('2.1.330'); e.cand('2.1.327');
  assert.deepEqual(await run(e, 'path'), { bin: join(e.pbin, 'claude'), version: '2.1.330' });
});
test('fallback: PATH already measured -> PATH, no installed', async () => {
  const e = mk('2.1.327'); e.cand('2.1.327');
  assert.deepEqual(await run(e), { bin: join(e.pbin, 'claude'), version: '2.1.327' });
});
test('fallback: no claude on PATH + valid candidate -> candidate without installed', async () => {
  const e = mk(undefined); const c = e.cand('2.1.327');
  assert.deepEqual(await run(e), { bin: c, version: '2.1.327' });
});
test('fallback: untrusted or wrong candidates are refused, PATH kept', async () => {
  const keep = { version: '2.1.330' };
  let e = mk('2.1.330'); const real = join(e.home, 'real'); writeFileSync(real, '#!/bin/sh\necho 2.1.327\n'); chmodSync(real, 0o755);
  symlinkSync(real, join(e.vdir, '2.1.327'));
  assert.deepEqual(await run(e), { bin: join(e.pbin, 'claude'), ...keep });
  e = mk('2.1.330'); e.cand('2.1.327'); chmodSync(e.vdir, 0o775);
  assert.deepEqual(await run(e), { bin: join(e.pbin, 'claude'), ...keep });
  e = mk('2.1.330'); e.cand('2.1.327', '2.1.327', 0o757);
  assert.deepEqual(await run(e), { bin: join(e.pbin, 'claude'), ...keep });
  e = mk('2.1.330'); e.cand('2.1.327', '2.1.330');
  assert.deepEqual(await run(e), { bin: join(e.pbin, 'claude'), ...keep });
});
test('fallback: empty or relative HOME never looks for a candidate (even a trusted one under cwd)', async () => {
  const e = mk('2.1.330');
  // Trusted candidates where join('', ...) and join('rel', ...) resolve against the cwd: only the guard stops them.
  const plant = (base: string) => { const d = claudeVersionsDir(base); mkdirSync(d, { recursive: true }); chmodSync(d, 0o755);
    const p = join(d, '2.1.327'); writeFileSync(p, '#!/bin/sh\necho "2.1.327 (Claude Code)"\n'); chmodSync(p, 0o755); };
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'tq-probe-cwd-')));
  plant(tmp); plant(join(tmp, 'rel'));
  const prev = process.cwd(); process.chdir(tmp);
  try {
    for (const HOME of ['', 'rel']) assert.deepEqual(await run(e, 'auto', HOME), { bin: join(e.pbin, 'claude'), version: '2.1.330' });
  } finally { process.chdir(prev); }
});
test('untrustedReason names the failure', () => {
  const e = mk('2.1.330'); const uid = process.getuid!();
  assert.equal(untrustedReason(join(e.vdir, 'nope'), uid), 'missing');
  assert.equal(untrustedReason(e.vdir, uid), 'not a file');
  assert.equal(untrustedReason(e.cand('a.b.c', '1', 0o644), uid), 'not executable');
  assert.equal(untrustedReason(e.cand('2.1.327'), uid + 1), 'not owned');
  assert.equal(untrustedReason(e.cand('2.1.327'), uid), undefined);
});

// A measured file that exists but is not used: the probe keeps it with the reason (doctor, banner and /upgrade say why).
const probe = (e: ReturnType<typeof mk>, selection: 'auto' | 'path' = 'auto') =>
  probeHost({ cwd: e.home, PATH: e.PATH, HOME: e.home, claude: { measured: '2.1.327', selection } });
test('candidate: a measured file that is there but not used is reported with its reason', async () => {
  let e = mk('2.1.330'); let c = e.cand('2.1.327'); chmodSync(e.vdir, 0o775); // reproduced: versions/ at 0775
  let h = await probe(e);
  assert.deepEqual(h.runtimes.claude, { bin: join(e.pbin, 'claude'), version: '2.1.330' });
  assert.deepEqual(h.claudeCandidate, { bin: c, reason: 'writable by others' });
  e = mk('2.1.330'); c = e.cand('2.1.327');
  assert.deepEqual((await probe(e, 'path')).claudeCandidate, { bin: c, reason: 'selection path' });
  e = mk('2.1.330'); c = e.cand('2.1.327', '2.1.330');
  assert.deepEqual((await probe(e)).claudeCandidate, { bin: c, reason: 'version mismatch' });
  e = mk('2.1.330'); const real = join(e.home, 'real'); writeFileSync(real, '#!/bin/sh\necho 2.1.327\n'); chmodSync(real, 0o755);
  symlinkSync(real, join(e.vdir, '2.1.327'));
  assert.deepEqual((await probe(e)).claudeCandidate, { bin: join(e.vdir, '2.1.327'), reason: 'link' });
  e = mk(undefined); c = e.cand('2.1.327'); chmodSync(e.vdir, 0o775); // no claude on PATH at all: the reason is kept too
  h = await probe(e);
  assert.equal(h.runtimes.claude, undefined);
  assert.deepEqual(h.claudeCandidate, { bin: c, reason: 'writable by others' });
});
test('candidate: none when the file is missing, when it is the one used, or when the PATH one is measured', async () => {
  assert.equal((await probe(mk('2.1.330'))).claudeCandidate, undefined);
  let e = mk('2.1.330'); e.cand('2.1.327');
  assert.equal((await probe(e)).claudeCandidate, undefined);
  e = mk('2.1.327'); e.cand('2.1.327'); chmodSync(e.vdir, 0o775);
  assert.equal((await probe(e)).claudeCandidate, undefined);
});
test('candidate: a versions directory that cannot be searched is "unreadable", not "missing"', { skip: process.getuid?.() === 0 ? 'root reads every directory' : false }, async () => {
  const e = mk('2.1.330'); const c = e.cand('2.1.327'); chmodSync(e.vdir, 0o000);
  try { assert.deepEqual((await probe(e)).claudeCandidate, { bin: c, reason: 'unreadable' }); } finally { chmodSync(e.vdir, 0o755); }
});
test('untrustedReason: only ENOENT/ENOTDIR are "missing", other errors "unreadable"; a parent that is not a directory is named', () => {
  const uid = 1000;
  const st = (kind: 'file' | 'dir' | 'other', mode = 0o755) => ({ isSymbolicLink: () => false, isFile: () => kind === 'file', isDirectory: () => kind === 'dir', mode, uid });
  const failing = (code: string) => () => { throw Object.assign(new Error(code), { code }); };
  for (const code of ['ENOENT', 'ENOTDIR']) assert.equal(untrustedReason('/v/2.1.327', uid, failing(code)), 'missing', code);
  for (const code of ['EACCES', 'ELOOP', 'EIO']) assert.equal(untrustedReason('/v/2.1.327', uid, failing(code)), 'unreadable', code);
  assert.equal(untrustedReason('/v/2.1.327', uid, (p) => (p === '/v' ? st('other') : st('file'))), 'parent not a directory');
  assert.equal(untrustedReason('/v/2.1.327', uid, (p) => (p === '/v' ? st('dir') : st('other'))), 'not a file');
  assert.equal(untrustedReason('/v/2.1.327', uid, (p) => (p === '/v' ? st('dir', 0o775) : st('file'))), 'writable by others');
  assert.equal(untrustedReason('/v/2.1.327', uid, (p) => (p === '/v' ? st('dir') : st('file'))), undefined);
});
