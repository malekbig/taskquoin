/**
 * claude-mem (thedotmack/claude-mem 15.18.4, Apache-2.0) adapter for MemoryPort — ADR-0009, ADR-0010.
 * Talks to the LOCAL worker HTTP API only (/api/health, /api/search, /api/memory/save). Never loads the plugin's hooks,
 * MCP server or observer into governed runs. Refuses to operate when claude-mem itself is configured to sync off-box.
 * Note: the worker API is unauthenticated on loopback (it only rejects browser cross-origin requests) — any local
 * process can write memories. Recalled text is therefore always framed as untrusted.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { MemoryPort, MemoryRecall, RunSummary } from '@taskquoin/application';

export interface ClaudeMemOptions { baseUrl?: string; timeoutMs?: number; maxRecallChars?: number; settingsFile?: string }

/** Literal loopback addresses only — `localhost` depends on name resolution (Codex R3). */
const LOOPBACK = new Set(['127.0.0.1', '[::1]', '::1']);
const ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const OFFBOX_KEYS = ['CLAUDE_MEM_CLOUD_SYNC_TOKEN', 'CLAUDE_MEM_CLOUD_SYNC_HUB_URL', 'CLAUDE_MEM_PRO_MEMORY_KEY', 'CLAUDE_MEM_PRO_MEMORY_BASE_URL'];

export class ClaudeMemMemory implements MemoryPort {
  private readonly base: URL; private readonly timeoutMs: number; private readonly maxChars: number; private readonly settingsFile: string;

  constructor(o: ClaudeMemOptions = {}) {
    this.base = new URL(o.baseUrl ?? 'http://127.0.0.1:37700');
    if (this.base.protocol !== 'http:' || !LOOPBACK.has(this.base.hostname)) throw new Error(`claude-mem worker must be a loopback http URL (ADR-0010 local-only), got ${o.baseUrl}`);
    this.timeoutMs = o.timeoutMs ?? 3000; this.maxChars = o.maxRecallChars ?? 8000;
    this.settingsFile = o.settingsFile ?? join(homedir(), '.claude-mem', 'settings.json');
  }

  /** ADR-0010: claude-mem must not be configured to send memories off-box. Unknown configuration ⇒ refuse. Values are never read out. */
  async localOnlyCheck(): Promise<{ ok: boolean; reason?: string }> {
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(this.settingsFile, 'utf8')); } catch { return { ok: false, reason: `claude-mem settings unreadable (${this.settingsFile}); cannot verify local-only` }; }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'claude-mem settings are not an object; cannot verify local-only' };
    const s = raw as Record<string, unknown>;
    const badType = OFFBOX_KEYS.filter(k => s[k] !== undefined && typeof s[k] !== 'string');
    if (badType.length) return { ok: false, reason: `claude-mem settings have unexpected types (${badType.join(', ')}); cannot verify local-only` };
    const on = OFFBOX_KEYS.filter(k => typeof s[k] === 'string' && (s[k] as string).trim() !== '');
    if (on.length) return { ok: false, reason: `claude-mem cloud sync / hosted memory is configured (${on.join(', ')}); local-only policy forbids it` };
    if (s.CLAUDE_MEM_WORKER_HOST !== undefined && typeof s.CLAUDE_MEM_WORKER_HOST !== 'string') return { ok: false, reason: 'claude-mem CLAUDE_MEM_WORKER_HOST has an unexpected type; cannot verify local-only' };
    const host = typeof s.CLAUDE_MEM_WORKER_HOST === 'string' ? s.CLAUDE_MEM_WORKER_HOST : '127.0.0.1';
    if (!LOOPBACK.has(host)) return { ok: false, reason: `claude-mem worker host ${host} is not loopback` };
    return { ok: true };
  }

  private async call(path: string, init?: { method: string; body: string }): Promise<unknown> {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await fetch(new URL(path, this.base), { method: init?.method ?? 'GET', body: init?.body, signal: ac.signal, redirect: 'error',
        headers: init ? { 'content-type': 'application/json' } : undefined });
      if (!res.ok) throw new Error(`claude-mem ${path} → HTTP ${res.status}`);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  async available(): Promise<boolean> {
    try { return (await this.call('/api/health') as { status?: string }).status === 'ok'; } catch { return false; }
  }

  async recall(query: string, project: string): Promise<MemoryRecall | undefined> {
    try {
      if (!(await this.localOnlyCheck()).ok) return undefined;
      const qs = new URLSearchParams({ query: query.slice(0, 500), project, limit: '10' });
      const r = await this.call(`/api/search?${qs}`) as { content?: { type?: string; text?: string }[] };
      const text = (r.content ?? []).filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n');
      if (!text.trim()) return undefined;
      return { source: 'claude-mem', project, query, text: text.slice(0, this.maxChars), truncated: text.length > this.maxChars };
    } catch { return undefined; }
  }

  async record(s: RunSummary): Promise<{ recorded: boolean; reason?: string }> {
    if (!ID_RE.test(s.runId) || s.runId.includes('..')) throw new Error(`invalid runId ${JSON.stringify(s.runId)}`);
    const check = await this.localOnlyCheck();
    if (!check.ok) return { recorded: false, reason: check.reason };
    const lines = [
      `Taskquoin governed run ${s.runId} (workflow ${s.workflow}) finished with status ${s.status}.`,
      s.tests ? `Tests: ${s.tests.passed} passed, ${s.tests.failed} failed (verified by Taskquoin, not by the model).` : 'Tests: verified by Taskquoin in its sandbox (see decisions).',
      `Files changed (${s.filesChanged.length}): ${s.filesChanged.slice(0, 50).join(', ') || 'none'}`,
      ...s.decisions.slice(0, 20).map(d => `Decision: ${d.slice(0, 200)}`),
    ];
    try {
      await this.call('/api/memory/save', { method: 'POST', body: JSON.stringify({
        title: `Taskquoin run ${s.runId}: ${s.workflow} ${s.status}`.slice(0, 200), text: lines.join('\n'), project: s.project,
        metadata: { source: 'taskquoin', runId: s.runId, workflow: s.workflow, status: s.status },
      }) });
      return { recorded: true };
    } catch (e) { return { recorded: false, reason: (e as Error).message }; }
  }
}

/** Framing lives in the application layer (used by the workflow); re-exported for compatibility. */
export { memoryContextBlock } from '@taskquoin/application';
