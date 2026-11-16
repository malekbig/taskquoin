/**
 * Text-only judge over an OpenAI-compatible chat API (multi-LLM project A, ADR-0016). One request, one answer:
 * `POST <url>/chat/completions` with the agent's instructions (system) and the task (user) — no tools, no functions,
 * no temperature. Redirects are refused (the code never goes to another host). 429 / 5xx / timeouts / network errors
 * are retried twice (2 s, 8 s, or a Retry-After under 30 s), then TransientProviderError is thrown so the workflow
 * stops in a resumable state. The key is read from the environment at call time and never appears anywhere else.
 */
import { assertTicket, invocationDigest, type RunRequest, type RunResult, type RuntimeExecutor } from '@taskquoin/application';
import { normalizeGrants } from '@taskquoin/domain';

export const API_RUNTIME_VERSION = '1';
const RETRY_WAITS_MS = [2000, 8000];
const MAX_RETRY_AFTER_S = 30;
const MAX_ERROR_CHARS = 300;

export interface ApiProvider { id: string; url: string; model: string; keyEnv?: string; maxOutputTokens: number; timeoutSeconds: number;
  tokenField: 'max_tokens' | 'max_completion_tokens' }

/** The provider kept failing in a way that may pass later (rate limit, outage, timeout): the run can be resumed. */
export class TransientProviderError extends Error {
  constructor(message: string) { super(message); this.name = 'TransientProviderError'; }
}

type Outcome = { kind: 'ok'; content: string; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }
  | { kind: 'transient'; why: string; retryAfterS?: number }
  | { kind: 'fail'; why: string; truncated?: boolean };

async function readCapped(res: Response, cap: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) return { text: '', truncated: false };
  const reader = res.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) { await reader.cancel(); return { text: '', truncated: true }; }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated: false };
}

export class ApiExecutor implements RuntimeExecutor {
  readonly runtime = 'api' as const;
  private readonly p: ApiProvider;
  private readonly env: NodeJS.ProcessEnv;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(p: ApiProvider, o: { env?: NodeJS.ProcessEnv; sleep?: (ms: number) => Promise<void> } = {}) {
    this.p = p;
    this.env = o.env ?? process.env;
    this.sleep = o.sleep ?? ((ms) => new Promise(r => setTimeout(r, ms)));
  }

  async run(req: RunRequest, signal?: AbortSignal): Promise<RunResult> {
    assertTicket(req.ticket, 'api', API_RUNTIME_VERSION, req.agent.capabilities, req.agent.id);
    if (Object.keys(normalizeGrants(req.agent.capabilities)).length) throw new Error('refusing: an api judge has no capability (text in, text out)');
    const started = Date.now();
    const endpoint = this.p.url.replace(/\/+$/, '') + '/chat/completions';
    const origin = new URL(endpoint).origin;
    const base = { runtime: 'api' as const, runtimeVersion: API_RUNTIME_VERSION, exitCode: null,
      command: { bin: origin, args: [this.p.model], cwd: req.cwd },
      effectiveConfigDigest: invocationDigest(origin, [this.p.model, this.p.tokenField, String(this.p.maxOutputTokens)], {}),
      inventory: { tools: [], mcpServers: [], plugins: [], skills: [], agents: [req.agent.id], model: this.p.model }, unsupported: [] as string[] };
    const key = this.p.keyEnv ? this.env[this.p.keyEnv] : undefined;
    // The key is removed from the WHOLE text first, then cut (cutting first could leave a fragment of the key).
    const scrub = (s: string) => (key ? s.split(key).join('[redacted]') : s);
    const redact = (s: string) => scrub(s).slice(0, MAX_ERROR_CHARS);
    const done = (status: RunResult['status'], extra: Partial<RunResult>): RunResult =>
      ({ ...base, status, stdoutTruncated: false, stderr: '', durationMs: Date.now() - started, ...extra });
    if (this.p.keyEnv && !key?.trim()) return done('failed', { stderr: `${this.p.id}: ${this.p.keyEnv} absente — rien n'a été envoyé` });

    const body = JSON.stringify({ model: this.p.model, messages: [{ role: 'system', content: req.agent.prompt }, { role: 'user', content: req.task }],
      [this.p.tokenField]: this.p.maxOutputTokens, stream: false });
    for (let attempt = 0; ; attempt++) {
      const o = await this.attempt(endpoint, body, key, req.maxOutputBytes, signal);
      if (signal?.aborted) return done('cancelled', { stderr: 'cancelled' });
      if (o.kind === 'ok') {
        const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : undefined); // never trust a provider's types
        const inputTokens = n(o.usage?.prompt_tokens), outputTokens = n(o.usage?.completion_tokens);
        return done('completed', { exitCode: 0, terminalMessage: scrub(o.content), // a provider echoing the key never gets it stored
          usage: { ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}) } });
      }
      if (o.kind === 'fail') return done('failed', { stderr: redact(`${this.p.id}: ${o.why}`), stdoutTruncated: !!o.truncated });
      if (attempt >= RETRY_WAITS_MS.length) throw new TransientProviderError(redact(`${this.p.id}: ${o.why} (after ${attempt + 1} attempts)`));
      await this.sleep(o.retryAfterS !== undefined && o.retryAfterS < MAX_RETRY_AFTER_S ? o.retryAfterS * 1000 : RETRY_WAITS_MS[attempt]);
    }
  }

  private async attempt(endpoint: string, body: string, key: string | undefined, cap: number, signal?: AbortSignal): Promise<Outcome> {
    let res: Response;
    try {
      res = await fetch(endpoint, { method: 'POST', body, redirect: 'error',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
        signal: AbortSignal.any([AbortSignal.timeout(this.p.timeoutSeconds * 1000), ...(signal ? [signal] : [])]) });
    } catch (e) {
      const err = e as Error & { cause?: { message?: string } };
      const msg = `${err.message} ${err.cause?.message ?? ''}`;
      if (/redirect/i.test(msg)) return { kind: 'fail', why: 'redirect refused — the code is never sent to another host' };
      return { kind: 'transient', why: err.name === 'TimeoutError' ? `no answer within ${this.p.timeoutSeconds} s` : `network error (${msg.trim()})` };
    }
    let read: { text: string; truncated: boolean };
    try { read = await readCapped(res, cap); } catch (e) { return { kind: 'transient', why: `connection lost while reading (${(e as Error).message})` }; }
    if (res.status === 429 || res.status >= 500) {
      const ra = Number(res.headers.get('retry-after'));
      return { kind: 'transient', why: `HTTP ${res.status}`, ...(Number.isFinite(ra) && ra >= 0 && res.headers.get('retry-after') ? { retryAfterS: ra } : {}) };
    }
    if (res.status >= 300) return { kind: 'fail', why: `HTTP ${res.status}: ${read.text}` }; // cut AFTER the key is removed (run)
    if (read.truncated) return { kind: 'fail', why: 'answer larger than the output budget', truncated: true };
    let data: { choices?: { finish_reason?: unknown; message?: { content?: unknown; tool_calls?: unknown[] } }[]; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } };
    try { data = JSON.parse(read.text); } catch { return { kind: 'fail', why: 'the answer is not JSON (proxy or wrong url?)' }; }
    const m = data?.choices?.[0]?.message;
    if (!m) return { kind: 'fail', why: 'no choices[0].message in the answer' };
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) return { kind: 'fail', why: 'the model asked for tools — a judge answers with text only' };
    if (data.choices![0].finish_reason === 'length') return { kind: 'fail', why: `réponse coupée à maxOutputTokens ${this.p.maxOutputTokens} — augmentez providers.${this.p.id}.maxOutputTokens dans taskquoin.yaml` };
    if (typeof m.content !== 'string' || !m.content.trim()) return { kind: 'fail', why: 'empty answer' };
    return { kind: 'ok', content: m.content, ...(data.usage ? { usage: data.usage } : {}) };
  }
}
