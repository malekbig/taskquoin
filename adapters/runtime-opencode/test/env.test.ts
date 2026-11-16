/**
 * PROVES: every variable OpenCode needs for isolation is allowed by the process runner (nothing is inherited), and the
 * allowlist never carries a credential (spec: ALLOWED_ENV_KEYS widens only with path or switch variables).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_ENV_KEYS } from '@taskquoin/process-runner';
import { CONFIG_ENV, isolationEnv } from '../src/facts.ts';

test('isolation variables are allowed; no allowed key looks like a credential', () => {
  const keys = [...Object.keys(isolationEnv({ config: '/c', data: '/d', cache: '/k', state: '/s' })), CONFIG_ENV];
  for (const k of keys) assert.ok(ALLOWED_ENV_KEYS.includes(k), k);
  assert.deepEqual(ALLOWED_ENV_KEYS.filter(k => /KEY|TOKEN|SECRET|PASS|AUTH|CRED/i.test(k)), []);
});
