/**
 * LIVE — one real call to an OpenAI-compatible provider through ApiExecutor (multi-LLM A). Spends a few tokens on the
 * owner's key. Only with TQ_E2E=1 and TQ_API_PROVIDER_URL, TQ_API_PROVIDER_MODEL, TQ_API_PROVIDER_KEY_ENV (the NAME of the
 * variable holding the key; optional TQ_API_PROVIDER_TOKEN_FIELD=max_completion_tokens).
 * PROVES: a real provider answers through the adapter; the key appears nowhere in the result (what becomes artifacts
 * and events). DOES NOT PROVE: review quality.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { capabilitiesDigest } from '@taskquoin/application';
import { ApiExecutor } from '@taskquoin/runtime-api';

const url = process.env.TQ_API_PROVIDER_URL, model = process.env.TQ_API_PROVIDER_MODEL, keyEnv = process.env.TQ_API_PROVIDER_KEY_ENV;
const live = process.env.TQ_E2E === '1' && !!url && !!model && !!keyEnv;

test('live api judge: one real call answers with a strict verdict; the key appears nowhere', { skip: live ? false : 'TQ_E2E=1 + TQ_API_PROVIDER_URL/_MODEL/_KEY_ENV not set', timeout: 300_000 }, async () => {
  const tokenField = process.env.TQ_API_PROVIDER_TOKEN_FIELD === 'max_completion_tokens' ? 'max_completion_tokens' as const : 'max_tokens' as const;
  const ex = new ApiExecutor({ id: 'live', url: url!, model: model!, keyEnv: keyEnv!, maxOutputTokens: 300, timeoutSeconds: 120, tokenField });
  const caps = {};
  const r = await ex.run({ agent: { id: 'security', description: 'live probe', prompt: 'You are a terse reviewer.', capabilities: caps },
    task: 'Reply with exactly one line and nothing else: VERDICT: APPROVE', cwd: process.cwd(), env: {}, timeoutMs: 120_000, maxOutputBytes: 1_000_000,
    ticket: { kind: 'taskquoin.gate-ticket.v1', agentId: 'security', runtime: 'api', runtimeVersion: '1', capabilitiesDigest: capabilitiesDigest(caps), issuedAt: new Date().toISOString() } });
  const line = `live-api ${new URL(url!).host} ${model} status=${r.status} tokens=${r.usage?.inputTokens}/${r.usage?.outputTokens} answer=${JSON.stringify((r.terminalMessage ?? '').slice(0, 80))}`;
  console.log(line); if (process.env.TQ_EVIDENCE_FILE) appendFileSync(process.env.TQ_EVIDENCE_FILE, line + '\n');
  assert.equal(r.status, 'completed', r.stderr);
  assert.ok(!JSON.stringify(r).includes(process.env[keyEnv!]!), 'the key never appears in the result');
});
