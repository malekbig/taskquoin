import { userInfo } from 'node:os';
import { isAbsolute } from 'node:path';

/**
 * The home directory, only when it is an absolute path: `$HOME`, else the account's home (passwd), else undefined.
 * `os.homedir()` is not enough: it returns `$HOME` as it is, so an empty, `.` or relative HOME pointed the probe and
 * the installer at the current directory — the repository, whose `.npmrc` or `.claude/` would then apply.
 */
export function absoluteHome(env: Record<string, string | undefined> = process.env, account: () => string = () => userInfo().homedir): string | undefined {
  if (env.HOME && isAbsolute(env.HOME)) return env.HOME;
  try { const h = account(); return h && isAbsolute(h) ? h : undefined; } catch { return undefined; } // no passwd entry
}
