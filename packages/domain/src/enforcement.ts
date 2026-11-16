import {
  CAPABILITIES, isCapability,
  type Capability, type CapabilityGrants, type CapabilityMatrix, type CapabilityVariant, type EnforcementClass,
  type HostFacts, type PolicyRestriction, type RestrictionScope,
} from './capabilities.ts';

export interface ResolvedRestriction extends PolicyRestriction {
  class: EnforcementClass;
  scope: RestrictionScope;
  mechanism: string;
  certified: boolean;
}
export interface EnforcementFailure { capability: Capability; class: EnforcementClass; message: string }
export interface EnforcementResult { ok: boolean; resolved: ResolvedRestriction[]; failures: EnforcementFailure[]; warnings: string[] }

/** Drop empty grants: an empty list grants nothing (Codex R1 N2). */
export function normalizeGrants(g: CapabilityGrants): CapabilityGrants {
  const out: CapabilityGrants = {};
  for (const [k, v] of Object.entries(g) as [Capability, string[] | undefined][]) if (v && v.length > 0) out[k] = [...v];
  return out;
}

/** Globs that mean the whole workspace. NOT '*' (top-level entries only) — review H3. */
const WHOLE = new Set(['**', './**']);
/** What a restriction on `capability` must hold, derived from the grant alone. */
export function restrictionScope(capability: Capability, grants: CapabilityGrants): RestrictionScope {
  const g = normalizeGrants(grants)[capability];
  if (!g) return 'deny-all';
  if ((capability === 'fs.read' || capability === 'fs.write') && g.every(x => WHOLE.has(x))) return 'workspace';
  return 'scoped';
}

function matches(v: CapabilityVariant, scope: RestrictionScope, grants: CapabilityGrants, facts: HostFacts): boolean {
  const w = v.when;
  if (!w) return true;
  if (w.sandbox && w.sandbox !== facts.sandbox) return false;
  if (w.scope && w.scope !== scope) return false;
  if (w.granted && !w.granted.every(c => (grants[c]?.length ?? 0) > 0)) return false;
  if (w.absent && w.absent.some(c => (grants[c]?.length ?? 0) > 0)) return false;
  return true;
}

/**
 * Pure, deterministic, fail closed. A mandatory restriction is certified only by a measured
 * ENFORCED/BROKERED mechanism, matching the run conditions, with all preconditions satisfied,
 * from a matrix measured on the installed runtime version.
 */
export function resolveEnforcement(
  restrictions: readonly PolicyRestriction[], rawGrants: CapabilityGrants, matrix: CapabilityMatrix, facts: HostFacts,
): EnforcementResult {
  const grants = normalizeGrants(rawGrants);
  const resolved: ResolvedRestriction[] = []; const failures: EnforcementFailure[] = []; const warnings: string[] = [];
  const target = `${matrix.runtime} ${facts.runtimeVersion}`;
  const versionOk = facts.runtimeVersion === matrix.runtimeVersion;

  for (const r of restrictions) {
    if (!isCapability(r.capability)) throw new Error(`unknown capability "${String(r.capability)}"; known: ${CAPABILITIES.join(', ')}`);
    const scope = restrictionScope(r.capability, grants);
    let cls: EnforcementClass; let mechanism: string; let problem: string | undefined;

    const variant = versionOk ? (matrix.entries[r.capability] ?? []).find(v => matches(v, scope, grants, facts)) : undefined;
    if (!versionOk) {
      cls = 'UNSUPPORTED'; mechanism = 'no matrix for this version';
      problem = `capability matrix measured for ${matrix.runtime} ${matrix.runtimeVersion}, installed ${facts.runtimeVersion}`;
    } else if (!variant) {
      cls = 'UNSUPPORTED'; mechanism = `no measured mechanism on ${target}`; problem = mechanism;
    } else {
      cls = variant.class; mechanism = variant.mechanism;
      const holds = variant.holdsFor ?? (variant.granularity === 'workspace' ? ['workspace'] : ['deny-all', 'scoped', 'workspace']);
      if (!holds.includes(scope) && (cls === 'ENFORCED' || cls === 'BROKERED')) {
        cls = 'ADVISORY'; mechanism = `${mechanism} — mechanism holds for ${holds.join('/')} only, not for a ${scope} restriction`;
      }
      const missing = (variant.requires ?? []).filter(p => !facts.satisfied.includes(p));
      if (missing.length > 0) { cls = 'UNSUPPORTED'; problem = `unmet precondition(s): ${missing.join(', ')}`; }
      else if ((cls === 'ENFORCED' || cls === 'BROKERED') && variant.evidence !== 'measured') problem = `claimed ${cls} but the mechanism is not measured (${variant.evidence})`;
      else if (cls === 'ADVISORY' || cls === 'UNSUPPORTED') problem = mechanism;
    }

    const certified = (cls === 'ENFORCED' || cls === 'BROKERED') && !problem;
    resolved.push({ ...r, class: cls, scope, mechanism, certified });
    if (certified) continue;
    const detail = problem && problem !== mechanism ? problem : `${cls} — ${mechanism}`;
    const msg = `restriction "${r.capability}" (${scope}) on ${target}: ${detail}`;
    if (r.mandatory) failures.push({ capability: r.capability, class: cls, message: `mandatory ${msg}. Execution refused (ADR-0002).` });
    else warnings.push(msg);
  }
  return { ok: failures.length === 0, resolved, failures, warnings };
}
