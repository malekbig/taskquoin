import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Selection = 'auto' | 'path';
export interface Preferences { language?: string; runtimeSelection?: { claude?: Selection } }

function readRaw(stateDir: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(stateDir, 'preferences.json'), 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* missing, unreadable or not JSON */ }
  return {};
}

export function loadPreferences(stateDir: string): Preferences {
  const raw = readRaw(stateDir);
  const out: Preferences = {};
  if (typeof raw.language === 'string') out.language = raw.language;
  const sel = raw.runtimeSelection;
  if (sel && typeof sel === 'object' && !Array.isArray(sel)) {
    const claude = (sel as { claude?: unknown }).claude;
    if (claude === 'auto' || claude === 'path') out.runtimeSelection = { claude };
  }
  return out;
}

// Merge into the existing file so unrelated keys (the language) survive; temp file + rename so a crash cannot truncate it.
// A failed save throws (the caller reports it) and removes its temporary file.
export function savePreferences(stateDir: string, patch: Pick<Preferences, 'runtimeSelection'>): void {
  const raw = readRaw(stateDir);
  const prior = raw.runtimeSelection && typeof raw.runtimeSelection === 'object' && !Array.isArray(raw.runtimeSelection) ? raw.runtimeSelection : {};
  const next = patch.runtimeSelection ? { ...raw, runtimeSelection: { ...prior, ...patch.runtimeSelection } } : raw;
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = join(stateDir, 'preferences.json');
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(next)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* the save error is the one to report */ }
    throw e;
  }
}
