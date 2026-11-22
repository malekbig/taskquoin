/**
 * The full-screen terminal: alternate screen, raw mode, line-diff painting, and the terminal ALWAYS given back
 * (cursor, alternate screen, bracketed paste, raw mode) on return, error, SIGINT, SIGTERM, SIGHUP and process exit.
 * IO is injected (TtyIO, Signals) so every exit path is testable without a terminal.
 */
import { clip } from './text.ts';

export interface TtyIO {
  write(s: string): void;
  setRawMode(on: boolean): void;
  onData(f: (chunk: string) => void): () => void;
  onResize(f: () => void): () => void;
  size(): { columns: number; rows: number };
}

type SignalName = 'SIGINT' | 'SIGTERM' | 'SIGHUP' | 'exit';
export interface Signals {
  on(ev: SignalName, f: () => void): unknown;
  off(ev: SignalName, f: () => void): unknown;
  exit(code: number): void;
}

export interface Screen {
  /** Paint a frame (one string per row); returns the rows written, 0 when nothing changed. */
  draw(lines: string[]): number;
  /** Forget what is on the terminal: the next draw rewrites every row. */
  invalidate(): void;
}

export const ENTER = '\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[2J';
export const RESTORE = '\x1b[0m\x1b[?2004l\x1b[?25h\x1b[?1049l';

const EXIT_CODE = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;
const rowAt = (row: number): string => `\x1b[${row};1H\x1b[2K`;

export async function withTerminal<T>(io: TtyIO, sig: Signals, body: (s: Screen) => Promise<T>): Promise<T> {
  let prev: string[] | undefined;
  let dirty = 0; // rows that may hold stale text after invalidate() or a resize: the next draw clears those past its frame
  const screen: Screen = {
    invalidate() { dirty = Math.max(dirty, prev?.length ?? 0); prev = undefined; },
    draw(lines) {
      const { columns, rows: height } = io.size();
      const next = lines.slice(0, Math.max(0, height)).map((l) => clip(l, columns));
      let out = '', rows = 0;
      for (let i = 0; i < next.length; i++) {
        if (prev === undefined || prev[i] !== next[i]) { out += rowAt(i + 1) + next[i]; rows++; }
      }
      for (let i = next.length; i < Math.max(prev?.length ?? 0, dirty); i++) { out += rowAt(i + 1); rows++; }
      if (rows > 0) {
        try { io.write(out); } catch (e) { dirty = Math.max(dirty, prev?.length ?? 0, next.length); prev = undefined; throw e; }
      }
      prev = next;
      dirty = 0;
      return rows;
    },
  };

  const offs: (() => void)[] = [];
  let restored = false;
  const restore = (): void => {
    if (restored) return;
    restored = true;
    try { io.setRawMode(false); } catch { /* terminal already gone */ }
    try { io.write(RESTORE); } catch { /* terminal already gone */ }
    for (const off of offs) { try { off(); } catch { /* nothing to undo */ } }
  };

  const bind = (ev: SignalName, f: () => void): void => { sig.on(ev, f); offs.push(() => { sig.off(ev, f); }); };
  for (const ev of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) bind(ev, () => { restore(); sig.exit(EXIT_CODE[ev]); });
  bind('exit', restore);
  offs.push(io.onResize(() => { dirty = Math.max(dirty, io.size().rows); prev = undefined; }));

  try {
    io.write(ENTER);
    io.setRawMode(true);
    return await body(screen);
  } finally {
    restore();
  }
}

/** The real process: signals and exit. */
export const processSignals: Signals = {
  on: (ev, f) => process.on(ev, f),
  off: (ev, f) => process.off(ev, f),
  exit: (code) => process.exit(code),
};

export function nodeTty(stdin: NodeJS.ReadStream, stdout: NodeJS.WriteStream): TtyIO {
  const subs = new Set<(chunk: string) => void>();
  const onChunk = (c: string | Buffer): void => { const s = typeof c === 'string' ? c : c.toString('utf8'); for (const f of [...subs]) f(s); };
  return {
    write: (s) => { stdout.write(s); },
    setRawMode: (on) => { if (stdin.isTTY) stdin.setRawMode(on); },
    onData(f) {
      if (subs.size === 0) { stdin.setEncoding('utf8'); stdin.on('data', onChunk); stdin.resume(); }
      subs.add(f);
      return () => {
        if (!subs.delete(f) || subs.size > 0) return;
        stdin.off('data', onChunk);
        stdin.pause();
      };
    },
    onResize(f) { stdout.on('resize', f); return () => { stdout.off('resize', f); }; },
    size: () => ({ columns: stdout.columns > 0 ? stdout.columns : 80, rows: stdout.rows > 0 ? stdout.rows : 24 }),
  };
}
