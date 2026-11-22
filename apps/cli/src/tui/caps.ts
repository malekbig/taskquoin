/** Terminal capabilities, decided once at start-up and passed to every renderer (ADR-0019). Pure: the caller hands
 *  over the streams' facts and the environment; nothing here reads process state. */
export interface Caps {
  interactive: boolean;
  colorDepth: 0 | 4 | 8 | 24;
  charset: 'utf8' | 'ascii';
  theme: 'dark' | 'light';
  motion: boolean;
  plain: boolean;
  columns: number;
  rows: number;
}

type Env = Record<string, string | undefined>;

export function detectCaps(o: {
  stdinTTY: boolean;
  stdout: { isTTY?: boolean; columns?: number; rows?: number; getColorDepth?: (env: Env) => number };
  env: Env;
}): Caps {
  const { env, stdout } = o;
  const interactive = o.stdinTTY === true && stdout.isTTY === true;
  const dumb = env.TERM === 'dumb';
  const plain = env.TASKQUOIN_PLAIN === '1';

  let colorDepth: Caps['colorDepth'] = 0;
  if (interactive && !dumb && !(env.NO_COLOR !== undefined && env.NO_COLOR !== '') && stdout.getColorDepth) {
    let d = stdout.getColorDepth(env);
    if (d === 8 && env.WT_SESSION) d = 24;
    colorDepth = d >= 24 ? 24 : d >= 8 ? 8 : d >= 4 ? 4 : 0;
  }

  const locale = [env.LC_ALL, env.LC_CTYPE, env.LANG].find((v) => v !== undefined && v !== '') ?? '';
  const charset: Caps['charset'] = /utf-?8/i.test(locale) ? 'utf8' : 'ascii';

  let theme: Caps['theme'] = 'dark';
  if (env.TASKQUOIN_THEME === 'light' || env.TASKQUOIN_THEME === 'dark') theme = env.TASKQUOIN_THEME;
  else if (env.COLORFGBG) {
    const last = env.COLORFGBG.split(';').pop() ?? '';
    if (/^\d+$/.test(last)) {
      const n = Number(last);
      theme = n === 7 || (n >= 9 && n <= 15) ? 'light' : 'dark';
    }
  }

  const motion = interactive && !dumb && env.TASKQUOIN_NO_ANIMATION !== '1' && !plain;
  return {
    interactive, colorDepth, charset, theme, motion, plain,
    columns: stdout.columns && stdout.columns > 0 ? stdout.columns : 80,
    rows: stdout.rows && stdout.rows > 0 ? stdout.rows : 24,
  };
}
