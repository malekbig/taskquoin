#!/usr/bin/env node
/**
 * Taskquoin PreToolUse hook for Claude Code. Contract (ADR-0003): read JSON on stdin, exit 0 = defer to the normal
 * permission system (never "allow"), exit 2 = deny with the reason on stderr. FAIL CLOSED: any parse, policy or
 * canonicalisation error ⇒ exit 2. Never exits 1 (Claude treats other non-zero codes as non-blocking).
 * Usage: node main.ts --policy <policy.json>
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateRules, type RulePolicy, type Violation } from '@taskquoin/rules';
import { physicalPath } from './canonical.ts';
import { mapPayload } from './payload.ts';

function deny(reason: string): never { process.stderr.write(`Taskquoin BLOCKED — ${reason}\n`); process.exit(2); }

function loadPolicy(file: string | undefined): RulePolicy {
  if (!file) throw new Error('--policy <file> is required');
  const p = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  const s = (k: string) => { if (typeof p[k] !== 'string' || !(p[k] as string).startsWith('/')) throw new Error(`policy.${k} must be an absolute path`); return physicalPath(p[k] as string); };
  if (!Array.isArray(p.writeGlobs) || p.writeGlobs.some(g => typeof g !== 'string')) throw new Error('policy.writeGlobs must be a string array');
  const vcs = p.vcs as Record<string, unknown> | undefined;
  if (!vcs || typeof vcs.commit !== 'boolean' || typeof vcs.push !== 'boolean') throw new Error('policy.vcs.{commit,push} must be booleans');
  let frozenRoots: string[] | undefined;
  if (p.frozenRoots !== undefined) {
    if (!Array.isArray(p.frozenRoots) || p.frozenRoots.some(f => typeof f !== 'string' || !f.startsWith('/'))) throw new Error('policy.frozenRoots must be absolute paths');
    frozenRoots = (p.frozenRoots as string[]).map(f => physicalPath(f));
  }
  return { projectRoot: s('projectRoot'), home: s('home'), writeGlobs: p.writeGlobs as string[], vcs: { commit: vcs.commit, push: vcs.push },
    ...(p.controlStore !== undefined ? { controlStore: s('controlStore') } : {}), ...(frozenRoots ? { frozenRoots } : {}) };
}

function main(): void {
  const argv = process.argv.slice(2);
  const policy = loadPolicy(argv[argv.indexOf('--policy') + 1] && argv.includes('--policy') ? argv[argv.indexOf('--policy') + 1] : undefined);
  const { cwd, tool, mapped } = mapPayload(JSON.parse(readFileSync(0, 'utf8')));
  let violations: Violation[] = [];
  if (mapped.kind === 'write' || mapped.kind === 'read') {
    for (const raw of mapped.rawPaths) {
      // Both views must pass: lexical (what permission rules see) and physical (what the kernel will touch).
      const candidates = [...new Set([resolve(cwd, raw), physicalPath(raw, cwd)])];
      violations = violations.concat(evaluateRules({ kind: mapped.kind, paths: candidates }, policy).violations);
    }
  } else if (mapped.kind === 'shell') {
    violations = evaluateRules({ kind: 'shell', command: mapped.command }, policy).violations;
  }
  if (violations.length) deny(`${tool}: ${violations.map(v => `${v.rule} ${v.reason}`).join('; ')}`);
  process.exit(0);
}

try { main(); } catch (e) { deny(`hook could not evaluate the call, failing closed: ${(e as Error).message}`); }
