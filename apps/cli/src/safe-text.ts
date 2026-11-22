/** Text that comes from outside (paths, versions, registry answers) printed as data, and commands shown to a human. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}]/gu;

/** Control, bidi and invisible characters replaced, so they can neither drive the terminal nor hide in what is shown. */
export const safe = (s: string): string => s.replace(UNSAFE, '?');

/** One argument as a shell user would type it: as is when plain, otherwise single-quoted (a space stays visible). */
export const shellWord = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
