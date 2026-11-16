/**
 * PROVES: prepareRun is the gate before every run — it refuses when a mandatory restriction cannot be certified,
 * applies ONLY owner exceptions that match agent + capability and have not expired (expired ones are reported),
 * and never turns an exception into a certification (accepted risks are listed separately for the audit log).
 * DOES NOT PROVE: the facts are true (host probe) or the matrix is true (live suite).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareRun, failureDigest, BUILTIN_MANDATORY } from '../src/use-cases/prepare-run.ts';
import type { CapabilityMatrix } from '@taskquoin/domain';

const m: CapabilityMatrix = { runtime: 'codex', runtimeVersion: '0.157.1', measuredOn: '2026-11-15', entries: {
  'fs.write': [{ when: { sandbox: 'read-only' }, class: 'ENFORCED', holdsFor: ['deny-all', 'workspace'], evidence: 'measured', evidenceRef: 'x', mechanism: 'read-only sandbox' }, { class: 'ADVISORY', evidence: 'measured', evidenceRef: 'x', mechanism: 'writer' }],
  'connector.write': [{ class: 'ENFORCED', evidence: 'inferred', mechanism: 'no MCP configured for agent runs' }],
  ...Object.fromEntries((['net.egress', 'config.modify', 'vcs.commit', 'vcs.push'] as const).map(c => [c, [{ class: 'ENFORCED', holdsFor: ['deny-all'], evidence: 'measured', evidenceRef: 'x', mechanism: `${c} measured mechanism` }]])),
} };
const agent = { runtime: 'codex' as const, description: 'd', prompt: 'p', capabilities: { 'fs.read': ['**'] } };
const facts = { runtimeVersion: '0.157.1', sandbox: 'read-only' as const, satisfied: [] };
const now = new Date('2026-11-15T12:00:00Z');

test('refuses when a mandatory restriction is not certified', () => {
  const r = prepareRun({ agentId: 'challenger', agent, mandatory: ['fs.write', 'connector.write'], exceptions: [], matrix: m, facts, now });
  assert.equal(r.ok, false);
  assert.deepEqual(r.failures.map(f => f.capability), ['connector.write']);
  assert.match(r.failures[0].message, /not measured \(inferred\)/);
});

const failureOf = (cap: 'connector.write') => prepareRun({ agentId: 'challenger', agent, mandatory: [cap], exceptions: [], matrix: m, facts, now }).failures[0];
const bound = (over: Record<string, string> = {}) => [{ agent: 'challenger', capability: 'connector.write' as const, reason: 'Codex MCP absence not measurable yet', expires: '2026-12-31', approvedBy: 'owner',
  runtimeVersion: '0.157.1', failureDigest: failureDigest(failureOf('connector.write').message), ...over }];

test('a matching, unexpired owner exception lets the run proceed, recorded as an accepted risk (not certified)', () => {
  const ex = bound();
  const r = prepareRun({ agentId: 'challenger', agent, mandatory: ['fs.write', 'connector.write'], exceptions: ex, matrix: m, facts, now });
  assert.equal(r.ok, true);
  assert.deepEqual(r.acceptedRisks.map(a => [a.capability, a.approvedBy, a.expires]), [['connector.write', 'owner', '2026-12-31']]);
  assert.equal(r.resolved.find(x => x.capability === 'connector.write')?.certified, false);
});

test('expired or mismatched exceptions do not apply', () => {
  const expired = bound({ expires: '2026-11-14' });
  const r1 = prepareRun({ agentId: 'challenger', agent, mandatory: ['connector.write'], exceptions: expired, matrix: m, facts, now });
  assert.equal(r1.ok, false); assert.match(r1.failures[0].message, /exception expired on 2026-11-14/);
  const other = bound({ agent: 'implementer', expires: '2099-01-01' });
  assert.equal(prepareRun({ agentId: 'challenger', agent, mandatory: ['connector.write'], exceptions: other, matrix: m, facts, now }).ok, false);
});

test('runtime mismatch between agent and matrix is a programming error', () => {
  assert.throws(() => prepareRun({ agentId: 'x', agent: { ...agent, runtime: 'claude' }, mandatory: [], exceptions: [], matrix: m, facts, now }), /matrix is for codex/);
});

test('ticket: issued only when ok, bound to runtime, version and capabilities', async () => {
  const { assertTicket } = await import('../src/use-cases/prepare-run.ts');
  const r = prepareRun({ agentId: 'challenger', agent, mandatory: ['fs.write'], exceptions: bound(), matrix: m, facts, now });
  assert.ok(r.ok && r.ticket, 'ok thanks to the bound acceptance of the floor restriction connector.write');
  const t0 = new Date(now.getTime() + 1000);
  assert.doesNotThrow(() => assertTicket(r.ticket, 'codex', '0.157.1', { 'fs.read': ['**'] }, 'challenger', t0));
  assert.throws(() => assertTicket(undefined, 'codex', '0.157.1', {}, 'challenger', t0), /no gate ticket/);
  assert.throws(() => assertTicket(r.ticket, 'claude', '0.157.1', { 'fs.read': ['**'] }, 'challenger', t0), /ticket is for codex/);
  assert.throws(() => assertTicket(r.ticket, 'codex', '0.158.0', { 'fs.read': ['**'] }, 'challenger', t0), /binary is 0\.158\.0/);
  assert.throws(() => assertTicket(r.ticket, 'codex', '0.157.1', { 'fs.read': ['**'], 'fs.write': ['**'] }, 'challenger', t0), /capabilities differ/);
  assert.throws(() => assertTicket(r.ticket, 'codex', '0.157.1', { 'fs.read': ['**'] }, 'implementer', t0), /ticket is for agent challenger/);
  assert.throws(() => assertTicket(r.ticket, 'codex', '0.157.1', { 'fs.read': ['**'] }, 'challenger', new Date(now.getTime() + 16 * 60_000)), /expired/);
  assert.equal(prepareRun({ agentId: 'challenger', agent, mandatory: ['connector.write'], exceptions: [], matrix: m, facts, now }).ticket, undefined);
});

test('exception bound to the failure it accepted: a different failure (e.g. version mismatch) is not covered', () => {
  const ex = bound();
  const newer = { ...facts, runtimeVersion: '0.158.0' };
  const r = prepareRun({ agentId: 'challenger', agent, mandatory: ['connector.write'], exceptions: ex, matrix: m, facts: newer, now });
  assert.equal(r.ok, false);
  assert.equal(r.acceptedRisks.length, 0);
});

test('expiry must be a real date; valid through the end of that UTC day', () => {
  assert.equal(prepareRun({ agentId: 'challenger', agent, mandatory: ['connector.write'], exceptions: bound({ expires: '2026-11-15' }), matrix: m, facts, now }).ok, true);
  assert.equal(prepareRun({ agentId: 'challenger', agent, mandatory: ['connector.write'], exceptions: bound({ expires: '2099-99-99' }), matrix: m, facts, now }).ok, false);
});

test('built-in mandatory floor applies even if the caller passes an empty list (Codex R3 #2)', () => {
  const r = prepareRun({ agentId: 'challenger', agent, mandatory: [], exceptions: [], matrix: m, facts, now });
  assert.equal(r.ok, false);
  assert.ok(BUILTIN_MANDATORY.includes('connector.write'));
  assert.ok(r.failures.some(f => f.capability === 'connector.write'));
});
