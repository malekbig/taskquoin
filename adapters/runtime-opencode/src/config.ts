/**
 * The OpenCode config Taskquoin generates for every run (passed in OPENCODE_CONFIG_CONTENT; the repository's and the
 * user's configs are ignored). OpenCode 1.19.5 appends this `permission` object AFTER its built-in agent rules and the
 * last matching rule wins (measured), so `"*": "deny"` first, then the few allows, then the denies they must not cover.
 * No rule can resolve to `ask` (spec anti-goal) — test/config.test.ts replays the measured evaluation order.
 */
import { PROTECTED_WRITE_GLOBS, SECRET_READ_GLOBS } from '@taskquoin/rules';
import { stepLimit } from './facts.ts';

/** Taskquoin globs → OpenCode wildcards (`*` spans `/`): as given (relative) and under any prefix (absolute paths). */
function patterns(globs: readonly string[]): string[] {
  const out = new Set<string>();
  for (const g of globs) { const w = g.replace(/\*\*\/?/g, '*'); out.add(w); if (!w.startsWith('*')) out.add(`*/${w}`); }
  return [...out];
}
const deny = (globs: readonly string[]) => Object.fromEntries(patterns(globs).map(p => [p, 'deny']));

export function opencodeConfig(o: { write: boolean; maxTurns?: number }): object {
  return {
    $schema: 'https://opencode.ai/config.json',
    autoupdate: false, share: 'disabled', lsp: false, formatter: false, mcp: {}, plugin: [], instructions: [],
    permission: {
      '*': 'deny',
      read: { '*': 'allow', ...deny(SECRET_READ_GLOBS) },
      list: 'allow', glob: 'allow', grep: 'allow',
      ...(o.write ? { edit: { '*': 'allow', ...deny([...PROTECTED_WRITE_GLOBS, ...SECRET_READ_GLOBS]) } } : {}),
    },
    ...(o.maxTurns ? stepLimit(o.maxTurns) : {}),
  };
}
