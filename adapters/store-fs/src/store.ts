import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ensureTrustedDir } from './trusted-dir.ts';

/** `$XDG_STATE_HOME/taskquoin` (default `~/.local/state/taskquoin`). */
export function stateBase(): string {
  return join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'taskquoin');
}

export interface RepoStore { root: string; runs: string; artifacts: string; policies: string; approvals: string }

/** Control store for one repository, keyed by its physical path; always outside the repository (ADR-0005). */
export function repoStore(repoRoot: string, base: string = stateBase()): RepoStore {
  const realRepo = realpathSync(repoRoot);
  const id = createHash('sha256').update(realRepo).digest('hex').slice(0, 16);
  const root = ensureTrustedDir(join(ensureTrustedDir(join(ensureTrustedDir(base, realRepo), 'repos'), realRepo), id), realRepo);
  const sub = (n: string) => ensureTrustedDir(join(root, n), realRepo);
  return { root, runs: sub('runs'), artifacts: sub('artifacts'), policies: sub('policies'), approvals: sub('approvals') };
}

const SHA_RE = /^[0-9a-f]{64}$/;
export interface ArtifactMeta { mediaType: string; producer: string }
export interface ArtifactRef { sha256: string; path: string; size: number; mediaType: string; producer: string }

/** Write-once, content-addressed, read-only. Re-putting identical bytes is a no-op. */
export function putArtifact(store: RepoStore, bytes: Buffer, meta: ArtifactMeta): ArtifactRef {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const path = join(store.artifacts, sha256);
  if (!existsSync(path)) {
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o400 });
    writeFileSync(`${path}.meta.json`, JSON.stringify({ ...meta, size: bytes.length, createdAt: new Date().toISOString() }), { flag: 'wx', mode: 0o400 });
  }
  return { sha256, path, size: bytes.length, ...meta };
}

/** Read and verify. Throws on a malformed id or a hash mismatch (tampering). */
export function getArtifact(store: RepoStore, sha256: string): Buffer {
  if (!SHA_RE.test(sha256)) throw new Error(`invalid artifact id ${JSON.stringify(sha256)}`);
  const bytes = readFileSync(join(store.artifacts, sha256));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== sha256) throw new Error(`artifact ${sha256} hash mismatch (got ${actual})`);
  return bytes;
}

/** Fields that may carry prompts, model output or file content — never persisted by default (architecture §12). */
const FREE_TEXT = new Set(['prompt', 'task', 'output', 'content', 'stdin', 'stdout', 'stderr', 'terminalMessage', 'resultText', 'message', 'input']);
const RUN_ID_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** Append one metadata-only event (scalars only, free-text keys dropped) to runs/<runId>/events.jsonl. */
export function appendEvent(store: RepoStore, runId: string, event: { type: string } & Record<string, unknown>): string {
  if (!RUN_ID_RE.test(runId) || runId.includes('..')) throw new Error(`invalid run id ${JSON.stringify(runId)}`);
  const dir = ensureTrustedDir(join(store.runs, runId));
  const clean: Record<string, unknown> = { ts: new Date().toISOString() };
  for (const [k, v] of Object.entries(event)) {
    if (FREE_TEXT.has(k)) continue;
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) clean[k] = typeof v === 'string' ? v.slice(0, 256) : v;
  }
  const file = join(dir, 'events.jsonl');
  appendFileSync(file, JSON.stringify(clean) + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

/** Owner risk acceptances live in the control store, never in the repository (Codex R3 #2). */
export interface StoredRiskAcceptance { agent: string; capability: string; reason: string; expires: string; approvedBy: string; runtimeVersion: string; failureDigest: string; createdAt: string }

export function loadRiskAcceptances(store: RepoStore): StoredRiskAcceptance[] {
  const f = join(store.approvals, 'risk-acceptances.json');
  if (!existsSync(f)) return [];
  const raw = JSON.parse(readFileSync(f, 'utf8')) as unknown;
  if (!Array.isArray(raw)) throw new Error(`${f}: expected a list`);
  return raw.filter((e): e is StoredRiskAcceptance => typeof e === 'object' && e !== null
    && ['agent', 'capability', 'reason', 'expires', 'approvedBy', 'runtimeVersion', 'failureDigest', 'createdAt'].every(k => typeof (e as Record<string, unknown>)[k] === 'string'));
}

/** One acceptance per (agent, capability): a new one replaces the old one. */
export function saveRiskAcceptance(store: RepoStore, a: StoredRiskAcceptance): void {
  const f = join(store.approvals, 'risk-acceptances.json');
  const all = loadRiskAcceptances(store).filter(e => !(e.agent === a.agent && e.capability === a.capability));
  writeFileSync(f, JSON.stringify([...all, a], null, 2), { mode: 0o600 });
}

/** Atomic JSON write (tmp + rename), 0600, under runs/<runId>/. */
export function saveRunState(store: RepoStore, runId: string, state: unknown): void {
  if (!RUN_ID_RE.test(runId) || runId.includes('..')) throw new Error(`invalid run id ${JSON.stringify(runId)}`);
  const dir = ensureTrustedDir(join(store.runs, runId));
  const tmp = join(dir, `.state.${process.pid}.tmp`);
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, join(dir, 'state.json'));
}
export function loadRunState<T>(store: RepoStore, runId: string): T | undefined {
  if (!RUN_ID_RE.test(runId) || runId.includes('..')) throw new Error(`invalid run id ${JSON.stringify(runId)}`);
  const f = join(store.runs, runId, 'state.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as T : undefined;
}
export function listRuns(store: RepoStore): string[] {
  return readdirSync(store.runs, { withFileTypes: true }).filter(d => d.isDirectory() && existsSync(join(store.runs, d.name, 'state.json'))).map(d => d.name).sort();
}
