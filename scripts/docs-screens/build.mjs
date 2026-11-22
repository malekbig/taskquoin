// Builds the documentation screenshots (SVG) from the REAL Taskquoin CLI in a demo repository with simulated agents.
// Usage: node scripts/docs-screens/build.mjs <work-dir> [lang…]   (default: every language, the same 16 screens each)
// Output: docs/assets/screens/<lang>/<screen>.svg. Needs git, npm and bubblewrap (the clean-room Verify runs for real).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { assertPublic, createDemo } from './demo.mjs';
import { terminalSvg } from './svg.mjs';

const [work, ...wanted] = process.argv.slice(2);
if (!work) throw new Error('usage: build.mjs <work-dir> [lang…]');
// Times in UTC, like the run ids and the history next to them: a screen never shows the build machine's time zone.
process.env.TZ = 'UTC';
const C = await import(new URL('../../apps/cli/src/console.ts', import.meta.url).href);
const I = await import(new URL('../../apps/cli/src/i18n/index.ts', import.meta.url).href);
const { displayWidth } = await import(new URL('../../apps/cli/src/i18n/width.ts', import.meta.url).href);
const { LANGUAGES } = await import(new URL('../../apps/cli/src/i18n/languages.ts', import.meta.url).href);
const { parseConfig } = await import('@taskquoin/config');
const { sandboxedToolAvailable } = await import('@taskquoin/local-tool');
const { loadRiskAcceptances, repoStore } = await import('@taskquoin/store-fs');
const { configDigest } = await import(new URL('../../apps/cli/src/workflow-cli.ts', import.meta.url).href);
const { renderHome } = await import(new URL('../../apps/cli/src/tui/components/home.ts', import.meta.url).href);
const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
/** The terminal of the screenshots: a truecolor UTF-8 terminal 100 columns wide, so the home is the Full one. */
const CAPS = { interactive: true, cursor: true, colorDepth: 24, charset: 'utf8', theme: 'dark', motion: false, plain: false, columns: 100, rows: 40 };
const OUT = new URL('../../docs/assets/screens/', import.meta.url).pathname;
const FORBIDDEN = [work, homedir(), userInfo().username, '/tmp/'];

const MAX_COLS = 128, MAX_ROWS = 46;
const muted = (s) => `\x1b[38;2;154;165;206m${s}\x1b[0m`, mint = (s) => `\x1b[38;2;94;242;194m${s}\x1b[0m`;
const shell = (cmd) => muted('~/calc $ ') + cmd;
/** Hard-wraps plain lines at MAX_COLS display columns, as a terminal of that width would. */
function wrap(text) {
  return text.split('\n').flatMap((line) => {
    if (line.includes('\x1b') || displayWidth(line) <= MAX_COLS) return [line];
    // Break at the last space that fits (words stay whole), else at the limit; continuation lines are indented.
    const parts = []; let rest = line;
    while (displayWidth(rest) > MAX_COLS) {
      let cut = 0, w = 0, lastSpace = -1;
      for (const ch of rest) { if (w + displayWidth(ch) > MAX_COLS) break; w += displayWidth(ch); cut += ch.length; if (ch === ' ') lastSpace = cut; }
      const at = lastSpace > MAX_COLS / 2 ? lastSpace : cut;
      parts.push(rest.slice(0, at).trimEnd()); rest = '    ' + rest.slice(at).trimStart();
    }
    return [...parts, rest];
  }).join('\n');
}
/** Keeps the start and the end of a long output, with a visible cut. */
function clip(text, rows = MAX_ROWS) {
  const lines = text.split('\n');
  if (lines.length <= rows) return text;
  const head = lines.slice(0, rows - 8), tail = lines.slice(-6);
  return [...head, muted(`  … ${lines.length - head.length - tail.length} more lines …`), ...tail].join('\n');
}

/**
 * A piped console session as a terminal shows it: each line of `typed` written after the prompt that read it (console
 * prompts in mint, questions as printed), starting at the first prompt.
 */
function echoTyped(out, typed, questions) {
  const prompt = /taskquoin (?:\[[^\]\n]*\] )?› /g;
  let rest = out.slice(out.search(prompt)), shown = '';
  for (const line of typed) {
    const at = [...questions.map((q) => ({ i: rest.indexOf(q), len: q.length, q: true })), (() => { prompt.lastIndex = 0; const m = prompt.exec(rest); return m ? { i: m.index, len: m[0].length, q: false } : { i: -1 }; })()]
      .filter((x) => x.i >= 0).sort((a, b) => a.i - b.i)[0];
    if (!at) throw new Error(`docs-screens: no prompt left for ${JSON.stringify(line)}`);
    const p = rest.slice(at.i, at.i + at.len);
    shown += rest.slice(0, at.i) + (at.q ? p : mint(p.trimEnd()) + ' ') + line + '\n';
    rest = rest.slice(at.i + at.len);
  }
  return (shown + rest).replace(/\n+$/, '');
}

async function buildLanguage(lang) {
  const demo = createDemo(work);
  const screens = {};
  const step = (cmd, r) => shell(`taskquoin ${cmd}`) + '\n' + demo.normalize(r.out).replace(/\n+$/, '');
  const save = (name, title, text) => { const t = clip(wrap(text)); assertPublic(t, FORBIDDEN); screens[name] = terminalSvg(t, title); };

  const init = demo.init(lang);
  const accept = demo.tq(['accept-risk', 'challenger', 'connector.write', '--reason', 'Codex reviews read-only; no connector configured', '--expires', '2026-12-31', '--as', 'you'], lang);
  const doctor = demo.tq(['doctor'], lang);

  // The console start screen, drawn by the console's own functions with the gates' real verdicts.
  I.setLanguage(lang);
  const cfg = parseConfig(readFileSync(join(demo.repo, 'taskquoin.yaml'), 'utf8'));
  const verdict = Object.fromEntries(Object.keys(cfg.agents).map((id) => [id, JSON.parse(demo.tq(['check', id, '--json'], lang).stdout)]));
  const squad = C.squadOf(cfg.agents, (id) => verdict[id], await sandboxedToolAvailable());
  const PROMPT = mint('taskquoin ›') + ' ';
  const store = repoStore(demo.repo, join(demo.env.XDG_STATE_HOME, 'taskquoin'));
  const today = new Date().toISOString().slice(0, 10);
  const risks = loadRiskAcceptances(store).filter((r) => r.expires >= today);
  const home = renderHome({ version: VERSION, repo: '~/calc', branch: 'main', clean: true,
    sandbox: { bubblewrap: await sandboxedToolAvailable(), socat: (process.env.PATH ?? '').split(':').some((d) => existsSync(join(d || '.', 'socat'))), verify: await sandboxedToolAvailable() },
    policy: { digest: configDigest(demo.repo).replace(/^sha256:/, ''), acceptedRisks: risks.map((r) => ({ capability: r.capability, expires: r.expires })) },
    squad, notices: [] }, CAPS);
  save('console', '~/calc — taskquoin', [shell('taskquoin'), ...home, I.t('console.welcome'), PROMPT + '/help', C.consoleHelp(), PROMPT + '/quit'].join('\n'));
  I.setLanguage('en');

  const run = demo.tq(['run', 'Add a sum function'], lang);
  const runId = /\brun-\d{8}T\d{6}-[0-9a-f]{6}\b/.exec(run.out)?.[0];
  if (!runId) throw new Error(`${lang}: no run id in:\n${run.out}`);
  const pending = () => /taskquoin approve (\S+) (plan|commit) --expect ([0-9a-f]{12})/.exec(demo.tq(['status', runId], lang).out);
  save('run', '~/calc — taskquoin run', step('run "Add a sum function"', run));
  const plan = demo.tq(['show', runId, 'plan'], lang);
  const p1 = pending(); if (!p1) throw new Error(`${lang}: no plan gate`);
  const a1 = demo.tq(['approve', runId, 'plan', '--expect', p1[3], '--as', 'you'], lang);
  const diff = demo.tq(['show', runId, 'diff-1'], lang);
  const verify = demo.tq(['show', runId, 'verify-1'], lang);
  const p2 = pending(); if (!p2) throw new Error(`${lang}: no commit gate`);
  // A wrong hash, typed while the commit gate is still waiting: refused, nothing approved.
  const wrong = demo.tq(['approve', runId, 'commit', '--expect', '000000000000', '--as', 'you'], lang);
  // The console's /approve commit from a REAL console session: /show diff-1, then what the approval is bound to, what
  // to read and what was read, cancelled at the retype (the commit is approved below with the CLI). The input is piped,
  // so each typed line is put back after its prompt, as a terminal would echo it; the home before the first prompt is left out.
  {
    const typed = [`/use ${runId}`, '/show diff-1', '/approve commit', 'you', '', '/quit'];
    const session = demo.tq(['console'], lang, typed.join('\n') + '\n');
    if (session.code !== 0) throw new Error(`${lang}: the console session failed:\n${session.out}`);
    I.setLanguage(lang);
    save('console-approve', '~/calc — taskquoin › /approve commit', echoTyped(demo.normalize(session.stdout), typed, [I.t('console.askName'), I.t('console.retype', { hash: p2[3] })]));
    I.setLanguage('en');
  }
  const a2 = demo.tq(['approve', runId, 'commit', '--expect', p2[3], '--as', 'you'], lang);
  save('approve', '~/calc — taskquoin approve', [step(`approve ${runId} plan --expect ${p1[3]} --as you`, a1), '', step(`approve ${runId} commit --expect ${p2[3]} --as you`, a2)].join('\n'));

  {
    save('init', '~/calc — taskquoin init', step('init', init));
    save('accept-risk', '~/calc — taskquoin accept-risk', step('accept-risk challenger connector.write --reason "Codex reviews read-only; no connector configured" --expires 2026-12-31 --as you', accept));
    save('doctor', '~/calc — taskquoin doctor', step('doctor', doctor));
    save('show-plan', '~/calc — taskquoin show plan', step(`show ${runId} plan`, plan));
    save('show-diff', '~/calc — taskquoin show diff-1', step(`show ${runId} diff-1`, diff));
    save('show-verify', '~/calc — taskquoin show verify-1', step(`show ${runId} verify-1`, verify));
    save('status', '~/calc — taskquoin status', step(`status ${runId}`, demo.tq(['status', runId], lang)) + '\n\n' + step('status', demo.tq(['status'], lang)));
    save('commit', '~/calc — git log', shell(`git log -1 taskquoin/${runId}`) + '\n' + demo.normalize(demo.git('log', '-1', `taskquoin/${runId}`)).replace(/\n+$/, ''));
    save('check', '~/calc — taskquoin check', step('check challenger', demo.tq(['check', 'challenger'], lang)));
    save('skills', '~/calc — taskquoin skills list', step('skills list', demo.tq(['skills', 'list'], lang)));
    save('refused', '~/calc — a wrong hash is refused', step(`approve ${runId} commit --expect 000000000000 --as you`, wrong));

    // Claude Code auto-updated: doctor shows the measured version in use, and `upgrade` shows the three versions.
    demo.unmeasuredClaude();
    save('doctor-fallback', '~/calc — taskquoin doctor after a Claude Code update', step('doctor', demo.tq(['doctor'], lang)));
    save('upgrade', '~/calc — taskquoin upgrade', step('upgrade --offline', demo.tq(['upgrade', '--offline'], lang)));
  }
  mkdirSync(join(OUT, lang), { recursive: true });
  for (const [name, svg] of Object.entries(screens)) writeFileSync(join(OUT, lang, `${name}.svg`), svg);
  return Object.keys(screens);
}

const langs = wanted.length ? wanted : LANGUAGES.map((l) => l.code);
for (const lang of langs) {
  const t0 = Date.now(); const names = await buildLanguage(lang);
  console.log(`${lang}: ${names.join(', ')} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
