/** Shared fixtures for the terminal-interface tests: capabilities, the hostile-string corpus, a fake TTY and fake signals. */
import { setLanguage } from '../../src/i18n/index.ts';
import type { Caps } from '../../src/tui/caps.ts';
import type { Signals, TtyIO } from '../../src/tui/screen.ts';

export const caps = (o: Partial<Caps> = {}): Caps =>
  ({ interactive: true, cursor: true, colorDepth: 24, charset: 'utf8', theme: 'dark', motion: false, plain: false, columns: 100, rows: 30, ...o });

/** The renderer's own colour codes. */
export const SGR = /\x1b\[[0-9;]*m/g;

export const FORBIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]|[\u{1bca0}-\u{1bca3}\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/u;

/** Strings an agent, a file name or a provider could send; each must come out inert and marked. */
export const CORPUS = [
  'ok\u001b[2J\u001b[Hcleared',
  'tests FAILED\r\u001b[32mtests PASSED\u001b[0m',
  '\u001b]52;c;Y3VybCBldmlsLnNoIHwgc2g=\u0007copy',
  '\u001b]8;;https://evil.example\u001b\\docs\u001b]8;;\u001b\\',
  '\u001b]0;root@prod\u0007title',
  'answer me\u001b[c\u001b[6n\u001b[21t',
  '\u001bP+q544e\u001b\\dcs', '\u001b_apc\u001b\\',
  '\u009b31mC1 CSI\u009b0m', '\u009d0;t\u009c',
  'if (isAdmin) {\u202e } \u2066// check\u2069',
  'pass\u200bword', '\ufeffBOM', 'tag\u{e0041}', 'soft\u00adhyphen', 'sep\u2028line', 'arabic\u061cmark', 'fill\u3164er\u115f\u1160\uffa0',
  'cgj\u034fx', 'khmer\u17b4\u17b5', 'mongolian\u180b\u180c\u180d\u180f', 'inv\u2065\u206a\u206b\u206c\u206d\u206e\u206f', 'vs\ufe00', 'vs\u{e0100}\u{e01ef}', 'shorthand\u{1bca0}\u{1bca3}',
  'bell\u0007', 'back\bspace', 'del\u007f',
  'src/\u001b[31mevil.js',
];

export const LANGS = ['en', 'fr', 'ja', 'ar'] as const;

/** Run `fn` with the interface language set, English again afterwards (also when it throws or its promise rejects). */
export function withLang<T>(lang: string, fn: () => T): T {
  setLanguage(lang);
  let async = false;
  try {
    const r = fn();
    if (r && typeof (r as { then?: unknown }).then === 'function') {
      async = true;
      return (r as unknown as Promise<unknown>).finally(() => setLanguage('en')) as T;
    }
    return r;
  } finally {
    if (!async) setLanguage('en');
  }
}

export interface FakeTty extends TtyIO {
  writes: string[];
  rawMode: boolean;
  dataHandlers: Set<(chunk: string) => void>;
  resizeHandlers: Set<() => void>;
  dims: { columns: number; rows: number };
  /** When it returns true for a write, that write throws (a closed terminal). */
  failWrite?: (s: string) => boolean;
  text(): string;
}

export function fakeTty(columns = 80, rows = 24): FakeTty {
  const io: FakeTty = {
    writes: [], rawMode: false, dataHandlers: new Set(), resizeHandlers: new Set(), dims: { columns, rows },
    write(s) { if (io.failWrite?.(s)) throw new Error('EIO'); io.writes.push(s); },
    setRawMode(on) { io.rawMode = on; },
    onData(f) { io.dataHandlers.add(f); return () => { io.dataHandlers.delete(f); }; },
    onResize(f) { io.resizeHandlers.add(f); return () => { io.resizeHandlers.delete(f); }; },
    size() { return { ...io.dims }; },
    text() { return io.writes.join(''); },
  };
  return io;
}

export interface FakeSignals extends Signals {
  exits: number[];
  emit(ev: string): void;
  count(): number;
}

export function fakeSignals(): FakeSignals {
  const handlers = new Map<string, Set<() => void>>();
  const s: FakeSignals = {
    exits: [],
    on(ev, f) { (handlers.get(ev) ?? handlers.set(ev, new Set()).get(ev)!).add(f); return s; },
    off(ev, f) { handlers.get(ev)?.delete(f); return s; },
    exit(code) { s.exits.push(code); },
    emit(ev) { for (const f of [...(handlers.get(ev) ?? [])]) f(); },
    count() { let n = 0; for (const h of handlers.values()) n += h.size; return n; },
  };
  return s;
}
