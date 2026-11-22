/**
 * PROVES (skill rule 1, testing.md T4, AC-5/AC-6): no single key of the keyboard approves, in any step; an Enter inside
 * a pasted chunk or a chunk of several keys never submits; keys typed before the form was on screen are dropped; the
 * binding is re-read after the last keystroke and a change refuses (`stale`, "changed since it was shown"); retyping
 * the shown 12 characters calls the existing approve path exactly once with what was typed and
 * `<name> (via taskquoin dashboard)`; the name is asked first when the session has none, trimmed, capped at 64,
 * `/…` and controls refused, an empty one cancels, `onName` once; a mismatch clears the field; Esc and Ctrl+C cancel
 * while typing ("nothing was approved") but after `sent` they change nothing; a gate approved since the last poll opens
 * as `not-waiting` with no field. The renderer: exactly `height` lines within the columns at 40..200 in en/fr/ja/ar
 * and both charsets, the hash bold in colour and no escape at colour 0, and hostile request / approver / reason /
 * artifact names / binding never reach the screen raw.
 * DOES NOT PROVE: the separate `taskquoin approve` process and the loop around the form (Task 9 tests).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunView, StepId } from '@taskquoin/application';
import { approvalForm, HASH_LEN, NAME_MAX, type CenterContext, type FormStep, type Pending } from '../src/dashboard-approve.ts';
import { renderApprovalCenter } from '../src/tui/components/approval-center.ts';
import { displayWidth } from '../src/i18n/width.ts';
import { caps, CORPUS, FORBIDDEN, LANGS, SGR, withLang } from './support/tui-fixtures.ts';

process.env.TZ = 'UTC';
const TREE = '9c1e04b7aa31d2f04c11aa0b3e2e5f9d8c7b6a51';
const PLAN = 'ab'.repeat(32);
const IDS: StepId[] = ['planning', 'critique', 'plan-approval', 'implementation', 'verify', 'red-proof', 'review', 'commit-approval', 'commit'];

function view(gate: 'plan' | 'commit' = 'commit', o: { binding?: string; reason?: string; artifacts?: string[] } = {}): RunView {
  const waitAt = gate === 'plan' ? 2 : 7;
  return {
    runId: 'run-20261122T101500-ab12cd', status: 'waiting-approval', current: gate === 'plan' ? 'approve-plan' : 'approve-commit', attempts: 2,
    startedAt: '2026-11-22T10:15:00.000Z', pending: { gate, binding: o.binding ?? (gate === 'plan' ? PLAN : TREE) }, ...(o.reason !== undefined ? { reason: o.reason } : {}),
    steps: IDS.map((id, i) => ({
      id, state: i < waitAt ? 'done' as const : i === waitAt ? 'waiting' as const : 'pending' as const, attempts: [],
      ...(i === waitAt ? { startedAt: '2026-11-22T10:31:44.000Z' } : {}),
      artifacts: id === 'review' ? (o.artifacts ?? ['diff-2', 'review-2']) : id === 'verify' ? ['verify-2'] : id === 'planning' ? ['plan'] : [],
      ...(id === 'verify' ? { outcome: 'tests-green' } : id === 'review' ? { outcome: 'review:APPROVE' } : {}),
    })),
  };
}

const ctxOf = (o: Partial<CenterContext> = {}): CenterContext => ({ view: view(), request: 'rate-limit the /login route', read: new Set(['diff-2']), acceptedRisks: [], waiting: 1, ...o });

function harness(o: { binding?: string; approver?: string | null; gate?: 'plan' | 'commit'; ctx?: Partial<CenterContext> } = {}) {
  const calls: unknown[][] = [];
  const names: string[] = [];
  const gate = o.gate ?? 'commit';
  let current: Pending | undefined = { gate, binding: o.binding ?? TREE, at: '2026-11-22T10:31:44.000Z' };
  let clock = Date.parse('2026-11-22T10:33:02.000Z');
  const form = approvalForm({
    runId: 'ab12cd', gate, ...(o.approver === null ? {} : { approver: o.approver ?? 'alice' }),
    pending: () => current,
    approve: async (...a: unknown[]) => { calls.push(a); return 0; },
    onName: (n) => { names.push(n); },
    context: () => ctxOf({ view: view(gate), ...o.ctx }),
    now: () => new Date(clock += 1000),
  });
  return { form, calls, names, change: (b: string) => { current = { gate, binding: b, at: '2026-11-22T10:32:58.000Z' }; }, gone: () => { current = undefined; }, other: (p: Pending) => { current = p; } };
}
const typeKeys = async (form: ReturnType<typeof harness>['form'], s: string): Promise<void> => { for (const k of s) await form.key(k); };
const text = (lines: string[]): string => lines.join('\n').replace(SGR, '');
const flat = (lines: string[]): string => text(lines).replace(/[│╭╮╰╯─|+-]+/g, ' ').replace(/\s+/g, ' ');

// ---- testing.md T4, as written (the approver is the name: the form adds the surface once — F30) -------------------

test('T4: no single key approves', async () => {
  const { form, calls } = harness();
  for (const k of ['y', 'Y', '\r', ' ', 'a', '\u001b']) await form.key(k);
  assert.equal(calls.length, 0);
  const h = harness(); h.form.open();
  for (const k of ['y', 'Y', '\r', ' ', 'a', '\u001b']) await h.form.key(k);
  assert.equal(h.calls.length, 0);
});

test('T4: an Enter inside a pasted chunk never submits', async () => {
  const { form, calls } = harness(); form.open();
  await form.key('9c1e04b7aa31\r');
  assert.equal(calls.length, 0);
  const s = form.state();
  assert.equal(s.step, 'hash'); assert.equal((s as Extract<FormStep, { step: 'hash' }>).text, '9c1e04b7aa31', 'the text is there, the Enter was not a submit');
  const b = harness(); b.form.open();
  await b.form.key('\x1b[200~9c1e04b7aa31\r\n\x1b[201~');
  assert.equal(b.calls.length, 0, 'a bracketed paste with a line break does not submit either');
});

test('T4: keys typed before the form appeared are discarded', async () => {
  const { form, calls } = harness();
  form.typeAhead('9c1e04b7aa31\r');
  form.open(); await form.key('\r');
  assert.equal(calls.length, 0);
  assert.equal(form.state().step, 'cancelled', 'the field was empty: Enter cancels');
});

test('T4: the binding is re-read after the last keystroke', async () => {
  const { form, calls, change } = harness(); form.open();
  for (const k of '9c1e04b7aa3') await form.key(k);
  change('77d0e2c41f95aa00000000000000000000000000'); await form.key('1'); await form.key('\r');
  assert.equal(calls.length, 0); assert.match(form.render(caps()).join('\n'), /changed since it was shown/);
  assert.equal(form.state().step, 'stale');
});

test('T4: retyping the shown hash approves exactly once, through the existing function', async () => {
  const { form, calls } = harness(); form.open();
  for (const k of '9c1e04b7aa31\r') await form.key(k);
  assert.deepEqual(calls, [['ab12cd', 'commit', '9c1e04b7aa31', 'alice (via taskquoin dashboard)']]);
  assert.equal(form.state().step, 'sent');
});

// ---- every key of the keyboard, alone ---------------------------------------------------------------------------------

const ALL_KEYS = [
  ...Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)), // every printable ASCII character
  '\r', '\n', '\t', '\x7f', '\b', '\x03', '\x1b', '\x04', '\x07', '\x00', '\u202e', '\u200b', 'é', '日',
  '\x1b[A', '\x1b[B', '\x1b[C', '\x1b[D', '\x1b[H', '\x1b[F', '\x1b[5~', '\x1b[6~', '\x1b[Z', '\x1bOA', '\x1b[15~', '\x1bx', '\x1b[200~\x1b[201~',
];

test('every key of the keyboard, alone or held down, never approves — at the name step, at the hash step, after a refusal', async () => {
  for (const k of ALL_KEYS) {
    for (const approver of ['alice', null] as const) {
      const h = harness({ approver }); h.form.open();
      await h.form.key(k);
      for (let i = 0; i < 20; i++) await h.form.key(k);
      await h.form.key('\r');
      assert.equal(h.calls.length, 0, `${JSON.stringify(k)} (${approver ?? 'no name'})`);
    }
    const s = harness({ binding: k.repeat(40) }); s.form.open(); // even a binding made of that very key needs 12 keys AND an Enter
    await s.form.key(k);
    assert.equal(s.calls.length, 0, `${JSON.stringify(k)} against a binding of itself`);
  }
});

test('a pasted hash is allowed once the form is shown, but only a separate Enter submits', async () => {
  const { form, calls } = harness(); form.open();
  await form.key('\x1b[200~9c1e04b7aa31\x1b[201~');
  assert.equal(calls.length, 0);
  await form.key('\r');
  assert.deepEqual(calls, [['ab12cd', 'commit', '9c1e04b7aa31', 'alice (via taskquoin dashboard)']]);
});

test('a bracketed paste begun before the form was shown is dropped up to its end', async () => {
  const { form, calls } = harness();
  form.typeAhead('\x1b[200~9c1e04b7');
  form.open();
  await form.key('aa31\x1b[201~');
  assert.equal((form.state() as Extract<FormStep, { step: 'hash' }>).text, '', 'the paste began before the form: none of it is typed');
  await form.key('\r');
  assert.equal(calls.length, 0);
});

test('a key before open() is dropped, never typed', async () => {
  const { form } = harness();
  await form.key('9'); form.open();
  assert.equal((form.state() as Extract<FormStep, { step: 'hash' }>).text, '');
});

// ---- the name -----------------------------------------------------------------------------------------------------

test('without a name in the session the name comes first, then the hash; onName once; a second form opens on the hash', async () => {
  const h = harness({ approver: null }); h.form.open();
  assert.equal(h.form.state().step, 'name');
  assert.match(flat(h.form.render(caps())), /Your name \(asked once per session\):/);
  await typeKeys(h.form, 'alice');
  await h.form.key('\r');
  assert.deepEqual(h.names, ['alice']);
  assert.equal(h.form.state().step, 'hash');
  await typeKeys(h.form, '9c1e04b7aa31'); await h.form.key('\r');
  assert.deepEqual(h.calls, [['ab12cd', 'commit', '9c1e04b7aa31', 'alice (via taskquoin dashboard)']]);
  assert.deepEqual(h.names, ['alice'], 'asked once');
  const again = harness({ approver: h.names[0]! }); again.form.open();
  assert.equal(again.form.state().step, 'hash');
});

test('a name typed in one chunk is kept (its Enter does not submit it); `/alice` and an empty name are refused', async () => {
  const h = harness({ approver: null }); h.form.open();
  await h.form.key('alice\r');
  assert.equal(h.form.state().step, 'name');
  assert.equal((h.form.state() as Extract<FormStep, { step: 'name' }>).text, 'alice');
  const slash = harness({ approver: null }); slash.form.open();
  await typeKeys(slash.form, '/alice'); await slash.form.key('\r');
  assert.deepEqual(slash.form.state(), { step: 'name', text: '', error: 'slash' });
  assert.deepEqual(slash.names, []);
  assert.match(flat(slash.form.render(caps())), /never starts with \//);
  for (const typed of ['', '   ']) {
    const e = harness({ approver: null }); e.form.open();
    await typeKeys(e.form, typed); await e.form.key('\r');
    assert.equal(e.form.state().step, 'cancelled', JSON.stringify(typed));
    assert.deepEqual(e.names, []); assert.equal(e.calls.length, 0);
  }
});

test('F32: the name is trimmed and capped at 64 characters; `as` is that name and the surface, once', async () => {
  const h = harness({ approver: null }); h.form.open();
  await typeKeys(h.form, '  ' + 'x'.repeat(100) + '  '); await h.form.key('\r');
  assert.deepEqual(h.names, ['x'.repeat(NAME_MAX)]);
  await typeKeys(h.form, '9c1e04b7aa31'); await h.form.key('\r');
  assert.equal(h.calls[0]![3], 'x'.repeat(NAME_MAX) + ' (via taskquoin dashboard)');
  const t = harness({ approver: '  bob  ' }); t.form.open();
  await typeKeys(t.form, '9c1e04b7aa31'); await t.form.key('\r');
  assert.equal(t.calls[0]![3], 'bob (via taskquoin dashboard)');
});

test('a pasted or typed control / bidi character is refused: `controls`, nothing appended — in the name and in the hash', async () => {
  const h = harness({ approver: null }); h.form.open();
  await typeKeys(h.form, 'al');
  await h.form.key('\x1b[200~ice\u202e\x1b[201~');
  assert.deepEqual(h.form.state(), { step: 'name', text: 'al', error: 'controls' });
  await h.form.key('\u202e');
  assert.deepEqual(h.form.state(), { step: 'name', text: 'al', error: 'controls' });
  await h.form.key('\x1b[200~multi\nline\x1b[201~');
  assert.equal((h.form.state() as Extract<FormStep, { step: 'name' }>).text, 'al');
  const k = harness(); k.form.open();
  await k.form.key('\x1b[200~9c1e\u200b04b7aa31\x1b[201~');
  assert.deepEqual({ ...k.form.state(), shown: undefined }, { step: 'hash', shown: undefined, text: '', error: 'controls' });
  await k.form.key('\r');
  assert.equal(k.calls.length, 0);
});

test('a session approver holding a hostile character is never used: the name is asked again', () => {
  for (const bad of CORPUS) {
    const h = harness({ approver: bad }); h.form.open();
    assert.equal(h.form.state().step, 'name', JSON.stringify(bad));
  }
});

// ---- the hash -----------------------------------------------------------------------------------------------------

test('a mismatch clears the field and says so; a correct retype then submits once; upper case is lower-cased', async () => {
  const { form, calls } = harness(); form.open();
  await typeKeys(form, '9c1e04b7aa30'); await form.key('\r');
  assert.equal(calls.length, 0);
  const s = form.state() as Extract<FormStep, { step: 'hash' }>;
  assert.equal(s.step, 'hash'); assert.equal(s.text, ''); assert.equal(s.error, 'mismatch');
  assert.match(flat(form.render(caps())), /the hash does not match: nothing was approved/);
  await typeKeys(form, '9C1E04B7AA31'); await form.key('\r');
  assert.deepEqual(calls, [['ab12cd', 'commit', '9c1e04b7aa31', 'alice (via taskquoin dashboard)']]);
});

test('F33: the hash field holds 12 characters; Backspace deletes; a longer prefix is never typed', async () => {
  const { form, calls } = harness(); form.open();
  await typeKeys(form, '9c1e04b7aa31d2f04c11');
  assert.equal((form.state() as Extract<FormStep, { step: 'hash' }>).text, '9c1e04b7aa31');
  assert.equal(HASH_LEN, 12);
  await form.key('\x7f');
  assert.equal((form.state() as Extract<FormStep, { step: 'hash' }>).text, '9c1e04b7aa3');
  await form.key('1'); await form.key('\r');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]![2], '9c1e04b7aa31');
});

test('a second Enter after `sent` is still one call; Esc and Ctrl+C after `sent` change nothing and never say nothing was approved (F31)', async () => {
  const { form, calls } = harness(); form.open();
  await typeKeys(form, '9c1e04b7aa31'); await form.key('\r');
  await form.key('\r'); await typeKeys(form, '9c1e04b7aa31'); await form.key('\r');
  assert.equal(calls.length, 1);
  for (const k of ['\x1b', '\x03']) {
    await form.key(k);
    assert.equal(form.state().step, 'sent');
    assert.ok(!/nothing was approved/i.test(flat(form.render(caps()))), 'after sent the screen never says nothing was approved');
  }
});

test('Esc and Ctrl+C cancel at the name and at the hash: `cancelled`, "nothing was approved" on screen, no call', async () => {
  for (const k of ['\x1b', '\x03']) for (const approver of [null, 'alice'] as const) {
    const h = harness({ approver }); h.form.open();
    await typeKeys(h.form, approver ? '9c1e04b7aa31' : 'ali');
    await h.form.key(k);
    assert.equal(h.form.state().step, 'cancelled');
    assert.match(flat(h.form.render(caps())), /nothing was approved/);
    await h.form.key('\r');
    assert.equal(h.calls.length, 0);
  }
});

test('Review Focus 2: the gate approved (or moved on) since the last poll → `not-waiting`, no field, nothing approved', async () => {
  const h = harness(); h.gone(); h.form.open();
  assert.equal(h.form.state().step, 'not-waiting');
  const shown = flat(h.form.render(caps()));
  assert.match(shown, /No longer waiting — approved or changed elsewhere/);
  assert.ok(!/Retype|Your name/.test(shown), 'no field');
  await typeKeys(h.form, '9c1e04b7aa31'); await h.form.key('\r');
  assert.equal(h.calls.length, 0);
  const other = harness(); other.other({ gate: 'plan', binding: PLAN }); other.form.open();
  assert.equal(other.form.state().step, 'not-waiting', 'another gate waits: not this one');
  // and with no name yet, the gate gone when the name is given: no hash step
  const late = harness({ approver: null }); late.form.open();
  await typeKeys(late.form, 'alice'); late.gone(); await late.form.key('\r');
  assert.equal(late.form.state().step, 'not-waiting');
});

test('stale (layouts.md): shown and waiting hashes, the re-verify time, "Nothing was approved. Read the new diff: d", title stale', async () => {
  const { form, calls, change } = harness(); form.open();
  await typeKeys(form, '9c1e04b7aa31');
  change('77d0e2c41f95aa00000000000000000000000000');
  await form.key('\r');
  const s = form.state() as Extract<FormStep, { step: 'stale' }>;
  assert.equal(s.step, 'stale'); assert.equal(s.now?.at, '2026-11-22T10:32:58.000Z');
  const shown = flat(form.render(caps()));
  assert.match(shown, /✖ Refused: the tree changed since it was shown/);
  assert.match(shown, /shown 9c1e04b7aa31 at 10:33:0\d/);
  assert.match(shown, /waiting 77d0e2c41f95 re verified and re reviewed at 10:32:58/);
  assert.match(shown, /Nothing was approved\. Read the new diff: d/);
  assert.match(shown, /Approval center stale/);
  assert.equal(calls.length, 0);
  const g = harness(); g.form.open(); await typeKeys(g.form, '9c1e04b7aa31'); g.gone(); await g.form.key('\r');
  assert.match(flat(g.form.render(caps())), /no longer waiting/);
  assert.equal(g.calls.length, 0);
});

test('refresh() (each poll) marks the hash step changed for display only: it neither refuses nor submits', async () => {
  const { form, calls, change } = harness(); form.open();
  assert.match(flat(form.render(caps())), /Status ◆ waiting for you since 10:31:44 · re read 10:33:0\d ✔ unchanged/);
  change('77d0e2c41f95aa00000000000000000000000000'); form.refresh();
  const s = form.state() as Extract<FormStep, { step: 'hash' }>;
  assert.equal(s.step, 'hash'); assert.equal(s.changed, true);
  assert.match(flat(form.render(caps())), /re read 10:33:0\d ✖ changed$|re read 10:33:0\d ✖ changed /);
  change(TREE); form.refresh();
  assert.equal((form.state() as Extract<FormStep, { step: 'hash' }>).changed, false);
  assert.equal(calls.length, 0);
});

// ---- the renderer ------------------------------------------------------------------------------------------------

async function everyStep(): Promise<{ label: string; form: ReturnType<typeof harness>['form'] }[]> {
  const out: { label: string; form: ReturnType<typeof harness>['form'] }[] = [];
  const name = harness({ approver: null }); name.form.open(); await typeKeys(name.form, 'alice-with-a-rather-long-name'); out.push({ label: 'name', form: name.form });
  const slash = harness({ approver: null }); slash.form.open(); await typeKeys(slash.form, '/x'); await slash.form.key('\r'); out.push({ label: 'name+error', form: slash.form });
  const hash = harness(); hash.form.open(); await typeKeys(hash.form, '9c1e04'); out.push({ label: 'hash', form: hash.form });
  const mis = harness(); mis.form.open(); await typeKeys(mis.form, '000000000000'); await mis.form.key('\r'); out.push({ label: 'mismatch', form: mis.form });
  const plan = harness({ gate: 'plan', binding: PLAN }); plan.form.open(); await typeKeys(plan.form, 'abab'); out.push({ label: 'plan', form: plan.form });
  const stale = harness(); stale.form.open(); await typeKeys(stale.form, '9c1e04b7aa31'); stale.change('7'.repeat(40)); await stale.form.key('\r'); out.push({ label: 'stale', form: stale.form });
  const sent = harness(); sent.form.open(); await typeKeys(sent.form, '9c1e04b7aa31'); await sent.form.key('\r'); out.push({ label: 'sent', form: sent.form });
  const can = harness(); can.form.open(); await can.form.key('\x1b'); out.push({ label: 'cancelled', form: can.form });
  const nw = harness(); nw.gone(); nw.form.open(); out.push({ label: 'not-waiting', form: nw.form });
  return out;
}

test('every step: exactly `height` lines, each within the columns, at 40..200 in en/fr/ja/ar, UTF-8 and ASCII; the hash and the field stay', async () => {
  for (const lang of LANGS) await withLang(lang, async () => {
    for (const { label, form } of await everyStep()) {
      for (const columns of [40, 60, 80, 100, 120, 200]) for (const height of [10, 12, 20, 30, 40]) for (const charset of ['utf8', 'ascii'] as const) {
        const c = caps({ columns, rows: height, charset });
        const lines = form.render(c, height);
        assert.equal(lines.length, height, `${lang} ${label} ${columns}x${height} ${charset}: lines`);
        for (const l of lines) assert.ok(displayWidth(l.replace(SGR, '')) <= columns, `${lang} ${label} ${columns}x${height} ${charset}: ${displayWidth(l.replace(SGR, ''))} > ${columns}: ${l}`);
        const shown = text(lines);
        if (label === 'hash' || label === 'mismatch') {
          assert.ok(shown.includes('9c1e04b7aa31'), `${lang} ${label} ${columns}x${height}: the hash stays`);
          assert.ok(shown.includes(label === 'hash' ? `9c1e04${charset === 'utf8' ? '█' : '#'}` : charset === 'utf8' ? '█' : '#'), `${lang} ${label} ${columns}x${height}: the field and its caret stay`);
        }
        if (charset === 'ascii') assert.ok(!/[◆✔✖◉·…█─│╭╮╰╯]/u.test(shown), `${lang} ${label} ${columns}: ASCII only for marks: ${shown}`);
      }
    }
  });
});

test('the 12-character hash is bold in colour; colour 0 writes no escape at all', async () => {
  const { form } = harness(); form.open();
  assert.ok(form.render(caps({ colorDepth: 24 })).join('\n').includes('\x1b[1m9c1e04b7aa31\x1b[22m'));
  for (const { label, form: f } of await everyStep()) assert.ok(!f.render(caps({ colorDepth: 0 })).join('').includes('\x1b'), `${label}: no escape at colour 0`);
  const s = harness(); s.form.open(); await typeKeys(s.form, '9c1e04b7aa31'); s.change('7'.repeat(40)); await s.form.key('\r');
  const stale = s.form.render(caps({ colorDepth: 24 })).join('\n');
  assert.ok(stale.includes('\x1b[1m9c1e04b7aa31\x1b[22m') && stale.includes('\x1b[1m777777777777\x1b[22m'), 'both hashes bold in the stale screen');
});

test('the body is R2\'s approval body with the dashboard as surface: approver via the dashboard, no /show hints, the request on the title', () => {
  const { form } = harness(); form.open();
  const shown = flat(form.render(caps({ columns: 120, rows: 30 })));
  assert.match(shown, /◆ Commit approval run ab12cd — "rate limit the \/login route"/);
  assert.match(shown, /Approver alice \(via taskquoin dashboard\)/);
  assert.match(shown, /Retype the hash to approve: █/);
  assert.match(shown, /Esc cancels · no key approves on its own · keys typed before this screen are ignored/);
  assert.match(shown, /Approval center 1 waiting/);
  assert.ok(!/\/show/.test(shown), 'the console\'s /show hints are not the dashboard\'s keys');
  assert.ok(!/via taskquoin console/.test(shown));
});

test('hostile request, approver, reason, artifact names and binding never reach the screen raw (CORPUS)', async () => {
  for (const bad of CORPUS) {
    const probes: string[][] = [];
    const a = harness({ ctx: { request: bad, view: view('commit', { reason: bad, artifacts: [`diff-2${bad}`, 'review-2'] }), read: new Set([`r${bad}`]), acceptedRisks: [bad] } }); a.form.open();
    probes.push(a.form.render(caps({ columns: 120, rows: 40 })), a.form.render(caps({ columns: 40, rows: 12 })));
    const b = harness({ binding: `9c1e04b7aa31${bad}` }); b.form.open(); await typeKeys(b.form, '9c1e04b7aa31'); b.change(`77${bad}`); await b.form.key('\r');
    probes.push(b.form.render(caps({ columns: 100, rows: 30 })));
    assert.equal(b.calls.length, 0);
    const direct = renderApprovalCenter({ step: 'sent', shown: { binding: bad, at: bad }, as: bad }, { ...ctxOf({ request: bad }), gate: 'commit', approver: bad, reReadAt: bad, outcome: { kind: 'refused', exit: bad, tail: [bad, bad] } }, caps(), 30);
    probes.push(direct);
    for (const p of probes) {
      const visible = p.join('\n').replace(SGR, '');
      assert.ok(!FORBIDDEN.test(visible), `${JSON.stringify(bad)}: ${JSON.stringify(visible.match(FORBIDDEN))}`);
      assert.ok(!visible.includes('\x1b'), `${JSON.stringify(bad)}: an escape reached the screen`);
    }
  }
});

test('the dashboard frame shows the centre under the run\'s top bar: exactly `rows` lines, no help overlay, too small still wins', async () => {
  const { renderDashboard, initialUi } = await import('../src/tui/components/dashboard-frame.ts');
  const { form } = harness(); form.open();
  const m = {
    fixed: { version: '1.0.0', repo: 'demo', acceptedRisks: [], squad: [], runtimeVersions: {}, checkedAt: '' },
    runs: [{ runId: 'run-20261122T101500-ab12cd', short: 'ab12cd', status: 'waiting-approval', request: 'x', startedAt: '', waiting: 'commit' }],
    selected: { runId: 'run-20261122T101500-ab12cd', view: view(), request: 'x', marked: 0, events: [], skipped: 0, cut: false, liveness: 'none' },
    lastChange: '2026-11-22T10:33:00.000Z',
  } as unknown as Parameters<typeof renderDashboard>[0];
  const ui = { ...initialUi(), screen: 'center' as const, help: true, center: { render: (c: Parameters<typeof form.render>[0], h: number) => form.render(c, h) } };
  for (const [columns, rows] of [[120, 34], [80, 24], [60, 20], [40, 12]] as const) {
    const lines = renderDashboard(m, ui, caps({ columns, rows }), Date.parse('2026-11-22T10:33:00.000Z'));
    assert.equal(lines.length, rows);
    const shown = text(lines);
    assert.match(shown, /run ab12cd/, `${columns}: the top bar`);
    assert.match(shown, /Approval center/, `${columns}: the centre`);
    assert.ok(shown.includes('9c1e04b7aa31'), `${columns}: the hash`);
    assert.ok(!/Keys/.test(shown), `${columns}: no help overlay over the form`);
  }
  assert.match(text(renderDashboard(m, ui, caps({ columns: 36, rows: 10 }), 0)).replace(/\s+/g, ' '), /needs 40 × 12/);
});
