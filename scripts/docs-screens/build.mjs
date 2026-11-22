// Builds the documentation screenshots (SVG) from the REAL Taskquoin CLI in a demo repository with simulated agents.
// Usage: node scripts/docs-screens/build.mjs <work-dir> [lang…]   (default: every language, the same 16 screens each)
// Output: docs/assets/screens/<lang>/<screen>.svg. Needs git, npm and bubblewrap (the clean-room Verify runs for real).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { assertPublic, createDemo } from './demo.mjs';
import { terminalSvg } from './svg.mjs';

const [work, ...wanted] = process.argv.slice(2);
if (!work) throw new Error('usage: build.mjs <work-dir> [lang…]');
const C = await import(new URL('../../apps/cli/src/console.ts', import.meta.url).href);
const I = await import(new URL('../../apps/cli/src/i18n/index.ts', import.meta.url).href);
const { displayWidth } = await import(new URL('../../apps/cli/src/i18n/width.ts', import.meta.url).href);
const { LANGUAGES } = await import(new URL('../../apps/cli/src/i18n/languages.ts', import.meta.url).href);
const { parseConfig } = await import('@taskquoin/config');
const { sandboxedToolAvailable } = await import('@taskquoin/local-tool');
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
  save('console', '~/calc — taskquoin', [shell('taskquoin'), C.logoFrames().at(-1), C.renderBanner(squad, { color: true, logo: false }),
    I.t('console.welcome'), PROMPT + '/help', C.consoleHelp(), PROMPT + '/quit'].join('\n'));
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
