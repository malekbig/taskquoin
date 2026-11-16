import { createHash } from 'node:crypto';
import { normalizeGrants, resolveEnforcement, type Capability, type CapabilityGrants, type CapabilityMatrix, type EnforcementFailure, type HostFacts, type ResolvedRestriction, type RuntimeId } from '@taskquoin/domain';

export interface GateAgent { runtime: RuntimeId; description: string; prompt: string; capabilities: CapabilityGrants }
/**
 * Owner risk acceptance, stored OUTSIDE the repository (control store) and created only by `taskquoin accept-risk`.
 * Bound to the exact failure it accepted (message digest, which names mechanism and runtime version) — Codex R3 #2/#5.
 */
export interface OwnerException { agent: string; capability: Capability; reason: string; expires: string; approvedBy: string; runtimeVersion: string; failureDigest: string }

/** Restrictions that are always mandatory; repository configuration can add to them, never remove (Codex R3 #2). */
export const BUILTIN_MANDATORY: readonly Capability[] = ['fs.write', 'net.egress', 'config.modify', 'connector.write', 'vcs.commit', 'vcs.push'];

export function failureDigest(message: string): string {
  return 'sha256:' + createHash('sha256').update(message).digest('hex');
}

/** YYYY-MM-DD that is a real calendar date. */
export function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export interface AcceptedRisk extends OwnerException { message: string }
/**
 * Proof that the gate ran for THIS agent's capabilities on THIS runtime version. Executors refuse to spawn without a
 * ticket that matches their verified binary version and the request's capabilities (Codex R3 #3: no bypass by construction).
 */
export interface GateTicket { readonly kind: 'taskquoin.gate-ticket.v1'; agentId: string; runtime: RuntimeId; runtimeVersion: string; capabilitiesDigest: string; issuedAt: string }
export interface GateResult { ok: boolean; resolved: ResolvedRestriction[]; failures: EnforcementFailure[]; warnings: string[]; acceptedRisks: AcceptedRisk[]; ticket?: GateTicket }

/** Order-independent digest of normalized grants. */
export function capabilitiesDigest(grants: CapabilityGrants): string {
  const g = normalizeGrants(grants);
  const canon = Object.keys(g).sort().map(k => [k, [...(g as Record<string, string[]>)[k]].sort()]);
  return 'sha256:' + createHash('sha256').update(JSON.stringify(canon)).digest('hex');
}

export const TICKET_TTL_MS = 15 * 60_000;
/**
 * Executors call this before spawning. Throws on a missing, expired or mismatched ticket (Codex R4 N9). A ticket is a
 * composition safeguard against accidental bypass inside Taskquoin's own process — NOT authentication.
 */
export function assertTicket(ticket: GateTicket | undefined, runtime: RuntimeId, verifiedVersion: string, grants: CapabilityGrants, agentId: string, now: Date = new Date()): void {
  if (!ticket || ticket.kind !== 'taskquoin.gate-ticket.v1') throw new Error('refusing to spawn: no gate ticket (every governed run must pass prepareRun)');
  if (ticket.agentId !== agentId) throw new Error(`refusing to spawn: ticket is for agent ${ticket.agentId}, request is for ${agentId}`);
  const age = now.getTime() - Date.parse(ticket.issuedAt);
  if (!(age >= 0 && age <= TICKET_TTL_MS)) throw new Error('refusing to spawn: gate ticket expired or not yet valid');
  if (ticket.runtime !== runtime) throw new Error(`refusing to spawn: ticket is for ${ticket.runtime}, executor is ${runtime}`);
  if (ticket.runtimeVersion !== verifiedVersion) throw new Error(`refusing to spawn: ticket certified ${runtime} ${ticket.runtimeVersion}, binary is ${verifiedVersion}`);
  if (ticket.capabilitiesDigest !== capabilitiesDigest(grants)) throw new Error('refusing to spawn: request capabilities differ from the certified ones');
}

/**
 * The gate before every run (Codex R1 N1 / R1.2 M5). Pure. An owner exception never certifies anything: it records an
 * accepted, time-limited risk so the run may proceed; it is reported in doctor output and the run's audit events.
 */
export function prepareRun(input: {
  agentId: string; agent: GateAgent; mandatory: readonly Capability[]; exceptions: readonly OwnerException[];
  matrix: CapabilityMatrix; facts: HostFacts; now: Date;
}): GateResult {
  if (input.agent.runtime !== input.matrix.runtime) throw new Error(`agent "${input.agentId}" runs on ${input.agent.runtime} but the matrix is for ${input.matrix.runtime}`);
  const mandatory = [...new Set([...BUILTIN_MANDATORY, ...input.mandatory])];
  const restrictions = mandatory.map(capability => ({ capability, mandatory: true }));
  const r = resolveEnforcement(restrictions, input.agent.capabilities, input.matrix, input.facts);
  const today = input.now.toISOString().slice(0, 10);
  const failures: EnforcementFailure[] = []; const acceptedRisks: AcceptedRisk[] = [];
  for (const f of r.failures) {
    // An exception applies only to the very failure it accepted, on the same runtime version, until the end of its
    // expiry day (UTC, inclusive).
    const ex = input.exceptions.find(e => e.agent === input.agentId && e.capability === f.capability
      && e.runtimeVersion === input.facts.runtimeVersion && e.failureDigest === failureDigest(f.message));
    if (ex && isRealDate(ex.expires) && ex.expires >= today) acceptedRisks.push({ ...ex, message: f.message });
    else failures.push(ex ? { ...f, message: `${f.message} (owner exception expired on ${ex.expires})` } : f);
  }
  const ok = failures.length === 0;
  const ticket: GateTicket | undefined = ok ? { kind: 'taskquoin.gate-ticket.v1', agentId: input.agentId, runtime: input.agent.runtime, runtimeVersion: input.facts.runtimeVersion,
    capabilitiesDigest: capabilitiesDigest(input.agent.capabilities), issuedAt: input.now.toISOString() } : undefined;
  return { ok, resolved: r.resolved, failures, warnings: r.warnings, acceptedRisks, ...(ticket ? { ticket } : {}) };
}
