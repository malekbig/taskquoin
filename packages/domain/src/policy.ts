import type { Capability } from './capabilities.ts';

export type Decision = 'allow' | 'ask' | 'deny';
export interface PolicyRule { capability: Capability; decision: Decision }
/** Layers are ordered from highest precedence (builtin) to lowest (skill content never gets a layer). */
export interface PolicyLayer { name: string; rules: PolicyRule[] }

export interface MergedPolicy {
  rules: Map<Capability, { decision: Decision; decidedBy: string }>;
  /** Attempts by a lower layer to relax a higher layer, recorded for doctor/audit. */
  conflicts: string[];
}
export interface Evaluation { decision: Decision; decidedBy: string; reason: string }

const STRENGTH: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 };

/**
 * Merge layers: a lower-precedence layer may only tighten (allow→ask→deny).
 * Any attempt to relax is ignored and recorded as a conflict. Pure.
 */
export function mergePolicyLayers(layers: readonly PolicyLayer[]): MergedPolicy {
  const rules = new Map<Capability, { decision: Decision; decidedBy: string }>();
  const conflicts: string[] = [];
  for (const layer of layers) {
    for (const rule of layer.rules) {
      const current = rules.get(rule.capability);
      if (!current) { rules.set(rule.capability, { decision: rule.decision, decidedBy: layer.name }); continue; }
      if (STRENGTH[rule.decision] > STRENGTH[current.decision]) {
        rules.set(rule.capability, { decision: rule.decision, decidedBy: layer.name });
      } else if (STRENGTH[rule.decision] < STRENGTH[current.decision]) {
        conflicts.push(`layer "${layer.name}" tried to set ${rule.capability}=${rule.decision} but cannot relax ${current.decision} set by "${current.decidedBy}"`);
      }
    }
  }
  return { rules, conflicts };
}

/** Fail closed: a capability with no rule is denied. */
export function evaluate(policy: MergedPolicy, capability: Capability): Evaluation {
  const r = policy.rules.get(capability);
  if (!r) return { decision: 'deny', decidedBy: 'default', reason: `no rule for ${capability}: fail closed` };
  return { decision: r.decision, decidedBy: r.decidedBy, reason: `rule from layer "${r.decidedBy}"` };
}
