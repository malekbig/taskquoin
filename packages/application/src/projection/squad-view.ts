/**
 * The squad as the console shows it, and the one definition of "ready" the banner and `doctor` share.
 * Pure: no I/O, no clock, no environment, no translation. Names and details are RAW here (`SquadMember<string>`): a
 * skill error, a gate message or an agent id come from files and config. Each member says what its note is about as
 * a code (`noteKind`) with its raw part (`detail`), and names its agent: a screen never prints the projection itself —
 * the CLI's `shownSquad()` (apps/cli/src/tui/view.ts) says the role and the note in the user's language, neutralises
 * only the raw parts (never a translated message), into `SquadMember<Neutral>`, with the count of marked characters.
 * `role` and `note` are the same in the injected labels' words (English when none are injected).
 */
export interface GateVerdict {
  ok: boolean;
  runtimeFound: boolean;
  failures: { message: string }[];
  acceptedRisks: { capability: string }[];
  /** Errors resolving the agent's approved skills: an agent that cannot load them is refused. */
  skillErrors?: string[];
}

/** An agent can run only when its gate certifies it, its runtime is installed and every skill loads. */
export const isReady = (g: GateVerdict): boolean => g.ok && g.runtimeFound && !(g.skillErrors?.length);

/**
 * What a member's note is about: its runtime is not installed, its gate refused it, a skill does not load, it runs
 * with accepted risks, or (Taskquoin's own tester) the sandbox is unavailable.
 */
export type SquadNoteKind = 'absent' | 'failure' | 'skill' | 'risks' | 'tester';

/** `S` is the type of the free text: `string` as projected (raw), `Neutral` once the CLI has neutralised it. */
export interface SquadMember<S extends string = string> {
  role: S; who: S; state: 'ready' | 'risk' | 'blocked'; note?: S;
  /** The agent's id in the config; absent only for Taskquoin's own tester (Verify in its sandbox). */
  agent?: S;
  /** The note as a code, and its raw part: the runtime, the gate's short reason, the skill error, the risky capabilities. */
  noteKind?: SquadNoteKind; detail?: S;
  /** The runtime name alone (`claude`, `api`, `bubblewrap` for the Tester), without the composite `who`. */
  runtime?: S;
}

/** Display words injected by the caller (the application layer knows no language). */
export interface SquadLabels {
  role(id: string): string;
  absent(runtime: string): string;
  testerRole: string;
  testerUnavailable: string;
}

const upperFirst = (id: string): string => (id ? id[0].toUpperCase() + id.slice(1) : id);
const DEFAULT_LABELS: SquadLabels = { role: upperFirst, absent: (rt) => `${rt} not found`, testerRole: 'Tester', testerUnavailable: 'bubblewrap unavailable' };

export function projectSquad(
  agents: Record<string, { runtime: string; provider?: string; model?: string }>,
  verdict: (id: string) => GateVerdict,
  testerReady: boolean,
  labels: SquadLabels = DEFAULT_LABELS,
): SquadMember<string>[] {
  const squad: SquadMember[] = Object.entries(agents).map(([id, a]) => {
    const g = verdict(id);
    const state: SquadMember['state'] = !isReady(g) ? 'blocked' : g.acceptedRisks.length ? 'risk' : 'ready';
    let kind: SquadNoteKind | undefined, detail: string | undefined;
    if (!g.runtimeFound) { kind = 'absent'; detail = a.runtime; }
    else if (!g.ok) { kind = 'failure'; detail = (g.failures[0]?.message ?? '').split(' — ')[0]; }
    else if (g.skillErrors?.length) { kind = 'skill'; detail = g.skillErrors[0]; }
    else if (g.acceptedRisks.length) { kind = 'risks'; detail = g.acceptedRisks.map(r => r.capability).join(', '); }
    const note = kind === 'absent' ? labels.absent(a.runtime) : detail;
    const who = `${id} · ${a.runtime === 'api' ? `api:${a.provider ?? ''}` : a.runtime === 'opencode' ? `opencode:${(a.model ?? '').split('/')[0]}` : a.runtime}`;
    return { role: labels.role(id), who, state, agent: id, runtime: a.runtime, ...(note ? { note, noteKind: kind, detail } : {}) };
  });
  squad.push(testerReady ? { role: labels.testerRole, who: 'verify · bubblewrap', state: 'ready', runtime: 'bubblewrap' }
    : { role: labels.testerRole, who: 'verify · bubblewrap', state: 'blocked', runtime: 'bubblewrap', note: labels.testerUnavailable, noteKind: 'tester' });
  return squad;
}
