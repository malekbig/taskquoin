/**
 * Where this install lives. From a source checkout the CLI runs as `.ts` (Node type stripping); from npm it runs as
 * `.js` (Node refuses to strip types under node_modules). Both keep the repository layout, so the install root is
 * three directories above apps/cli/src. File paths come from fileURLToPath: URL.pathname would keep `%20`.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Layout {
  /** Installed by npm (compiled `.js`), not a source checkout. */
  packaged: boolean;
  root: string;
  /** The PreToolUse hook entry for Claude Code. */
  hookEntry: string;
  /** The shell launcher the `taskquoin` shortcut links to — none when npm installed `taskquoin` on the PATH. */
  launcher?: string;
  version: string;
}

export function layoutOf(moduleUrl: string): Layout {
  const packaged = moduleUrl.endsWith('.js');
  const root = resolve(fileURLToPath(new URL('.', moduleUrl)), '../../..');
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
  return {
    packaged, root, version,
    hookEntry: join(root, 'adapters/hooks-claude/src', packaged ? 'main.js' : 'main.ts'),
    ...(packaged ? {} : { launcher: join(root, 'bin/taskquoin') }),
  };
}
