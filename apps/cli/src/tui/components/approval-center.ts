/**
 * The approval center (layouts.md "Approval center" and "Stale artifact"): the body of the approval screen (R2's
 * renderApproval, reused — what is bound, what to read, what was read, policy, approver), the Status line (waiting
 * since, re-read time, unchanged / changed), the one field being typed, and the reminder that no key approves.
 * Exactly `height` lines, each within `caps.columns`; a panel from 80 columns, the borderless section below. When the
 * terminal is short, lines go in a fixed order (blank lines, read / policy / reason, the artifact rows, the title,
 * the approver) and the hash, the field and the reminder stay. Texts from outside arrive neutral and are
 * neutralised again (idempotent); the 12-character hash is bold; state = glyph + word. Pure.
 */
import { t, tn } from '../../i18n/index.ts';
import { displayWidth } from '../../i18n/width.ts';
import type { RunView } from '@taskquoin/application';
import type { CenterContext, FormStep, Gate } from '../../dashboard-approve.ts';
import type { Caps } from '../caps.ts';
import { n, type Neutral } from '../neutral.ts';
import { bold, ellipsis, glyph, mark, paint, stateToken, type Token } from '../tokens.ts';
import { clip, clock, cut, pad, wrap } from '../text.ts';
import { renderApproval, type ApprovalSeg } from './approval.ts';
import { panel, section } from './panel.ts';

/** What the separate `taskquoin approve` process has done so far (Task 9); absent before anything was started. */
export type Outcome =
  | { kind: 'started'; pid: number }
  | { kind: 'approved'; pid: number; as: string; at: string }
  | { kind: 'refused'; exit: string; tail: string[] }
  | { kind: 'failed'; message: string };

export interface CenterRender extends CenterContext { gate: Gate; approver?: string; reReadAt?: string; outcome?: Outcome }

interface L { text: string; p: number }
const MAX_WIDTH = 100;

/** Keep `max` lines: drop the lowest priority first (the last of equals first), keep the order. */
function fitLines(lines: L[], max: number): string[] {
  const keep = lines.slice();
  while (keep.length > Math.max(0, max)) {
    let at = 0;
    for (let i = 0; i < keep.length; i++) if (keep[i]!.p <= keep[at]!.p) at = i;
    keep.splice(at, 1);
  }
  return keep.map((l) => l.text);
}

/** A translated sentence for this charset: in ASCII its typographic marks become their ASCII twins. */
const ascii = (s: string, caps: Caps): string => (caps.charset === 'utf8' ? s : s.replaceAll('·', '-').replaceAll('—', '-').replaceAll('…', '...').replaceAll('→', '->'));

const waitingStart = (view: RunView): string | undefined => view.steps.find((s) => s.state === 'waiting')?.startedAt;

/** `label: text█` within `width`: the typed text and the caret stay, the label is cut first. */
function field(label: string, text: string, width: number, caps: Caps): string {
  const typed = n(text), caret = mark('caret', caps);
  const room = width - 2 - displayWidth(typed) - displayWidth(caret);
  const lab = room >= 4 ? cut(label, room, ellipsis(caps)) : '';
  return clip(`  ${lab}${typed}${paint('mint', caret, caps)}`, width);
}

const para = (text: string, width: number, p: number, caps: Caps, style: (s: string) => string = (s) => s): L[] =>
  wrap(ascii(text, caps), Math.max(1, width - 2)).map((l) => ({ text: '  ' + style(l), p }));

/** The approval body (R2's renderer) with the dashboard's rows: priorities by what each line is. */
function bodyOf(f: FormStep, ctx: CenterRender, binding: string | undefined, width: number, caps: Caps): L[] {
  if (binding === undefined) return [];
  const sep = ` ${mark('sep', caps)} `;
  const extra: { label: string; segs: ApprovalSeg[] }[] = [];
  if (ctx.view.reason) extra.push({ label: t('dashboard.center.reasonLabel'), segs: [[undefined, n(ctx.view.reason)]] });
  if (f.step === 'name' || f.step === 'hash') {
    const segs: ApprovalSeg[] = [[stateToken('waiting'), `${glyph('waiting', caps)} `], [undefined, ascii(t('dashboard.center.waitingSince', { time: clock(waitingStart(ctx.view)) }), caps)]];
    if (f.step === 'hash' && ctx.reReadAt) {
      segs.push([undefined, sep + ascii(t('dashboard.center.reRead', { time: clock(ctx.reReadAt) }), caps) + ' ']);
      segs.push(f.changed ? [stateToken('failed'), `${glyph('failed', caps)} ${ascii(t('dashboard.center.changed'), caps)}`] : [stateToken('done'), `${glyph('done', caps)} ${ascii(t('dashboard.center.unchanged'), caps)}`]);
    }
    extra.push({ label: t('dashboard.center.statusLabel'), segs });
  }
  const lines = renderApproval({ run: ctx.view as RunView<Neutral>, gate: ctx.gate, binding, read: ctx.read, acceptedRisks: ctx.acceptedRisks,
    ...(ctx.approver !== undefined ? { approver: ctx.approver } : {}), surface: 'dashboard', request: ctx.request, extra }, { ...caps, columns: width });
  const rows = ctx.gate === 'plan' ? 2 : 4;
  const expected = [3, 10, ...Array<number>(rows).fill(2), 1, 1, ...(ctx.approver !== undefined || extra.length ? [0] : []), ...(ctx.approver !== undefined ? [4] : []), ...extra.map((e) => (e.label === t('dashboard.center.statusLabel') ? 6 : 1))];
  const short = n(binding).slice(0, 12);
  return lines.map((text, i) => ({ text, p: lines.length === expected.length ? expected[i]! : text.includes(short) ? 10 : 2 }));
}

function outcomeLines(f: Extract<FormStep, { step: 'sent' }>, o: CenterRender['outcome'], width: number, caps: Caps): L[] {
  const head = (state: 'running' | 'done' | 'failed', text: string, p = 9): L[] =>
    wrap(`${glyph(state, caps)} ${ascii(text, caps)}`, Math.max(1, width - 2)).map((l, i) => ({ text: '  ' + (i === 0 ? paint(stateToken(state), l, caps) : l), p }));
  if (!o) return head('running', t('dashboard.center.sent', { as: n(f.as) }));
  switch (o.kind) {
    case 'started': return head('running', t('dashboard.center.started', { pid: o.pid }));
    case 'approved': return head('done', t('dashboard.center.approved', { as: n(o.as), time: clock(o.at), pid: o.pid }));
    case 'refused': return [...head('failed', t('dashboard.center.refused', { exit: n(o.exit) })),
      ...o.tail.map((l) => ({ text: '    ' + paint('muted', cut(n(l), Math.max(1, width - 4), ellipsis(caps)), caps), p: 5 })),
      ...para(t('dashboard.center.nothing'), width, 9, caps)];
    case 'failed': return [...head('failed', t('dashboard.center.notStarted', { message: n(o.message) })), ...para(t('dashboard.center.nothing'), width, 9, caps)];
  }
}

function staleLines(f: Extract<FormStep, { step: 'stale' }>, ctx: CenterRender, width: number, caps: Caps): L[] {
  const headline = !f.now || f.now.gate !== ctx.gate ? t('dashboard.center.staleGone', { gate: ctx.gate }) : t(ctx.gate === 'commit' ? 'dashboard.center.staleTree' : 'dashboard.center.stalePlan');
  const out: L[] = wrap(`${glyph('failed', caps)} ${ascii(headline, caps)}`, Math.max(1, width - 2)).map((l, i) => ({ text: '  ' + (i === 0 ? paint('red', l, caps) : l), p: 10 }));
  out.push({ text: '', p: 0 });
  const lw = Math.max(displayWidth(t('dashboard.center.shownLabel')), displayWidth(t('dashboard.center.waitingLabel')));
  const row = (label: string, hash: string, rest: string): L => ({ text: clip(`  ${paint('muted', pad(label, lw), caps)}  ${bold(n(hash).slice(0, 12), caps)}   ${rest}`, width), p: 9 });
  out.push(row(t('dashboard.center.shownLabel'), f.shown.binding, ascii(t('dashboard.center.shownAt', { time: clock(f.shown.at) }), caps)));
  if (f.now) {
    const when = clock(f.now.at);
    out.push(row(t('dashboard.center.waitingLabel'), f.now.binding, f.now.gate === 'commit' ? ascii(t('dashboard.center.reverified', { time: when }), caps) : ascii(t('dashboard.center.replanned', { time: when }), caps)));
  } else out.push({ text: clip(`  ${paint('muted', pad(t('dashboard.center.waitingLabel'), lw), caps)}  ${ascii(t('dashboard.center.none'), caps)}`, width), p: 9 });
  out.push({ text: '', p: 0 });
  out.push(...para(t(ctx.gate === 'commit' ? 'dashboard.center.readDiff' : 'dashboard.center.readPlan'), width, 9, caps));
  return out;
}

export function renderApprovalCenter(f: FormStep, ctx: CenterRender, caps: Caps, height: number): string[] {
  const rows = Math.max(0, height);
  if (rows === 0) return [];
  const narrow = caps.columns < 80;
  const w = narrow ? caps.columns : Math.min(caps.columns, MAX_WIDTH);
  const inner = narrow ? w : w - 4;
  const back = (): L[] => para(t('dashboard.center.back'), inner, 7, caps, (s) => paint('muted', s, caps));
  let body: L[] = [];
  switch (f.step) {
    case 'not-waiting': body = [...para(t('dashboard.center.notWaiting'), inner, 10, caps, (s) => paint('amber', s, caps)), { text: '', p: 0 }, ...back()]; break;
    case 'cancelled': body = [...para(t('dashboard.center.cancelled'), inner, 10, caps), { text: '', p: 0 }, ...back()]; break;
    case 'stale': body = [...staleLines(f, ctx, inner, caps), { text: '', p: 0 }, ...back()]; break;
    case 'sent': body = [...bodyOf(f, ctx, f.shown.binding, inner, caps), { text: '', p: 0 }, ...outcomeLines(f, ctx.outcome, inner, caps), { text: '', p: 0 }, ...back()]; break;
    case 'name': case 'hash': {
      const pending = ctx.view.pending && ctx.view.pending.gate === ctx.gate ? ctx.view.pending.binding : undefined;
      const binding = f.step === 'hash' ? f.shown.binding : pending;
      body = bodyOf(f, ctx, binding, inner, caps);
      body.push({ text: '', p: 0 });
      body.push({ text: field(ascii(t(f.step === 'name' ? 'dashboard.center.name' : 'dashboard.center.retype'), caps), f.text, inner, caps), p: 10 });
      if (f.error) body.push(...para(t(`dashboard.center.error.${f.error}`), inner, 8, caps, (s) => paint(f.error === 'mismatch' || f.error === 'controls' ? 'red' : 'amber', s, caps)));
      body.push({ text: '', p: 0 });
      body.push(...para(t('dashboard.center.keys'), inner, 7, caps, (s) => paint('muted', s, caps)));
      break;
    }
  }
  const right = f.step === 'stale' ? t('dashboard.center.stale') : ctx.waiting > 0 ? tn('dashboard.frame.waitingCount', ctx.waiting) : undefined;
  const title = ascii(t('dashboard.center.title'), caps);
  let out: string[];
  if (narrow) {
    out = section({ title, ...(right ? { right } : {}), body: fitLines(body, rows - 1), width: w, height: rows }, caps);
  } else {
    const shown = fitLines(body, rows - 2);
    const boxed = panel({ title, ...(right ? { right } : {}), body: shown, width: w, height: Math.min(rows, shown.length + 2), focused: true }, caps);
    const indent = ' '.repeat(Math.floor((caps.columns - w) / 2));
    out = boxed.map((l) => indent + l);
  }
  while (out.length < rows) out.push('');
  return out.slice(0, rows).map((l) => clip(l, caps.columns));
}
