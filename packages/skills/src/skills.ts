/**
 * Agent Skills (agentskills.io spec, assessed @83021e2) validation + Taskquoin first-party requirements, and a
 * deterministic audit. Pure: takes a file listing; the importer adapter does the I/O. Findings are SIGNALS, never a
 * safety certificate: a human approves every external skill.
 */
import { createHash } from 'node:crypto';
import YAML from 'yaml';

export interface SkillFile { path: string; bytes: Buffer; exec: boolean }
export interface SkillMeta { name: string; description: string; license?: string; compatibility?: string; metadata?: Record<string, string>; allowedTools?: string; body: string }
export interface Validation { errors: string[]; meta?: SkillMeta }
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export interface Finding { rule: string; severity: Severity; file: string; message: string; evidence: string }

const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ALLOWED_FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
export const FIRST_PARTY_SECTIONS = ['When to use', 'Preconditions', 'Procedure', 'Safety rules', 'Examples', 'Test cases', 'Expected outputs', 'Evaluation criteria'];

export function validateSkill(dirName: string, files: SkillFile[], o: { firstParty?: boolean } = {}): Validation {
  const errors: string[] = [];
  const skill = files.find(f => f.path === 'SKILL.md');
  if (!skill) return { errors: ['SKILL.md missing at the skill root'] };
  const text = skill.bytes.toString('utf8');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { errors: ['SKILL.md must start with YAML frontmatter delimited by ---'] };
  let fm: unknown;
  try { const doc = YAML.parseDocument(m[1], { uniqueKeys: true }); if (doc.errors.length) throw doc.errors[0]; fm = doc.toJS({ maxAliasCount: 0 }); }
  catch (e) { return { errors: [`frontmatter is not valid YAML: ${(e as Error).message}`] }; }
  if (typeof fm !== 'object' || fm === null || Array.isArray(fm)) return { errors: ['frontmatter must be a mapping'] };
  const f = fm as Record<string, unknown>;
  for (const k of Object.keys(f)) if (!ALLOWED_FIELDS.includes(k)) errors.push(`unknown frontmatter field "${k}" (allowed: ${ALLOWED_FIELDS.join(', ')})`);
  const name = f.name;
  if (typeof name !== 'string' || name.length < 1 || name.length > 64) errors.push('name: 1–64 characters required');
  else {
    if (name.startsWith('-') || name.endsWith('-')) errors.push('name: must not start or end with a hyphen');
    if (name.includes('--')) errors.push('name: no consecutive hyphens');
    if (!/^[a-z0-9-]+$/.test(name)) errors.push('name: lowercase letters, digits and hyphens only');
    else if (!NAME_RE.test(name) && !errors.length) errors.push('name: invalid');
    if (name !== dirName) errors.push(`name "${name}" must match the directory name "${dirName}"`);
  }
  const desc = f.description;
  if (typeof desc !== 'string' || !desc.trim()) errors.push('description: required, non-empty');
  else if (desc.length > 1024) errors.push('description: at most 1024 characters');
  if (f.compatibility !== undefined && (typeof f.compatibility !== 'string' || f.compatibility.length > 500)) errors.push('compatibility: string of at most 500 characters');
  if (f.metadata !== undefined && (typeof f.metadata !== 'object' || f.metadata === null || Object.values(f.metadata).some(v => typeof v !== 'string'))) errors.push('metadata: mapping of string to string');
  if (f['allowed-tools'] !== undefined && typeof f['allowed-tools'] !== 'string') errors.push('allowed-tools: space-delimited string');
  const body = m[2];
  if (o.firstParty) for (const s of FIRST_PARTY_SECTIONS) if (!new RegExp(`^## ${s}\\s*$`, 'm').test(body)) errors.push(`missing section "## ${s}"`);
  return errors.length ? { errors } : { errors, meta: { name: name as string, description: desc as string, license: f.license as string | undefined,
    compatibility: f.compatibility as string | undefined, metadata: f.metadata as Record<string, string> | undefined, allowedTools: f['allowed-tools'] as string | undefined, body } };
}

/** Order-independent content hash over (path, exec bit, sha256(bytes)). */
export function treeHash(files: SkillFile[]): string {
  const lines = files.map(f => `${f.path}\0${f.exec ? 1 : 0}\0${createHash('sha256').update(f.bytes).digest('hex')}`).sort();
  return 'sha256:' + createHash('sha256').update(lines.join('\n')).digest('hex');
}

interface Rule { id: string; severity: Severity; message: string; re: RegExp }
const TEXT_RULES: Rule[] = [
  { id: 'SK-INJ-001', severity: 'high', message: 'prompt-injection phrasing (tries to override instructions or policy)', re: /\b(ignore|disregard|forget)\s+(all\s+|any\s+)?(the\s+)?(previous|prior|above|earlier|system)\s+(instructions|rules|prompts?|messages)\b|\boverride\s+(the\s+)?(security|policy|system|safety)\b|\bdo\s+not\s+(tell|inform)\s+the\s+user\b|\bapprove\s+(this|it)\s+(regardless|anyway)\b/i },
  { id: 'SK-INJ-002', severity: 'high', message: 'hidden Unicode (bidirectional override or zero-width characters)', re: /[‪-‮⁦-⁩​-‍⁠﻿]/ },
  { id: 'SK-INJ-003', severity: 'medium', message: 'long base64-like blob (opaque payload)', re: /[A-Za-z0-9+/]{200,}={0,2}/ },
  { id: 'SK-SH-001', severity: 'critical', message: 'downloads and pipes code into a shell', re: /\b(curl|wget|fetch)\b[^\n|]*\|\s*(sudo\s+)?(ba|z|da)?sh\b|\b(bash|sh)\s+<\s*\(\s*(curl|wget)/ },
  { id: 'SK-SH-002', severity: 'high', message: 'destructive or privileged command', re: /\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|\$HOME)(\s|$|\/)|\bchmod\s+(-R\s+)?777\b|\bsudo\b|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{\s*:\|:&\s*\};:/ },
  { id: 'SK-SEC-001', severity: 'high', message: 'references credential or secret locations', re: /~\/\.(ssh|aws|azure|kube|gnupg|docker\/config\.json|npmrc|netrc)|\bid_(rsa|ed25519|ecdsa)\b|\.env\b(?!\.example)|\bauth\.json\b|\.config\/gh\b|\bcredentials\.json\b|\bAWS_SECRET_ACCESS_KEY\b|\bGITHUB_TOKEN\b/ },
  { id: 'SK-CFG-001', severity: 'high', message: 'touches global agent configuration or disables safety switches', re: /~\/\.(claude|codex|agents)\b|\bCLAUDE_CONFIG_DIR\b|\bCODEX_HOME\b|--dangerously|\bbypassPermissions\b|--permission-mode\s+(bypass|auto)|\bdisable[-_ ]?sandbox\b|\ballowUnsandboxedCommands\b/ },
  { id: 'SK-NET-001', severity: 'medium', message: 'contains a network endpoint (review what the skill sends or fetches)', re: /\bhttps?:\/\/[^\s)>\]"']+/ },
];
const HOOK_FILES = /(^|\/)(hooks\.json|\.mcp\.json|mcp\.json|plugin\.json|settings(\.local)?\.json|hooks\/)/;

/** Deterministic findings over every text file (binary files are reported, not parsed). */
export function auditSkill(files: SkillFile[]): Finding[] {
  const out: Finding[] = [];
  for (const f of files) {
    if (HOOK_FILES.test(f.path)) out.push({ rule: 'SK-HOOK-001', severity: 'high', file: f.path, message: 'ships hooks, MCP servers, plugin or settings manifests (code that would run outside the skill text)', evidence: f.path });
    const isBinary = f.bytes.includes(0);
    if (f.exec || /^#!/.test(f.bytes.subarray(0, 2).toString()) || /(^|\/)scripts\//.test(f.path) || /\.(sh|py|js|mjs|cjs|ts|rb|pl|ps1|exe|bin)$/.test(f.path)) {
      out.push({ rule: 'SK-EXE-001', severity: 'medium', file: f.path, message: 'executable or script — review before any use; Taskquoin never runs skill scripts', evidence: f.path });
    }
    if (isBinary) { out.push({ rule: 'SK-BIN-001', severity: 'medium', file: f.path, message: 'binary file (not inspected)', evidence: f.path }); continue; }
    const text = f.bytes.toString('utf8');
    for (const r of TEXT_RULES) {
      const m = r.re.exec(text);
      if (m) out.push({ rule: r.id, severity: r.severity, file: f.path, message: r.message, evidence: JSON.stringify(m[0]).slice(0, 120) });
    }
  }
  return out;
}
