import { matchGlob } from './glob.ts';
import { HOME_SECRET_GLOBS, PROTECTED_WRITE_GLOBS, SECRET_READ_GLOBS } from './lists.ts';
import { splitSegments, tokenize } from './shell.ts';

export type RuleId = 'CONFIG001' | 'SCOPE001' | 'SECRET001' | 'GIT001' | 'FROZEN001';
export interface Violation { rule: RuleId; reason: string }
export interface RuleResult { decision: 'allow' | 'deny'; violations: Violation[] }

/** Per-run policy, written by the executor to the control store (outside the workspace). */
export interface RulePolicy {
  /** Canonical (physical) absolute project root. */
  projectRoot: string;
  /** Canonical absolute HOME. */
  home: string;
  /** Project-relative globs the agent may write. Empty ⇒ no writes. */
  writeGlobs: string[];
  vcs: { commit: boolean; push: boolean };
  /** Canonical absolute control-store root: never read or written by an agent. */
  controlStore?: string;
  /** Canonical absolute dependency directories Verify inherits read-only (ADR-0014): never written by an agent. */
  frozenRoots?: string[];
}

/** Canonical absolute paths only (see canonical.ts in the hook adapter). */
export type RuleInput =
  | { kind: 'write'; paths: string[] }
  | { kind: 'read'; paths: string[] }
  | { kind: 'shell'; command: string };

const within = (p: string, root: string) => p === root || p.startsWith(root.endsWith('/') ? root : root + '/');
const rel = (p: string, root: string) => (p === root ? '' : p.slice(root.length + (root.endsWith('/') ? 0 : 1)));

function writeViolations(p: string, pol: RulePolicy): Violation[] {
  if (pol.controlStore && within(p, pol.controlStore)) return [{ rule: 'CONFIG001', reason: `write to the Taskquoin control store (${p}) is never allowed` }];
  if (!within(p, pol.projectRoot)) return [{ rule: 'SCOPE001', reason: `write outside the project root: ${p}` }];
  const r = rel(p, pol.projectRoot);
  const frozen = pol.frozenRoots?.find(f => within(p, f));
  if (frozen) return [{ rule: 'FROZEN001', reason: `write to an inherited dependency directory (read-only during the run): ${rel(frozen, pol.projectRoot) || frozen}` }];
  if (PROTECTED_WRITE_GLOBS.some(g => matchGlob(g, r))) return [{ rule: 'CONFIG001', reason: `write to protected configuration: ${r}` }];
  if (!pol.writeGlobs.some(g => matchGlob(g, r))) return [{ rule: 'SCOPE001', reason: `write outside the agent's fs.write scope (${pol.writeGlobs.join(', ') || 'none'}): ${r}` }];
  return [];
}

function readViolations(p: string, pol: RulePolicy): Violation[] {
  if (pol.controlStore && within(p, pol.controlStore)) return [{ rule: 'SECRET001', reason: `read of the Taskquoin control store (${p})` }];
  if (within(p, pol.projectRoot) && SECRET_READ_GLOBS.some(g => matchGlob(g, rel(p, pol.projectRoot)))) return [{ rule: 'SECRET001', reason: `read of a secret file: ${rel(p, pol.projectRoot)}` }];
  if (within(p, pol.home) && HOME_SECRET_GLOBS.some(g => matchGlob(g, rel(p, pol.home)))) return [{ rule: 'SECRET001', reason: `read of a credential file: ~/${rel(p, pol.home)}` }];
  return [];
}

const HOOK_ENV = /^(HUSKY=0|LEFTHOOK=0|SKIP=.*|GIT_HOOKS_PATH=.*)$/;
const isGit = (t: string) => t === 'git' || t.endsWith('/git');

function shellViolations(command: string, pol: RulePolicy): Violation[] {
  const out: Violation[] = [];
  for (const seg of splitSegments(command)) {
    const toks = tokenize(seg);
    if (toks.some(t => HOOK_ENV.test(t))) out.push({ rule: 'GIT001', reason: `environment switches git hooks off: ${seg}` });
    const gi = toks.findIndex(isGit);
    if (gi < 0) continue;
    const args = toks.slice(gi + 1);
    let i = 0; // skip global options to find the subcommand
    while (i < args.length && args[i].startsWith('-')) {
      if (/^-c$/.test(args[i]) && /core\.hookspath/i.test(args[i + 1] ?? '')) out.push({ rule: 'GIT001', reason: `git -c core.hooksPath disables hooks: ${seg}` });
      i += (args[i] === '-c' || args[i] === '-C') ? 2 : 1;
    }
    const sub = args[i]; const rest = args.slice(i + 1);
    if (args.some(a => /^core\.hookspath/i.test(a))) out.push({ rule: 'GIT001', reason: `core.hooksPath changes the hooks directory: ${seg}` });
    if (rest.includes('--no-verify')) out.push({ rule: 'GIT001', reason: `--no-verify skips git hooks: ${seg}` });
    if (sub === 'commit') {
      // short-flag clusters before a value-taking flag: -n, -nm, -an … (quoted messages are single tokens)
      for (let k = 0; k < rest.length; k++) {
        const a = rest[k];
        if (/^-[a-zA-Z]+$/.test(a) && a.slice(1).replace(/[mFCc].*$/, '').includes('n')) { out.push({ rule: 'GIT001', reason: `git commit -n skips git hooks: ${seg}` }); break; }
        if (/^-[a-zA-Z]*[mFCc]$/.test(a)) k++; // skip the value of -m/-F/-C/-c
      }
      if (!pol.vcs.commit) out.push({ rule: 'GIT001', reason: `git commit is not granted to this agent: ${seg}` });
    }
    if (sub === 'push' && !pol.vcs.push) out.push({ rule: 'GIT001', reason: `git push is not granted to this agent: ${seg}` });
  }
  return out;
}

/** Pure and deterministic. Any violation ⇒ deny. */
export function evaluateRules(input: RuleInput, policy: RulePolicy): RuleResult {
  const violations = input.kind === 'write' ? input.paths.flatMap(p => writeViolations(p, policy))
    : input.kind === 'read' ? input.paths.flatMap(p => readViolations(p, policy))
    : shellViolations(input.command, policy);
  return { decision: violations.length ? 'deny' : 'allow', violations };
}
