/**
 * The single choke point between a projection and a screen (ADR-0019 decision 3, untrusted-text rules 1 and 2).
 * RunView and SquadMember come out of the application RAW (`<string>`): their free text was written by agents, git,
 * config or files. The console and the dashboard call these adapters once, where they read the store or the config,
 * and hand the `<Neutral>` view they return to renderers, which accept only that. `marked` counts the characters made
 * visible in the view, so the screen can say how many there were.
 * - shownRun: every string of the view goes through the one-line strict profile, enum words and times included
 *   (ASCII, they come out unchanged): a field added to the projection later is neutralised without anyone having to
 *   remember it.
 * - shownSquad: parameters, not messages — the role and the note are said in the user's language from the
 *   projection's codes, and only their raw parts (agent id, runtime, gate reason, skill error, capabilities) are
 *   neutralised: a translated message keeps its own ZWNJ/ZWJ.
 */
import type { RunView, SquadMember } from '@taskquoin/application';
import { t } from '../i18n/index.ts';
import { cutNeutral, neutralize, type Neutral } from './neutral.ts';

export interface Shown<T> { view: T; marked: number }

/** A copy of plain data (objects, arrays, scalars) with every string neutralised; `marked` summed over all of them. */
function neutralizeAll(value: unknown): { value: unknown; marked: number } {
  let marked = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') { const r = neutralize(v, { singleLine: true }); marked += r.marked; return r.text; }
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value), marked };
}

/** A run as a screen may show it: every free-text field neutralised, once. */
export function shownRun(v: RunView<string>): Shown<RunView<Neutral>> {
  const r = neutralizeAll(v);
  return { view: r.value as RunView<Neutral>, marked: r.marked };
}

const ROLE = { planner: 'console.role.planner', implementer: 'console.role.implementer', challenger: 'console.role.challenger', security: 'console.role.security' } as const;
/** Taskquoin's own words (a translated label or message): trusted text, never marked (parameters, not messages). */
const own = (text: string): Neutral => text as Neutral;
/** A blocked member's reason is cut to this many columns, once, after neutralising (a marker is never split). */
const NOTE_COLUMNS = 70;

/**
 * The squad as a screen may show it: a known role and every note code in the user's language, the agent id, runtime,
 * gate reason, skill error and capabilities neutralised (one-line strict profile), a blocked member's reason cut.
 * `marked` counts the characters marked in what a screen prints of a member: its role, `who` and note. The raw
 * `detail` is not carried (the note says it); `agent` is, neutralised, for a screen that keys its rows by agent.
 */
export function shownSquad(squad: readonly SquadMember<string>[]): Shown<SquadMember<Neutral>[]> {
  let marked = 0;
  const raw = (text: string): Neutral => { const r = neutralize(text, { singleLine: true }); marked += r.marked; return r.text; };
  const view = squad.map((m): SquadMember<Neutral> => {
    const role = m.agent === undefined ? own(t('console.role.tester'))
      : Object.hasOwn(ROLE, m.agent) ? own(t(ROLE[m.agent as keyof typeof ROLE])) : raw(m.agent ? m.agent[0].toUpperCase() + m.agent.slice(1) : m.agent);
    const cut = (text: Neutral) => (m.state === 'blocked' ? cutNeutral(text, NOTE_COLUMNS) : text);
    let note: Neutral | undefined;
    switch (m.noteKind) {
      case 'absent': note = own(t('console.squad.absent', { runtime: raw(m.detail ?? '') })); break;
      case 'tester': note = own(t('console.squad.testerUnavailable')); break;
      case undefined: note = m.note === undefined ? undefined : cut(raw(m.note)); break; // no code: all of it is raw
      default: note = cut(raw(m.detail ?? m.note ?? ''));
    }
    return {
      role, who: raw(m.who), state: m.state, ...(m.agent !== undefined ? { agent: neutralize(m.agent, { singleLine: true }).text } : {}),
      ...(note ? { note } : {}), ...(m.noteKind ? { noteKind: m.noteKind } : {}),
    };
  });
  return { view, marked };
}
