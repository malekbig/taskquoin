/**
 * PROVES: `cmdUpgrade` (the /upgrade and `taskquoin upgrade` command) with a fake environment: the table (installed /
 * used / measured, the check mark, the selection), no `latest()` call when offline, every `Latest` kind's line (npm
 * command when packaged, git pull otherwise), auto|path saving then re-probing, the reinstall only after a typed
 * confirmation (translated word or yes, case-insensitive; anything else runs nothing), native vs npm command, the
 * working directory, the state shown after a re-probe, the nothing-to-do case, usage (2); consent covers exactly what
 * is shown (a command with control/bidi characters is refused, a path with a space is shown quoted and run as is); no
 * absolute home → refused (`absoluteHome`: $HOME, else the account home, only when absolute); a failing installer →
 * its code printed and 1; codex/opencode commands only for an installed, unmeasured version; the "installed but not
 * used" line with its reason and remedy.
 * DOES NOT PROVE: the real installer, the real registry, or the wiring in main.ts / console.ts (cli.test.ts does).
 */
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HostReport } from '@taskquoin/host-probe';
import { cmdUpgrade, type UpgradeEnv } from '../src/upgrade-cli.ts';
import { absoluteHome } from '../src/home.ts';
import { setLanguage } from '../src/i18n/index.ts';
import type { Latest } from '../src/upgrade-check.ts';

afterEach(() => setLanguage('en'));

const home = mkdtempSync(join(tmpdir(), 'tq-upgrade-'));
const vdir = join(home, '.local/share/claude/versions');
mkdirSync(vdir, { recursive: true });
const nativeNew = join(vdir, '2.1.330');
const nativeOld = join(vdir, '2.1.327');
writeFileSync(nativeNew, ''); writeFileSync(nativeOld, '');
const measured = { claude: '2.1.327', codex: '0.157.1', opencode: '1.19.5' };

const report = (claude: HostReport['runtimes']['claude']): HostReport => ({
  runtimes: { claude, codex: { bin: '/b/codex', version: '0.157.1' }, opencode: { bin: '/b/opencode', version: '1.19.5' } },
  bashSandbox: true, localIsolation: true, node: 'v22', fileSandbox: true,
});
const fallback = () => report({ bin: nativeOld, version: '2.1.327', installed: { bin: nativeNew, version: '2.1.330' } });
const measuredPath = () => report({ bin: nativeOld, version: '2.1.327' });

function mk(o: Partial<Omit<UpgradeEnv, 'latest'>> & { answers?: (string | undefined)[]; latest?: Latest; after?: HostReport } = {}) {
  const { answers: scripted = [], latest: latestAnswer, after, ...over } = o;
  const out: string[] = []; const err: string[] = []; const asked: string[] = [];
  const calls = { save: [] as string[], reprobe: 0, latest: 0, run: [] as { bin: string; args: string[]; cwd: string }[] };
  const answers = [...scripted];
  const e: UpgradeEnv = {
    h: fallback(), measured, selection: 'auto', packaged: true, version: '2026.11.1', offline: false, home, surface: 'console',
    out: (s = '') => { out.push(s); }, err: (s) => { err.push(s); },
    ask: async (q) => { asked.push(q); return answers.shift(); },
    save: (s) => { calls.save.push(s); },
    reprobe: async () => { calls.reprobe++; return after ?? measuredPath(); },
    latest: async () => { calls.latest++; return latestAnswer ?? { kind: 'latest', version: '2026.11.1', measured }; },
    run: async (bin, args, cwd) => { calls.run.push({ bin, args, cwd }); return 0; },
    ...over,
  };
  return { e, out, err, asked, calls, text: () => out.join('\n') };
}

test('the table shows installed, used (with a check) and measured, and the selection', async () => {
  const m = mk({ offline: true });
  assert.equal(await cmdUpgrade(undefined, m.e), 0);
  assert.match(m.text(), /2\.1\.330 +2\.1\.327 ✔ {2}2\.1\.327/);
  assert.match(m.text(), /choice: automatic/);
  assert.match(m.text(), /measured \(Taskquoin 2026\.11\.1\)/);
  assert.match(m.text(), /codex +0\.157\.1 +0\.157\.1 ✔ +0\.157\.1/);
});

test('a runtime that is missing shows a dash, and an unmeasured used version has no check', async () => {
  const h = report({ bin: '/b/claude', version: '2.1.330' }); delete h.runtimes.opencode;
  const m = mk({ h, offline: true, selection: 'path' });
  await cmdUpgrade(undefined, m.e);
  assert.match(m.text(), /opencode +— +— +1\.19\.5/);
  assert.match(m.text(), /claude +2\.1\.330 +2\.1\.330 +2\.1\.327/);
  assert.doesNotMatch(m.text().split('\n').find((l) => l.startsWith('claude'))!, /✔/);
  assert.match(m.text(), /choice: PATH only/);
});

test('offline never calls latest', async () => {
  const m = mk({ offline: true });
  await cmdUpgrade(undefined, m.e);
  assert.equal(m.calls.latest, 0);
  assert.match(m.text(), /Offline/);
});

test('each Latest kind prints its line', async () => {
  const run = async (latest: Latest, packaged = true, h?: HostReport) => { const m = mk({ latest, packaged, ...(h ? { h } : {}) }); assert.equal(await cmdUpgrade(undefined, m.e), 0); assert.equal(m.calls.latest, 1); return m.text(); };
  assert.match(await run({ kind: 'unpublished' }), /No Taskquoin version is published/);
  assert.match(await run({ kind: 'offline', reason: 'boom' }), /Check impossible/);
  assert.match(await run({ kind: 'invalid' }), /not valid/);
  assert.match(await run({ kind: 'latest', version: '2026.11.1', measured }), /up to date \(2026\.11\.1\)/);
  assert.match(await run({ kind: 'latest', version: '2026.10.0', measured }), /up to date/);
  const m330 = { ...measured, claude: '2.1.330' };
  assert.match(await run({ kind: 'latest', version: '2026.12.0', measured: m330 }), /measures claude 2\.1\.330 — to install it: npm install -g taskquoin@2026\.12\.0/);
  const src = await run({ kind: 'latest', version: '2026.12.0', measured: m330 }, false);
  assert.match(src, /git pull/); assert.doesNotMatch(src, /npm install -g taskquoin/);
  assert.match(await run({ kind: 'latest', version: '2026.12.0', measured: { ...measured, claude: '2.1.340' } }), /Taskquoin 2026\.12\.0 available \(measures claude 2\.1\.340, installed 2\.1\.330\)/);
});

test('auto and path save, re-probe and show the table', async () => {
  for (const s of ['auto', 'path'] as const) {
    const m = mk({ after: measuredPath() });
    assert.equal(await cmdUpgrade(s, m.e), 0);
    assert.deepEqual(m.calls.save, [s]);
    assert.equal(m.calls.reprobe, 1);
    assert.equal(m.calls.latest, 0);
    assert.match(m.text(), /measured \(Taskquoin/);
  }
});

test('install runs the native command in HOME after oui (fr) or YES', async () => {
  setLanguage('fr');
  let m = mk({ answers: [' Oui '] });
  assert.equal(await cmdUpgrade('install', m.e), 0);
  assert.deepEqual(m.calls.run, [{ bin: nativeNew, args: ['install', '2.1.327'], cwd: home }]);
  assert.match(m.text(), new RegExp(`${nativeNew.replace(/[.]/g, '\\.')} install 2\\.1\\.327`));
  assert.equal(m.calls.reprobe, 1);
  assert.equal(m.asked.length, 1);
  setLanguage('en');
  m = mk({ answers: ['YES'] });
  await cmdUpgrade('install', m.e);
  assert.equal(m.calls.run.length, 1);
  assert.match(m.text(), /may change/);
});

test('anything but the word cancels and runs nothing', async () => {
  for (const a of ['o', '', 'no', undefined]) {
    const m = mk({ answers: [a] });
    assert.equal(await cmdUpgrade('install', m.e), 0, String(a));
    assert.equal(m.calls.run.length, 0); assert.equal(m.calls.reprobe, 0);
    assert.match(m.text(), /Cancelled/);
  }
  setLanguage('fr');
  const m = mk({ answers: ['yes'] });
  await cmdUpgrade('install', m.e);
  assert.equal(m.calls.run.length, 1);
});

test('an npm-installed Claude is reinstalled with npm from PATH', async () => {
  const h = report({ bin: nativeOld, version: '2.1.327', installed: { bin: '/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js', version: '2.1.330' } });
  const m = mk({ h, answers: ['yes'] });
  assert.equal(await cmdUpgrade('install', m.e), 0);
  assert.deepEqual(m.calls.run, [{ bin: 'npm', args: ['install', '-g', '@anthropic-ai/claude-code@2.1.327'], cwd: home }]);
  assert.match(m.text(), /npm install -g @anthropic-ai\/claude-code@2\.1\.327/);
});

test('a failing installer is reported with its code and returns 1 (the documented 0/1/2); the new state is shown', async () => {
  for (const code of [7, 127]) {
    const m = mk({ answers: ['yes'], run: async () => code });
    assert.equal(await cmdUpgrade('install', m.e), 1, String(code));
    assert.match(m.err.join('\n'), new RegExp(`installer exited with code ${code}`));
  }
  const ok = mk({ answers: ['yes'] });
  assert.equal(await cmdUpgrade('install', ok.e), 0);
  assert.deepEqual(ok.err, []);
  const m = mk({ answers: ['yes'], after: measuredPath(), run: async () => 7 });
  assert.equal(await cmdUpgrade('install', m.e), 1);
  const claude = m.text().split('\n').filter((l) => l.startsWith('claude')).pop()!;
  assert.match(claude, /2\.1\.327 +2\.1\.327 ✔ +2\.1\.327/);
  assert.doesNotMatch(claude, /2\.1\.330/);
});

test('install with nothing missing says so and runs nothing', async () => {
  const m = mk({ h: measuredPath(), answers: ['yes'] });
  assert.equal(await cmdUpgrade('install', m.e), 0);
  assert.equal(m.calls.run.length, 0); assert.equal(m.asked.length, 0);
  assert.match(m.text(), /Nothing to do/);
});

test('an unknown subcommand prints the usage on stderr and returns 2', async () => {
  const m = mk();
  assert.equal(await cmdUpgrade('foo', m.e), 2);
  assert.match(m.err.join('\n'), /usage: \/upgrade/);
  assert.equal(m.out.length, 0);
});

test('a command that cannot be shown exactly (control or bidi characters) is refused: nothing asked, nothing run', async () => {
  const esc = String.fromCharCode(27); const bidi = String.fromCharCode(0x202e);
  const hostile = join(vdir, `${esc}[31mclaude${bidi}`);
  writeFileSync(hostile, '');
  const h = report({ bin: nativeOld, version: '2.1.327', installed: { bin: hostile, version: '2.1.330' } });
  const m = mk({ h, answers: ['yes'] });
  assert.equal(await cmdUpgrade('install', m.e), 1);
  assert.equal(m.asked.length, 0); assert.equal(m.calls.run.length, 0);
  const all = [...m.out, ...m.err].join('\n');
  assert.match(m.err.join('\n'), /cannot be shown exactly/);
  assert.ok(all.includes('claude?') && all.includes(' install 2.1.327'));
  assert.ok(!all.includes(esc) && !all.includes(bidi));
  assert.ok(!m.out.some((l) => l.startsWith('Command:')), 'no command line is offered for confirmation');
});

test('a path with a space is shown quoted, and the command run is exactly the one shown', async () => {
  const spaced = join(mkdtempSync(join(tmpdir(), 'tq-upgrade-sp-')), 'my home');
  const sv = join(spaced, '.local/share/claude/versions'); mkdirSync(sv, { recursive: true });
  const bin = join(sv, '2.1.330'); writeFileSync(bin, '');
  const h = report({ bin: join(sv, '2.1.327'), version: '2.1.327', installed: { bin, version: '2.1.330' } });
  const m = mk({ h, home: spaced, answers: ['yes'] });
  assert.equal(await cmdUpgrade('install', m.e), 0);
  assert.ok(m.out.includes(`Command: '${bin}' install 2.1.327`), m.out.join('\n'));
  assert.deepEqual(m.calls.run, [{ bin, args: ['install', '2.1.327'], cwd: spaced }]);
});

test('install without an absolute home is refused before anything is asked or run', async () => {
  const m = mk({ home: undefined, answers: ['yes'] });
  assert.equal(await cmdUpgrade('install', m.e), 1);
  assert.equal(m.calls.run.length, 0); assert.equal(m.asked.length, 0);
  assert.match(m.err.join('\n'), /No absolute home directory/);
  setLanguage('fr');
  const fr = mk({ home: undefined, answers: ['oui'] });
  assert.equal(await cmdUpgrade('install', fr.e), 1);
  assert.match(fr.err.join('\n'), /Aucun dossier personnel absolu/);
});

test('absoluteHome: $HOME when absolute, else the account home when absolute, else nothing', () => {
  const account = (h: string) => () => h;
  assert.equal(absoluteHome({ HOME: '/h' }, account('/acct')), '/h');
  for (const HOME of ['', '.', 'rel', undefined]) {
    assert.equal(absoluteHome({ HOME }, account('/acct')), '/acct', String(HOME));
    assert.equal(absoluteHome({ HOME }, account('rel')), undefined, String(HOME));
    assert.equal(absoluteHome({ HOME }, account('')), undefined, String(HOME));
    assert.equal(absoluteHome({ HOME }, () => { throw new Error('no passwd entry'); }), undefined, String(HOME));
  }
});

test('a HOME that is a symlink still recognises the native installer', async () => {
  const link = join(mkdtempSync(join(tmpdir(), 'tq-upgrade-link-')), 'home');
  symlinkSync(home, link);
  const m = mk({ home: link, answers: ['yes'] });
  await cmdUpgrade('install', m.e);
  assert.deepEqual(m.calls.run, [{ bin: nativeNew, args: ['install', '2.1.327'], cwd: link }]);
});

test('an empty translated yes never lets Enter confirm', async () => {
  setLanguage('fr', () => JSON.stringify({ 'upgrade.yes': '' }));
  for (const a of ['', '  ']) {
    const m = mk({ answers: [a] });
    assert.equal(await cmdUpgrade('install', m.e), 0);
    assert.equal(m.calls.run.length, 0);
  }
  const m = mk({ answers: ['yes'] });
  await cmdUpgrade('install', m.e);
  assert.equal(m.calls.run.length, 1);
});

test('codex and opencode commands are printed only when installed with another version than the measured one, never run', async () => {
  const stale = report({ bin: nativeOld, version: '2.1.327', installed: { bin: nativeNew, version: '2.1.330' } });
  stale.runtimes.codex = { bin: '/b/codex', version: '0.150.0' }; delete stale.runtimes.opencode;
  let m = mk({ h: stale, offline: true });
  await cmdUpgrade(undefined, m.e);
  assert.match(m.text(), /npm install -g @openai\/codex@0\.157\.1/);
  assert.doesNotMatch(m.text(), /opencode-ai/, 'opencode is not installed: no command');
  assert.doesNotMatch(m.text(), /@anthropic-ai/);
  m = mk({ h: stale, answers: ['yes'] });
  await cmdUpgrade('install', m.e);
  assert.match(m.text(), /npm install -g @openai\/codex@0\.157\.1/);
  assert.deepEqual(m.calls.run.map((r) => r.bin), [nativeNew]);
  m = mk({ h: measuredPath(), offline: true });
  await cmdUpgrade(undefined, m.e);
  assert.doesNotMatch(m.text(), /@openai|opencode-ai/);
});

test('the table says when the measured Claude Code is installed but not used, why, and the command that fixes it', async () => {
  const h = report({ bin: '/b/claude', version: '2.1.330' }); h.claudeCandidate = { bin: nativeOld, reason: 'selection path' };
  let m = mk({ h, offline: true, selection: 'path' });
  await cmdUpgrade(undefined, m.e);
  assert.match(m.text(), /Claude Code 2\.1\.327 is installed but not used: the choice is PATH only — run \/upgrade auto/);
  m = mk({ h, offline: true, selection: 'path', surface: 'cli' });
  await cmdUpgrade(undefined, m.e);
  assert.match(m.text(), /not used: the choice is PATH only — run taskquoin upgrade auto/);
  h.claudeCandidate = { bin: nativeOld, reason: 'writable by others' };
  m = mk({ h, offline: true });
  await cmdUpgrade(undefined, m.e);
  assert.match(m.text(), new RegExp(`writable by group or others — run chmod go-w ${vdir.replace(/[.]/g, '\\.')} ${nativeOld.replace(/[.]/g, '\\.')}`));
  m = mk({ h: measuredPath(), offline: true });
  await cmdUpgrade(undefined, m.e);
  assert.doesNotMatch(m.text(), /not used/);
});

test('a choice that cannot be saved is reported (translated) and returns 1; nothing is re-probed', async () => {
  const eacces = () => { throw Object.assign(new Error("EACCES: permission denied, open '/s/taskquoin/preferences.json.1.tmp'"), { code: 'EACCES' }); };
  const m = mk({ save: eacces });
  assert.equal(await cmdUpgrade('path', m.e), 1);
  assert.equal(m.calls.reprobe, 0); assert.equal(m.e.selection, 'auto');
  assert.match(m.err.join('\n'), /Cannot save the choice \(EACCES: permission denied/);
  setLanguage('fr');
  const fr = mk({ save: eacces });
  assert.equal(await cmdUpgrade('auto', fr.e), 1);
  assert.match(fr.err.join('\n'), /Impossible d'enregistrer le choix/);
});
