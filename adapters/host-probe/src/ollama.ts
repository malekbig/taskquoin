/**
 * Local Ollama detection for `taskquoin init` (multi-LLM A): asks the LOCAL server which models are installed. Nothing
 * leaves the machine; any failure (nothing listening, timeout, not Ollama) is just "not detected".
 */
export async function probeOllama(o: { url?: string; timeoutMs?: number } = {}): Promise<string[] | undefined> {
  try {
    const res = await fetch(`${(o.url ?? 'http://localhost:11434').replace(/\/+$/, '')}/api/tags`, { redirect: 'error', signal: AbortSignal.timeout(o.timeoutMs ?? 500) });
    if (!res.ok) return undefined;
    const data = await res.json() as { models?: { name?: unknown }[] };
    if (!Array.isArray(data.models)) return undefined;
    return data.models.map(m => m.name).filter((n): n is string => typeof n === 'string' && n.length > 0);
  } catch { return undefined; }
}
