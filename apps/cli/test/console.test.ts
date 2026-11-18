/**
 * PROVES (pure, no terminal): the `taskquoin console` loop parses `/` commands only (plain text never starts anything),
 * keeps a current run, and approves ONLY after the human retypes the pending hash (12 chars) — wrong or empty input
 * approves nothing; the approver's name is asked once per session and recorded "via taskquoin console".
 * Under a wide-character (zh-CN) catalog, the `/` menu and the banner keep their second column at one display column.
 * DOES NOT PROVE: the readline wiring and the real CLI commands — features/console.feature does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lineReader, runConsole, type ConsoleCommands } from '../src/console.ts';
import { setLanguage, t } from '../src/i18n/index.ts';
import { displayWidth } from '../src/i18n/width.ts';

/** Runs `fn` with the console in `code`, back to English afterwards (module state). */
async function inLang<T>(code: string, fn: () => Promise<T> | T): Promise<T> {
  setLanguage(code);
  try { return await fn(); } finally { setLanguage('en'); }
}

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9001122334';
function session(lines: string[], over: Partial<ConsoleCommands> = {}) {
  const input = [...lines]; const out: string[] = []; const calls: string[] = [];
  let runs = ['run-20261115T100000-aaaaaa'];
  const cmds: ConsoleCommands = {
    run: async (r) => { calls.push(`run:${r}`); runs = [...runs, 'run-20261115T110000-bbbbbb']; return { code: 0, runId: 'run-20261115T110000-bbbbbb' }; },
    status: async (r) => { calls.push(`status:${r ?? ''}`); return 0; },
    show: async (r, a) => { calls.push(`show:${r}:${a ?? ''}`); return 0; },
    approve: async (r, g, e, as) => { calls.push(`approve:${r}:${g}:${e}:${as}`); return 0; },
    resume: async (r) => { calls.push(`resume:${r}`); return 0; },
    doctor: async () => { calls.push('doctor'); return 0; },
    skills: async () => { calls.push('skills'); return 0; },
    agents: async () => { calls.push('agents'); return 0; },
    pending: (r) => (r === 'run-20261115T110000-bbbbbb' ? { gate: 'plan', binding: HASH } : undefined),
    runs: () => runs,
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

test('banner: the TASK art, Q U O I N, the squad with its REAL status; colours only when asked', async () => {
  await inLang('fr', async () => {
    const { renderBanner } = await import('../src/console.ts');
    const squad = [
      { role: 'Architect', who: 'planner · claude', state: 'ready' as const },
      { role: 'Developer', who: 'implementer · claude', state: 'ready' as const },
      { role: 'Reviewer', who: 'challenger · codex', state: 'risk' as const, note: 'connector.write' },
      { role: 'Tester', who: 'verify · bubblewrap', state: 'blocked' as const, note: 'bubblewrap absent' },
    ];
    const plain = renderBanner(squad, { color: false });
    assert.match(plain, /████████╗ █████╗ ███████╗██╗  ██╗/);
    assert.match(plain, /Q U O I N/); assert.match(plain, /YOUR AI DEV SQUAD/);
    assert.match(plain, /\[●\] Architect\s+planner · claude\s+READY/);
    assert.match(plain, /\[●\] Reviewer\s+challenger · codex\s+READY \(risque accepté : connector\.write\)/);
    assert.match(plain, /\[○\] Tester\s+verify · bubblewrap\s+NOT READY — bubblewrap absent/);
    assert.match(plain, /> Let's build something awesome_/);
    assert.doesNotMatch(plain, /\x1b\[/, 'no escape codes without colour');
    const colored = renderBanner(squad, { color: true });
    assert.match(colored, /\x1b\[38;2;/, 'truecolor escapes'); assert.match(colored, /\x1b\[0m/);
    assert.equal(colored.replace(/\x1b\[[0-9;]*m/g, ''), plain, 'same text once colours are removed');
  });
});

test('the prompt shows the current run; tab completion proposes the commands', async () => {
  const { completeCommand } = await import('../src/console.ts');
  assert.deepEqual(completeCommand('/ap'), [['/approve '], '/ap']);
  assert.deepEqual(completeCommand('/s')[0].sort(), ['/show ', '/skills ', '/status '].sort());
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
    assert.equal(all.length, CONSOLE_COMMANDS.length);
    assert.ok(all.some(l => /^\/approve <plan\|commit>\s+approuver/.test(l)), all.join('\n'));
    assert.deepEqual(slashMenu('/ap').map(l => l.split(/\s/)[0]), ['/approve']);
    assert.deepEqual(slashMenu('/s').map(l => l.split(/\s/)[0]).sort(), ['/show', '/skills', '/status']);
    assert.deepEqual(slashMenu('/approve plan'), [], 'gone once the command has arguments');
    assert.deepEqual(slashMenu('bonjour'), []); assert.deepEqual(slashMenu('/zz'), []);
  });
});

test('slash menu drawing: drawn under the input, cursor put back where it was; an empty menu only clears', async () => {
  const { drawSlashMenu } = await import('../src/console.ts');
  const d = drawSlashMenu({ promptWidth: 12, line: '/ap', cursor: 3, items: ['/approve <plan|commit>  approuver'], color: false });
  assert.equal(d, '\x1b[16G\x1b[J\n/approve <plan|commit>  approuver\x1b[1A\x1b[16G');
  assert.equal(drawSlashMenu({ promptWidth: 12, line: 'x', cursor: 0, items: [], color: false }), '\x1b[14G\x1b[J\x1b[13G');
});

test('logo animation: frames reveal TASK left to right with a shine, then Q U O I N letter by letter; the last frame IS the static logo', async () => {
  const { logoFrames, renderLogo, animateLogo } = await import('../src/console.ts');
  const strip = (t: string) => t.replace(/\x1b\[[0-9;]*m/g, '');
  const frames = logoFrames();
  assert.ok(frames.length >= 12 && frames.length <= 30, `${frames.length} frames (short animation)`);
  const lines = (f: string) => strip(f).split('\n');
  for (const f of frames) assert.equal(lines(f).length, lines(frames.at(-1)!).length, 'constant height: frames overwrite each other');
  assert.equal(strip(frames.at(-1)!), strip(renderLogo(true)), 'ends exactly on the static logo');
  assert.ok(!strip(frames[0]).includes('████████╗'), 'starts hidden');
  assert.ok(!strip(frames[Math.floor(frames.length / 2)]).includes('Q U O I N'), 'QUOIN comes after TASK');
  const writes: string[] = []; let slept = 0;
  await animateLogo((s) => writes.push(s), async (ms) => { slept += ms; });
  const all = writes.join('');
  assert.ok(all.startsWith('\x1b[?25l') && all.endsWith('\x1b[?25h'), 'cursor hidden during, shown after');
  assert.ok(slept > 0 && slept <= 1200, `${slept} ms in total`);
});

test('squad: api judges get their real line — role from the id, provider shown, NOT READY with the short reason', async () => {
  await inLang('fr', async () => {
    const { squadOf, renderBanner } = await import('../src/console.ts');
    const agents = { planner: { runtime: 'claude' }, implementer: { runtime: 'claude' }, challenger: { runtime: 'codex' }, security: { runtime: 'api', provider: 'deepseek' } };
    const gateOf = (id: string) => (id === 'security'
      ? { ok: false, runtimeFound: true, acceptedRisks: [], failures: [{ message: 'DEEPSEEK_API_KEY absente — définissez-la dans votre environnement' }] }
      : { ok: true, runtimeFound: true, acceptedRisks: id === 'challenger' ? [{ capability: 'connector.write' }] : [], failures: [] });
    const text = renderBanner(squadOf(agents, gateOf, true), { color: false });
    assert.match(text, /\[○\] Security\s+security · api:deepseek\s+NOT READY — DEEPSEEK_API_KEY absente\s*$/m);
    assert.match(text, /\[●\] Reviewer\s+challenger · codex\s+READY \(risque accepté : connector\.write\)/);
    assert.match(text, /\[●\] Testeur\s+verify · bubblewrap\s+READY/);
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
  assert.equal(commandDocs().length, 12);
  assert.notEqual(await inLang('en', () => consoleHelp()), await inLang('fr', () => consoleHelp()), 'help is computed at call time, not at module load');
});

test('CJK: the / menu description column and the banner second column start at one display column per line', async () => {
  const { slashMenu, renderBanner, squadOf } = await import('../src/console.ts');
  const wide: Record<string, string> = {
    'console.doc.run': '启动受管运行', 'console.doc.runs': '列出所有运行', 'console.doc.use': '选择当前运行', 'console.doc.status': '当前运行的历史',
    'console.doc.show': '显示产物', 'console.doc.approve': '批准流程', 'console.doc.resume': '恢复运行', 'console.doc.agents': '代理及其权限',
    'console.doc.doctor': '机器状态', 'console.doc.skills': '已安装技能', 'console.doc.help': '帮助', 'console.doc.quit': '退出控制台',
    'console.role.planner': '架构师', 'console.role.implementer': '开发者', 'console.role.challenger': '审阅者', 'console.role.security': '安全',
    'console.role.tester': '测试员',
  };
  setLanguage('zh-CN', () => JSON.stringify(wide));
  try {
    const menu = slashMenu('/');
    assert.ok(menu.length >= 10);
    const cut = (line: string, tail: string) => displayWidth(line.slice(0, line.lastIndexOf(tail)));
    const descs = Object.entries(wide).filter(([k]) => k.startsWith('console.doc.')).map(([, v]) => v);
    const menuCols = menu.map((l) => cut(l, descs.find((d) => l.endsWith(d))!));
    assert.equal(new Set(menuCols).size, 1, `menu columns ${menuCols}`);
    const agents = { planner: { runtime: 'claude' }, implementer: { runtime: 'claude' }, challenger: { runtime: 'codex' }, security: { runtime: 'api', provider: 'x' } };
    const squad = squadOf(agents, () => ({ ok: true, runtimeFound: true, failures: [], acceptedRisks: [] }), true);
    assert.equal(squad.at(-1)!.role, '测试员');
    const banner = renderBanner(squad, { color: false, logo: false }).split('\n');
    const cols = squad.map((m) => cut(banner.find((l) => l.includes(m.who))!, m.who));
    assert.equal(new Set(cols).size, 1, `banner columns ${cols}`);
    assert.ok(cols[0] > 8, 'roles are wide, so the column moved');
    assert.equal(t('console.role.tester'), '测试员');
  } finally { setLanguage('en'); }
});
