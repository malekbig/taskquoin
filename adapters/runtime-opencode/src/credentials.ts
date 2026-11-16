/**
 * Taskquoin's own OpenCode connection (spec §5.2): one per user under the control-store base, never the user's personal
 * OpenCode. Each run gets fresh dirs holding ONLY the credential of its model's provider, plus the models catalogue and
 * the plugin manifests fetched at connect time (measured, Task 1). Credential values are never returned or printed.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ensureTrustedDir, stateBase } from '@taskquoin/store-fs';
import { authPath, AUTH_TYPE_FIELD, isolationEnv, modelsPath, pluginDir, PLUGIN_MANIFESTS, type OpenCodeDirs } from './facts.ts';

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function dirsUnder(root: string): OpenCodeDirs {
  const d = { config: join(root, 'config'), data: join(root, 'data'), cache: join(root, 'cache'), state: join(root, 'state') };
  for (const p of Object.values(d)) mkdirSync(p, { recursive: true, mode: 0o700 });
  return d;
}

/** `<base>/opencode/{config,data,cache,state}`, 0700 (refuses a symlinked or loose directory). */
export function userOpenCodeDirs(base: string = stateBase()): OpenCodeDirs {
  return dirsUnder(ensureTrustedDir(join(base, 'opencode')));
}
/** The same paths, without creating anything (doctor / gate only read them). */
export function userOpenCodePaths(base: string = stateBase()): OpenCodeDirs {
  const r = join(base, 'opencode'); return { config: join(r, 'config'), data: join(r, 'data'), cache: join(r, 'cache'), state: join(r, 'state') };
}

function readAuth(d: OpenCodeDirs): Record<string, unknown> | undefined {
  try { const x = JSON.parse(readFileSync(authPath(d), 'utf8')); return isObj(x) ? x : undefined; } catch { return undefined; }
}
function writeAuth(d: OpenCodeDirs, entries: Record<string, unknown>): void {
  const p = authPath(d); mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  const tmp = `${p}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(entries), { mode: 0o600 }); renameSync(tmp, p);
}

/** Connected providers and their non-secret kind (e.g. `oauth` = ChatGPT sign-in, `api` = key). */
export function connectedProviders(d: OpenCodeDirs): { id: string; type: string }[] {
  const a = readAuth(d); if (!a) return [];
  return Object.entries(a).filter(([, v]) => isObj(v)).map(([id, v]) => ({ id, type: typeof (v as Record<string, unknown>)[AUTH_TYPE_FIELD] === 'string' ? String((v as Record<string, unknown>)[AUTH_TYPE_FIELD]) : 'unknown' }));
}

/** Fresh per-run dirs under `runBase` with only `providerId`'s credential (0600), the catalogue and the plugin manifests. */
export function prepareRunDirs(user: OpenCodeDirs, runBase: string, providerId: string): { root: string; dirs: OpenCodeDirs; initial: string } {
  const entry = readAuth(user)?.[providerId];
  if (!isObj(entry)) throw new Error(`fournisseur "${providerId}" non connecté pour Taskquoin — lancez : taskquoin connect opencode`);
  const root = mkdtempSync(join(ensureTrustedDir(runBase), 'oc-'));
  const dirs = dirsUnder(root);
  writeAuth(dirs, { [providerId]: entry });
  if (existsSync(modelsPath(user))) { mkdirSync(dirname(modelsPath(dirs)), { recursive: true, mode: 0o700 }); copyFileSync(modelsPath(user), modelsPath(dirs)); }
  mkdirSync(pluginDir(dirs), { recursive: true, mode: 0o700 });
  for (const f of PLUGIN_MANIFESTS) if (existsSync(join(pluginDir(user), f))) copyFileSync(join(pluginDir(user), f), join(pluginDir(dirs), f));
  return { root, dirs, initial: JSON.stringify(entry) };
}

const expiresOf = (x: unknown) => (isObj(x) && typeof x.expires === 'number' ? x.expires : -Infinity);

/**
 * Copies `providerId`'s entry back to the user connection when THIS run refreshed it (it differs from `initial`, the
 * entry the run started with); never touches another provider. A run that changed nothing never rolls back a newer
 * credential; when two overlapping runs both refreshed, the later expiry wins (final review, Codex MEDIUM 3).
 */
export function mergeBackCredential(user: OpenCodeDirs, run: OpenCodeDirs, providerId: string, initial?: string, lockWaitMs = 2000): string | undefined {
  const fromRun = readAuth(run)?.[providerId];
  if (!isObj(fromRun)) return `credential of the run unreadable — the user connection is unchanged`;
  if (initial !== undefined && JSON.stringify(fromRun) === initial) return undefined;
  // Compare-and-swap under a lock file (final review, Claude I1): overlapping runs never interleave their writes.
  const lock = `${authPath(user)}.lock`; const until = Date.now() + lockWaitMs;
  for (;;) {
    try { writeFileSync(lock, String(process.pid), { flag: 'wx', mode: 0o600 }); break; } catch { /* held */ }
    try { if (Date.now() - statSync(lock).mtimeMs > 30_000) { rmSync(lock, { force: true }); continue; } } catch { continue; } // stale
    if (Date.now() >= until) return 'connection busy (another run is saving its credential) — the user connection is unchanged';
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  try { return swap(user, providerId, fromRun, initial); } finally { rmSync(lock, { force: true }); }
}

function swap(user: OpenCodeDirs, providerId: string, fromRun: Record<string, unknown>, initial?: string): string | undefined {
  if (!existsSync(authPath(user))) return 'the connection was removed meanwhile (taskquoin connect opencode --remove) — not re-created';
  const current = readAuth(user);
  if (!current) return 'user connection unreadable — left unchanged';
  if (JSON.stringify(current[providerId]) === JSON.stringify(fromRun)) return undefined;
  if (initial !== undefined && JSON.stringify(current[providerId]) !== initial && expiresOf(current[providerId]) >= expiresOf(fromRun))
    return `a newer credential was saved meanwhile by another run — kept it`;
  try { writeAuth(user, { ...current, [providerId]: fromRun }); return undefined; }
  catch (e) { return `could not save the refreshed credential (${(e as Error).message}) — the user connection is unchanged`; }
}

/** For `taskquoin connect opencode`: the run isolation, except that the sign-in may fetch the catalogue and plugin SDK. */
export function connectEnv(d: OpenCodeDirs): Record<string, string> {
  const { OPENCODE_DISABLE_MODELS_FETCH: _f, OPENCODE_MODELS_PATH: _m, ...rest } = isolationEnv(d);
  return rest;
}
