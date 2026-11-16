/**
 * PROVES: policy layer merging follows the precedence rules from the Codex review:
 *  - deny is absolute and cannot be relaxed by a lower-precedence layer;
 *  - ask cannot be weakened to allow by a lower layer;
 *  - a lower layer may only tighten (allow→ask→deny);
 *  - unknown sensitive operations fail closed (deny).
 * DOES NOT PROVE: that the runtime honours the merged policy (adapter concern).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergePolicyLayers, evaluate, type PolicyLayer } from '../src/policy.ts';

const builtin: PolicyLayer = { name: 'builtin', rules: [
  { capability: 'config.modify', decision: 'deny' },
  { capability: 'connector.write', decision: 'ask' },
  { capability: 'fs.write', decision: 'allow' },
]};

test('lower layer cannot turn deny into allow', () => {
  const project: PolicyLayer = { name: 'project', rules: [{ capability: 'config.modify', decision: 'allow' }] };
  const merged = mergePolicyLayers([builtin, project]);
  assert.equal(evaluate(merged, 'config.modify').decision, 'deny');
  assert.match(merged.conflicts[0], /project.*config\.modify.*cannot relax deny/);
});

test('lower layer cannot weaken ask to allow', () => {
  const project: PolicyLayer = { name: 'project', rules: [{ capability: 'connector.write', decision: 'allow' }] };
  const merged = mergePolicyLayers([builtin, project]);
  assert.equal(evaluate(merged, 'connector.write').decision, 'ask');
});

test('lower layer may tighten allow to ask or deny', () => {
  const project: PolicyLayer = { name: 'project', rules: [{ capability: 'fs.write', decision: 'deny' }] };
  const merged = mergePolicyLayers([builtin, project]);
  assert.equal(evaluate(merged, 'fs.write').decision, 'deny');
  assert.equal(merged.conflicts.length, 0);
});

test('capability without any rule fails closed', () => {
  const merged = mergePolicyLayers([builtin]);
  const r = evaluate(merged, 'net.egress');
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /no rule.*fail closed/);
});

test('evaluation reports which layer decided', () => {
  const merged = mergePolicyLayers([builtin]);
  assert.equal(evaluate(merged, 'config.modify').decidedBy, 'builtin');
});
