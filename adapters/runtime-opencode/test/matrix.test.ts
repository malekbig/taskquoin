/**
 * PROVES (final review, Codex HIGH 2): the OpenCode matrix certifies only what the sandbox and the generated config
 * really enforce for reads — the whole repository. A mandatory SCOPED or DENY-ALL read restriction is refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCapabilityMatrix } from '@taskquoin/domain';
import { prepareRun } from '@taskquoin/application';

const matrix = validateCapabilityMatrix(JSON.parse(readFileSync(new URL('../src/capabilities.json', import.meta.url), 'utf8')));
const gate = (capabilities: Record<string, string[]>) => prepareRun({ agentId: 'planner', agent: { runtime: 'opencode', description: 'd', prompt: 'p', capabilities },
  mandatory: ['fs.read'], exceptions: [], matrix, facts: { runtimeVersion: '1.19.5', satisfied: ['file-sandbox', 'landing-gate'] }, now: new Date() });

test('mandatory fs.read: the whole repository is certified; a scoped or deny-all read is refused', () => {
  assert.ok(!gate({ 'fs.read': ['**'] }).failures.some(f => f.capability === 'fs.read'));
  assert.ok(gate({ 'fs.read': ['src/**'] }).failures.some(f => f.capability === 'fs.read'), 'scoped read must not be certified');
  assert.ok(gate({}).failures.some(f => f.capability === 'fs.read'), 'deny-all read must not be certified');
});
