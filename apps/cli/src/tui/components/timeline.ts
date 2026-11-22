/**
 * The run's timeline (layout "During /run"): one line per step of the real state machine, from a RunView — never a
 * progress bar, never a percentage. State = glyph + word; times are the state machine's (local clock); what is not
 * recorded is `?`. `timelineLine` is the append-only form: one line per event, for a pipe or a console run.
 * Every string from outside Taskquoin (agent, runtime, model, outcome, artifact names) is neutralised here, as a
 * parameter — never a whole translated message — and cut to the terminal width AFTER that.
 */
import type { RunView, StepId, StepView } from '@taskquoin/application';
import { t } from '../../i18n/index.ts';
import { displayWidth, padEndDisplay } from '../../i18n/width.ts';
import { clock, cut as textCut, duration } from '../text.ts';
import type { Caps } from '../caps.ts';
import { n } from '../neutral.ts';
import { glyph, paint, stateToken, type StateName } from '../tokens.ts';

const LABEL: Record<StepId, () => string> = {
  planning: () => t('timeline.step.planning'), critique: () => t('timeline.step.critique'), 'plan-approval': () => t('timeline.step.planApproval'),
  implementation: () => t('timeline.step.implementation'), verify: () => t('timeline.step.verify'), 'red-proof': () => t('timeline.step.redProof'),
  review: () => t('timeline.step.review'), 'commit-approval': () => t('timeline.step.commitApproval'), commit: () => t('timeline.step.commit'),
};

const valid = (iso: string | undefined): number | undefined => { const ms = iso ? Date.parse(iso) : NaN; return Number.isFinite(ms) ? ms : undefined; };
/** An already neutral string cut to `max` columns, no ellipsis (the callers have already made room for what follows). */
const cut = (s: string, max: number): string => textCut(s, max, '');
const arrow = (caps: Caps) => (caps.charset === 'utf8' ? '→' : '->');
const bar = (caps: Caps) => (caps.charset === 'utf8' ? '│' : '|');

/** Glyph state and the word that always travels with it (AC-3: state = glyph + word, never dropped). */
function stateOf(view: RunView, s: StepView, live: boolean): { name: StateName; word: string } {
  switch (s.state) {
    case 'pending': return { name: 'pending', word: t('timeline.state.pending') };
    case 'done': return { name: 'done', word: t('timeline.state.done') };
    case 'running': return live ? { name: 'running', word: t('timeline.state.running') } : { name: 'unknown', word: t('dashboard.status.notRunning') };
    case 'waiting': return { name: 'waiting', word: t('timeline.state.waiting') };
    case 'unknown': return { name: 'unknown', word: t('timeline.state.unknown') }; // a status this projection does not know: never a failure
    default:
      return view.status === 'interrupted' ? { name: 'interrupted', word: t('timeline.state.interrupted') }
        : view.status === 'needs-human' ? { name: 'failed', word: t('timeline.state.needsHuman') } : { name: 'failed', word: t('timeline.state.failed') };
  }
}
const attemptState = (outcome: string): StateName =>
  outcome === 'running' ? 'running' : /rework|^(failed|needs-human|interrupted)$/.test(outcome) ? 'failed' : 'done';
const WORD: Partial<Record<StateName, () => string>> = { running: () => t('timeline.state.running'), failed: () => t('timeline.state.failed'), done: () => t('timeline.state.done') };

/**
 * The state word (`must`) is never dropped. Optional columns go from the right until the line fits (hint, then
 * duration, end time, agent · runtime); the label is cut last, to what the glyph and the word leave.
 */
function fit(lead: string, label: string, must: string, cols: string[], max: number): { label: string; cols: string[] } {
  let keep = cols.filter(c => c !== '');
  const width = (l: string, cs: string[]) => displayWidth(lead) + displayWidth(l) + 2 + displayWidth(must) + cs.reduce((a, c) => a + 2 + displayWidth(c), 0);
  while (keep.length && width(label, keep) > max) keep = keep.slice(0, -1);
  return { label: width(label, keep) > max ? cut(label, Math.max(0, max - displayWidth(lead) - 2 - displayWidth(must))) : label, cols: keep };
}

export interface TimelineOptions {
  /** `/show x` (console) or `show x` (command line) in artifact hints. */ slash?: boolean;
  /** `false` drops the `/show …` hints (the dashboard has its own keys); default true. */ hints?: boolean;
  /** `false`: the process of the run is not alive, so a running step is shown `?` "not running?" with no elapsed time; default true. */ live?: boolean;
  /** `false`: a step in progress shows the clock time it began, never an elapsed time that would go stale; default true. */ elapsed?: boolean;
}

export function renderTimeline(view: RunView, caps: Caps, now: number, o: TimelineOptions = {}): string[] {
  const show = o.slash === false ? 'show' : '/show';
  const hints = o.hints !== false, live = o.live !== false, elapsed = o.elapsed !== false;
  const labels = view.steps.map(s => LABEL[s.id]());
  const lw = Math.min(Math.max(...labels.map(displayWidth)), Math.max(8, Math.floor(caps.columns / 3)));
  const lines: string[] = [];
  view.steps.forEach((s, i) => {
    const st = stateOf(view, s, live);
    const lead = `  ${glyph(st.name, caps)} `;
    const who = s.agent ? `${n(s.agent)}${s.runtime ? ` · ${n(s.runtime)}` : ''}` : '';
    const main = s.artifacts.find(a => a === 'plan' || a === 'challenge'); // `memory`, `challenge-<judge>` are for /show to list
    const att = s.attempts.length > 1 ? t('timeline.attempt', { n: s.attempts.length }) : '';
    const hint = s.attempts.length ? (hints && s.attempts.at(-1)!.artifact ? `${show} ${n(s.attempts.at(-1)!.artifact!)}` : '')
      : s.state === 'waiting' && view.pending ? view.pending.binding.slice(0, 12)
      : s.state === 'done' && main && hints ? `${show} ${main}` : '';
    let at = '', took = '';
    if (s.state === 'done' || (s.state === 'failed' && s.endedAt)) { at = clock(s.endedAt); took = duration(s.durationMs); }
    else if (s.state === 'running' && !live) { /* a dead process: no start-to-now figure that keeps growing */ }
    else if (s.state === 'running' || s.state === 'waiting' || s.state === 'failed') {
      const from = valid(s.startedAt);
      if (elapsed) took = from === undefined ? '?' : duration(now - from);
      else at = clock(s.startedAt);
    }
    const label = padEndDisplay(labels[i], lw);
    // A pending step has no agent, time or hint yet: glyph, name and word.
    const f = fit(lead, label, st.word, [who, at, took, att, hint], caps.columns);
    lines.push(`  ${paint(stateToken(st.name), glyph(st.name, caps), caps)} ${f.label}  ${paint(stateToken(st.name), st.word, caps)}${f.cols.map(c => '  ' + c).join('')}`);
    // A retry is nested under the step it repeats; the last attempt is the step's own line.
    for (const a of s.attempts.slice(0, -1)) {
      const as = attemptState(a.outcome);
      const word = WORD[as]!();
      const l = `    ${bar(caps)} ${glyph(as, caps)} `;
      const text = fit(l, t('timeline.attempt', { n: a.n }), word, [n(a.outcome), hints && a.artifact ? `${show} ${n(a.artifact)}` : ''], caps.columns);
      lines.push(`    ${bar(caps)} ${paint(stateToken(as), glyph(as, caps), caps)} ${text.label}  ${paint(stateToken(as), word, caps)}${text.cols.map(c => '  ' + c).join('')}`);
    }
  });
  return lines;
}

/** One append-only line for an event of the run; undefined for the events that are not progress. */
export function timelineLine(event: Record<string, unknown>, caps: Caps): string | undefined {
  const s = (k: string): string => (typeof event[k] === 'string' && event[k] !== '' ? n(event[k] as string) : '?');
  const num = (k: string): string => (typeof event[k] === 'number' ? String(event[k]) : '?');
  let state: StateName, text: string;
  switch (event.type) {
    case 'node.transition': state = 'done'; text = `${s('node')}  ${s('outcome')}  ${arrow(caps)}  ${s('next')}`; break;
    case 'agent.started': state = 'running'; text = t('timeline.p.started', { agent: s('agent'), runtime: s('runtime') }); break;
    case 'agent.finished': {
      const ok = event.status === 'completed';
      state = ok ? 'done' : 'failed';
      const ms = typeof event.durationMs === 'number' ? duration(event.durationMs) : '?';
      const model = typeof event.model === 'string' && event.model !== '' ? ` · ${n(event.model)}` : '';
      text = t(ok ? 'timeline.p.finished' : 'timeline.p.finishedFailed', { agent: s('agent'), runtime: s('runtime'), duration: ms, status: s('status') }) + model;
      break;
    }
    case 'verify.result': state = event.passed === true ? 'done' : 'failed'; text = t(event.passed === true ? 'timeline.p.verifyPassed' : 'timeline.p.verifyFailed', { n: num('attempt'), code: num('exitCode') }); break;
    case 'red.result':
      state = event.redFailed === true ? 'done' : event.redFailed === false ? 'failed' : 'unknown';
      text = t(event.redFailed === true ? 'timeline.p.redProven' : event.redFailed === false ? 'timeline.p.redNotProven' : 'timeline.p.redInconclusive', { n: num('attempt') });
      break;
    default: return undefined;
  }
  const at = typeof event.ts === 'string' && valid(event.ts) !== undefined ? `${clock(event.ts)}  ` : '';
  const lead = `  ${glyph(state, caps)} `;
  return `  ${paint(stateToken(state), glyph(state, caps), caps)} ${cut(at + text, Math.max(1, caps.columns - displayWidth(lead)))}`;
}
