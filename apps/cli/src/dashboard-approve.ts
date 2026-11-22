/**
 * The dashboard's approval form (skill rule 1, "approvals are typed, never pressed"; ADR-0015 unchanged). No key
 * approves: the form only collects what the human types and hands it, once, to the existing `approve` path — the
 * 12 characters typed go to `--expect`, the name is recorded as `<name> (via taskquoin dashboard)`.
 *  - Nothing typed before the form is on screen counts: `typeAhead()` drops it, and `key()` before `open()` too.
 *  - Each `key(chunk)` is one input event. Only a chunk holding a single Enter submits; a paste or a chunk of several
 *    keys (type-ahead, an unbracketed paste) appends its text and never submits.
 *  - The binding is read again when the form opens, when the hash step starts and after the last keystroke (the
 *    submitting Enter): absent, another gate or another hash refuses (`stale`) and nothing is approved.
 *  - Esc and Ctrl+C cancel while something is being typed; after `sent` they only close the view (an approval may
 *    already be recorded: the screen never says "nothing was approved" then).
 * The name is trimmed and capped at 64 characters, kept in memory by the caller (`onName`), never read from the OS.
 *
 * The approval itself is the existing CLI path, in its own process (spec §6): `spawnApprove` starts
 * `taskquoin approve <run> <gate> --expect <typed> --as "<name> (via taskquoin dashboard)"` detached, its output in a
 * private log file (never a pipe: quitting the dashboard must not kill the run with EPIPE). Whether it approved is
 * what the control store records (`approvalRecorded`), never its exit code.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import { closeSync, fstatSync, mkdtempSync, openSync, readSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunState, RunView } from '@taskquoin/application';
import type { Caps } from './tui/caps.ts';
import { keyDecoder, type Key } from './tui/keys.ts';
import { neutralize } from './tui/neutral.ts';
import { renderApprovalCenter, type Outcome } from './tui/components/approval-center.ts';

export type Gate = 'plan' | 'commit';
/** What the store says the run waits for, read now. `at`: when it started waiting (the last history entry). */
export interface Pending { gate: Gate; binding: string; at?: string }
export type Shown = { binding: string; at: string };
export type FormStep = { step: 'not-waiting' } | { step: 'name'; text: string; error?: 'slash' | 'controls' }
  | { step: 'hash'; shown: Shown; text: string; error?: 'mismatch' | 'controls'; changed?: boolean }
  | { step: 'stale'; shown: Shown; now?: Pending } | { step: 'cancelled' } | { step: 'sent'; shown: Shown; as: string };
/** What the centre shows around the form: the run (neutral), its request, what was read this session, the risks in force, how many runs wait. */
export interface CenterContext { view: RunView; request: string; read: Set<string>; acceptedRisks: string[]; waiting: number }

export const VIA_DASHBOARD = ' (via taskquoin dashboard)';
export const NAME_MAX = 64;
export const HASH_LEN = 12;

const PASTE_START = '\x1b[200~', PASTE_END = '\x1b[201~';
const chars = (s: string): string[] => [...s];
/** The name as recorded: trimmed, at most 64 characters (code points). */
export const cleanName = (s: string): string => chars(s.trim()).slice(0, NAME_MAX).join('').trim();

export interface ApprovalForm {
  open(): void;
  typeAhead(chunk: string): void;
  key(chunk: string): Promise<void>;
  refresh(): void;
  state(): FormStep;
  /** The approver this form records (undefined until the name step is done). */
  approver(): string | undefined;
  render(caps: Caps, height?: number, outcome?: Outcome): string[];
}

export function approvalForm(o: {
  runId: string; gate: Gate; approver?: string;
  pending: () => Pending | undefined;
  approve: (runId: string, gate: Gate, expect: string, as: string) => unknown;
  onName?: (name: string) => void;
  context: () => CenterContext;
  now?: () => Date;
}): ApprovalForm {
  const now = o.now ?? ((): Date => new Date());
  const decoder = keyDecoder();
  let opened = false;
  let step: FormStep = { step: 'not-waiting' };
  // A name the session kept: only one that could have been typed (no control, bidi or invisible character); else asked again.
  const given = o.approver !== undefined && neutralize(o.approver, { singleLine: true }).marked === 0 ? cleanName(o.approver) : '';
  let name = given !== '' && !given.startsWith('/') ? given : undefined;
  let reReadAt: string | undefined;
  let sentOnce = false;
  let dropPaste = false; // a bracketed paste begun before the form was on screen: its end is dropped too

  const same = (p: Pending | undefined, shown: Shown): boolean => p !== undefined && p.gate === o.gate && p.binding === shown.binding;
  /** The hash step, from a binding read now. */
  const toHash = (): FormStep => {
    const p = o.pending();
    reReadAt = now().toISOString();
    if (!p || p.gate !== o.gate) return { step: 'not-waiting' };
    return { step: 'hash', shown: { binding: p.binding, at: reReadAt }, text: '' };
  };

  const nameKey = (s: Extract<FormStep, { step: 'name' }>, k: Key, multi: boolean): FormStep => {
    const { error: _e, ...plain } = s;
    // the field never starts with a space and holds at most 64 characters: what is kept is what is recorded
    const append = (text: string): FormStep => ({ ...plain, text: chars((s.text + text).trimStart()).slice(0, NAME_MAX).join('') });
    switch (k.name) {
      case 'char': return append(k.ch);
      case 'paste': {
        if (dropPaste) { dropPaste = false; return s; }
        if (neutralize(k.text, { singleLine: true }).marked > 0) return { ...plain, error: 'controls' };
        return append(k.text);
      }
      case 'backspace': return { ...plain, text: chars(s.text).slice(0, -1).join('') };
      case 'unknown': return k.seq.startsWith('\x1b') ? s : { ...plain, error: 'controls' };
      case 'enter': {
        if (multi) return s; // an Enter inside a chunk of several keys never submits
        const typed = cleanName(s.text);
        if (typed === '') return { step: 'cancelled' };
        if (typed.startsWith('/')) return { step: 'name', text: '', error: 'slash' };
        name = typed;
        o.onName?.(typed);
        return toHash();
      }
      default: return s;
    }
  };

  let handed: unknown; // what approve() returned, awaited by key() once the state is `sent`
  const hashKey = (s: Extract<FormStep, { step: 'hash' }>, k: Key, multi: boolean): FormStep => {
    const { error: _e, ...plain } = s;
    const append = (text: string): FormStep => ({ ...plain, text: chars(s.text + text).slice(0, HASH_LEN).join('') });
    switch (k.name) {
      case 'char': return append(k.ch);
      case 'paste': {
        if (dropPaste) { dropPaste = false; return s; }
        const text = k.text.replace(/[\r\n]/g, '').trim();
        if (neutralize(text, { singleLine: true }).marked > 0) return { ...plain, error: 'controls' };
        return append(text);
      }
      case 'backspace': return { ...plain, text: chars(s.text).slice(0, -1).join('') };
      case 'unknown': return k.seq.startsWith('\x1b') ? s : { ...plain, error: 'controls' };
      case 'enter': {
        if (multi) return s;
        const typed = s.text.trim().toLowerCase();
        if (typed === '') return { step: 'cancelled' };
        // after the last keystroke: what is approved is what was shown, or nothing
        const p = o.pending();
        reReadAt = now().toISOString();
        if (!same(p, s.shown)) return { step: 'stale', shown: s.shown, ...(p ? { now: p } : {}) };
        if (typed !== s.shown.binding.slice(0, HASH_LEN).toLowerCase()) return { ...plain, text: '', error: 'mismatch' };
        if (sentOnce || name === undefined) return s;
        sentOnce = true;
        const as = name + VIA_DASHBOARD;
        step = { step: 'sent', shown: s.shown, as };
        handed = o.approve(o.runId, o.gate, typed, as);
        return step;
      }
      default: return s;
    }
  };

  /** Dropped. The decoder still reads it, so a bracketed paste it began is known, and dropped whole when it ends. */
  const typeAhead = (chunk: string): void => {
    decoder.feed(chunk); decoder.flush();
    const start = chunk.lastIndexOf(PASTE_START), end = chunk.lastIndexOf(PASTE_END);
    if (start > end) dropPaste = true;
    else if (end >= 0) dropPaste = false;
  };

  return {
    open(): void {
      opened = true;
      const p = o.pending();
      reReadAt = now().toISOString();
      if (!p || p.gate !== o.gate) { step = { step: 'not-waiting' }; return; }
      step = name === undefined ? { step: 'name', text: '' } : { step: 'hash', shown: { binding: p.binding, at: reReadAt }, text: '' };
    },
    typeAhead,
    async key(chunk: string): Promise<void> {
      if (!opened) { typeAhead(chunk); return; }
      const keys = [...decoder.feed(chunk), ...decoder.flush()].flatMap((c) => c.keys);
      const multi = keys.length > 1;
      for (const k of keys) {
        const s = step;
        if (s.step !== 'name' && s.step !== 'hash') return; // after the form: the caller closes the view, nothing is re-sent
        if (k.name === 'esc' || k.name === 'ctrl-c') { step = { step: 'cancelled' }; return; }
        step = s.step === 'name' ? nameKey(s, k, multi) : hashKey(s, k, multi);
      }
      // every state change above is synchronous; only what approve() returned is waited for
      if (handed !== undefined) { const h = handed; handed = undefined; await h; }
    },
    refresh(): void {
      if (step.step !== 'hash') return;
      const p = o.pending();
      reReadAt = now().toISOString();
      step = { ...step, changed: !same(p, step.shown) };
    },
    state: (): FormStep => structuredClone(step),
    approver: (): string | undefined => name,
    render(caps: Caps, height = caps.rows, outcome?: Outcome): string[] {
      return renderApprovalCenter(step, { ...o.context(), gate: o.gate, ...(name !== undefined ? { approver: name } : {}), ...(reReadAt !== undefined ? { reReadAt } : {}), ...(outcome ? { outcome } : {}) }, caps, height);
    },
  };
}

// ---- the separate `taskquoin approve` process --------------------------------------------------------------------

export interface ApproveChild { pid: number; logPath: string; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>; tail(maxBytes?: number): string }

/** The last bytes of a log, cut at a line start, each line neutralised (log profile, one line each). */
function tailOf(path: string, maxBytes: number): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, 'r');
    const size = fstatSync(fd).size, len = Math.min(size, Math.max(0, maxBytes));
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    let lines = buf.toString('utf8').split(/\r?\n/);
    if (len < size) lines = lines.slice(1); // the first line was cut
    while (lines.length && lines.at(-1)!.trim() === '') lines.pop();
    return lines.map((l) => neutralize(l, { profile: 'log', singleLine: true }).text).join('\n');
  } catch { return ''; } finally { if (fd !== undefined) closeSync(fd); }
}

/**
 * Starts `taskquoin approve` in its own process: argv exactly `[entry, 'approve', runId, gate, '--expect', expect,
 * '--as', as]` (no shell), detached, stdin ignored, stdout and stderr to `approve.log` (0600, `wx`) in a fresh 0700
 * directory; the descriptor is closed here once the child has it; `unref()` so the dashboard can quit while it runs.
 */
export function spawnApprove(o: { node: string; entry: string; cwd: string; env: NodeJS.ProcessEnv; runId: string; gate: Gate; expect: string; as: string; spawn?: typeof nodeSpawn }): ApproveChild {
  const dir = mkdtempSync(join(tmpdir(), 'taskquoin-approve-'));
  const logPath = join(dir, 'approve.log');
  const fd = openSync(logPath, 'wx', 0o600);
  let child: ReturnType<typeof nodeSpawn>;
  try {
    child = (o.spawn ?? nodeSpawn)(o.node, [o.entry, 'approve', o.runId, o.gate, '--expect', o.expect, '--as', o.as],
      { cwd: o.cwd, detached: true, stdio: ['ignore', fd, fd], env: { ...o.env, NO_COLOR: '1', TASKQUOIN_NO_SETUP: '1' } });
  } finally { closeSync(fd); }
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => { resolve({ code, signal }); });
    child.once('error', () => { resolve({ code: null, signal: null }); });
  });
  child.unref();
  if (child.pid === undefined) throw new Error('taskquoin approve could not be started');
  return { pid: child.pid, logPath, exited, tail: (maxBytes = 4096) => tailOf(logPath, maxBytes) };
}

type Approvals = Record<string, { approvedBy?: unknown; binding?: unknown; at?: unknown } | undefined>;

/** The approval the store holds for this send, when there is one: its time. Records already there before (`before`) do not count. */
export function approvalRecord(state: RunState | undefined, events: Record<string, unknown>[], sent: { gate: Gate; binding: string; as: string },
  before?: { state?: RunState; events: Record<string, unknown>[] }): { at?: string } | undefined {
  const node = sent.gate === 'plan' ? 'approve-plan' : 'approve-commit';
  const as = sent.as.trim();
  const byUs = (by: unknown): boolean => typeof by === 'string' && by.trim() === as;
  const match = (e: Record<string, unknown>): boolean => e.type === 'approval' && e.node === node && e.binding === sent.binding && byUs(e.approvedBy);
  const found = events.filter(match), old = before ? before.events.filter(match).length : 0;
  if (found.length > old) { const ts = found.at(-1)!.ts; return typeof ts === 'string' ? { at: ts } : {}; }
  const rec = (state?.approvals as Approvals | undefined)?.[node];
  if (!rec || rec.binding !== sent.binding || !byUs(rec.approvedBy)) return undefined;
  const prev = (before?.state?.approvals as Approvals | undefined)?.[node];
  if (prev && prev.binding === rec.binding && prev.approvedBy === rec.approvedBy && prev.at === rec.at) return undefined;
  return typeof rec.at === 'string' ? { at: rec.at } : {};
}

/** True when the store records this approval: an `approval` event for the gate's node, the binding and `approvedBy === as`, or `state.approvals[node]` with both. */
export function approvalRecorded(state: RunState | undefined, events: Record<string, unknown>[], sent: { gate: Gate; binding: string; as: string },
  before?: { state?: RunState; events: Record<string, unknown>[] }): boolean {
  return approvalRecord(state, events, sent, before) !== undefined;
}
