/**
 * PROVES: both adapters' capabilities.json are well-formed, cover every canonical capability with an
 * unconditional fallback variant, and every 'measured' variant cites evidence.
 * DOES NOT PROVE: that the cited evidence is true — tests/live-contract.e2e.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAPABILITIES, PRECONDITIONS } from '../src/capabilities.ts';
import { validateCapabilityMatrix } from '../src/capability-matrix.ts';

for (const rt of ['claude', 'codex']) {
  test(`capabilities.json valid and complete: ${rt}`, () => {
    const raw = JSON.parse(readFileSync(new URL(`../../../adapters/runtime-${rt}/src/capabilities.json`, import.meta.url), 'utf8'));
    const m = validateCapabilityMatrix(raw);
    assert.equal(m.runtime, rt);
    for (const c of CAPABILITIES) assert.ok(m.entries[c]?.length, `missing capability ${c}`);
  });
}

test('validator rejects bad class, missing evidence ref, conditional fallback, unknown precondition', () => {
  const base = { runtime: 'claude', runtimeVersion: '1', measuredOn: '2026-11-15' };
  const v = { class: 'ENFORCED', mechanism: 'a long enough mechanism', evidence: 'measured', evidenceRef: 'test x' };
  assert.throws(() => validateCapabilityMatrix({ ...base, entries: { 'fs.write': [{ ...v, class: 'MAYBE' }] } }), /class/);
  assert.throws(() => validateCapabilityMatrix({ ...base, entries: { 'fs.write': [{ ...v, evidenceRef: undefined }] } }), /evidenceRef/);
  assert.throws(() => validateCapabilityMatrix({ ...base, entries: { 'fs.write': [{ ...v, when: { sandbox: 'read-only' } }] } }), /fallback/);
  assert.throws(() => validateCapabilityMatrix({ ...base, entries: { 'fs.write': [{ ...v, requires: ['magic'] }] } }), /requires/);
  assert.throws(() => validateCapabilityMatrix({ ...base, entries: { 'fs.write': [{ ...v, holdsFor: ['everything'] }] } }), /holdsFor/);
  assert.throws(() => validateCapabilityMatrix({ runtime: 'gemini', runtimeVersion: '1', measuredOn: '2026-11-15', entries: {} }), /runtime/);
});

test('opencode is a runtime and the file sandbox a precondition (project B)', () => {
  const m = validateCapabilityMatrix({ runtime: 'opencode', runtimeVersion: '1.19.5', measuredOn: '2026-11-16', entries: { 'fs.write': [{ class: 'ENFORCED', mechanism: 'bubblewrap', evidence: 'documented', requires: ['file-sandbox'] }] } });
  assert.equal(m.runtime, 'opencode');
  assert.ok((PRECONDITIONS as readonly string[]).includes('file-sandbox'));
});
