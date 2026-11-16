/** Canonical capability vocabulary (architecture.md §4). Runtime-neutral by construction. */
export const CAPABILITIES = [
  'fs.read', 'fs.write', 'shell.run', 'net.egress',
  'vcs.commit', 'vcs.push', 'connector.read', 'connector.write', 'config.modify',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export function isCapability(x: string): x is Capability {
  return (CAPABILITIES as readonly string[]).includes(x);
}

/** Grants with scope (globs, command patterns, hosts, connector ids). Absent or empty ⇒ not granted. */
export type CapabilityGrants = Partial<Record<Capability, string[]>>;

/** ADR-0002. */
export type EnforcementClass = 'ENFORCED' | 'BROKERED' | 'ADVISORY' | 'UNSUPPORTED';
/** `api`: a text-only judge reached through an OpenAI-compatible HTTP API (no tools — multi-LLM project A).
 *  `opencode`: OpenCode in Taskquoin's file sandbox, without commands (project B, step 1). */
export type RuntimeId = 'claude' | 'codex' | 'api' | 'opencode';
export type SandboxMode = 'read-only' | 'workspace-write';

/**
 * How we know a mechanism works. Only 'measured' (a live contract test on the pinned version, with
 * evidence) can certify a mandatory restriction; 'documented' (vendor docs/--help) and 'inferred'
 * (reasoning) are signals, not proof.
 */
export type EvidenceLevel = 'measured' | 'documented' | 'inferred';

/** Machine-checkable preconditions, satisfied (or not) by HostFacts gathered by doctor/preflight. */
/** 'bash-sandbox' = Claude Code native OS sandbox usable (bubblewrap + socat on Linux), checked by doctor. */
/** 'landing-gate' = the run goes through the Taskquoin workflow, which never commits protected-config changes. */
/** 'file-sandbox' = Taskquoin's own bubblewrap profile is usable (OpenCode agents run in it), checked by doctor. */
export const PRECONDITIONS = ['hooks-trusted', 'container-profile', 'broker-available', 'bash-sandbox', 'landing-gate', 'file-sandbox'] as const;
export type Precondition = (typeof PRECONDITIONS)[number];

/** Derived from grants; never declared by callers. */
export type RestrictionScope = 'deny-all' | 'scoped' | 'workspace';

export interface VariantCondition {
  sandbox?: SandboxMode;
  /** Variant applies when ALL of these capabilities are granted (non-empty). */
  granted?: Capability[];
  /** Variant applies when NONE of these capabilities is granted (absent or empty) — e.g. tool-absence mechanisms. */
  absent?: Capability[];
  scope?: RestrictionScope;
}

export interface CapabilityVariant {
  when?: VariantCondition;
  class: EnforcementClass;
  /** 'workspace' = mechanism only distinguishes inside vs outside the workspace (e.g. OS sandbox). Default 'pattern'. Documentation. */
  granularity?: 'workspace' | 'pattern';
  /**
   * Restriction scopes this mechanism actually enforces. Default: all for 'pattern' granularity, ['workspace'] for
   * 'workspace' granularity. A restriction whose derived scope is not listed resolves to ADVISORY (review H2).
   */
  holdsFor?: RestrictionScope[];
  mechanism: string;
  requires?: Precondition[];
  evidence: EvidenceLevel;
  /** Pointer to the test / evidence line that measured it. */
  evidenceRef?: string;
}

/** Measured per runtime version; shipped by each adapter as capabilities.json. First matching variant wins. */
export interface CapabilityMatrix {
  runtime: RuntimeId;
  runtimeVersion: string;
  measuredOn: string;
  entries: Partial<Record<Capability, CapabilityVariant[]>>;
}

/** Facts about the actual run, gathered outside the model (doctor / preflight / executor). */
export interface HostFacts {
  runtimeVersion: string;
  sandbox?: SandboxMode;
  satisfied: Precondition[];
}

export interface PolicyRestriction {
  capability: Capability;
  /** Mandatory restrictions must be certified (ENFORCED/BROKERED, measured, preconditions met) or execution is refused. */
  mandatory: boolean;
}
