/**
 * `taskquoin console` — an interactive shell over the existing commands (no new workflow logic).
 * Human-only by design: plain text never starts anything (only `/` commands act), and `/approve` approves ONLY when the
 * human retypes the pending hash. It is never installed as slash commands INSIDE Claude Code or Codex, where a model
 * could type them. The real boundary stays the control store: agents cannot write it, so they cannot approve at all.
 */
import { t, tn, type MessageKey } from './i18n/index.ts';
import { alignColumns, displayWidth, padEndDisplay } from './i18n/width.ts';
export interface ConsoleIO {
  /** Show `question` and return the next line typed, or undefined at end of input. */
  ask(question: string): Promise<string | undefined>;
  out(s?: string): void;
  err(s: string): void;
}
export interface ConsoleCommands {
  /** The run id is the one THIS call created (never guessed from a listing another process may share). */
  run(request: string): Promise<{ code: number; runId?: string }>;
  status(run?: string): Promise<number>;
  show(run: string, artifact?: string): Promise<number>;
  approve(run: string, gate: 'plan' | 'commit', expect: string, as: string): Promise<number>;
  resume(run: string): Promise<number>;
  doctor(): Promise<number>;
  skills(): Promise<number>;
  agents(): Promise<number>;
  /** The gate a run waits for and the exact hash to approve, if any. */
  pending(run: string): { gate: 'plan' | 'commit'; binding: string } | undefined;
  /** Run ids, oldest first (ids sort by time). */
  runs(): string[];
}

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

type DocKey = Extract<MessageKey, `console.doc.${string}`>;
/** Single source for /help, Tab completion and the "/" menu: [command, arguments key, description key] (names are not translated). */
const COMMAND_TABLE: readonly [string, DocKey | '', DocKey][] = [
  ['/run', 'console.doc.run.args', 'console.doc.run'],
  ['/runs', '', 'console.doc.runs'],
  ['/use', '', 'console.doc.use'],
  ['/status', '', 'console.doc.status'],
  ['/show', 'console.doc.show.args', 'console.doc.show'],
  ['/approve', '', 'console.doc.approve'],
  ['/resume', '', 'console.doc.resume'],
  ['/agents', '', 'console.doc.agents'],
  ['/doctor', '', 'console.doc.doctor'],
  ['/skills', '', 'console.doc.skills'],
  ['/help', '', 'console.doc.help'],
  ['/quit', '', 'console.doc.quit'],
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

/** The "/" menu for what is typed so far: every matching command with its description, while no argument is typed. */
export function slashMenu(line: string): string[] {
  if (!line.startsWith('/') || line.includes(' ')) return [];
  return docLines().filter((_, i) => COMMAND_TABLE[i][0].startsWith(line));
}

/**
 * Terminal escapes that draw `items` under the input line and put the cursor back (relative moves: correct even when
 * the screen scrolls); always clears what was drawn before, so an empty list just erases the menu.
 */
export function drawSlashMenu(o: { promptWidth: number; line: string; cursor: number; items: string[]; color: boolean }): string {
  const dim = (t: string) => (o.color ? `\x1b[38;2;154;165;206m${t}\x1b[0m` : t);
  let s = `\x1b[${o.promptWidth + o.line.length + 1}G\x1b[J`;
  if (o.items.length) s += '\n' + o.items.map(dim).join('\n') + `\x1b[${o.items.length}A`;
  return s + `\x1b[${o.promptWidth + o.cursor + 1}G`;
}

const gateReads = (gate: 'plan' | 'commit') => t(gate === 'plan' ? 'console.gate.plan' : 'console.gate.commit');
const promptFor = (current?: string) => (current ? `taskquoin [${current.slice(-6)}] › ` : 'taskquoin › ');

export const CONSOLE_COMMANDS = COMMAND_TABLE.map(([c]) => c);
/** readline completer: `/ap` → `/approve `. Free text gets no completion. */
export function completeCommand(line: string): [string[], string] {
  if (!line.startsWith('/') || line.includes(' ')) return [[], line];
  return [CONSOLE_COMMANDS.filter(c => c.startsWith(line)).map(c => c + ' '), line];
}

// ── banner ───────────────────────────────────────────────────────────────────────────────────────────────────────
export interface SquadMember { role: string; who: string; state: 'ready' | 'risk' | 'blocked'; note?: string }

const roleLabel = (id: string): string => (id === 'planner' ? t('console.role.planner') : id === 'implementer' ? t('console.role.implementer') : id === 'challenger' ? t('console.role.challenger') : id === 'security' ? t('console.role.security') : id[0].toUpperCase() + id.slice(1));
/**
 * The squad as it really is: every agent with its gate verdict (a judge's provider shown), then Taskquoin's own
 * sandboxed Verify as the tester. A refusal shows its short reason (the text before " — ").
 */
export function squadOf(agents: Record<string, { runtime: string; provider?: string; model?: string }>,
  gateOf: (id: string) => { ok: boolean; runtimeFound: boolean; failures: { message: string }[]; acceptedRisks: { capability: string }[] },
  testerReady: boolean): SquadMember[] {
  const squad: SquadMember[] = Object.entries(agents).map(([id, a]) => {
    const g = gateOf(id);
    const state = !g.ok ? 'blocked' as const : g.acceptedRisks.length ? 'risk' as const : 'ready' as const;
    const note = !g.ok ? (g.runtimeFound ? g.failures[0]?.message.split(' — ')[0].slice(0, 70) : t('console.squad.absent', { runtime: a.runtime })) : g.acceptedRisks.map(r => r.capability).join(', ') || undefined;
    return { role: roleLabel(id), who: `${id} · ${a.runtime === 'api' ? `api:${a.provider}` : a.runtime === 'opencode' ? `opencode:${(a.model ?? '').split('/')[0]}` : a.runtime}`, state, ...(note ? { note } : {}) };
  });
  squad.push(testerReady ? { role: t('console.role.tester'), who: 'verify · bubblewrap', state: 'ready' } : { role: t('console.role.tester'), who: 'verify · bubblewrap', state: 'blocked', note: t('console.squad.testerUnavailable') });
  return squad;
}
const TASK_ART = [
  '████████╗ █████╗ ███████╗██╗  ██╗',
  '╚══██╔══╝██╔══██╗██╔════╝██║ ██╔╝',
  '   ██║   ███████║███████╗█████╔╝ ',
  '   ██║   ██╔══██║╚════██║██╔═██╗ ',
  '   ██║   ██║  ██║███████║██║  ██╗',
  '   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝',
];
type RGB = [number, number, number];
const C = { mint: [94, 242, 194] as RGB, shadow: [38, 166, 140] as RGB, pink: [247, 143, 179] as RGB, violet: [183, 148, 246] as RGB,
  muted: [154, 165, 206] as RGB, line: [86, 95, 137] as RGB, green: [158, 206, 106] as RGB, amber: [224, 175, 104] as RGB, red: [247, 118, 142] as RGB, orange: [255, 158, 100] as RGB };
const mix = (a: RGB, b: RGB, t: number): RGB => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;

/**
 * Start-up banner (owner's design). The squad lines show the REAL agents and their gate status — never a decorative
 * "READY": a role that cannot run says NOT READY and why. Colours (24-bit) only when `color` (a TTY, no NO_COLOR).
 */
const paintWith = (color: boolean) => (s: string, c: RGB) => (color && s ? `\x1b[38;2;${c[0]};${c[1]};${c[2]}m${s}\x1b[0m` : s);
const ART_W = Math.max(...TASK_ART.map(l => l.length));
const QUOIN_PAD = '      ';

/** The logo block (TASK art, blank line, Q U O I N), every line padded to the same width so frames overwrite cleanly. */
export function renderLogo(color: boolean, reveal = ART_W, shine = false, letters = 5): string {
  const paint = paintWith(color);
  const art = TASK_ART.map(l => ' ' + [...l.padEnd(ART_W)].map((ch, i) => {
    if (i >= reveal || ch === ' ') return ' ';
    if (shine && i >= reveal - 4) return paint(ch, [225, 255, 246]); // the light band at the reveal edge
    return ch === '█' ? paint(ch, C.mint) : paint(ch, C.shadow);
  }).join(''));
  const q = [...'QUOIN'].map((ch, i) => (i < letters ? paint(ch, mix(C.pink, C.violet, i / 4)) : ' ')).join(' ');
  const visible = QUOIN_PAD.length + 'Q U O I N'.length; // pad on the VISIBLE width (colour escapes take no column)
  return [...art, ''.padEnd(ART_W + 1), QUOIN_PAD + q + ' '.repeat(ART_W + 1 - visible)].join('\n');
}

/** Frames of the start-up animation: TASK revealed left to right with a shine, then Q U O I N letter by letter. */
export function logoFrames(): string[] {
  const steps = 14; const frames: string[] = [];
  for (let k = 1; k <= steps; k++) frames.push(renderLogo(true, Math.round((ART_W * k) / steps), k < steps, 0));
  for (let n = 1; n <= 5; n++) frames.push(renderLogo(true, ART_W, false, n));
  return frames;
}

/** Plays the frames in place (cursor hidden, always shown again), ~0.9 s in total. */
export async function animateLogo(write: (s: string) => void, sleep: (ms: number) => Promise<void>): Promise<void> {
  const frames = logoFrames(); const height = frames[0].split('\n').length;
  write('\x1b[?25l');
  try {
    for (let i = 0; i < frames.length; i++) {
      write((i ? `\x1b[${height - 1}A\r` : '') + frames[i]);
      await sleep(i < 14 ? 40 : 70);
    }
    write('\n');
  } finally { write('\x1b[?25h'); }
}

/**
 * Start-up banner (owner's design). The squad lines show the REAL agents and their gate status — never a decorative
 * "READY": a role that cannot run says NOT READY and why. Colours (24-bit) only when `color` (a TTY, no NO_COLOR).
 * `logo: false` when the animation already drew it.
 */
export function renderBanner(squad: SquadMember[], o: { color: boolean; logo?: boolean }): string {
  const paint = paintWith(o.color);
  const width = Math.max(...squad.map(m => displayWidth(m.role))) + 2, whoW = Math.max(...squad.map(m => displayWidth(m.who))) + 2;
  const rows = squad.map(m => {
    const notReady = t('console.banner.notReady'), ready = t('console.banner.ready');
    const status = m.state === 'blocked' ? paint(m.note ? t('console.banner.notReadyNote', { label: notReady, note: m.note }) : notReady, C.red)
      : m.state === 'risk' ? paint(m.note ? t('console.banner.riskNote', { label: ready, note: m.note }) : t('console.banner.risk', { label: ready }), C.amber)
      : paint(ready, C.green);
    return ` ${paint(m.state === 'blocked' ? '[○]' : '[●]', m.state === 'blocked' ? C.red : C.mint)} ${paint(padEndDisplay(m.role, width), C.mint)}${paint(padEndDisplay(m.who, whoW), C.muted)}${status}`;
  });
  return [...(o.logo === false ? [] : ['', renderLogo(o.color)]), '', ` ${paint(t('console.banner.tagline'), C.muted)}`, ` ${paint('─'.repeat(34), C.line)}`, '', ...rows, '',
    ` ${paint(t('console.banner.slogan'), C.orange)}`, ''].join('\n');
}

export async function runConsole(io: ConsoleIO, cmd: ConsoleCommands, banner?: string): Promise<number> {
  let current: string | undefined;
  let approver: string | undefined;
  let failed = false; // exit code of the session: 1 if any command or approval failed (scripts must see it)
  const fail = (msg: string) => { failed = true; io.err(msg); };
  const track = (code: number) => { if (code !== 0) failed = true; };
  if (banner) io.out(banner);
  io.out(t('console.welcome'));
  for (;;) {
    const line = await io.ask(promptFor(current));
    if (line === undefined) return failed ? 1 : 0;
    const text = line.trim();
    if (!text) continue;
    if (!text.startsWith('/')) { io.out(t('console.noCommand')); continue; }
    const [name, ...rest] = text.slice(1).split(/\s+/); const arg = text.slice(1 + name.length).trim();
    const needRun = (): string | undefined => { if (!current) fail(t('console.noRun')); return current; };
    switch (name) {
      case 'quit': case 'exit': return failed ? 1 : 0;
      case 'help': io.out(consoleHelp()); break;
      case 'run': {
        if (!arg) { fail(t('console.usage.run')); break; }
        current = undefined; // never fall back silently to the previously selected run (Codex console review HIGH 2)
        const r = await cmd.run(arg); track(r.code);
        if (r.runId) { current = r.runId; io.out(t('console.currentRun', { run: current })); } else io.out(t('console.noCurrentRun'));
        break;
      }
      case 'runs': track(await cmd.status()); break;
      case 'use': {
        if (!cmd.runs().includes(arg)) { fail(t('console.unknownRun', { run: arg || t('console.empty') })); break; }
        current = arg; io.out(t('console.currentRun', { run: current })); break;
      }
      case 'status': { const r = needRun(); if (r) track(await cmd.status(r)); break; }
      case 'show': { const r = needRun(); if (r) track(await cmd.show(r, rest[0])); break; }
      case 'resume': { const r = needRun(); if (r) track(await cmd.resume(r)); break; }
      case 'agents': track(await cmd.agents()); break;
      case 'doctor': track(await cmd.doctor()); break;
      case 'skills': track(await cmd.skills()); break;
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
        const short = p.binding.slice(0, 12);
        io.out(t('console.toApprove', { gate, run: r, hash: short }));
        io.out(t('console.readFirst', { reads: gateReads(gate) }));
        const typed = (await io.ask(t('console.retype', { hash: short })))?.trim();
        if (!typed) { io.out(t('console.cancelled')); break; }
        if (typed !== short) { fail(t('console.hashMismatch')); break; }
        track(await cmd.approve(r, gate, typed, `${approver} (via taskquoin console)`));
        break;
      }
      default: fail(t('console.unknownCommand', { name }));
    }
  }
}
