// The only network read this feature adds: the npm registry, on demand (/upgrade, taskquoin upgrade). The response is
// untrusted: it is size-capped, parsed strictly and never echoed unless it matches a strict pattern.
export const REGISTRY_LATEST = 'https://registry.npmjs.org/taskquoin/latest';

export type Tool = 'claude' | 'codex' | 'opencode';
export type Latest =
  | { kind: 'latest'; version: string; measured: Partial<Record<Tool, string>> }
  | { kind: 'unpublished' }
  | { kind: 'invalid' }
  | { kind: 'offline'; reason: string };

const VERSION = /^\d{4}\.\d{1,2}\.\d+$/;
const TOOL_VERSION = /^\d+\.\d+\.\d+$/;
const TOOLS: readonly Tool[] = ['claude', 'codex', 'opencode'];

async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parse(text: string): Latest {
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return { kind: 'invalid' }; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { kind: 'invalid' };
  const d = doc as Record<string, unknown>;
  if (typeof d.version !== 'string' || !VERSION.test(d.version)) return { kind: 'invalid' };
  const measured: Partial<Record<Tool, string>> = {};
  const tq = d.taskquoin;
  const m = tq && typeof tq === 'object' ? (tq as Record<string, unknown>).measured : undefined;
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    for (const k of TOOLS) {
      const v = (m as Record<string, unknown>)[k];
      if (typeof v === 'string' && TOOL_VERSION.test(v)) measured[k] = v;
    }
  }
  return { kind: 'latest', version: d.version, measured };
}

export async function fetchLatest(
  url: string = REGISTRY_LATEST,
  o: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<Latest> {
  const timeoutMs = o.timeoutMs ?? 5000;
  const maxBytes = o.maxBytes ?? 1024 * 1024;
  try {
    const res = await fetch(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'taskquoin', accept: 'application/json' },
    });
    if (res.status === 404) { await res.body?.cancel().catch(() => {}); return { kind: 'unpublished' }; }
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return { kind: 'offline', reason: `HTTP ${res.status}` }; }
    const text = await readCapped(res, maxBytes);
    return text === null ? { kind: 'invalid' } : parse(text);
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    return { kind: 'offline', reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network error' };
  }
}

export function newerCalver(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
