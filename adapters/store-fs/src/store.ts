import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, closeSync, constants, existsSync, fstatSync, openSync, readSync, readdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkTrustedDir, ensureTrustedDir } from './trusted-dir.ts';

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

/**
 * Read-only twin of `repoStore()`: same paths, creates nothing. `undefined` when the repo store does not exist;
 * throws when a directory on the way fails the trusted-dir checks. Sub-directories that do not exist yet are still
 * returned as paths (readers treat a missing file as empty).
 */
export function openRepoStoreReadOnly(repoRoot: string, base: string = stateBase()): RepoStore | undefined {
  const realRepo = realpathSync(repoRoot);
  const id = createHash('sha256').update(realRepo).digest('hex').slice(0, 16);
  const b = checkTrustedDir(base, realRepo); if (!b) return undefined;
  const repos = checkTrustedDir(join(b, 'repos'), realRepo); if (!repos) return undefined;
  const root = checkTrustedDir(join(repos, id), realRepo); if (!root) return undefined;
  const sub = (n: string) => checkTrustedDir(join(root, n), realRepo) ?? join(root, n);
  return { root, runs: sub('runs'), artifacts: sub('artifacts'), policies: sub('policies'), approvals: sub('approvals') };
}

const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/**
 * A regular file, read through ONE descriptor: opened without following a symlink (`<file> is a symlink; refusing`)
 * and without blocking (a FIFO or a device opens at once), then `fstat` must say a regular file (else `ENOTREG`), and
 * only that descriptor is read — never the path again. `maxBytes`: a larger file is refused unread (`EFBIG`, with its
 * `size`). `tailBytes`: only its last bytes (`cut` when that is not the whole file). A missing file throws ENOENT.
 */
export function readRegularFile(file: string, o: { maxBytes?: number; tailBytes?: number } = {}): { bytes: Buffer; size: number; cut: boolean } {
  let fd: number;
  try { fd = openSync(file, READ_FLAGS); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ELOOP') throw Object.assign(new Error(`${file} is a symlink; refusing`), { code: 'ELOOP' });
    throw e;
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw Object.assign(new Error(`${file} is not a regular file; refusing`), { code: 'ENOTREG' });
    const size = st.size;
    if (o.maxBytes !== undefined && size > o.maxBytes) throw Object.assign(new Error(`${file} is ${size} bytes, over ${o.maxBytes}`), { code: 'EFBIG', size });
    const len = o.tailBytes === undefined ? size : Math.min(size, Math.max(1, o.tailBytes));
    const buf = Buffer.alloc(len);
    let got = 0;
    while (got < len) { const k = readSync(fd, buf, got, len - got, size - len + got); if (k === 0) break; got += k; }
    return { bytes: buf.subarray(0, got), size, cut: size > len };
  } finally { closeSync(fd); }
}

/**
 * Tolerant reader of runs/<runId>/events.jsonl (appended without lock or fsync: the last line may be partial).
 * Keeps the last `max` (default 1000) well-formed object lines; blank lines are ignored; malformed lines, non-object
 * lines and an unterminated last line that does not parse are counted in `skipped`. A missing file is empty.
 * Only the last `tailBytes` (default 4 MiB) are read; when that starts mid-file the cut first line is dropped, not counted.
 * `cut` is true when older events exist that are not returned (the tail did not reach the file's start, or more than `max` lines).
 */
export function readEvents(store: RepoStore, runId: string, o: { max?: number; tailBytes?: number } = {}): { events: Record<string, unknown>[]; skipped: number; cut: boolean } {
  if (!RUN_ID_RE.test(runId) || runId.includes('..')) throw new Error(`invalid run id ${JSON.stringify(runId)}`);
  const file = join(store.runs, runId, 'events.jsonl');
  let text: string;
  let cut = false;
  try {
    const r = readRegularFile(file, { tailBytes: o.tailBytes ?? EVENTS_TAIL_BYTES }); // a link, a FIFO or a device is refused
    text = r.bytes.toString('utf8'); cut = r.cut;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { events: [], skipped: 0, cut: false };
    throw e;
  }
  if (cut) { const nl = text.indexOf('\n'); text = nl < 0 ? '' : text.slice(nl + 1); }
  const max = Math.max(0, o.max ?? 1000);
  const events: Record<string, unknown>[] = [];
  let skipped = 0;
  for (const ln of text.split('\n')) {
    if (ln.trim() === '') continue;
    try {
      const v = JSON.parse(ln) as unknown;
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) events.push(v as Record<string, unknown>); else skipped++;
    } catch { skipped++; }
  }
  return { events: max >= events.length ? events : events.slice(events.length - max), skipped, cut: cut || events.length > max };
}

const EVENTS_TAIL_BYTES = 4 * 1024 * 1024;
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

/**
 * Read and verify. Throws on a malformed id, a hash mismatch (tampering), or a file that is not regular (a symlink, a
 * FIFO, a device: see readRegularFile); `maxBytes`: a larger artifact is refused unread (`EFBIG`, with its `size`).
 */
export function getArtifact(store: RepoStore, sha256: string, o: { maxBytes?: number } = {}): Buffer {
  if (!SHA_RE.test(sha256)) throw new Error(`invalid artifact id ${JSON.stringify(sha256)}`);
  const { bytes } = readRegularFile(join(store.artifacts, sha256), o.maxBytes !== undefined ? { maxBytes: o.maxBytes } : {});
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
