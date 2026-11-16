/**
 * Capability → Claude Code (2.1.325) tool availability + permission rules.
 * Under --permission-mode dontAsk every tool use without an allow rule is denied, so the allow list
 * IS the grant. Deny rules take precedence over allow and are always present for config/secrets (ADR-0005).
 * Path rules: "./p" relative to cwd, "~/p" home. Edit rules cover every built-in file-editing tool.
 */
import { normalizeGrants, type CapabilityGrants } from '@taskquoin/domain';
import { HOME_SECRET_GLOBS, PROTECTED_WRITE_GLOBS, SECRET_READ_GLOBS } from '@taskquoin/rules';

export type { CapabilityGrants };
export interface ClaudePermissions { tools: string[]; allow: string[]; deny: string[] }

/**
 * Always denied, whatever the agent is granted. Generated from the shared @taskquoin/rules lists so the permission
 * compiler, the PreToolUse hook and the CI gate give one verdict (ADR-0003). The control store is added by absolute
 * path per run (claudePermissionsFor opts).
 */
export const CLAUDE_BASE_DENY: readonly string[] = [
  ...PROTECTED_WRITE_GLOBS.map(g => `Edit(./${g})`),
  ...SECRET_READ_GLOBS.map(g => `Read(./${g})`),
  ...HOME_SECRET_GLOBS.map(g => `Read(~/${g})`),
];

const RULE_UNSAFE = /[()\u0000-\u001f\u007f]/;
const HOST_RE = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;

function assertInsideWorkspace(glob: string): string {
  if (glob.trim() === '') throw new Error('fs glob is empty');
  if (RULE_UNSAFE.test(glob)) throw new Error(`fs glob ${JSON.stringify(glob)} contains characters that break permission-rule syntax`);
  if (glob.startsWith('/') || glob.startsWith('~') || glob.split('/').includes('..') || /^[A-Za-z]:/.test(glob)) {
    throw new Error(`fs glob "${glob}" points outside the workspace; only workspace-relative globs are allowed`);
  }
  return glob.startsWith('./') ? glob : `./${glob}`;
}

export interface ClaudePermissionOptions {
  /** Physical absolute path of the control store; denied for Read and Edit (`//abs` = absolute in Claude rules). */
  controlStore?: string;
}

export function claudePermissionsFor(rawCaps: CapabilityGrants, opts: ClaudePermissionOptions = {}): ClaudePermissions {
  const caps = normalizeGrants(rawCaps);
  const tools = new Set<string>();
  const allow: string[] = [];
  const deny: string[] = [...CLAUDE_BASE_DENY];
  if (opts.controlStore !== undefined) {
    if (!opts.controlStore.startsWith('/') || RULE_UNSAFE.test(opts.controlStore)) throw new Error(`controlStore must be an absolute, rule-safe path (got ${JSON.stringify(opts.controlStore)})`);
    deny.push(`Edit(/${opts.controlStore}/**)`, `Read(/${opts.controlStore}/**)`);
  }

  if (caps['fs.read']) {
    tools.add('Read').add('Grep').add('Glob');
    // Read rules also govern Grep and Glob. Always workspace-anchored (never a bare `Read`).
    for (const g of caps['fs.read']) allow.push(`Read(${assertInsideWorkspace(g)})`);
  }
  if (caps['fs.write']) {
    tools.add('Edit').add('Write');
    for (const g of caps['fs.write']) allow.push(`Edit(${assertInsideWorkspace(g)})`);
  }
  if (caps['shell.run']) {
    tools.add('Bash');
    for (const p of caps['shell.run']) {
      if (p.trim() === '' || RULE_UNSAFE.test(p)) throw new Error(`shell.run pattern ${JSON.stringify(p)} is empty or contains characters that break permission-rule syntax`);
      allow.push(`Bash(${p})`);
    }
  }
  if (caps['net.egress']) {
    tools.add('WebFetch');
    for (const h of caps['net.egress']) {
      if (!HOST_RE.test(h)) throw new Error(`net.egress host ${JSON.stringify(h)} is not a plain hostname`);
      allow.push(`WebFetch(domain:${h})`);
    }
  } else {
    deny.push('WebFetch', 'WebSearch');
  }
  if (!caps['vcs.commit']) deny.push('Bash(git commit)', 'Bash(git commit *)');
  if (!caps['vcs.push']) deny.push('Bash(git push)', 'Bash(git push *)');
  return { tools: [...tools], allow, deny };
}
