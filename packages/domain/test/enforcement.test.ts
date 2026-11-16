/**
 * PROVES: resolveEnforcement certifies a mandatory restriction only when the selected mechanism
 *  (a) matches the actual run conditions (sandbox mode, other granted capabilities, derived scope),
 *  (b) has every precondition satisfied by host facts,
 *  (c) was MEASURED (documented/inferred mechanisms cannot certify), and
 *  (d) belongs to the runtime version actually installed.
 * Scope is derived from grants, never supplied by the caller; empty grants mean "not granted".
 * Addresses Codex R1 N1/N2 and R1.1 P1 ("policy layer certifies restrictions the executor does not enforce").
 * DOES NOT PROVE: that the matrix itself is true — that is the live contract suite's job.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEnforcement, normalizeGrants, restrictionScope } from '../src/enforcement.ts';
import type { CapabilityMatrix, HostFacts } from '../src/capabilities.ts';

const claude: CapabilityMatrix = {
  runtime: 'claude', runtimeVersion: '2.1.325', measuredOn: '2026-11-15',
  entries: {
    'fs.write': [
      { when: { granted: ['shell.run'] }, class: 'ADVISORY', granularity: 'pattern', evidence: 'measured', mechanism: 'an allowed shell command can write anywhere the user can' },
      { class: 'ENFORCED', granularity: 'pattern', evidence: 'measured', mechanism: 'dontAsk + Edit(./glob) allow rules' },
    ],
    'net.egress': [{ class: 'ADVISORY', evidence: 'measured', mechanism: 'no host network control' }],
    'connector.write': [{ class: 'BROKERED', evidence: 'measured', requires: ['broker-available'], mechanism: 'Action Broker' }],
    'vcs.push': [{ class: 'ENFORCED', evidence: 'documented', mechanism: 'deny Bash(git push *)' }],
  },
};
const codex: CapabilityMatrix = {
  runtime: 'codex', runtimeVersion: '0.157.1', measuredOn: '2026-11-15',
  entries: {
    'config.modify': [
      { when: { sandbox: 'read-only' }, class: 'ENFORCED', granularity: 'workspace', holdsFor: ['deny-all', 'scoped', 'workspace'], evidence: 'measured', mechanism: 'read-only sandbox: no writes' },
      { class: 'ADVISORY', granularity: 'workspace', evidence: 'measured', mechanism: 'only .codex/ and .git/ protected for writers' },
    ],
    'fs.write': [
      { when: { sandbox: 'read-only' }, class: 'ENFORCED', granularity: 'workspace', holdsFor: ['deny-all', 'workspace'], evidence: 'measured', mechanism: 'read-only sandbox: no writes' },
      { class: 'ENFORCED', granularity: 'workspace', holdsFor: ['workspace'], evidence: 'measured', mechanism: 'workspace-write OS sandbox' },
    ],
  },
};
const facts = (over: Partial<HostFacts> = {}): HostFacts => ({ runtimeVersion: '2.1.325', satisfied: [], ...over });

test('derived scope: absent or empty grant ⇒ deny-all; ["**"] ⇒ workspace; globs ⇒ scoped', () => {
  assert.deepEqual(normalizeGrants({ 'fs.write': [], 'fs.read': ['**'] }), { 'fs.read': ['**'] });
  assert.equal(restrictionScope('fs.write', {}), 'deny-all');
  assert.equal(restrictionScope('fs.write', { 'fs.write': [] }), 'deny-all');
  assert.equal(restrictionScope('fs.write', { 'fs.write': ['**'] }), 'workspace');
  assert.equal(restrictionScope('fs.write', { 'fs.write': ['src/**'] }), 'scoped');
  assert.equal(restrictionScope('shell.run', { 'shell.run': ['npm test'] }), 'scoped');
});

test('capability interaction: granting shell.run on Claude makes fs.write restrictions ADVISORY', () => {
  const alone = resolveEnforcement([{ capability: 'fs.write', mandatory: true }], { 'fs.write': ['src/**'] }, claude, facts());
  assert.equal(alone.ok, true);
  const withShell = resolveEnforcement([{ capability: 'fs.write', mandatory: true }], { 'fs.write': ['src/**'], 'shell.run': ['npm test'] }, claude, facts());
  assert.equal(withShell.ok, false);
  assert.equal(withShell.failures[0].class, 'ADVISORY');
  assert.match(withShell.failures[0].message, /allowed shell command/);
});

test('sandbox-conditional variant: Codex config.modify ENFORCED read-only, ADVISORY for writers', () => {
  const cf = (sandbox: 'read-only' | 'workspace-write') => ({ runtimeVersion: '0.157.1', sandbox, satisfied: [] });
  assert.equal(resolveEnforcement([{ capability: 'config.modify', mandatory: true }], {}, codex, cf('read-only')).ok, true);
  const w = resolveEnforcement([{ capability: 'config.modify', mandatory: true }], { 'fs.write': ['**'] }, codex, cf('workspace-write'));
  assert.equal(w.ok, false);
  assert.equal(w.failures[0].class, 'ADVISORY');
});

test('workspace-granularity mechanism cannot enforce a glob-scoped grant (scope derived, not declared)', () => {
  const f = { runtimeVersion: '0.157.1', sandbox: 'workspace-write' as const, satisfied: [] };
  assert.equal(resolveEnforcement([{ capability: 'fs.write', mandatory: true }], { 'fs.write': ['**'] }, codex, f).ok, true);
  const scoped = resolveEnforcement([{ capability: 'fs.write', mandatory: true }], { 'fs.write': ['src/**'] }, codex, f);
  assert.equal(scoped.ok, false);
  assert.equal(scoped.failures[0].class, 'ADVISORY');
  assert.match(scoped.failures[0].message, /holds for workspace only/);
});

test('H2: a deny-all restriction is never certified by a writer-only mechanism (sandbox fact missing or wrong)', () => {
  const r = resolveEnforcement([{ capability: 'fs.write', mandatory: true }], {}, codex, { runtimeVersion: '0.157.1', satisfied: [] });
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].class, 'ADVISORY');
  const ro = resolveEnforcement([{ capability: 'fs.write', mandatory: true }], {}, codex, { runtimeVersion: '0.157.1', sandbox: 'read-only', satisfied: [] });
  assert.equal(ro.ok, true);
});

test('H3: "*" is not the whole workspace', () => {
  assert.equal(restrictionScope('fs.write', { 'fs.write': ['*'] }), 'scoped');
  assert.equal(restrictionScope('fs.write', { 'fs.write': ['./**'] }), 'workspace');
});

test('unmet precondition ⇒ UNSUPPORTED (BROKERED without a broker cannot certify)', () => {
  const r = resolveEnforcement([{ capability: 'connector.write', mandatory: true }], {}, claude, facts());
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].class, 'UNSUPPORTED');
  assert.match(r.failures[0].message, /broker-available/);
  assert.equal(resolveEnforcement([{ capability: 'connector.write', mandatory: true }], {}, claude, facts({ satisfied: ['broker-available'] })).ok, true);
});

test('documented-only mechanism cannot certify a mandatory restriction', () => {
  const r = resolveEnforcement([{ capability: 'vcs.push', mandatory: true }], {}, claude, facts());
  assert.equal(r.ok, false);
  assert.match(r.failures[0].message, /not measured \(documented\)/);
  assert.equal(resolveEnforcement([{ capability: 'vcs.push', mandatory: false }], {}, claude, facts()).warnings.length, 1);
});

test('runtime version mismatch fails every mandatory restriction closed', () => {
  const r = resolveEnforcement([{ capability: 'fs.write', mandatory: true }], { 'fs.write': ['src/**'] }, claude, facts({ runtimeVersion: '2.1.400' }));
  assert.equal(r.ok, false);
  assert.equal(r.failures[0].class, 'UNSUPPORTED');
  assert.match(r.failures[0].message, /measured for claude 2\.1\.325, installed 2\.1\.400/);
});

test('capability absent from matrix ⇒ UNSUPPORTED; advisory non-mandatory ⇒ warning only', () => {
  const r = resolveEnforcement([{ capability: 'fs.read', mandatory: true }], {}, claude, facts());
  assert.equal(r.failures[0].class, 'UNSUPPORTED');
  const w = resolveEnforcement([{ capability: 'net.egress', mandatory: false }], {}, claude, facts());
  assert.equal(w.ok, true);
  assert.match(w.warnings[0], /ADVISORY/);
});

test('unknown capability name throws, listing the canonical vocabulary', () => {
  assert.throws(() => resolveEnforcement([{ capability: 'fs.wrte' as never, mandatory: true }], {}, claude, facts()), /unknown capability "fs\.wrte".*known: fs\.read, fs\.write/);
});

test('absent condition: a variant can require that capabilities are NOT granted (tool-absence mechanisms)', () => {
  const m: CapabilityMatrix = { runtime: 'claude', runtimeVersion: '2.1.325', measuredOn: '2026-11-15', entries: {
    'net.egress': [
      { when: { absent: ['net.egress', 'shell.run'] }, class: 'ENFORCED', evidence: 'measured', evidenceRef: 'M1 tools', mechanism: 'no WebFetch/WebSearch/Bash tool at all' },
      { class: 'ADVISORY', evidence: 'measured', evidenceRef: 'x', mechanism: 'shell may reach network' },
    ] } };
  assert.equal(resolveEnforcement([{ capability: 'net.egress', mandatory: true }], { 'fs.read': ['**'] }, m, facts()).ok, true);
  assert.equal(resolveEnforcement([{ capability: 'net.egress', mandatory: true }], { 'fs.read': ['**'], 'shell.run': ['x'] }, m, facts()).ok, false);
  assert.equal(resolveEnforcement([{ capability: 'net.egress', mandatory: true }], { 'shell.run': [] }, m, facts()).ok, true, 'empty grant = absent');
});
