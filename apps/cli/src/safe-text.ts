/** Commands shown to a human; untrusted text is neutralised by `tui/neutral.ts` (one neutraliser everywhere). */
/** One argument as a shell user would type it: as is when plain, otherwise single-quoted (a space stays visible). */
export const shellWord = (s: string): string => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
