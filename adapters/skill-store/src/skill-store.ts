/**
 * Skill supply chain (architecture §11), local-only (ADR-0010): Taskquoin never downloads; the owner
 * fetches a repository at a pinned commit and imports a LOCAL directory. Flow: import → quarantine (control store,
 * outside the repo, never executable) → audit report → human approval → approved copy + skills.lock entry → every
 * load re-hashes the approved copy. Trust states are separate: status (quarantined/approved/revoked/invalid), findings,
 * approver. First-party skills ship with Taskquoin and are pinned by skills/first-party.lock.json.
 */
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSkill, treeHash, validateSkill, type Finding, type SkillFile } from '@taskquoin/skills';
import { ensureTrustedDir, type RepoStore } from '@taskquoin/store-fs';

const MAX_FILE = 1024 * 1024; const MAX_TOTAL = 5 * 1024 * 1024; const MAX_FILES = 500;
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type SkillStatus = 'quarantined' | 'approved' | 'revoked' | 'invalid';
export interface SkillReport { name: string; source: string; treeHash: string; status: SkillStatus; errors: string[]; findings: Finding[]; importedAt: string; path: string }
export interface LockEntry { name: string; source: string; treeHash: string; status: 'approved' | 'revoked'; approvedBy: string; approvedAt: string; acceptedFindings: string[]; revokedBy?: string; revokedAt?: string }

/** Read a local skill directory safely: no symlinks, no special files, bounded size. */
export function readSkillDir(dir: string): SkillFile[] {
  const out: SkillFile[] = []; let total = 0;
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name); const st = lstatSync(p); const rel = relative(dir, p).split('\\').join('/');
      if (st.isSymbolicLink()) throw new Error(`refusing ${rel}: symlink`);
      if (st.isDirectory()) { walk(p); continue; }
      if (!st.isFile()) throw new Error(`refusing ${rel}: not a regular file`);
      if (st.size > MAX_FILE) throw new Error(`refusing ${rel}: file too large (> ${MAX_FILE} bytes)`);
      total += st.size; if (total > MAX_TOTAL) throw new Error(`refusing skill: too large (> ${MAX_TOTAL} bytes)`);
      if (out.length >= MAX_FILES) throw new Error(`refusing skill: too many files (> ${MAX_FILES})`);
      out.push({ path: rel, bytes: readFileSync(p), exec: (st.mode & 0o111) !== 0 });
    }
  };
  walk(dir);
  return out;
}

const dirs = (s: RepoStore) => {
  const base = ensureTrustedDir(join(s.root, 'skills'));
  return { base, quarantine: ensureTrustedDir(join(base, 'quarantine')), approved: ensureTrustedDir(join(base, 'approved')), lock: join(base, 'skills.lock.json') };
};
const readLock = (s: RepoStore): LockEntry[] => { const f = dirs(s).lock; return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) as LockEntry[] : []; };
const writeLock = (s: RepoStore, l: LockEntry[]) => writeFileSync(dirs(s).lock, JSON.stringify(l, null, 2), { mode: 0o600 });
const short = (h: string) => h.slice('sha256:'.length, 'sha256:'.length + 12);

function writeCopy(files: SkillFile[], target: string) {
  for (const f of files) { const p = join(target, f.path); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, f.bytes, { mode: 0o644 }); }
}

export function importSkill(s: RepoStore, dir: string, source: string): SkillReport {
  const files = readSkillDir(dir);
  const dirName = dir.replace(/\/+$/, '').split('/').pop()!;
  const v = validateSkill(dirName, files);
  const name = v.meta?.name ?? dirName;
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(name)) throw new Error(`refusing skill: unusable name ${JSON.stringify(name)}`);
  const hash = treeHash(files);
  const target = join(dirs(s).quarantine, `${name}-${short(hash)}`);
  rmSync(target, { recursive: true, force: true }); mkdirSync(target, { mode: 0o700 });
  writeCopy(files, join(target, 'files'));
  const report: SkillReport = { name, source, treeHash: hash, status: v.errors.length ? 'invalid' : 'quarantined', errors: v.errors, findings: auditSkill(files), importedAt: new Date().toISOString(), path: join(target, 'files') };
  writeFileSync(join(target, 'report.json'), JSON.stringify(report, null, 2), { mode: 0o600 });
  return report;
}

const latestQuarantined = (s: RepoStore, name: string): SkillReport | undefined => {
  const q = dirs(s).quarantine;
  return readdirSync(q).filter(n => n.startsWith(name + '-')).map(n => JSON.parse(readFileSync(join(q, n, 'report.json'), 'utf8')) as SkillReport)
    .filter(r => r.name === name).sort((a, b) => a.importedAt.localeCompare(b.importedAt)).at(-1);
};

export function approveSkill(s: RepoStore, name: string, o: { approvedBy: string; acceptFindings?: boolean }): LockEntry {
  if (!o.approvedBy.trim()) throw new Error('approvedBy is required');
  const r = latestQuarantined(s, name);
  if (!r) throw new Error(`no quarantined skill "${name}" — import it first`);
  if (r.status === 'invalid') throw new Error(`skill "${name}" is invalid (${r.errors.join('; ')}) — cannot be approved`);
  const crit = r.findings.filter(f => f.severity === 'critical');
  if (crit.length) throw new Error(`skill "${name}" has critical findings (${crit.map(f => f.rule).join(', ')}) — blocked, cannot be approved`);
  const high = r.findings.filter(f => f.severity === 'high');
  if (high.length && !o.acceptFindings) throw new Error(`skill "${name}" has high findings (${[...new Set(high.map(f => f.rule))].join(', ')}) — review them, then approve with --accept-findings`);
  const files = readSkillDir(r.path);
  if (treeHash(files) !== r.treeHash) throw new Error(`quarantined copy of "${name}" changed since import — re-import it`);
  const target = join(dirs(s).approved, `${name}-${short(r.treeHash)}`);
  rmSync(target, { recursive: true, force: true }); writeCopy(files, target);
  const entry: LockEntry = { name, source: r.source, treeHash: r.treeHash, status: 'approved', approvedBy: o.approvedBy.trim(), approvedAt: new Date().toISOString(), acceptedFindings: [...new Set(high.map(f => f.rule))] };
  writeLock(s, [...readLock(s).filter(e => e.name !== name), entry]);
  return entry;
}

export function revokeSkill(s: RepoStore, name: string, by: string): void {
  const lock = readLock(s); const e = lock.find(x => x.name === name && x.status === 'approved');
  if (!e) throw new Error(`skill "${name}" is not approved`);
  rmSync(join(dirs(s).approved, `${name}-${short(e.treeHash)}`), { recursive: true, force: true });
  writeLock(s, lock.map(x => (x === e ? { ...x, status: 'revoked', revokedBy: by, revokedAt: new Date().toISOString() } : x)));
}

export interface LoadedSkill { name: string; text: string; treeHash: string; origin: 'first-party' | 'approved' }

/** Load an approved skill, re-hashing the approved copy (tampering ⇒ refused). */
export function loadApprovedSkill(s: RepoStore, name: string): LoadedSkill {
  const e = readLock(s).find(x => x.name === name && x.status === 'approved');
  if (!e) throw new Error(`skill "${name}" is not approved for this repository`);
  const dir = join(dirs(s).approved, `${name}-${short(e.treeHash)}`);
  if (!existsSync(dir)) throw new Error(`approved copy of "${name}" is missing`);
  const files = readSkillDir(dir);
  if (treeHash(files) !== e.treeHash) throw new Error(`skill "${name}": tree hash mismatch with skills.lock — refusing (tampered?)`);
  return { name, text: files.find(f => f.path === 'SKILL.md')!.bytes.toString('utf8'), treeHash: e.treeHash, origin: 'approved' };
}

export function listSkills(s: RepoStore): { name: string; status: SkillStatus; treeHash: string; findings: number }[] {
  const q = dirs(s).quarantine; const lock = readLock(s);
  const reports = readdirSync(q).map(n => JSON.parse(readFileSync(join(q, n, 'report.json'), 'utf8')) as SkillReport);
  const names = [...new Set([...reports.map(r => r.name), ...lock.map(l => l.name)])].sort();
  return names.map(n => {
    const l = lock.find(x => x.name === n); const r = reports.filter(x => x.name === n).at(-1);
    return { name: n, status: (l?.status ?? r?.status ?? 'quarantined') as SkillStatus, treeHash: l?.treeHash ?? r?.treeHash ?? '', findings: r?.findings.length ?? 0 };
  });
}

// ── first-party skills (shipped with Taskquoin, pinned) ──────────────────────────────────────────────────────────────
const FP_ROOT = fileURLToPath(new URL('../../../skills/', import.meta.url));
export function firstPartyLock(): Record<string, string> { return JSON.parse(readFileSync(join(FP_ROOT, 'first-party.lock.json'), 'utf8')); }
export function computeFirstPartyLock(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of readdirSync(FP_ROOT, { withFileTypes: true })) if (d.isDirectory() && NAME_RE.test(d.name)) out[d.name] = treeHash(readSkillDir(join(FP_ROOT, d.name)));
  return out;
}
export function loadFirstPartySkill(name: string): LoadedSkill {
  const lock = firstPartyLock();
  if (!Object.hasOwn(lock, name)) throw new Error(`unknown first-party skill "${name}"`);
  const files = readSkillDir(join(FP_ROOT, name));
  const h = treeHash(files);
  if (h !== lock[name]) throw new Error(`first-party skill "${name}" does not match skills/first-party.lock.json — refusing (modified Taskquoin checkout?)`);
  return { name, text: files.find(f => f.path === 'SKILL.md')!.bytes.toString('utf8'), treeHash: h, origin: 'first-party' };
}
void chmodSync; void cpSync;
