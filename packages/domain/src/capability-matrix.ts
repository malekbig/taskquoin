import {
  CAPABILITIES, PRECONDITIONS, isCapability,
  type CapabilityMatrix, type CapabilityVariant, type EnforcementClass, type EvidenceLevel, type Precondition, type RuntimeId,
} from './capabilities.ts';

const CLASSES: readonly EnforcementClass[] = ['ENFORCED', 'BROKERED', 'ADVISORY', 'UNSUPPORTED'];
const RUNTIMES: readonly RuntimeId[] = ['claude', 'codex', 'api'];
const EVIDENCE: readonly EvidenceLevel[] = ['measured', 'documented', 'inferred'];

function fail(path: string, msg: string): never { throw new Error(`capabilities${path}: ${msg}`); }
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function variant(path: string, raw: unknown): CapabilityVariant {
  if (!isObj(raw)) fail(path, 'expected object');
  if (!CLASSES.includes(raw.class as EnforcementClass)) fail(`${path}.class`, `expected one of ${CLASSES.join('|')}, got ${JSON.stringify(raw.class)}`);
  if (typeof raw.mechanism !== 'string' || raw.mechanism.length < 10) fail(`${path}.mechanism`, 'required descriptive string');
  if (!EVIDENCE.includes(raw.evidence as EvidenceLevel)) fail(`${path}.evidence`, `expected one of ${EVIDENCE.join('|')}`);
  if (raw.evidence === 'measured' && (typeof raw.evidenceRef !== 'string' || !raw.evidenceRef)) fail(`${path}.evidenceRef`, 'measured variants must cite their evidence');
  if (raw.granularity !== undefined && raw.granularity !== 'workspace' && raw.granularity !== 'pattern') fail(`${path}.granularity`, 'expected workspace|pattern');
  if (raw.holdsFor !== undefined && (!Array.isArray(raw.holdsFor) || raw.holdsFor.length === 0 || raw.holdsFor.some(x => !['deny-all', 'scoped', 'workspace'].includes(x as string)))) fail(`${path}.holdsFor`, 'expected non-empty subset of deny-all|scoped|workspace');
  if (raw.requires !== undefined && (!Array.isArray(raw.requires) || raw.requires.some(p => !PRECONDITIONS.includes(p as Precondition)))) fail(`${path}.requires`, `expected subset of ${PRECONDITIONS.join('|')}`);
  if (raw.when !== undefined) {
    if (!isObj(raw.when)) fail(`${path}.when`, 'expected object');
    const w = raw.when;
    if (w.sandbox !== undefined && w.sandbox !== 'read-only' && w.sandbox !== 'workspace-write') fail(`${path}.when.sandbox`, 'expected read-only|workspace-write');
    if (w.scope !== undefined && !['deny-all', 'scoped', 'workspace'].includes(w.scope as string)) fail(`${path}.when.scope`, 'expected deny-all|scoped|workspace');
    if (w.granted !== undefined && (!Array.isArray(w.granted) || w.granted.some(c => !isCapability(String(c))))) fail(`${path}.when.granted`, 'expected capability list');
    if (w.absent !== undefined && (!Array.isArray(w.absent) || w.absent.some(c => !isCapability(String(c))))) fail(`${path}.when.absent`, 'expected capability list');
  }
  return raw as unknown as CapabilityVariant;
}

/** Validate an untrusted JSON object into a CapabilityMatrix. Throws with a path-precise message. */
export function validateCapabilityMatrix(raw: unknown): CapabilityMatrix {
  if (!isObj(raw)) fail('', 'expected object');
  if (!RUNTIMES.includes(raw.runtime as RuntimeId)) fail('.runtime', `expected one of ${RUNTIMES.join('|')}, got ${JSON.stringify(raw.runtime)}`);
  if (typeof raw.runtimeVersion !== 'string' || !raw.runtimeVersion) fail('.runtimeVersion', 'required string');
  if (typeof raw.measuredOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.measuredOn)) fail('.measuredOn', 'expected YYYY-MM-DD');
  if (!isObj(raw.entries)) fail('.entries', 'required object');
  const entries: CapabilityMatrix['entries'] = {};
  for (const [k, v] of Object.entries(raw.entries)) {
    if (!isCapability(k)) fail(`.entries.${k}`, `unknown capability (known: ${CAPABILITIES.join(', ')})`);
    if (!Array.isArray(v) || v.length === 0) fail(`.entries.${k}`, 'expected non-empty array of variants');
    entries[k] = v.map((x, i) => variant(`.entries.${k}[${i}]`, x));
    const last = entries[k]![entries[k]!.length - 1];
    if (last.when) fail(`.entries.${k}`, 'last variant must be unconditional (fallback)');
  }
  return { runtime: raw.runtime as RuntimeId, runtimeVersion: raw.runtimeVersion, measuredOn: raw.measuredOn, entries };
}
