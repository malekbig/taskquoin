/**
 * The body of the approval screen (layout "/approve commit in the console"): what the approval is bound to, what there
 * is to read with its state (with the ignored files the agent changed, when there are), what was read in this session,
 * the policy line and the approver. Pure: a model and the caps in, lines out. It is the BODY only — the retype prompt
 * belongs to whoever asks (the console, the dashboard's form): no key approves on its own, the typed hash is the gate.
 * "Read this session" is a reminder, not a gate.
 * Every text from outside Taskquoin (artifact names, outcomes, the approver's name, risk names) is neutralised again
 * here (`n()` is idempotent); state = glyph + word; no line is wider than the terminal.
 */
import type { RunView, StepId, StepView } from '@taskquoin/application';
import type { Caps } from '../caps.ts';
import { glyph, paint, stateToken, type StateName, type Token } from '../tokens.ts';
import { cutNeutral, n, type Neutral } from '../neutral.ts';
import { displayWidth, padEndDisplay } from '../../i18n/width.ts';
import { t, tn } from '../../i18n/index.ts';

export interface ApprovalModel {
  run: RunView<Neutral>;
  gate: 'plan' | 'commit';
  /** The full hash the gate binds: the sha256 of the plan artifact, or the git tree id. */
  binding: string;
  /** Artifact names the human has shown with /show in this session. */
  read: ReadonlySet<string>;
  /** Capabilities with an accepted risk in force. */
  acceptedRisks: readonly string[];
  approver?: string;
}

type Seg = [Token | 'bold' | undefined, string];
const INDENT = 4;

/** Segments painted and clipped to `max` columns (the tail is cut with an ellipsis, never an escape). */
function line(segs: Seg[], max: number, caps: Caps): string {
  let left = max, out = '';
  for (const [tok, text] of segs) {
    if (!text) continue;
    if (left <= 0) break;
    const shown = displayWidth(text) <= left ? text : cutNeutral(text as Neutral, left, { ascii: caps.charset === 'ascii' });
    left -= displayWidth(shown);
    out += tok === 'bold' ? (caps.colorDepth > 0 ? `\x1b[1m${shown}\x1b[22m` : shown) : tok ? paint(tok, shown, caps) : shown;
  }
  return out;
}

const last = (xs: readonly string[], re: RegExp): string | undefined => xs.filter(x => re.test(x)).at(-1);
const verdictState = (v: string): StateName => (v === 'APPROVE' ? 'done' : 'risk');

interface Row { label: string; state: StateName; word: string; detail?: string; artifact?: string }

/** The artifacts to read at this gate and what the run says about each (outcomes come from history, never from the artifact text). */
function rowsOf(m: ApprovalModel): Row[] {
  const step = (id: StepId): StepView<Neutral> | undefined => m.run.steps.find(s => s.id === id);
  const toRead = (label: string, artifact: string | undefined): Row =>
    artifact ? { label, state: 'pending', word: t('approval.state.toRead'), artifact } : { label, state: 'unknown', word: t('approval.state.unknown') };
  if (m.gate === 'plan') {
    const crit = step('critique'); const verdicts = /^challenged:(.+)$/.exec(crit?.outcome ?? '')?.[1];
    const art = last(crit?.artifacts ?? [], /^challenge$/);
    return [toRead(t('approval.row.plan'), last(step('planning')?.artifacts ?? [], /^plan$/)),
      verdicts ? { label: t('approval.row.critique'), state: verdicts.split(',').every(v => v === 'APPROVE') ? 'done' : 'risk', word: verdicts.replaceAll(',', ', '), ...(art ? { artifact: art } : {}) }
        : toRead(t('approval.row.critique'), art)];
  }
  const verify = step('verify'), red = step('red-proof'), review = step('review');
  const rows: Row[] = [toRead(t('approval.row.diff'), last(review?.artifacts ?? [], /^diff-\d+$/))];
  // Ignored files the agent created, changed or removed in this attempt: not in the diff, not verified, not committed,
  // but left on disk. Amber, so the one item about what lies OUTSIDE the approval is never silently missing.
  const ignored = verify?.artifacts.find(a => a === `ignored-${m.run.attempts}`);
  if (ignored) rows.push({ label: t('approval.row.ignored'), state: 'risk', word: t('approval.state.outsideDiff'), artifact: ignored });
  const va = last(verify?.artifacts ?? [], /^verify-\d+$/);
  rows.push(verify?.outcome === 'tests-green' ? { label: t('approval.row.verify'), state: 'done', word: t('approval.state.passed'), ...(va ? { artifact: va } : {}) }
    : verify?.outcome && /^tests-red|^tree-changed/.test(verify.outcome) ? { label: t('approval.row.verify'), state: 'failed', word: t('approval.state.failed'), ...(va ? { artifact: va } : {}) }
    : { label: t('approval.row.verify'), state: 'unknown', word: t('approval.state.unknown'), ...(va ? { artifact: va } : {}) });
  const ra = last(red?.artifacts ?? [], /^red-\d+$/);
  rows.push(red?.outcome === 'red-proven' ? { label: t('approval.row.red'), state: 'done', word: t('approval.state.proven'), ...(ra ? { artifact: ra } : {}) }
    : red?.outcome?.startsWith('red-not-applicable') ? { label: t('approval.row.red'), state: 'done', word: t('approval.state.notApplicable'), ...(ra ? { artifact: ra } : {}) }
    : red?.outcome?.startsWith('red-not-proven') ? { label: t('approval.row.red'), state: 'failed', word: t('approval.state.failed'), ...(ra ? { artifact: ra } : {}) }
    : { label: t('approval.row.red'), state: 'unknown', word: t('approval.state.unknown'), ...(ra ? { artifact: ra } : {}) });
  const rv = last(review?.artifacts ?? [], /^review-\d+$/) ?? last(review?.artifacts ?? [], /^review-\d+-/);
  const verdict = /^review:([A-Z_]+)/.exec(review?.outcome ?? '')?.[1];
  rows.push(verdict ? { label: t('approval.row.review'), state: verdictState(verdict), word: verdict, ...(rv ? { artifact: rv } : {}) }
    : { label: t('approval.row.review'), state: 'unknown', word: t('approval.state.unknown'), ...(rv ? { artifact: rv } : {}) });
  return rows;
}

export function renderApproval(m: ApprovalModel, caps: Caps): string[] {
  const cols = caps.columns;
  const rows = rowsOf(m);
  const boundLabel = t(m.gate === 'plan' ? 'approval.bound.plan' : 'approval.bound.commit');
  const policyLabel = t('approval.policy.label'), readLabel = t('approval.read.label'), whoLabel = t('approval.approver.label');
  const labels = [boundLabel, policyLabel, readLabel, whoLabel, ...rows.map(r => r.label)];
  const lw = Math.min(Math.max(...labels.map(displayWidth)), Math.max(8, Math.floor(cols / 3)));
  const lab = (s: string) => padEndDisplay(displayWidth(s) > lw ? cutNeutral(s as Neutral, lw, { ascii: caps.charset === 'ascii' }) : s, lw);
  const lead: Seg = [undefined, ' '.repeat(INDENT)];
  const head = (label: string): Seg[] => [lead, ['muted', lab(label)], [undefined, '  ']];
  const out: string[] = [];

  const title = t(m.gate === 'plan' ? 'timeline.step.planApproval' : 'timeline.step.commitApproval');
  out.push(line([[undefined, '  '], [stateToken('waiting'), glyph('waiting', caps) + ' '], ['bold', title], [undefined, '  ' + `run ${n(m.run.runId.slice(-6))}`]], cols, caps));

  const full = n(m.binding), short = full.slice(0, 12);
  out.push(line([...head(boundLabel), ['bold', short], ...(full.length > 12 ? [[undefined, `   (${full.length > 20 ? full.slice(0, 20) + (caps.charset === 'utf8' ? '…' : '...') : full})`] as Seg] : [])], cols, caps));

  const used = Math.max(...rows.map(r => displayWidth(r.word)));
  for (const r of rows) {
    const body = displayWidth(glyph(r.state, caps)) + 1 + used;
    const hint = r.artifact ? `/show ${n(r.artifact)}` : '';
    const showHint = hint && INDENT + lw + 2 + body + 2 + displayWidth(hint) <= cols;
    out.push(line([...head(r.label), [stateToken(r.state), glyph(r.state, caps)], [undefined, ' '], [stateToken(r.state), padEndDisplay(r.word, used)],
      ...(showHint ? [[undefined, '  ' + hint] as Seg] : [])], cols, caps));
  }

  const risks = m.acceptedRisks.map(x => n(x));
  out.push(line([...head(policyLabel), [undefined, t('approval.policy.agentsNeverCommit') + (caps.charset === 'utf8' ? ' · ' : ' | ')],
    [risks.length ? 'amber' : undefined, risks.length ? tn('approval.policy.risk', risks.length, { list: risks.join(', ') }) : t('approval.policy.noRisk')]], cols, caps));

  const names = rows.flatMap(r => (r.artifact ? [r.artifact] : []));
  const read = [...m.read].map(x => n(x));
  const items: Seg[] = (read.length ? [...names.map(x => n(x)), ...read.filter(x => !names.includes(x))] : []).flatMap((x, i): Seg[] =>
    [[undefined, i ? '  ' : ''], read.includes(x) ? [stateToken('done'), glyph('done', caps) + ' '] : [undefined, glyph('pending', caps) + ' '], [undefined, x]]);
  out.push(line([...head(readLabel), ...(items.length ? items : [[undefined, t('approval.read.none')] as Seg])], cols, caps));

  if (m.approver) { out.push(''); out.push(line([...head(whoLabel), [undefined, t('approval.approver.value', { name: n(m.approver) })]], cols, caps)); }
  return out;
}
