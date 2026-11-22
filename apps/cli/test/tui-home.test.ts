/**
 * PROVES: the V2 home screen (renderLogo, renderHome) — the quoin mark with its wordmark and brand colours, the
 * Full / Compact / Minimal modes and their exact boundaries (100 / 70 columns, 24 / 16 rows, colour, UTF-8), the squad
 * with a reason per agent, the action line in the `orange` token, a refusal shortened on a whole word (a version
 * mismatch by meaning), the READY count equal to projectSquad's, every line within the terminal width at 40..200
 * columns in en, fr, ja and ar, no escape without colour, hostile text from outside made inert.
 * DOES NOT PROVE: how the real console gathers its context (cli.test.ts and the Gherkin features do), nor the animation (console.test.ts).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectSquad, type SquadMember } from '@taskquoin/application';
import { setLanguage } from '../src/i18n/index.ts';
import { displayWidth } from '../src/i18n/width.ts';
import type { Caps } from '../src/tui/caps.ts';
import { homeMode, renderHome, wordCut, type HomeModel } from '../src/tui/components/home.ts';
import { renderLogo } from '../src/tui/components/logo.ts';

const caps = (o: Partial<Caps> = {}): Caps => ({ interactive: true, cursor: true, colorDepth: 24, charset: 'utf8', theme: 'dark', motion: true, plain: false, columns: 100, rows: 30, ...o });
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
const ESC = String.fromCharCode(0x1b);

const SQUAD: SquadMember[] = [
  { role: 'Architect', who: 'planner · claude', state: 'blocked', note: 'capability matrix measured for claude 2.1.327, installed 2.1.330' },
  { role: 'Developer', who: 'implementer · claude', state: 'blocked', note: 'capability matrix measured for claude 2.1.327, installed 2.1.330' },
  { role: 'Reviewer', who: 'challenger · codex', state: 'risk', note: 'connector.write' },
  { role: 'Tester', who: 'verify · bubblewrap', state: 'ready' },
];
const model = (o: Partial<HomeModel> = {}): HomeModel => ({
  version: '2026.11.1', repo: '~/shop-api', branch: 'main', clean: true,
  sandbox: { bubblewrap: true, socat: true, verify: true },
  policy: { digest: '5c7269946c4b8d0e', acceptedRisks: [{ capability: 'connector.write', expires: '2026-12-31' }] },
  squad: SQUAD, notices: [], ...o,
});
const FULL_LOGO = ['  ██████  ▀█▀ ▄▀▄ █▀▀ █▄▀ ▄▀▄ █ █ ▄▀▄ █ █▄ █', '  ███      █  █▀█ ▄▄█ █ █ ▀▄█ ▀▄▀ ▀▄▀ █ █ ▀█', '  ██████  ✦ YOUR AI DEV SQUAD ✦', '  ███     governed · human in the loop · verifiable'];

test('logo: the mark and the wordmark are exact; the version is right-aligned on row 1; the tagline and the promise sit on rows 3 and 4', () => {
  setLanguage('en');
  const rows = renderLogo(caps(), '2026.11.1').map(strip);
  assert.equal(rows.length, 4);
  assert.ok(rows[0].startsWith(FULL_LOGO[0]) && rows[0].endsWith('v2026.11.1'), rows[0]);
  assert.equal(displayWidth(rows[0]), 100, 'right-aligned to the 100-column Full width');
  assert.equal(rows[1], FULL_LOGO[1]); assert.equal(rows[2], FULL_LOGO[2]); assert.equal(rows[3], FULL_LOGO[3]);
});

test('logo: stones mint, cyan, violet, orange; the wordmark runs mint to violet; only the Q tail is orange; tagline orange, promise muted', () => {
  const rows = renderLogo(caps(), '2026.11.1');
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(';');
  const fg = (hex: string, text: string) => `${ESC}[38;2;${rgb(hex)}m${text}${ESC}[39m`;
  assert.ok(rows[0].includes(fg('#5EF2C2', '██████')), 'stone 1 mint');
  assert.ok(rows[1].includes(fg('#7DCFFF', '███')), 'stone 2 cyan');
  assert.ok(rows[2].startsWith('  ' + fg('#BB9AF7', '██████')), 'stone 3 violet');
  assert.ok(rows[3].includes(fg('#FF9E64', '███')), 'stone 4 orange');
  assert.ok(rows[0].includes(fg('#5EF2C2', '▀█▀')) && rows[0].includes(fg('#BB9AF7', '█▄ █')), 'T mint, N violet');
  assert.ok(rows[1].includes(fg('#FF9E64', '█') + ' ' + fg('#7DCFFF', '▀▄▀')), 'the Q tail is the only orange cell of the wordmark');
  assert.equal(rows[0].split('38;2;255;158;100').length - 1, 0, 'no orange on wordmark row 1');
  assert.ok(rows[2].includes(fg('#FF9E64', '✦ YOUR AI DEV SQUAD ✦')));
  assert.ok(rows[3].includes(fg('#9AA5CE', 'governed · human in the loop · verifiable')));
});

test('logo: one brand line without colour, in Minimal, in ASCII and in plain mode; `▙` is mint only with colour', () => {
  assert.deepEqual(renderLogo(caps({ colorDepth: 0 }), '2026.11.1'), ['▙ taskquoin 2026.11.1']);
  assert.deepEqual(renderLogo(caps({ columns: 69 }), '2026.11.1').map(strip), ['▙ taskquoin 2026.11.1']);
  assert.ok(renderLogo(caps({ columns: 69 }), '2026.11.1')[0].startsWith(`${ESC}[38;2;94;242;194m▙`));
  assert.deepEqual(renderLogo(caps({ charset: 'ascii' }), '2026.11.1').map(strip), ['# taskquoin 2026.11.1']);
  assert.equal(renderLogo(caps({ plain: true }), '2026.11.1').length, 1);
});

test('modes: Full from 100 columns and 24 rows with colour and UTF-8; Compact 70-99 columns or 16-23 rows; Minimal under 70, under 16 rows, no colour, ASCII, plain', () => {
  assert.equal(homeMode(caps({ columns: 100, rows: 24 })), 'full');
  assert.equal(homeMode(caps({ columns: 99 })), 'compact');
  assert.equal(homeMode(caps({ columns: 70 })), 'compact');
  assert.equal(homeMode(caps({ columns: 69 })), 'minimal');
  assert.equal(homeMode(caps({ rows: 23 })), 'compact');
  assert.equal(homeMode(caps({ rows: 16 })), 'compact');
  assert.equal(homeMode(caps({ rows: 15 })), 'minimal');
  assert.equal(homeMode(caps({ colorDepth: 0 })), 'minimal');
  assert.equal(homeMode(caps({ charset: 'ascii' })), 'minimal');
  assert.equal(homeMode(caps({ plain: true })), 'minimal');
});

test('Full: the mark, the three context lines, the squad with its reasons, the gate\'s count and the action line', () => {
  setLanguage('en');
  const lines = renderHome(model(), caps()).map(strip);
  assert.deepEqual(lines.slice(0, 4).map(l => l.replace(/\s+v2026\.11\.1$/, '')), FULL_LOGO.map(l => l));
  assert.match(lines.join('\n'), /^ {2}Repository +~\/shop-api {3}main · clean tree$/m);
  assert.match(lines.join('\n'), /^ {2}Sandbox +✔ bubblewrap {2}✔ socat · clean-room Verify available$/m);
  assert.match(lines.join('\n'), /^ {2}Policy +taskquoin\.yaml 5c7269946c4b · 1 accepted risk until 2026-12-31$/m);
  assert.match(lines.join('\n'), /^ {2}── Squad ─+ 1 of 3 agents ready · Verify ready ──$/m);
  assert.match(lines.join('\n'), /^ {2}○ Architect +planner · claude +NOT READY +not measured \(certified 2\.1\.327\)$/m);
  assert.match(lines.join('\n'), /^ {2}◐ Reviewer +challenger · codex +READY +accepted risk: connector\.write$/m);
  assert.match(lines.join('\n'), /^ {2}● Tester +verify · bubblewrap +READY$/m);
  assert.match(lines.join('\n'), /^ {2}◆ Action required {2}2 agents are NOT READY — \/doctor for the details$/m);
  assert.ok(lines.every(l => displayWidth(l) <= 100));
});

test('Full: an action notice from the runtime is the action line, in the orange token and nowhere else; a fallback notice is muted with a cyan arrow', () => {
  setLanguage('en');
  const action = { kind: 'action' as const, text: '◆ Action required  Claude Code 2.1.330 is not measured and 2.1.327 is not installed — /upgrade to reinstall it' };
  const fallback = { kind: 'fallback' as const, text: '⬆ Claude Code 9.9.9 installed, not measured yet — Taskquoin uses 2.1.327 (measured) · /upgrade' };
  const colored = renderHome(model({ notices: [action, fallback] }), caps());
  const orange = `${ESC}[38;2;255;158;100m`;
  const orangeLines = colored.filter(l => l.includes(orange));
  const actionAt = colored.findIndex(l => strip(l).includes('◆ Action required'));
  assert.ok(colored[actionAt].includes(orange + '◆ Action required'));
  assert.ok(orangeLines.some(l => l === colored[actionAt]));
  assert.ok(!colored.some(l => strip(l).includes('2 agents are NOT READY')), 'the runtime notice replaces the generic line');
  assert.ok(orangeLines.length >= 2, 'a long action wraps and every line stays orange');
  const fb = colored.find(l => strip(l).includes('⬆'))!;
  assert.ok(fb.includes(`${ESC}[38;2;125;207;255m⬆`) && !fb.includes(orange), 'cyan arrow, muted text');
  assert.ok(colored.every(l => displayWidth(l) <= 100));
  // without a blocked agent and without a notice there is no action line
  const calm = renderHome(model({ squad: SQUAD.map(m => ({ ...m, state: 'ready' as const })) }), caps()).map(strip).join('\n');
  assert.doesNotMatch(calm, /Action required/);
});

test('Compact: the context takes two lines beside the mark, no label block, short notes, one summary line', () => {
  setLanguage('en');
  const lines = renderHome(model(), caps({ columns: 76, rows: 18 })).map(strip);
  assert.ok(lines[0].startsWith(FULL_LOGO[0]) && lines[0].endsWith('v2026.11.1') && displayWidth(lines[0]) === 76, lines[0]);
  assert.equal(lines[2], '  ██████  ~/shop-api  main · clean');
  assert.equal(lines[3], '  ███     sandbox ✔ · 1 accepted risk');
  const text = lines.join('\n');
  assert.doesNotMatch(text, /Repository|Policy|── Squad/);
  assert.match(text, /^ {2}○ Architect +claude +NOT READY +not measured$/m);
  assert.match(text, /^ {2}◐ Reviewer +codex +READY +accepted risk$/m);
  assert.match(text, /^ {2}● Tester +bubblewrap +READY$/m);
  assert.match(text, /^ {2}1 of 3 agents ready — \/doctor for the details$/m);
  assert.ok(!text.includes('YOUR AI DEV SQUAD'), 'the context replaced the tagline');
});

test('Minimal: one brand line, one summary line, one line per agent, the hint; without colour and below 70 columns', () => {
  setLanguage('en');
  for (const c of [caps({ colorDepth: 0 }), caps({ columns: 56 })]) {
    const lines = renderHome(model(), c).map(strip);
    assert.equal(lines[0], '▙ taskquoin 2026.11.1 · shop-api (main)');
    assert.equal(lines[1], 'agents 1/3 ready · verify ready · 1 accepted risk');
    assert.deepEqual(lines.slice(2, 6), ['○ Architect NOT READY not measured', '○ Developer NOT READY not measured', '◐ Reviewer  READY     accepted risk', '● Tester    READY']);
    assert.equal(lines[6], '/doctor: details · /help: commands');
    assert.equal(lines.length, 7, 'brand + summary + 4 agents + hint, nothing else');
  }
  const ascii = renderHome(model(), caps({ colorDepth: 0, charset: 'ascii' }));
  assert.ok(ascii.includes('[x] Architect NOT READY not measured'), ascii.join('\n'));
  assert.ok(ascii.some(l => l.startsWith('[~] Reviewer')) && ascii.some(l => l.startsWith('[ok] Tester')));
});

test('no colour: no escape at all; with colour the text is the same once the colours are removed', () => {
  setLanguage('en');
  for (const columns of [60, 80, 120]) {
    const plain = renderHome(model(), caps({ colorDepth: 0, columns }));
    assert.ok(plain.every(l => !l.includes(ESC)), `${columns} columns`);
    const colored = renderHome(model(), caps({ columns }));
    if (columns >= 70) assert.ok(colored.some(l => l.includes(ESC)));
    if (columns >= 100) assert.notDeepEqual(colored.map(strip), plain, 'Full is a different screen from Minimal');
  }
  const c = renderHome(model(), caps({ columns: 120 })); const k = renderHome(model(), caps({ columns: 120, colorDepth: 8 }));
  assert.deepEqual(c.map(strip), k.map(strip));
  assert.ok(k.some(l => l.includes(`${ESC}[38;5;`)), '256-colour escapes');
});

test('a 200-character refusal becomes a short reason that ends on a whole word; a version mismatch is said by meaning', () => {
  setLanguage('en');
  const words = Array.from({ length: 30 }, (_, i) => `reason${i}`);
  const long = words.join(' ');
  assert.ok(long.length > 200);
  for (const columns of [60, 76, 100, 120]) {
    const lines = renderHome(model({ squad: [{ role: 'Architect', who: 'planner · claude', state: 'blocked', note: long }, SQUAD[3]] }), caps({ columns })).map(strip);
    const row = lines.find(l => l.includes('Architect'))!;
    assert.ok(displayWidth(row) <= columns, `${columns}: ${row}`);
    assert.match(row, /NOT READY/);
    const note = /(reason0.*)$/.exec(row)?.[1];
    assert.ok(note, `${columns} columns keep a reason: ${row}`);
    assert.ok(note.endsWith('…'), 'what was left out is marked');
    const last = note.slice(0, -1).split(' ').pop()!;
    assert.ok(words.includes(last), `"${last}" is a whole word`);
  }
  // a text cut mid-word by an earlier stage loses its partial word
  assert.equal(wordCut('alpha beta gam…', 40), 'alpha beta…');
  assert.equal(wordCut('alpha beta gamma', 12), 'alpha beta…');
  assert.equal(wordCut('alpha', 40), 'alpha');
  assert.equal(wordCut('supercalifragilistic', 8), 'superca…', 'a single word longer than the room is the only case cut by characters');
  const long2 = 'capability matrix measured for claude 2.1.327, installed 2.1.330 and a great many other words that explain it all in detail';
  const mism = renderHome(model({ squad: [{ role: 'Architect', who: 'planner · claude', state: 'blocked', note: long2 }, SQUAD[3]] }), caps()).map(strip).join('\n');
  assert.match(mism, /NOT READY +not measured \(certified 2\.1\.327\)$/m);
});

test('the READY count is the gate\'s: it equals the agents projectSquad finds ok, in the header and in Minimal', () => {
  setLanguage('en');
  const ok = { ok: true, runtimeFound: true, failures: [], acceptedRisks: [] };
  const verdicts: Record<string, Parameters<typeof projectSquad>[1] extends (id: string) => infer R ? R : never> = {
    planner: ok, implementer: { ...ok, ok: false, failures: [{ message: 'x' }] }, challenger: { ...ok, acceptedRisks: [{ capability: 'fs.read' }] }, security: { ...ok, skillErrors: ['bad skill'] },
  };
  const agents = { planner: { runtime: 'claude' }, implementer: { runtime: 'claude' }, challenger: { runtime: 'codex' }, security: { runtime: 'claude' } };
  const squad = projectSquad(agents, (id) => verdicts[id], true);
  const okCount = squad.slice(0, -1).filter(m => m.state !== 'blocked').length;
  assert.equal(okCount, 2);
  assert.match(renderHome(model({ squad }), caps()).map(strip).join('\n'), new RegExp(`${okCount} of 4 agents ready`));
  assert.equal(strip(renderHome(model({ squad }), caps({ colorDepth: 0 }))[1]).split(' · ')[0], `agents ${okCount}/4 ready`);
  const none = renderHome(model({ squad: squad.map(m => ({ ...m, state: 'blocked' as const })) }), caps({ colorDepth: 0 }));
  assert.equal(none[1].split(' · ')[0], 'agents 0/4 ready', 'no READY invented: the tester is not an agent');
  const one = renderHome(model({ squad: [squad[0], squad.at(-1)!] }), caps()).map(strip).join('\n');
  assert.match(one, /1 of 1 agent ready/);
});

test('hostile text from outside is made inert: repo, branch, notices, notes and names never carry a raw control or bidi character', () => {
  const evil = `x${ESC}]52;c;ZXZpbA==${String.fromCharCode(7)}${String.fromCharCode(0x202e)}y`;
  const m = model({ repo: evil, branch: evil, policy: { digest: evil, acceptedRisks: [{ capability: evil, expires: evil }] },
    squad: [{ role: evil, who: evil, state: 'blocked', note: evil }, { role: 'Tester', who: 'verify · bubblewrap', state: 'ready' }],
    notices: [{ kind: 'action', text: `◆ Action required  ${evil}` }, { kind: 'fallback', text: `⬆ ${evil}` }] });
  for (const c of [caps(), caps({ columns: 76 }), caps({ columns: 56, colorDepth: 0 })]) {
    const text = renderHome(m, c).join('\n').replace(/\x1b\[[0-9;]*m/g, '');
    assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202A-\u202E]/.test(text.replace(/\n/g, '')), JSON.stringify(text));
    assert.ok(text.includes('‹ESC›') || text.includes('‹ESC'), 'the marker is visible');
  }
});

test('every line fits 40..200 columns in en, fr, ja and ar, with and without colour', () => {
  const wide = 'これは非常に長い拒否の理由であり、端末の幅を超えてはならない説明文です'.repeat(3);
  const arabic = 'سبب الرفض طويل جدا ولا يجب أن يتجاوز عرض الطرفية أبدا'.repeat(3);
  const m = model({ repo: '~/' + 'a'.repeat(120), branch: 'b'.repeat(80), notices: [{ kind: 'action', text: '◆ Action required  ' + wide }, { kind: 'fallback', text: '⬆ ' + arabic }],
    squad: [{ role: 'Architect', who: 'planner · claude', state: 'blocked', note: wide }, { role: 'Reviewer', who: 'challenger · codex', state: 'risk', note: arabic },
      { role: 'Developer', who: 'implementer · ' + 'q'.repeat(90), state: 'blocked', note: 'n'.repeat(300) }, SQUAD[3]] });
  for (const lang of ['en', 'fr', 'ja', 'ar']) {
    setLanguage(lang);
    try {
      for (const columns of [40, 60, 69, 70, 80, 99, 100, 120, 200]) {
        for (const colorDepth of [0, 24] as const) {
          for (const rows of [12, 20, 30]) {
            for (const l of renderHome(m, caps({ columns, colorDepth, rows }))) assert.ok(displayWidth(l) <= columns, `${lang} ${columns} ${colorDepth} ${rows}: ${displayWidth(l)} ${strip(l)}`);
          }
        }
      }
    } finally { setLanguage('en'); }
  }
});

test('every state keeps its word and its glyph at every width: READY / NOT READY survive even a hostile who and role', () => {
  setLanguage('en');
  const m = model({ squad: [{ role: 'R'.repeat(60), who: 'w'.repeat(200), state: 'blocked', note: 'because' }, { role: 'S'.repeat(60), who: 'v'.repeat(200), state: 'risk', note: 'because' }] });
  for (const columns of [40, 60, 80, 100, 200]) for (const colorDepth of [0, 24] as const) {
    const text = renderHome(m, caps({ columns, colorDepth })).map(strip);
    assert.ok(text.some(l => /○ .*NOT READY/.test(l)), `${columns}: NOT READY kept`);
    assert.ok(text.some(l => /◐ .*READY/.test(l)), `${columns}: READY kept`);
  }
});

test('the French screen speaks French except the brand: labels, summary and notes translated, READY and NOT READY unchanged', () => {
  setLanguage('fr');
  try {
    const text = renderHome(model(), caps()).map(strip).join('\n');
    assert.match(text, /Dépôt +~\/shop-api +main · arbre propre/);
    assert.match(text, /agents prêts : 1 sur 3 · Verify prêt/);
    assert.match(text, /NOT READY +non mesuré \(certifié 2\.1\.327\)/);
    assert.match(text, /READY +risque accepté : connector\.write/);
    assert.match(text, /YOUR AI DEV SQUAD/);
  } finally { setLanguage('en'); }
});
