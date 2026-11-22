/**
 * PROVES: one definition of "ready" for the banner and doctor — an agent whose gate is ok but whose skills fail to
 * load is blocked with the skill error as its note; ok + accepted risk is `risk`; a missing runtime is blocked with
 * the absent note; the tester follows the sandbox; every note is also a code (`noteKind`) with its raw part
 * (`detail`) and every agent is named, so the CLI translates codes, never sentences; pure (inputs untouched).
 * DOES NOT PROVE: rendering or neutralisation (apps/cli) nor the real gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReady, projectSquad, type GateVerdict } from '../src/projection/squad-view.ts';

const ok: GateVerdict = { ok: true, runtimeFound: true, failures: [], acceptedRisks: [] };
const agents = { planner: { runtime: 'claude' }, implementer: { runtime: 'codex' }, security: { runtime: 'api', provider: 'deepseek' } };

test('isReady: gate ok, runtime found and no skill error', () => {
  assert.equal(isReady(ok), true);
  assert.equal(isReady({ ...ok, skillErrors: [] }), true);
  assert.equal(isReady({ ...ok, skillErrors: ['x: bad'] }), false);
  assert.equal(isReady({ ...ok, ok: false }), false);
  assert.equal(isReady({ ...ok, runtimeFound: false }), false);
});

test('projectSquad: a skill error makes an ok agent blocked, with the error as its note', () => {
  const s = projectSquad(agents, (id) => (id === 'planner' ? { ...ok, skillErrors: ['not-approved: not approved'] } : ok), true);
  assert.equal(s[0].state, 'blocked');
  assert.equal(s[0].note, 'not-approved: not approved');
  assert.equal(s[1].state, 'ready');
  assert.equal(s[2].who, 'security · api:deepseek');
});

test('projectSquad: accepted risk is risk; absent runtime is blocked with the absent note; failure keeps its short reason', () => {
  const s = projectSquad(agents, (id) => id === 'planner' ? { ...ok, acceptedRisks: [{ capability: 'connector.write' }] }
    : id === 'implementer' ? { ...ok, ok: false, runtimeFound: false } : { ...ok, ok: false, failures: [{ message: 'KEY absent — set it' }] }, false);
  assert.deepEqual(s[0], { role: 'Planner', who: 'planner · claude', state: 'risk', note: 'connector.write', agent: 'planner', noteKind: 'risks', detail: 'connector.write' });
  assert.deepEqual(s[1], { role: 'Implementer', who: 'implementer · codex', state: 'blocked', note: 'codex not found', agent: 'implementer', noteKind: 'absent', detail: 'codex' });
  assert.deepEqual([s[2].note, s[2].noteKind, s[2].detail], ['KEY absent', 'failure', 'KEY absent']);
  assert.deepEqual(s[3], { role: 'Tester', who: 'verify · bubblewrap', state: 'blocked', note: 'bubblewrap unavailable', noteKind: 'tester' });
});

test('projectSquad: each note is also a code with its raw part, and each agent is named — so a screen translates the code, not the sentence', () => {
  const s = projectSquad(agents, (id) => (id === 'planner' ? { ...ok, skillErrors: ['not-approved: not approved'] } : ok), true, {
    role: (id) => `role(${id})`, absent: (rt) => `absent(${rt})`, testerRole: 'tester-role', testerUnavailable: 'tester-unavailable' });
  assert.deepEqual(s.map(m => [m.agent, m.role, m.noteKind, m.detail]), [
    ['planner', 'role(planner)', 'skill', 'not-approved: not approved'], ['implementer', 'role(implementer)', undefined, undefined],
    ['security', 'role(security)', undefined, undefined], [undefined, 'tester-role', undefined, undefined],
  ]);
  assert.equal(projectSquad({}, () => ok, false, { role: String, absent: String, testerRole: 'r', testerUnavailable: 'u' })[0].noteKind, 'tester');
});
