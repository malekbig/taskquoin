/**
 * PROVES: renderApproval draws the body of the approval screen from a RunView — what the approval is bound to, what
 * there is to read with its state (verify passed, RED proven, review verdict, taken from history outcomes), what was
 * read this session, the policy line and the approver — with a glyph + word per state, no escape without colour, the
 * 12-character hash in bold with colour, every line within the terminal width at 40..200 columns in en, fr, ja and ar,
 * and every outside text (artifact names, outcomes, approver, risk names) neutralised. It draws no retype prompt.
 * Also: a RunView of an unknown status is an unknown state in the timeline, never a failure.
 * DOES NOT PROVE: the console flow around it (console.test.ts) nor the real gates (features/console.feature).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RunView, StepId } from '@taskquoin/application';
import { setLanguage } from '../src/i18n/index.ts';
import { displayWidth } from '../src/i18n/width.ts';
import type { Caps } from '../src/tui/caps.ts';
import { n, type Neutral } from '../src/tui/neutral.ts';
import { renderApproval, type ApprovalModel } from '../src/tui/components/approval.ts';
import { renderTimeline } from '../src/tui/components/timeline.ts';

const caps = (o: Partial<Caps> = {}): Caps => ({ interactive: false, cursor: false, colorDepth: 0, charset: 'utf8', theme: 'dark', motion: false, plain: false, columns: 100, rows: 24, ...o });
const IDS: StepId[] = ['planning', 'critique', 'plan-approval', 'implementation', 'verify', 'red-proof', 'review', 'commit-approval', 'commit'];
const TREE = '9c1e04b7aa31d2f04c88e1a7b5d3f6a2c4e8b0d1';
const N = (s: string) => s as Neutral;
function atCommitGate(over: Record<string, { outcome?: string; artifacts?: string[] }> = {}): RunView<Neutral> {
  const def: Record<string, { outcome?: string; artifacts?: string[] }> = {
    verify: { outcome: 'tests-green', artifacts: ['verify-2'] }, 'red-proof': { outcome: 'red-proven', artifacts: ['red-2'] },
    review: { outcome: 'review:APPROVE', artifacts: ['diff-2', 'review-2', 'review-2-reviewer'] }, ...over };
  return { runId: N('run-20261122T101500-ab12cd'), status: 'waiting-approval', current: 'approve-commit', attempts: 2, startedAt: N('2026-11-22T10:15:00.000Z'),
    pending: { gate: 'commit', binding: N(TREE) },
    steps: IDS.map((id, i) => ({ id, state: i < 7 ? 'done' as const : i === 7 ? 'waiting' as const : 'pending' as const, attempts: [],
      artifacts: (def[id]?.artifacts ?? []).map(N), ...(def[id]?.outcome ? { outcome: N(def[id]!.outcome!) } : {}) })) };
}
const model = (o: Partial<ApprovalModel> = {}): ApprovalModel => ({ run: atCommitGate(), gate: 'commit', binding: TREE, read: new Set(), acceptedRisks: [], approver: 'alice', ...o });

test('the commit screen: bound tree, what to read with its state, what was read, policy, approver — and no retype prompt', () => {
  setLanguage('en');
  const text = renderApproval(model({ read: new Set(['diff-2', 'review-2']), acceptedRisks: ['connector.write'] }), caps()).join('\n');
  assert.match(text, /◆ Commit approval\s+run ab12cd/);
  assert.match(text, /Bound to the git tree\s+9c1e04b7aa31\s+\(9c1e04b7aa31d2f04c88…\)/);
  assert.match(text, /Diff\s+· to read\s+\/show diff-2/);
  assert.match(text, /Verify\s+✔ passed\s+\/show verify-2/);
  assert.match(text, /RED proof\s+✔ proven\s+\/show red-2/);
  assert.match(text, /Review\s+✔ APPROVE\s+\/show review-2\n/);
  assert.match(text, /Policy\s+agents never commit · 1 accepted risk \(connector\.write\)/);
  assert.match(text, /Read this session\s+✔ diff-2  · verify-2  · red-2  ✔ review-2/);
  assert.match(text, /Approver\s+alice \(via taskquoin console\)/);
  assert.doesNotMatch(text, /Retype|Enter to cancel/, 'the prompt belongs to the caller');
});

test('states come from the history outcomes: failed verify, RED not proven, requested changes are never shown as passed', () => {
  setLanguage('en');
  const v = atCommitGate({ verify: { outcome: 'tests-red:rework', artifacts: ['verify-1'] }, 'red-proof': { outcome: 'red-not-applicable:tests-only' }, review: { outcome: 'review:CHANGES_REQUESTED:rework', artifacts: ['diff-1'] } });
  const text = renderApproval(model({ run: v }), caps()).join('\n');
  assert.match(text, /Verify\s+✖ failed/); assert.match(text, /RED proof\s+✔ not applicable/); assert.match(text, /Review\s+◐ CHANGES_REQUESTED/);
  const none = renderApproval(model({ run: atCommitGate({ verify: {}, 'red-proof': {}, review: {} }) }), caps()).join('\n');
  assert.match(none, /Verify\s+\? unknown/); assert.match(none, /Review\s+\? unknown/); assert.doesNotMatch(none, /passed|proven|APPROVE/);
});

test('ignored files the agent changed (ignored-N of this attempt): their own row in amber, a hint, and in what there is to read', () => {
  setLanguage('en');
  const run = atCommitGate({ verify: { outcome: 'tests-green', artifacts: ['verify-2', 'ignored-2'] } });
  const text = renderApproval(model({ run, read: new Set(['diff-2']) }), caps()).join('\n');
  assert.match(text, /Ignored files\s+◐ outside the diff\s+\/show ignored-2/);
  assert.match(text, /Read this session\s+✔ diff-2  · ignored-2  · verify-2/);
  const col = renderApproval(model({ run }), caps({ colorDepth: 24 })).find(l => l.includes('Ignored files'))!;
  assert.ok(col.includes('\x1b[38;2;224;175;104m◐'), 'amber: something changed outside what is approved');
  // an earlier attempt's list is not about this tree; no list, no row
  const old = renderApproval(model({ run: atCommitGate({ verify: { outcome: 'tests-green', artifacts: ['ignored-1', 'verify-2'] } }) }), caps()).join('\n');
  assert.doesNotMatch(old, /Ignored files|ignored-1/);
  assert.doesNotMatch(renderApproval(model(), caps()).join('\n'), /Ignored files/);
});

test('the plan gate lists the plan and the critique with its verdicts', () => {
  setLanguage('en');
  const run = atCommitGate(); run.steps[0].artifacts = [N('memory'), N('plan')]; run.steps[1].artifacts = [N('challenge')]; run.steps[1].outcome = N('challenged:APPROVE,CHANGES_REQUESTED');
  const text = renderApproval(model({ run, gate: 'plan', binding: 'ab'.repeat(32), acceptedRisks: [] }), caps()).join('\n');
  assert.match(text, /Plan approval/); assert.match(text, /Bound to the plan\s+abababababab/);
  assert.match(text, /Plan\s+· to read\s+\/show plan/); assert.match(text, /Critique\s+◐ APPROVE, CHANGES_REQUESTED\s+\/show challenge/);
  assert.match(text, /no accepted risk/); assert.match(text, /nothing yet/);
});

test('no escape without colour; with colour the hash is bold and every colour is closed; ASCII glyphs in ASCII', () => {
  setLanguage('en');
  assert.ok(!renderApproval(model(), caps()).join('').includes('\x1b'));
  const col = renderApproval(model(), caps({ colorDepth: 24 })).join('\n');
  assert.ok(col.includes('\x1b[1m9c1e04b7aa31\x1b[22m'), 'the 12 characters are bold');
  const ascii = renderApproval(model(), caps({ charset: 'ascii' })).join('\n');
  assert.match(ascii, /\[v\] passed/); assert.match(ascii, /\[ \] to read/); assert.doesNotMatch(ascii, /[✔◆·…]/u);
});

test('every line fits the terminal at 40..200 columns in en, fr, ja and ar, with the word of every state kept', () => {
  const run = atCommitGate(); run.steps[6].artifacts = [N('diff-2'), N('review-2')]; run.steps[4].artifacts = [N('verify-2'), N('ignored-2')];
  for (const lang of ['en', 'fr', 'ja', 'ar']) {
    setLanguage(lang);
    try {
      for (const columns of [40, 60, 80, 100, 120, 200]) {
        const lines = renderApproval(model({ run, read: new Set(['diff-2']), acceptedRisks: ['connector.write', 'network.egress'], approver: 'alice-with-a-rather-long-name' }), caps({ columns }));
        for (const l of lines) assert.ok(displayWidth(l) <= columns, `${lang}@${columns}: ${displayWidth(l)} > ${columns}: ${l}`);
        assert.ok(lines.filter(l => /✔|◐|\?/.test(l)).length >= 3, `${lang}@${columns}: the state glyphs survive`);
      }
    } finally { setLanguage('en'); }
  }
});

test('texts from outside are neutralised: artifact names, an outcome, the approver, a risk name', () => {
  setLanguage('en');
  const evil = '\u202Eevil\u001b[31m';
  const run = atCommitGate({ review: { outcome: 'review:APPROVE', artifacts: [`diff-1${evil}`] } });
  const lines = renderApproval(model({ run, read: new Set([`x${evil}`]), acceptedRisks: [`cap${evil}`], approver: `bob${evil}` }), caps());
  const text = lines.join('\n');
  assert.ok(!/[\u202E\u001b]/.test(text), 'no bidi or escape character reaches the screen');
  assert.ok(text.includes(n(`bob${evil}`)), 'the neutral form is what is shown');
});

test('an unknown run status is an unknown state in the timeline (glyph + word), never a failure', () => {
  setLanguage('en');
  const v = atCommitGate(); v.status = 'sideways'; v.steps[7].state = 'unknown';
  const line = renderTimeline(v, caps(), Date.now())[7];
  assert.match(line, /^  \? Commit approval\s+unknown/); assert.doesNotMatch(line, /failed|✖/);
});
