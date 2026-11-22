/**
 * PROVES (pure, no terminal): the `taskquoin console` loop parses `/` commands only (plain text never starts anything),
 * keeps a current run, and approves ONLY after the human retypes the pending hash (12 chars) — wrong or empty input
 * approves nothing; the approver's name is asked once per session and recorded "via taskquoin console". A typed
 * unknown run id or command name is echoed as visible markers, never raw.
 * Under a wide-character (zh-CN) catalog, the `/` menu and the banner keep their second column at one display column.
 * `withTerminalReleased` (fakes) pauses readline, turns raw mode off and leaves SIGINT to the installer, restoring all.
 * DOES NOT PROVE: the readline wiring and the real CLI commands — features/console.feature does (the pseudo-terminal
 * behaviour of Ctrl+C during /upgrade install was checked by hand, see the final fix report).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lineReader, runConsole, type ConsoleCommands } from '../src/console.ts';
import { setLanguage, t } from '../src/i18n/index.ts';
import { displayWidth } from '../src/i18n/width.ts';
import type { Caps } from '../src/tui/caps.ts';
import type { HomeModel } from '../src/tui/components/home.ts';
import type { SquadMember } from '../src/console.ts';
import type { RunView } from '@taskquoin/application';
import type { Neutral } from '../src/tui/neutral.ts';

/** Runs `fn` with the console in `code`, back to English afterwards (module state). */
async function inLang<T>(code: string, fn: () => Promise<T> | T): Promise<T> {
  setLanguage(code);
  try { return await fn(); } finally { setLanguage('en'); }
}

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9001122334';
const IDS = ['planning', 'critique', 'plan-approval', 'implementation', 'verify', 'red-proof', 'review', 'commit-approval', 'commit'] as const;
/** A run at its plan gate, as the approval screen is given it. */
const VIEW = (over: Partial<RunView<Neutral>> = {}): RunView<Neutral> => ({ runId: 'run-20261115T110000-bbbbbb' as Neutral, status: 'waiting-approval', current: 'approve-plan', attempts: 0, startedAt: '' as Neutral,
  steps: IDS.map((id): RunView<Neutral>['steps'][number] => id === 'planning' ? { id, state: 'done', attempts: [], artifacts: ['plan' as Neutral] }
    : id === 'critique' ? { id, state: 'done', attempts: [], artifacts: ['challenge' as Neutral], outcome: 'challenged:APPROVE' as Neutral } : { id, state: 'pending', attempts: [], artifacts: [] }), ...over });
function session(lines: string[], over: Partial<ConsoleCommands> = {}) {
  const input = [...lines]; const out: string[] = []; const calls: string[] = [];
  let runs = ['run-20261115T100000-aaaaaa'];
  const cmds: ConsoleCommands = {
    run: async (r) => { calls.push(`run:${r}`); runs = [...runs, 'run-20261115T110000-bbbbbb']; return { code: 0, runId: 'run-20261115T110000-bbbbbb' }; },
    status: async (r) => { calls.push(`status:${r ?? ''}`); return 0; },
    show: async (r, a) => { calls.push(`show:${r}:${a ?? ''}`); return 0; },
    approve: async (r, g, e, as) => { calls.push(`approve:${r}:${g}:${e}:${as}`); return 0; },
    resume: async (r) => { calls.push(`resume:${r}`); return 0; },
    dashboard: async (r) => { calls.push(`dashboard:${r ?? ''}`); return 1; },
    doctor: async () => { calls.push('doctor'); return 0; },
    skills: async () => { calls.push('skills'); return 0; },
    agents: async () => { calls.push('agents'); return 0; },
    upgrade: async (a) => { calls.push(`upgrade:${a}`); return 0; },
    pending: (r) => (r === 'run-20261115T110000-bbbbbb' ? { gate: 'plan', binding: HASH } : undefined),
    runs: () => runs,
    approval: () => ({ run: VIEW(), acceptedRisks: [] }),
    ...over,
  };
  const io = { ask: async (q: string) => { out.push(q); return input.shift(); }, out: (s = '') => { out.push(s); }, err: (s: string) => { out.push(s); } };
  return { done: runConsole(io, cmds), out, calls };
}

test('only `/` commands act: plain text is a hint, unknown commands are refused, /quit and end of input stop', async () => {
  await inLang('fr', async () => {
    const s = session(['ajoute une fonction sum', '/nope', '/help', '/quit', '/run never']);
    assert.equal(await s.done, 1, 'an unknown command fails the session (scripts see it)');
    assert.deepEqual(s.calls, [], 'nothing ran');
    assert.ok(s.out.some(l => /tapez \/run <demande>/.test(l)), 'plain text explains how to start a run');
    assert.ok(s.out.some(l => /commande inconnue : \/nope/.test(l)));
    assert.ok(s.out.some(l => /\/approve <plan\|commit>/.test(l)), '/help lists the commands');
    assert.equal(await session([]).done, 0, 'end of input ends the session');
  });
});

test('/run starts a run and makes it current; /show and /status use the current run; /use selects one', async () => {
  await inLang('fr', async () => {
    const s = session(['/run Ajouter sum', '/show plan', '/show', '/status', '/runs', '/use run-20261115T100000-aaaaaa', '/show diff-1', '/resume', '/quit']);
    await s.done;
    assert.deepEqual(s.calls, ['run:Ajouter sum', 'show:run-20261115T110000-bbbbbb:plan', 'show:run-20261115T110000-bbbbbb:', 'status:run-20261115T110000-bbbbbb', 'status:',
      'show:run-20261115T100000-aaaaaa:diff-1', 'resume:run-20261115T100000-aaaaaa']);
    const t = session(['/use run-unknown', '/quit']); await t.done;
    assert.ok(t.out.some(l => /run inconnu : run-unknown/.test(l)));
  });
});

test('/approve shows the pending hash and what to read, and approves ONLY when the human retypes it', async () => {
  await inLang('fr', async () => {
    const ok = session(['/run x', '/approve plan', 'alice', HASH.slice(0, 12), '/quit']);
    await ok.done;
    assert.ok(ok.out.some(l => l.includes(HASH.slice(0, 12)) && /plan/.test(l)), 'the hash to retype is shown');
    assert.ok(ok.out.some(l => /\/show plan/.test(l)), 'says what to read first');
    assert.deepEqual(ok.calls.filter(c => c.startsWith('approve')), [`approve:run-20261115T110000-bbbbbb:plan:${HASH.slice(0, 12)}:alice (via taskquoin console)`]);

    const wrong = session(['/run x', '/approve plan', 'alice', 'deadbeef0000', '/quit']); assert.equal(await wrong.done, 1, 'a refused approval fails the session');
    assert.deepEqual(wrong.calls.filter(c => c.startsWith('approve')), [], 'wrong hash: nothing approved');
    assert.ok(wrong.out.some(l => /ne correspond pas/.test(l)));
    const empty = session(['/run x', '/approve plan', 'alice', '', '/quit']); await empty.done;
    assert.deepEqual(empty.calls.filter(c => c.startsWith('approve')), [], 'empty: cancelled');
    const gate = session(['/run x', '/approve commit', '/quit']); await gate.done;
    assert.ok(gate.out.some(l => /n'attend pas l'approbation commit/.test(l)), 'wrong gate refused before asking');
    const none = session(['/approve plan', '/quit']); await none.done;
    assert.ok(none.out.some(l => /aucun run sélectionné/.test(l)));
  });
});

test('the approver name is asked once per session and must not be empty', async () => {
  const s = session(['/run x', '/approve plan', '', 'bob', HASH.slice(0, 12), '/approve plan', HASH.slice(0, 12), '/quit']);
  await s.done;
  assert.deepEqual(s.calls.filter(c => c.startsWith('approve')).map(c => c.split(':').at(-1)), ['bob (via taskquoin console)', 'bob (via taskquoin console)']);
});

test('Codex console review: a command typed at the name prompt cancels — it never becomes the approver (HIGH 1)', async () => {
  await inLang('fr', async () => {
    const s = session(['/run x', '/approve plan', '/quit', '/approve plan', '/show plan', '/quit']);
    assert.equal(await s.done, 1);
    assert.deepEqual(s.calls.filter(c => c.startsWith('approve')), []);
    assert.ok(s.out.some(l => /annulé/.test(l)));
  });
});

test('Codex console review: the current run is the one THIS /run created; a failed /run clears it (HIGH 2)', async () => {
  await inLang('fr', async () => {
    const s = session(['/use run-20261115T100000-aaaaaa', '/run y', '/approve plan', '/quit'], { run: async () => ({ code: 1 }) });
    assert.equal(await s.done, 1, 'failed command → failing session');
    assert.ok(s.out.some(l => /aucun run sélectionné/.test(l)), 'no silent fallback to the previously selected run');
    assert.deepEqual(s.calls.filter(c => c.startsWith('approve')), []);
  });
});

test('Codex console review: exit code 1 when any command failed, 0 otherwise (MEDIUM 4)', async () => {
  assert.equal(await session(['/status', '/quit']).done, 1, 'no current run');
  assert.equal(await session(['/runs', '/quit']).done, 0);
  assert.equal(await session(['/runs', '/quit'], { status: async () => 2 }).done, 1);
});

test('lineReader: in a terminal, lines typed BEFORE a prompt are discarded (type-ahead never answers an approval); piped input is kept (HIGH 3)', async () => {
  await inLang('fr', async () => {
    const src = new EventEmitter(); const shown: string[] = [];
    const tty = lineReader(src, (s) => shown.push(s), { discardTypeAhead: true });
    src.emit('line', '/approve plan'); src.emit('line', 'a1b2c3d4e5f6');
    const p = tty.ask('hash ? ');
    assert.ok(shown.some(l => /2 ligne\(s\) tapée\(s\) avant l'invite/.test(l)), 'the human is told');
    src.emit('line', 'typed-after'); assert.equal(await p, 'typed-after');
    const piped = new EventEmitter(); const pr = lineReader(piped, () => {}, { discardTypeAhead: false });
    piped.emit('line', 'one'); piped.emit('line', 'two');
    assert.equal(await pr.ask('> '), 'one'); assert.equal(await pr.ask('> '), 'two');
    const end = pr.ask('> '); piped.emit('close'); assert.equal(await end, undefined);
    assert.equal(await pr.ask('> '), undefined, 'after close');
  });
});

const CAPS: Caps = { interactive: true, cursor: true, colorDepth: 24, charset: 'utf8', theme: 'dark', motion: true, plain: false, columns: 100, rows: 30 };
const homeOf = (squad: SquadMember[], over: Partial<HomeModel> = {}): HomeModel => ({ version: '2026.11.1', repo: '~/shop-api', branch: 'main', clean: true,
  sandbox: { bubblewrap: true, socat: true, verify: true }, policy: { digest: '5c7269946c4b', acceptedRisks: [] }, squad, notices: [], ...over });

test('banner: the V2 home — the quoin mark, no TASK art and no slogan, the squad with its REAL status; colours only when asked', async () => {
  await inLang('fr', async () => {
    const { renderBanner } = await import('../src/console.ts');
    const squad = [
      { role: 'Architect', who: 'planner · claude', state: 'ready' as const },
      { role: 'Developer', who: 'implementer · claude', state: 'ready' as const },
      { role: 'Reviewer', who: 'challenger · codex', state: 'risk' as const, note: 'connector.write' },
      { role: 'Tester', who: 'verify · bubblewrap', state: 'blocked' as const, note: 'bubblewrap absent' },
    ];
    const plain = renderBanner(homeOf(squad), { ...CAPS, colorDepth: 0 });
    assert.match(plain, /▙ taskquoin 2026\.11\.1 · shop-api \(main\)/);
    assert.doesNotMatch(plain, /████████╗|Q U O I N|Let's build something awesome/);
    assert.match(plain, /^● Architect\s+READY$/m);
    assert.match(plain, /^◐ Reviewer\s+READY\s+risque accepté$/m);
    assert.match(plain, /^○ Tester\s+NOT READY\s+bubblewrap absent$/m);
    assert.doesNotMatch(plain, /\x1b\[/, 'no escape codes without colour');
    const colored = renderBanner(homeOf(squad), CAPS);
    assert.match(colored, /\x1b\[38;2;/, 'truecolor escapes');
    assert.match(colored, /▀█▀/, 'the wordmark');
    assert.match(colored.replace(/\x1b\[[0-9;]*m/g, ''), /Escouade/);
  });
});

test('the prompt shows the current run; tab completion proposes the commands', async () => {
  const { completeCommand } = await import('../src/console.ts');
  assert.deepEqual(completeCommand('/ap'), [['/approve '], '/ap']);
  assert.deepEqual(completeCommand('/s')[0].sort(), ['/show ', '/skills ', '/status '].sort());
  assert.deepEqual(completeCommand('/up'), [['/upgrade '], '/up']);
  assert.equal(completeCommand('bonjour')[0].length, 0);
  const asked: string[] = [];
  const io = { ask: async (q: string) => { asked.push(q); return asked.length === 1 ? '/run x' : undefined; }, out: () => {}, err: () => {} };
  await runConsole(io, { run: async () => ({ code: 0, runId: 'run-20261115T110000-bbbbbb' }), runs: () => [], pending: () => undefined } as unknown as ConsoleCommands);
  assert.equal(asked[0], 'taskquoin › '); assert.equal(asked[1], 'taskquoin [bbbbbb] › ', 'current run (short id) in the prompt');
});

test('slash menu: typing "/" lists every command with its description; it narrows as you type; nothing for free text', async () => {
  await inLang('fr', async () => {
    const { slashMenu, CONSOLE_COMMANDS } = await import('../src/console.ts');
    const all = slashMenu('/');
    assert.equal(all.filter(l => l.startsWith('  /')).length, CONSOLE_COMMANDS.length);
    assert.deepEqual(all.filter(l => !l.startsWith(' ')), ['Lancer', 'Revue', 'Diagnostic', 'Console'], 'grouped under the four translated titles');
    assert.ok(all.indexOf('Revue') < all.findIndex(l => /^\s+\/approve/.test(l)) && all.findIndex(l => /^\s+\/approve/.test(l)) < all.indexOf('Diagnostic'));
    assert.ok(all.some(l => /^\s+\/approve <plan\|commit>\s+approuver/.test(l)), all.join('\n'));
    assert.deepEqual(slashMenu('/ap').filter(l => l.startsWith(' ')).map(l => l.trim().split(/\s/)[0]), ['/approve']);
    assert.deepEqual(slashMenu('/s').filter(l => l.startsWith(' ')).map(l => l.trim().split(/\s/)[0]).sort(), ['/show', '/skills', '/status']);
    assert.deepEqual(slashMenu('/approve plan'), [], 'gone once the command has arguments');
    assert.deepEqual(slashMenu('bonjour'), []); assert.deepEqual(slashMenu('/zz'), []);
  });
});

test('slash menu drawing: drawn under the input, cursor put back where it was; an empty menu only clears', async () => {
  const { drawSlashMenu } = await import('../src/console.ts');
  const d = drawSlashMenu({ promptWidth: 12, line: '/ap', cursor: 3, items: ['/approve <plan|commit>  approuver'], caps: { ...CAPS, colorDepth: 0 } });
  assert.equal(d, '\x1b[16G\x1b[J\n/approve <plan|commit>  approuver\x1b[1A\x1b[16G');
  assert.equal(drawSlashMenu({ promptWidth: 12, line: 'x', cursor: 0, items: [], caps: { ...CAPS, colorDepth: 0 } }), '\x1b[14G\x1b[J\x1b[13G');
});

test('logo animation: the quoin rows are revealed left to right in under 0.9 s; the last frame IS the static logo; every frame keeps its colours closed', async () => {
  const { logoFrames, animateLogo } = await import('../src/console.ts');
  const { renderLogo } = await import('../src/tui/components/logo.ts');
  const strip = (x: string) => x.replace(/\x1b\[[0-9;]*m/g, '');
  const rows = renderLogo(CAPS, '2026.11.1');
  const frames = logoFrames(rows);
  assert.ok(frames.length >= 12 && frames.length <= 30, `${frames.length} frames (short animation)`);
  assert.equal(frames.at(-1), rows.join('\n'), 'ends exactly on the static logo, escapes included');
  for (const f of frames) {
    assert.equal(f.split('\n').length, rows.length, 'constant height: frames overwrite each other');
    f.split('\n').forEach((l, i) => assert.equal(displayWidth(l), displayWidth(rows[i]), 'constant width per row'));
    assert.equal((f.match(/\x1b\[38;2/g) ?? []).length, (f.match(/\x1b\[39m/g) ?? []).length, 'every colour opened is closed');
  }
  assert.ok(!strip(frames[0]).includes('██████  ▀█▀'), 'starts mostly hidden');
  const shown = (f: string) => [...strip(f)].filter(ch => ch !== ' ' && ch !== '\n').length;
  for (let i = 1; i < frames.length; i++) assert.ok(shown(frames[i]) >= shown(frames[i - 1]), 'only ever reveals');
  assert.ok(!strip(frames[Math.floor(frames.length / 2)]).includes('v2026.11.1'), 'the version comes last (right-aligned)');
  const writes: string[] = []; let slept = 0;
  await animateLogo((x) => writes.push(x), async (ms) => { slept += ms; }, rows);
  const all = writes.join('');
  assert.ok(all.startsWith('\x1b[?25l') && all.endsWith('\x1b[?25h'), 'cursor hidden during, shown after');
  assert.ok(all.includes(`\x1b[${rows.length - 1}A`), 'redrawn in place');
  assert.ok(slept > 0 && slept <= 900, `${slept} ms in total`);
});

test('squad: api judges get their real line — role from the id, provider shown, NOT READY with the short reason', async () => {
  await inLang('fr', async () => {
    const { squadOf, renderBanner } = await import('../src/console.ts');
    const agents = { planner: { runtime: 'claude' }, implementer: { runtime: 'claude' }, challenger: { runtime: 'codex' }, security: { runtime: 'api', provider: 'deepseek' } };
    const gateOf = (id: string) => (id === 'security'
      ? { ok: false, runtimeFound: true, acceptedRisks: [], failures: [{ message: 'DEEPSEEK_API_KEY absente — définissez-la dans votre environnement' }] }
      : { ok: true, runtimeFound: true, acceptedRisks: id === 'challenger' ? [{ capability: 'connector.write' }] : [], failures: [] });
    const text = renderBanner(homeOf(squadOf(agents, gateOf, true)), CAPS).replace(/\x1b\[[0-9;]*m/g, '');
    assert.match(text, /^  ○ Security\s+security · api:deepseek\s+NOT READY\s+DEEPSEEK_API_KEY absente$/m);
    assert.match(text, /^  ◐ Reviewer\s+challenger · codex\s+READY\s+risque accepté : connector\.write$/m);
    assert.match(text, /● Tester\s+verify · bubblewrap\s+READY/);
  });
});

test('squad: an OpenCode agent shows its provider (opencode:openai)', async () => {
  const { squadOf } = await import('../src/console.ts');
  const ok = () => ({ ok: true, runtimeFound: true, failures: [], acceptedRisks: [] });
  const s = squadOf({ implementer: { runtime: 'opencode', model: 'openai/gpt-6-astra' } }, ok, true);
  assert.equal(s[0].who, 'implementer · opencode:openai');
});

test('the console speaks the selected language: English by default, French on request', async () => {
  const text = async (code: string) => inLang(code, async () => { const s = session(['/help', 'build me a sum', '/quit']); await s.done; return s.out.join('\n'); });
  const en = await text('en');
  assert.match(en, /Commands/); assert.match(en, /Nothing starts without a command/);
  const fr = await text('fr');
  assert.match(fr, /Commandes/); assert.match(fr, /Rien n'est lancé sans commande/);
  const { consoleHelp, commandDocs } = await import('../src/console.ts');
  assert.equal(commandDocs().length, 14);
  assert.notEqual(await inLang('en', () => consoleHelp()), await inLang('fr', () => consoleHelp()), 'help is computed at call time, not at module load');
});

test('CJK: the / menu description column and the banner second column start at one display column per line', async () => {
  const { slashMenu, renderBanner, squadOf } = await import('../src/console.ts');
  const wide: Record<string, string> = {
    'console.doc.run': '启动受管运行', 'console.doc.runs': '列出所有运行', 'console.doc.use': '选择当前运行', 'console.doc.status': '当前运行的历史',
    'console.doc.show': '显示产物', 'console.doc.approve': '批准流程', 'console.doc.dashboard': '实时只读看板', 'console.doc.resume': '恢复运行', 'console.doc.agents': '代理及其权限',
    'console.doc.doctor': '机器状态', 'console.doc.skills': '已安装技能', 'console.doc.upgrade': '升级工具版本', 'console.doc.upgrade.args': '[auto|path|install]', 'console.doc.help': '帮助', 'console.doc.quit': '退出控制台',
    'console.role.planner': '架构师', 'console.role.implementer': '开发者', 'console.role.challenger': '审阅者', 'console.role.security': '安全',
    'console.role.tester': '测试员',
  };
  setLanguage('zh-CN', () => JSON.stringify(wide));
  try {
    const menu = slashMenu('/').filter(l => l.startsWith('  /'));
    assert.ok(menu.length >= 10);
    const cut = (line: string, tail: string) => displayWidth(line.slice(0, line.lastIndexOf(tail)));
    const descs = Object.entries(wide).filter(([k]) => k.startsWith('console.doc.')).map(([, v]) => v);
    const menuCols = menu.map((l) => cut(l, descs.find((d) => l.endsWith(d))!));
    assert.equal(new Set(menuCols).size, 1, `menu columns ${menuCols}`);
    const agents = { planner: { runtime: 'claude' }, implementer: { runtime: 'claude' }, challenger: { runtime: 'codex' }, security: { runtime: 'api', provider: 'x' } };
    const squad = squadOf(agents, () => ({ ok: true, runtimeFound: true, failures: [], acceptedRisks: [] }), true);
    assert.equal(squad.at(-1)!.role, '测试员');
    const banner = renderBanner(homeOf(squad), CAPS).replace(/\x1b\[[0-9;]*m/g, '').split('\n');
    const cols = squad.map((m) => cut(banner.find((l) => l.includes(m.who))!, m.who));
    assert.equal(new Set(cols).size, 1, `banner columns ${cols}`);
    assert.ok(cols[0] > 8, 'roles are wide, so the column moved');
    assert.equal(t('console.role.tester'), '测试员');
  } finally { setLanguage('en'); }
});

test('/upgrade passes its argument to the command and is listed in /help', async () => {
  const s = session(['/upgrade path', '/upgrade', '/help', '/quit']); await s.done;
  assert.deepEqual(s.calls, ['upgrade:path', 'upgrade:']);
  assert.ok(s.out.some(l => /\/upgrade \[auto\|path\|install\]/.test(l)), '/help lists /upgrade');
});

test('an installer started from the console gets the terminal: readline paused, raw mode off, SIGINT left to it; all restored, even on failure', async () => {
  const { withTerminalReleased } = await import('../src/console.ts');
  const fakes = (tty: boolean, raw: boolean) => {
    const calls: string[] = [];
    const rl = { pause: () => { calls.push('pause'); }, resume: () => { calls.push('resume'); } };
    const stdin = { isTTY: tty, isRaw: raw, setRawMode: (m: boolean) => { calls.push(`raw:${m}`); stdin.isRaw = m; } };
    const signals = { on: (ev: string) => { calls.push(`on:${ev}`); }, off: (ev: string) => { calls.push(`off:${ev}`); } };
    return { calls, rl, stdin, signals };
  };
  let f = fakes(true, true);
  assert.equal(await withTerminalReleased(f, async () => { f.calls.push(`run(raw=${f.stdin.isRaw})`); return 7; }), 7);
  assert.deepEqual(f.calls, ['pause', 'raw:false', 'on:SIGINT', 'run(raw=false)', 'off:SIGINT', 'raw:true', 'resume']);
  f = fakes(true, true);
  await assert.rejects(withTerminalReleased(f, async () => { throw new Error('spawn failed'); }), /spawn failed/);
  assert.deepEqual(f.calls, ['pause', 'raw:false', 'on:SIGINT', 'off:SIGINT', 'raw:true', 'resume']);
  f = fakes(false, false); // piped input (scripts, tests): no raw mode to touch
  await withTerminalReleased(f, async () => 0);
  assert.deepEqual(f.calls, ['pause', 'on:SIGINT', 'off:SIGINT', 'resume']);
});

test('the / menu fits 40, 60, 80 and 200 columns (display width) in en, fr, ja, ar and a wide zh-CN text', async () => {
  const { slashMenu } = await import('../src/console.ts');
  for (const code of ['en', 'fr', 'ja', 'ar']) await inLang(code, () => {
    for (const cols of [40, 60, 80, 200]) for (const l of slashMenu('/', cols)) assert.ok(displayWidth(l) <= cols, `${code} ${cols}: "${l}"`);
  });
  setLanguage('zh-CN', () => JSON.stringify({ 'console.doc.upgrade': '升级工具版本和选择正在使用的版本以及重新安装' }));
  try { for (const l of slashMenu('/', 40)) assert.ok(displayWidth(l) <= 40, l); } finally { setLanguage('en'); }
});

test('contextual completion: /use <run>, /show <artifact>, /approve only the pending gate, /help <command>', async () => {
  const { completeCommand } = await import('../src/console.ts');
  const ctx = { runs: ['run-20261115T100000-aaaaaa', 'run-20261115T110000-bbbbbb'], artifacts: ['diff-1', 'plan', 'verify-1'], pendingGate: 'plan' as const };
  assert.deepEqual(completeCommand('/use run-20261115T11', ctx), [['run-20261115T110000-bbbbbb'], 'run-20261115T11']);
  assert.deepEqual(completeCommand('/use r', ctx)[0], ctx.runs);
  assert.deepEqual(completeCommand('/show d', ctx), [['diff-1'], 'd']);
  assert.deepEqual(completeCommand('/approve ', ctx), [['plan'], '']);
  assert.deepEqual(completeCommand('/approve c', ctx)[0], [], 'commit is not pending');
  assert.deepEqual(completeCommand('/approve ', { runs: [], artifacts: [] })[0], [], 'nothing pending: nothing proposed');
  assert.deepEqual(completeCommand('/help ap', ctx), [['approve'], 'ap']);
  assert.deepEqual(completeCommand('/run x', ctx)[0], []);
});

test('an unknown command suggests the closest one; /help <command> explains one', async () => {
  const { suggestCommand } = await import('../src/console.ts');
  assert.equal(suggestCommand('aprove'), '/approve'); assert.equal(suggestCommand('/stauts'), '/status');
  assert.equal(suggestCommand('zzzzzz'), undefined);
  const s = session(['/aprove', '/zzzzzz', '/help approve', '/help /use', '/help nope', '/quit']);
  assert.equal(await s.done, 1);
  assert.ok(s.out.includes('unknown command /aprove — did you mean /approve?'), s.out.join('\n'));
  assert.ok(s.out.includes('unknown command: /zzzzzz — /help for the list'));
  assert.ok(s.out.includes('/approve <plan|commit>') && s.out.includes('  approve: shows the pending hash, you retype it'));
  assert.ok(s.out.includes('/use <run>'));
  assert.deepEqual(s.calls, []);
  const e = session(['/aprove\x1b', '/quit']); await e.done;
  assert.ok(!e.out.some(l => l.includes('\x1b')), 'the typed name is neutralised');
  assert.ok(e.out.some(l => l.includes('did you mean /approve?')), 'the suggestion is still offered: ' + e.out.join('|'));
});

test('drawSlashMenu paints through the caps: no colour code when the caps have none', async () => {
  const { drawSlashMenu, slashMenu } = await import('../src/console.ts');
  const plain = drawSlashMenu({ promptWidth: 12, line: '/', cursor: 1, items: slashMenu('/', 40), caps: { ...CAPS, colorDepth: 0 } });
  assert.ok(!/\x1b\[[0-9;]*m/.test(plain), 'no SGR');
  assert.ok(drawSlashMenu({ promptWidth: 12, line: '/', cursor: 1, items: ['x'], caps: CAPS }).includes('\x1b[38;2;154;165;206mx\x1b[39m'), 'muted, from the tokens');
  assert.ok(drawSlashMenu({ promptWidth: 12, line: '/', cursor: 1, items: ['x'], caps: { ...CAPS, colorDepth: 8 } }).includes('\x1b[38;5;110mx'), '256 colours: never truecolor');
});

test('TERM=dumb, a pipe, NO_COLOR: what the console draws besides its lines is decided by detectCaps (AC-2)', async () => {
  const { consoleSurface, drawSlashMenu, slashMenu } = await import('../src/console.ts');
  const { detectCaps } = await import('../src/tui/caps.ts');
  const tty = { isTTY: true, columns: 60, rows: 24, getColorDepth: () => 24 };
  const ESC = /\x1b/;
  const dumb = consoleSurface(detectCaps({ stdinTTY: true, stdout: tty, env: { TERM: 'dumb', LANG: 'ja_JP.UTF-8' } }), true);
  assert.equal(dumb.menu, false, 'TERM=dumb: no live / menu, it moves the cursor');
  assert.doesNotMatch(dumb.error('unknown command: /nope'), ESC, 'TERM=dumb: an error line is plain');
  const piped = consoleSurface(detectCaps({ stdinTTY: false, stdout: { isTTY: false }, env: {} }), false);
  assert.equal(piped.menu, false); assert.doesNotMatch(piped.error('x'), ESC);
  assert.equal(consoleSurface(detectCaps({ stdinTTY: true, stdout: { isTTY: false }, env: {} }), true).menu, false, 'stdout piped: no menu written into the pipe');
  const noColorCaps = detectCaps({ stdinTTY: true, stdout: tty, env: { NO_COLOR: '1' } });
  const noColor = consoleSurface(noColorCaps, true);
  assert.equal(noColor.menu, true, 'NO_COLOR removes colour only: the menu still shows');
  assert.doesNotMatch(noColor.error('x'), ESC);
  assert.doesNotMatch(drawSlashMenu({ promptWidth: 12, line: '/', cursor: 1, items: slashMenu('/', 60), caps: noColorCaps }), /\x1b\[[0-9;]*m/);
  assert.equal(consoleSurface(detectCaps({ stdinTTY: true, stdout: tty, env: { TASKQUOIN_PLAIN: '1' } }), true).menu, false, 'plain mode: no redraws');
  const full = detectCaps({ stdinTTY: true, stdout: tty, env: {} });
  assert.equal(consoleSurface(full, true).error('x'), '\x1b[38;2;247;118;142mx\x1b[39m', 'red from the tokens');
  assert.equal(consoleSurface(full, false).error('x'), 'x', 'stderr redirected to a file: no colour in it');
});

test('TERM=dumb: a whole session — the home, the error lines, the approval screen — holds no escape at all', async () => {
  const { detectCaps } = await import('../src/tui/caps.ts');
  const { consoleSurface } = await import('../src/console.ts');
  const { renderHome } = await import('../src/tui/components/home.ts');
  for (const lang of ['en', 'ja']) await inLang(lang, async () => {
    const caps = detectCaps({ stdinTTY: true, stdout: { isTTY: true, columns: 60, rows: 24, getColorDepth: () => 24 }, env: { TERM: 'dumb', LANG: 'ja_JP.UTF-8' } });
    const surface = consoleSurface(caps, true);
    const squad = [{ role: 'Architect', who: 'planner · claude', state: 'ready' as const }, { role: 'Tester', who: 'verify · bubblewrap', state: 'blocked' as const, note: 'bubblewrap absent' }];
    const input = ['/nope', '/run x', '/approve plan', 'alice', HASH.slice(0, 12), '/quit']; const all: string[] = [];
    const io = { ask: async (q: string) => { all.push(q); return input.shift(); }, out: (s = '') => { all.push(s); }, err: (s: string) => { all.push(surface.error(s)); } };
    const cmds = { run: async () => ({ code: 0, runId: 'run-20261115T110000-bbbbbb' }), runs: () => ['run-20261115T110000-bbbbbb'], approve: async () => 0,
      pending: () => ({ gate: 'plan', binding: HASH }), approval: () => ({ run: VIEW(), acceptedRisks: ['connector.write'] }) } as unknown as ConsoleCommands;
    await runConsole(io, cmds, renderHome(homeOf(squad), caps).join('\n'), caps);
    assert.ok(all.some(l => l.includes('/nope')) && all.some(l => l.includes(HASH.slice(0, 12))), 'the session went through');
    assert.deepEqual(all.filter(l => l.includes('\x1b')), [], `${lang}: no ESC byte`);
  });
});

test('the prompt shows ◆ and the gate while the current run waits for an approval', async () => {
  const s = session(['/run x', '/quit']);
  await s.done;
  assert.ok(s.out.includes('taskquoin › '));
  assert.ok(s.out.includes('taskquoin [bbbbbb ◆ plan] › '), s.out.join('|'));
  const n = session(['/use run-20261115T100000-aaaaaa', '/quit']); await n.done;
  assert.ok(n.out.includes('taskquoin [aaaaaa] › '), 'no approval waiting: no glyph');
});

test('squad: an agent whose gate is ok but whose skills fail is NOT READY with the skill error; the error is neutralised where printed', async () => {
  const { squadOf, renderBanner } = await import('../src/console.ts');
  const evil = 'sk' + String.fromCharCode(0x1b) + '[2J: bad';
  const g = { ok: true, runtimeFound: true, failures: [], acceptedRisks: [], skillErrors: [evil] };
  const s = squadOf({ planner: { runtime: 'claude' } }, () => g, true);
  assert.equal(s[0].state, 'blocked');
  const text = renderBanner(homeOf(s), { ...CAPS, colorDepth: 0 });
  assert.match(text, /^○ Architect\s+NOT READY\s+sk\u2039ESC\u203a\[2J: bad$/m);
  assert.ok(!text.includes(String.fromCharCode(0x1b)));
});

test('unknown run and unknown command: the typed text is shown as markers, never raw', async () => {
  const ESC = String.fromCharCode(0x1b), BEL = String.fromCharCode(7), RLO = String.fromCharCode(0x202e);
  const s = session([`/use run-x${ESC}]52;c;ZXZpbA==${BEL}${RLO}y`, `/zz${ESC}[2J${RLO}`, '/quit']);
  assert.equal(await s.done, 1);
  const text = s.out.join('\n');
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e]/.test(text), JSON.stringify(text));
  assert.ok(text.includes('run-x‹ESC›]52;c;ZXZpbA==‹BEL›‹U+202E›y'), text);
  assert.ok(text.includes('/zz‹ESC›[2J‹U+202E›'), text);
});

test('squad: a translated role or note keeps its ZWNJ (never neutralised whole); only the raw parts are marked, a gate reason cut once', async () => {
  const { squadOf } = await import('../src/console.ts');
  const Z = String.fromCharCode(0x200c), ESC = String.fromCharCode(0x1b);
  setLanguage('fa', () => JSON.stringify({ 'console.role.planner': `معمار${Z}ها`, 'console.role.tester': `آزمون${Z}گر`,
    'console.squad.absent': `{runtime} پیدا نمی${Z}شود`, 'console.squad.testerUnavailable': `bubblewrap در دسترس نمی${Z}باشد` }));
  try {
    const gates: Record<string, { ok: boolean; runtimeFound: boolean; failures: { message: string }[]; acceptedRisks: { capability: string }[]; skillErrors?: string[] }> = {
      planner: { ok: false, runtimeFound: false, failures: [], acceptedRisks: [] },
      [`x${ESC}[2J`]: { ok: true, runtimeFound: true, failures: [], acceptedRisks: [], skillErrors: [`sk${ESC}: bad`] },
      judge: { ok: false, runtimeFound: true, failures: [{ message: `${'k'.repeat(66)}${ESC}${'z'.repeat(10)} — fix` }], acceptedRisks: [] },
    };
    const s = squadOf({ planner: { runtime: 'claude' }, [`x${ESC}[2J`]: { runtime: 'codex' }, judge: { runtime: 'codex' } }, (id) => gates[id], false);
    assert.deepEqual(s.map(m => [m.role, m.note]), [
      [`معمار${Z}ها`, `claude پیدا نمی${Z}شود`],
      ['X‹ESC›[2J', 'sk‹ESC›: bad'],
      ['Judge', `${'k'.repeat(66)}…`],
      [`آزمون${Z}گر`, `bubblewrap در دسترس نمی${Z}باشد`],
    ]);
    assert.equal(s[1].who, 'x‹ESC›[2J · codex');
  } finally { setLanguage('en'); }
});

test('/approve shows what the approval is bound to and what there is to read, before the unchanged retype', async () => {
  const s = session(['/run x', '/approve plan', 'alice', HASH.slice(0, 12), '/quit']); await s.done;
  const at = (re: RegExp) => s.out.findIndex(l => re.test(l));
  const screen = s.out.find(l => /Bound to the plan/.test(l) && l.includes(HASH.slice(0, 12)));
  assert.ok(screen, 'the screen says what is bound');
  assert.match(s.out.join('\n'), /Critique\s+✔ APPROVE\s+\/show challenge/);
  assert.match(s.out.join('\n'), /Plan\s+· to read\s+\/show plan/);
  assert.match(s.out.join('\n'), /Approver\s+alice \(via taskquoin console\)/);
  assert.ok(at(/Bound to the plan/) < at(/^Retype /), 'the screen comes before the retype prompt');
  assert.equal(s.calls.filter(c => c.startsWith('approve')).length, 1);
});

test('/show NAME then /approve: that artifact is listed as read; one that could not be shown is not', async () => {
  const cmds = { show: async (r: string, a?: string) => { return a === 'nope' ? 1 : 0; } };
  const s = session(['/run x', '/show plan', '/show nope', '/approve plan', 'alice', '', '/quit'], cmds); await s.done;
  const read = s.out.find(l => /Read this session/.test(l))!;
  assert.match(read, /✔ plan/); assert.doesNotMatch(read, /nope/); assert.match(read, /· challenge/);
  const none = session(['/run x', '/approve plan', 'alice', '', '/quit']); await none.done;
  assert.match(none.out.find(l => /Read this session/.test(l))!, /nothing yet/);
  // reading is per run: another run's /show does not count
  const other = session(['/use run-20261115T100000-aaaaaa', '/show plan', '/run x', '/approve plan', 'alice', '', '/quit']); await other.done;
  assert.match(other.out.find(l => /Read this session/.test(l))!, /nothing yet/);
});

test('/approve commit hands the retyped hash to the same approve path as the CLI: the console never reads the working tree', async () => {
  // An untracked file, an unreadable tree or another branch is for `taskquoin approve` to handle (it re-verifies, or
  // refuses with its own message): the console adds no check of its own (ADR-0015 §1, final review I1).
  const s = session(['/run x', '/approve commit', 'alice', HASH.slice(0, 12), '/quit'], { pending: () => ({ gate: 'commit', binding: HASH }) });
  assert.equal(await s.done, 0);
  assert.deepEqual(s.calls.filter(c => c.startsWith('approve')), [`approve:run-20261115T110000-bbbbbb:commit:${HASH.slice(0, 12)}:alice (via taskquoin console)`]);
  assert.ok(s.out.some(l => /Bound to the git tree/.test(l) && l.includes(HASH.slice(0, 12))), 'the binding recorded in the run is shown');
  const refused = session(['/run x', '/approve commit', 'alice', HASH.slice(0, 12), '/quit'], { pending: () => ({ gate: 'commit', binding: HASH }), approve: async () => 1 });
  assert.equal(await refused.done, 1, 'what approve answers is the result: a refusal by the CLI path fails the session');
  assert.ok(!refused.out.some(l => /nothing is approved/.test(l)), 'the console adds no message of its own: approve said why');
});

test('the pending binding changing between the display and the retype: refused with the reason, nothing approved', async () => {
  for (const gate of ['plan', 'commit'] as const) {
    const seen: { out?: string[] } = {};
    const asked = () => !!seen.out?.some(l => /^Retype /.test(l));
    const s = session(['/run x', `/approve ${gate}`, 'alice', HASH.slice(0, 12), '/quit'], { pending: () => ({ gate, binding: asked() ? 'f'.repeat(40) : HASH }) });
    seen.out = s.out;
    assert.equal(await s.done, 1, gate);
    assert.deepEqual(s.calls.filter(c => c.startsWith('approve')), [], gate);
    assert.ok(s.out.some(l => /^Retype /.test(l)), `${gate}: it was offered, then refused after the retype`);
    const reason = gate === 'plan' ? /the plan changed after it was shown: nothing is approved — run \/approve plan again/
      : /the tree waiting for approval changed after it was shown: nothing is approved — run \/approve commit again/;
    assert.ok(s.out.some(l => reason.test(l)), `${gate}: ${s.out.join('\n')}`);
  }
});

test('the gate no longer pending after the retype (approved elsewhere): refused, nothing approved', async () => {
  const seen: { out?: string[] } = {};
  const s = session(['/run x', '/approve plan', 'alice', HASH.slice(0, 12), '/quit'], { pending: () => (seen.out?.some(l => /^Retype /.test(l)) ? undefined : { gate: 'plan', binding: HASH }) });
  seen.out = s.out;
  assert.equal(await s.done, 1);
  assert.deepEqual(s.calls.filter(c => c.startsWith('approve')), []);
  assert.ok(s.out.some(l => /is no longer waiting for the plan approval/.test(l)));
});

test('/dashboard: runs the dashboard with the current run, its refusal is not a failed command, /help dashboard, listed under Review and fitting 40 columns', async () => {
  await inLang('en', async () => {
    const { slashMenu, commandDocs } = await import('../src/console.ts');
    const s = session(['/dashboard', '/use run-20261115T100000-aaaaaa', '/dashboard', '/help dashboard', '/quit']);
    assert.equal(await s.done, 0, 'the child exit code (1 without a terminal) does not fail the session');
    assert.deepEqual(s.calls, ['dashboard:', 'dashboard:run-20261115T100000-aaaaaa']);
    assert.ok(s.out.some(l => l.trim() === '/dashboard'), s.out.join('\n'));
    const menu = slashMenu('/', 40);
    const at = (c: string) => menu.findIndex(l => l.trim().startsWith(c));
    assert.ok(at('/dashboard') > menu.indexOf('Review') && at('/dashboard') < menu.indexOf('Diagnose'), menu.join('\n'));
    for (const l of menu) assert.ok(displayWidth(l) <= 40, l);
    assert.ok(commandDocs().some(([c]) => c === '/dashboard'));
  });
});
