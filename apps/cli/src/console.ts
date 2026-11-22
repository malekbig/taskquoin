/**
 * `taskquoin console` — an interactive shell over the existing commands (no new workflow logic).
 * Human-only by design: plain text never starts anything (only `/` commands act), and `/approve` approves ONLY when the
 * human retypes the pending hash. It is never installed as slash commands INSIDE Claude Code or Codex, where a model
 * could type them. The real boundary stays the control store: agents cannot write it, so they cannot approve at all.
 */
import { projectSquad, type GateVerdict, type RunView, type SquadMember } from '@taskquoin/application';
import { n as nz, type Neutral } from './tui/neutral.ts';
import { shownSquad } from './tui/view.ts';
import { t, tn, type MessageKey } from './i18n/index.ts';
import type { Caps } from './tui/caps.ts';
import { paint } from './tui/tokens.ts';
import { renderHome, type HomeModel } from './tui/components/home.ts';
import { renderApproval } from './tui/components/approval.ts';
import { alignColumns, displayWidth } from './i18n/width.ts';
export interface ConsoleIO {
  /** Show `question` and return the next line typed, or undefined at end of input. */
  ask(question: string): Promise<string | undefined>;
  out(s?: string): void;
  err(s: string): void;
  /** Told whenever the current run changes (the Tab completer needs it). */
  setCurrent?(run: string | undefined): void;
}
export interface ConsoleCommands {
  /** The run id is the one THIS call created (never guessed from a listing another process may share). */
  run(request: string): Promise<{ code: number; runId?: string }>;
  status(run?: string): Promise<number>;
  show(run: string, artifact?: string): Promise<number>;
  approve(run: string, gate: 'plan' | 'commit', expect: string, as: string): Promise<number>;
  resume(run: string): Promise<number>;
  /** `/dashboard`: the live screen in its own process (the console waits, then draws its prompt again). */
  dashboard(run?: string): Promise<number>;
  doctor(): Promise<number>;
  skills(): Promise<number>;
  agents(): Promise<number>;
  /** `/upgrade [auto|path|install]`: `ask` reads the confirmation line from the console. */
  upgrade(arg: string, ask: (q: string) => Promise<string | undefined>): Promise<number>;
  /** The gate a run waits for and the exact hash to approve, if any. */
  pending(run: string): { gate: 'plan' | 'commit'; binding: string } | undefined;
  /** Run ids, oldest first (ids sort by time). */
  runs(): string[];
  /** Artifact names of a run (for Tab completion of `/show`). */
  artifacts?(run: string): string[];
  /** The run as the approval screen shows it (already neutralised, shownRun) and the accepted risks in force. */
  approval(run: string): { run: RunView<Neutral>; acceptedRisks: string[] } | undefined;
}
/** Where the approval screen is drawn when the caller gives no terminal facts: no colour, UTF-8, 80 columns. */
const PLAIN: Caps = { interactive: false, cursor: false, colorDepth: 0, charset: 'utf8', theme: 'dark', motion: false, plain: false, columns: 80, rows: 24 };

/**
 * Lines from readline for `ask`. In a terminal, lines typed BEFORE a prompt (type-ahead during a long /run) are
 * discarded with a notice: an approval must be answered after it is shown (Codex console review HIGH 3). Piped input
 * (scripts, tests) has no one watching and is kept, like `taskquoin approve --expect` in a script.
 */
export function lineReader(src: { on(ev: 'line', fn: (l: string) => void): unknown; on(ev: 'close', fn: () => void): unknown }, write: (s: string) => void, o: { discardTypeAhead: boolean; showPrompt?: (q: string) => void }) {
  const queue: string[] = []; let waiting: ((l: string | undefined) => void) | undefined; let closed = false;
  src.on('line', (l) => { if (waiting) { const w = waiting; waiting = undefined; w(l); } else queue.push(l); });
  src.on('close', () => { closed = true; if (waiting) { const w = waiting; waiting = undefined; w(undefined); } });
  return {
    ask(question: string): Promise<string | undefined> {
      if (o.discardTypeAhead && queue.length) { write(tn('console.typeAhead', queue.length) + '\n'); queue.length = 0; }
      (o.showPrompt ?? write)(question);
      if (queue.length) return Promise.resolve(queue.shift());
      if (closed) return Promise.resolve(undefined);
      return new Promise((res) => { waiting = res; });
    },
  };
}

/**
 * While another program owns the terminal (the /upgrade installer, stdio inherited): the console's readline is paused
 * and raw mode is off, so Ctrl+C reaches that program as a signal — in raw mode it was a keypress the installer never
 * saw. The console ignores that SIGINT itself (it would end the session); both are restored afterwards, even on failure.
 */
export async function withTerminalReleased<T>(o: {
  rl: { pause(): unknown; resume(): unknown };
  stdin: { isTTY?: boolean; isRaw?: boolean; setRawMode?(raw: boolean): unknown };
  signals: { on(ev: 'SIGINT', fn: () => void): unknown; off(ev: 'SIGINT', fn: () => void): unknown };
}, f: () => Promise<T>): Promise<T> {
  const tty = !!o.stdin.isTTY && typeof o.stdin.setRawMode === 'function';
  const wasRaw = !!o.stdin.isRaw;
  const ignore = () => {};
  o.rl.pause();
  if (tty) o.stdin.setRawMode!(false);
  o.signals.on('SIGINT', ignore);
  try { return await f(); } finally {
    o.signals.off('SIGINT', ignore);
    if (tty) o.stdin.setRawMode!(wasRaw);
    o.rl.resume();
  }
}

type DocKey = Extract<MessageKey, `console.doc.${string}`>;
type Category = 'run' | 'review' | 'diagnose' | 'console';
const CATEGORIES: readonly Category[] = ['run', 'review', 'diagnose', 'console'];
/** Single source for /help, Tab completion and the "/" menu: [command, arguments key, description key, category] (names are not translated). */
const COMMAND_TABLE: readonly [string, DocKey | '', DocKey, Category][] = [
  ['/run', 'console.doc.run.args', 'console.doc.run', 'run'],
  ['/runs', '', 'console.doc.runs', 'run'],
  ['/use', '', 'console.doc.use', 'run'],
  ['/status', '', 'console.doc.status', 'run'],
  ['/resume', '', 'console.doc.resume', 'run'],
  ['/show', 'console.doc.show.args', 'console.doc.show', 'review'],
  ['/approve', '', 'console.doc.approve', 'review'],
  ['/dashboard', '', 'console.doc.dashboard', 'review'],
  ['/agents', '', 'console.doc.agents', 'diagnose'],
  ['/doctor', '', 'console.doc.doctor', 'diagnose'],
  ['/skills', '', 'console.doc.skills', 'diagnose'],
  ['/upgrade', 'console.doc.upgrade.args', 'console.doc.upgrade', 'diagnose'],
  ['/help', '', 'console.doc.help', 'console'],
  ['/quit', '', 'console.doc.quit', 'console'],
];
const BARE_ARGS: Record<string, string> = { '/use': '<run>', '/approve': '<plan|commit>' };
/** [command, arguments, description] in the current language. Computed at call time: nothing translated at module load. */
export function commandDocs(): readonly [string, string, string][] {
  return COMMAND_TABLE.map(([c, a, d]) => [c, a ? t(a) : (BARE_ARGS[c] ?? ''), t(d)] as [string, string, string]);
}
const usage = (c: string, a: string) => (a ? `${c} ${a}` : c);
const docLines = () => alignColumns(commandDocs().map(([c, a, d]) => [usage(c, a), d] as const));
export function consoleHelp(): string {
  return t('console.help.title') + '\n' + docLines().map(l => `  ${l}`).join('\n') + '\n' + t('console.help.footer');
}

/** `s` cut to at most `cols` display columns, ending with an ellipsis when something was cut. */
function fitWidth(s: string, cols: number): string {
  if (displayWidth(s) <= cols) return s;
  let out = '';
  for (const ch of s) { if (displayWidth(out + ch) > cols - 1) break; out += ch; }
  return out + '…';
}

/**
 * The "/" menu for what is typed so far: matching commands grouped under their category title, each with its
 * description, while no argument is typed. Every line fits `columns` (the description is cut first).
 */
export function slashMenu(line: string, columns = 80): string[] {
  if (!line.startsWith('/') || line.includes(' ')) return [];
  const rows = docLines();
  const lines: string[] = [];
  for (const cat of CATEGORIES) {
    const idx = COMMAND_TABLE.map((e, i) => (e[3] === cat && e[0].startsWith(line) ? i : -1)).filter(i => i >= 0);
    if (!idx.length) continue;
    lines.push(fitWidth(t(`console.cat.${cat}`), columns), ...idx.map(i => fitWidth('  ' + rows[i], columns)));
  }
  return lines;
}

/**
 * Terminal escapes that draw `items` under the input line and put the cursor back (relative moves: correct even when
 * the screen scrolls); always clears what was drawn before, so an empty list just erases the menu. Only where the
 * cursor may move (`consoleSurface(caps).menu`); the items are muted through the caps, so no colour without colour.
 */
export function drawSlashMenu(o: { promptWidth: number; line: string; cursor: number; items: string[]; caps: Caps }): string {
  const dim = (t: string) => paint('muted', t, o.caps);
  let s = `\x1b[${o.promptWidth + displayWidth(o.line) + 1}G\x1b[J`;
  if (o.items.length) s += '\n' + o.items.map(dim).join('\n') + `\x1b[${o.items.length}A`;
  return s + `\x1b[${o.promptWidth + displayWidth(o.line.slice(0, o.cursor)) + 1}G`;
}

/**
 * What the console draws besides its lines, decided from the caps alone (AC-2, ADR-0019): the live "/" menu moves the
 * cursor, so it needs a terminal that allows it (both ends a TTY, not `TERM=dumb`) and not plain mode; an error line is
 * red only when the caps have colour (never with `NO_COLOR`, `TERM=dumb` or a pipe) and stderr is a terminal too.
 */
export function consoleSurface(caps: Caps, stderrTTY: boolean): { menu: boolean; error(s: string): string } {
  return { menu: caps.cursor && !caps.plain, error: (s) => (stderrTTY ? paint('red', s, caps) : s) };
}

/** Edit distance (Levenshtein). */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
/** The known command closest to `name` (with or without the leading `/`), if within 2 edits. */
export function suggestCommand(name: string): string | undefined {
  const bare = name.replace(/^\//, '').toLowerCase();
  let best: string | undefined; let bestD = 3;
  for (const [c] of COMMAND_TABLE) { const d = distance(bare, c.slice(1)); if (d < bestD) { best = c; bestD = d; } }
  return best;
}

/** "unknown command /x — did you mean /y?" (the typed name is neutralised: it came from outside). */
function unknownCommand(name: string): string {
  const s = suggestCommand(name);
  return s ? t('console.unknownCommandDid', { name: nz(name), suggestion: s }) : t('console.unknownCommand', { name: nz(name) });
}
/** `taskquoin [ab12cd ◆ commit] › `: the current run and, with ◆, the approval it waits for (glyph + word). Plain text: its width is its display width. */
export const promptFor = (current?: string, waiting?: 'plan' | 'commit') =>
  current ? `taskquoin [${nz(current.slice(-6))}${waiting ? ` ◆ ${waiting}` : ''}] › ` : 'taskquoin › ';

export const CONSOLE_COMMANDS = COMMAND_TABLE.map(([c]) => c);
export interface CompletionContext { runs: string[]; artifacts: string[]; pendingGate?: 'plan' | 'commit' }
/**
 * readline completer: `/ap` → `/approve `; then contextual: `/use <run>`, `/show <artifact>` (current run),
 * `/approve <gate>` (only the gate really pending), `/help <command>`. Free text gets no completion.
 */
export function completeCommand(line: string, ctx: CompletionContext = { runs: [], artifacts: [] }): [string[], string] {
  if (!line.startsWith('/')) return [[], line];
  const sp = line.indexOf(' ');
  if (sp < 0) return [CONSOLE_COMMANDS.filter(c => c.startsWith(line)).map(c => c + ' '), line];
  const cmd = line.slice(0, sp); const rest = line.slice(sp + 1);
  if (rest.includes(' ')) return [[], line];
  const pool = cmd === '/use' ? ctx.runs : cmd === '/show' ? ctx.artifacts : cmd === '/approve' ? (ctx.pendingGate ? [ctx.pendingGate] : [])
    : cmd === '/help' ? CONSOLE_COMMANDS.map(c => c.slice(1)) : [];
  return [pool.filter(v => v.startsWith(rest)), rest];
}

// ── banner ───────────────────────────────────────────────────────────────────────────────────────────────────────
export type { SquadMember };

/**
 * The squad as it really is: every agent with its gate verdict (a judge's provider shown), then Taskquoin's own
 * sandboxed Verify as the tester. A refusal shows its short reason (the text before " — ").
 * The projection is raw and shared with doctor (isReady); shownSquad says it in the user's language and neutralises
 * what came from config, gates or skill files — never a translated message.
 */
export function squadOf(agents: Record<string, { runtime: string; provider?: string; model?: string }>,
  gateOf: (id: string) => GateVerdict, testerReady: boolean): SquadMember<Neutral>[] {
  return shownSquad(projectSquad(agents, gateOf, testerReady)).view;
}
/** The V2 home screen as one string (the lines of `renderHome`). */
export function renderBanner(model: HomeModel, caps: Caps): string {
  return renderHome(model, caps).join('\n');
}

/**
 * Reveals the logo rows left to right, in place, in at most 0.9 s (cursor hidden, always shown again). `rows` are the
 * finished lines: every frame keeps each escape and shows only the first columns' characters, so the last frame IS the
 * static logo and a frame never leaves a colour open.
 */
const ESCAPE = /(\x1b\[[0-9;]*[A-Za-z])/;
export function logoFrames(rows: readonly string[], steps = 16): string[] {
  const width = Math.max(...rows.map(displayWidth));
  const reveal = (row: string, shown: number): string => {
    let seen = 0;
    return row.split(ESCAPE).map((part) => {
      if (ESCAPE.test(part)) return part;
      return [...part].map((ch) => (seen++ < shown ? ch : ' ')).join('');
    }).join('');
  };
  const frames: string[] = [];
  for (let k = 1; k <= steps; k++) frames.push(rows.map((r) => reveal(r, Math.round((width * k) / steps))).join('\n'));
  return frames;
}
export async function animateLogo(write: (s: string) => void, sleep: (ms: number) => Promise<void>, rows: readonly string[]): Promise<void> {
  const frames = logoFrames(rows); const height = rows.length;
  write('\x1b[?25l');
  try {
    for (let i = 0; i < frames.length; i++) {
      write((i ? `\x1b[${height - 1}A\r` : '') + frames[i]);
      await sleep(i < frames.length - 1 ? 45 : 0);
    }
    write('\n');
  } finally { write('\x1b[?25h'); }
}

export async function runConsole(io: ConsoleIO, cmd: ConsoleCommands, banner?: string, caps: Caps = PLAIN): Promise<number> {
  let current: string | undefined;
  const read = new Map<string, Set<string>>(); // artifacts the human showed with /show, per run, this session
  let approver: string | undefined;
  let failed = false; // exit code of the session: 1 if any command or approval failed (scripts must see it)
  const setCurrent = (r: string | undefined) => { current = r; io.setCurrent?.(r); };
  const fail = (msg: string) => { failed = true; io.err(msg); };
  const track = (code: number) => { if (code !== 0) failed = true; };
  if (banner) io.out(banner);
  io.out(t('console.welcome'));
  for (;;) {
    const line = await io.ask(promptFor(current, current ? cmd.pending(current)?.gate : undefined));
    if (line === undefined) return failed ? 1 : 0;
    const text = line.trim();
    if (!text) continue;
    if (!text.startsWith('/')) { io.out(t('console.noCommand')); continue; }
    const [name, ...rest] = text.slice(1).split(/\s+/); const arg = text.slice(1 + name.length).trim();
    const needRun = (): string | undefined => { if (!current) fail(t('console.noRun')); return current; };
    switch (name) {
      case 'quit': case 'exit': return failed ? 1 : 0;
      case 'help': {
        if (!arg) { io.out(consoleHelp()); break; }
        const row = commandDocs().find(([c]) => c === '/' + arg.replace(/^\//, ''));
        if (!row) { fail(unknownCommand(arg.replace(/^\//, ''))); break; }
        io.out(usage(row[0], row[1])); io.out('  ' + row[2]); break;
      }
      case 'run': {
        if (!arg) { fail(t('console.usage.run')); break; }
        setCurrent(undefined); // never fall back silently to the previously selected run (Codex console review HIGH 2)
        const r = await cmd.run(arg); track(r.code);
        if (r.runId) { setCurrent(r.runId); io.out(t('console.currentRun', { run: r.runId })); } else io.out(t('console.noCurrentRun'));
        break;
      }
      case 'runs': track(await cmd.status()); break;
      case 'use': {
        if (!cmd.runs().includes(arg)) { fail(t('console.unknownRun', { run: arg ? nz(arg) : t('console.empty') })); break; }
        setCurrent(arg); io.out(t('console.currentRun', { run: nz(arg) })); break;
      }
      case 'status': { const r = needRun(); if (r) track(await cmd.status(r)); break; }
      case 'show': {
        const r = needRun(); if (!r) break;
        const code = await cmd.show(r, rest[0]); track(code);
        if (code === 0 && rest[0]) read.set(r, (read.get(r) ?? new Set()).add(rest[0])); // only what was really shown
        break;
      }
      case 'resume': { const r = needRun(); if (r) track(await cmd.resume(r)); break; }
      case 'dashboard': await cmd.dashboard(current); break; // the screen's own refusal is not a failed command
      case 'agents': track(await cmd.agents()); break;
      case 'doctor': track(await cmd.doctor()); break;
      case 'skills': track(await cmd.skills()); break;
      case 'upgrade': track(await cmd.upgrade(arg, io.ask)); break;
      case 'approve': {
        const r = needRun(); if (!r) break;
        const gate = rest[0];
        if (gate !== 'plan' && gate !== 'commit') { fail(t('console.usage.approve')); break; }
        if (!cmd.pending(r) || cmd.pending(r)!.gate !== gate) { const p = cmd.pending(r); fail(p ? t('console.notWaitingWaits', { run: r, gate, waits: p.gate }) : t('console.notWaiting', { run: r, gate })); break; }
        // The name FIRST, so the last thing typed before approving is the hash; a `/…` line is never a name (HIGH 1).
        let cancelled = false;
        while (!approver) {
          const n = (await io.ask(t('console.askName')))?.trim();
          if (n === undefined) return failed ? 1 : 0;
          if (n.startsWith('/')) { cancelled = true; break; }
          if (n) approver = n;
        }
        if (cancelled) { fail(t('console.cancelledCommand')); break; }
        const p = cmd.pending(r); // re-read right before showing it: what is shown is what can be approved
        if (!p || p.gate !== gate) { fail(t('console.notWaitingAnymore', { run: r, gate })); break; }
        const shown = cmd.approval(r);
        if (!shown) { fail(t('console.notWaitingAnymore', { run: r, gate })); break; }
        // The screen shows the binding recorded in the run (the plan's hash, the reviewed tree). The working tree, the
        // branch and the hash are checked by `approve` itself, as for `taskquoin approve`: no console-only logic (ADR-0015 §1).
        const short = p.binding.slice(0, 12);
        io.out(renderApproval({ run: shown.run, gate, binding: p.binding, read: read.get(r) ?? new Set(), acceptedRisks: shown.acceptedRisks, approver }, caps).join('\n'));
        const typed = (await io.ask(t('console.retype', { hash: short })))?.trim();
        if (!typed) { io.out(t('console.cancelled')); break; }
        if (typed !== short) { fail(t('console.hashMismatch')); break; }
        // What was shown is what is approved: the pending binding is read again after the last keystroke (AC-6).
        const now = cmd.pending(r);
        if (!now || now.gate !== gate) { fail(t('console.notWaitingAnymore', { run: r, gate })); break; }
        if (now.binding !== p.binding) { fail(t(gate === 'commit' ? 'console.treeChanged' : 'console.planChanged')); break; }
        track(await cmd.approve(r, gate, typed, `${approver} (via taskquoin console)`));
        break;
      }
      default: fail(unknownCommand(name));
    }
  }
}
