/**
 * The dashboard's top bar and footer. State = glyph + word, always together: the run's glyph and word are the last thing
 * either line gives up. Width is by display columns; what does not fit goes in a fixed order (version, branch, risks,
 * ready, repository, the word "taskquoin"), never the state. Strings from outside arrive neutral and are re-neutralised
 * here (idempotent). Pure.
 */
import type { WorkflowStatus } from '@taskquoin/application';
import { t, tn } from '../../i18n/index.ts';
import { displayWidth } from '../../i18n/width.ts';
import type { Caps } from '../caps.ts';
import { n } from '../neutral.ts';
import { cut } from '../text.ts';
import { bold, ellipsis, glyph, paint, stateToken, type StateName, type Token } from '../tokens.ts';

export type Liveness = 'live' | 'none' | 'unknown';
export type RunStatusView = WorkflowStatus | 'unreadable';

/** `running` is shown running only when the process is known alive; otherwise it is unknown (`not running?`). */
export function runState(status: RunStatusView, liveness?: Liveness): StateName {
  switch (status) {
    case 'running': return liveness === 'live' ? 'running' : 'unknown';
    case 'waiting-approval': case 'needs-human': return 'waiting';
    case 'completed': return 'done';
    case 'failed': return 'failed';
    case 'interrupted': return 'interrupted';
    default: return 'unknown';
  }
}

export function statusWord(status: RunStatusView, liveness?: Liveness): string {
  switch (status) {
    case 'running': return liveness === 'live' ? t('dashboard.status.running') : t('dashboard.status.notRunning');
    case 'waiting-approval': return t('dashboard.status.waiting');
    case 'needs-human': return t('dashboard.status.needsHuman');
    case 'completed': return t('dashboard.status.done');
    case 'failed': return t('dashboard.status.failed');
    case 'interrupted': return t('dashboard.status.interrupted');
    default: return t('dashboard.status.unreadable');
  }
}

export interface TopBar {
  version: string; repo: string; branch?: string;
  run?: { short: string; status: RunStatusView; liveness?: Liveness };
  ready: number; total: number; acceptedRisks: number;
}

type Seg = [text: string, token?: Token];
const widthOf = (segs: Seg[]): number => segs.reduce((a, [s]) => a + displayWidth(s), 0);
const paintSegs = (segs: Seg[], caps: Caps): string => segs.map(([s, tok]) => (tok ? paint(tok, s, caps) : s)).join('');

export function renderTopBar(m: TopBar, caps: Caps): string {
  const ascii = caps.charset !== 'utf8';
  const logo = ascii ? '#' : '▙', bar = ascii ? '|' : '│', dot = ascii ? '-' : '·';
  const state = m.run ? runState(m.run.status, m.run.liveness) : undefined;
  const stateSeg = (): Seg => [`${glyph(state!, caps)} ${statusWord(m.run!.status, m.run!.liveness)}`, stateToken(state!)];
  const runSegs = (): Seg[] => (m.run ? [[t('dashboard.top.run', { short: n(m.run.short) }) + ' '], stateSeg()] : [[t('dashboard.top.noRun'), 'muted']]);
  const flags = { version: true, branch: true, risks: true, ready: true, repo: true, name: true };
  const build = (k: typeof flags): Seg[] => {
    const parts: Seg[][] = [];
    parts.push([[logo, 'mint'], ...(k.name ? [[` taskquoin${k.version && m.version ? ' ' + n(m.version) : ''}`, 'muted'] as Seg] : [])]);
    if (k.repo) parts.push([[n(m.repo)], ...(k.branch && m.branch ? [[' ' + n(m.branch), 'muted'] as Seg] : [])]);
    parts.push(runSegs());
    if (k.ready) {
      const agents: Seg[] = [[t('dashboard.top.agents', { ready: m.ready, total: m.total })]];
      if (k.risks && m.acceptedRisks > 0) agents.push([` ${dot} ${tn('dashboard.top.risks', m.acceptedRisks)}`, 'muted']);
      parts.push(agents);
    }
    return parts.flatMap((p, i): Seg[] => (i === 0 ? p : [[` ${bar} `, 'line'], ...p]));
  };
  const order: (keyof typeof flags)[] = ['version', 'branch', 'risks', 'ready', 'repo', 'name'];
  const k = { ...flags };
  for (let i = 0; ; i++) {
    const segs: Seg[] = [[' '], ...build(k)];
    if (widthOf(segs) <= caps.columns) return paintSegs(segs, caps);
    if (i === order.length) break;
    k[order[i]] = false;
  }
  // Only the logo and the run remain. If that is still too wide, the run id is cut first; the glyph and word stay.
  const lead: Seg[] = [[' '], [logo, 'mint'], [' ']];
  const room = caps.columns - widthOf(lead);
  if (!m.run) return paintSegs([...lead, [cut(t('dashboard.top.noRun'), Math.max(0, room), ellipsis(caps)), 'muted']], caps);
  const st = stateSeg();
  const head = cut(t('dashboard.top.run', { short: n(m.run.short) }), Math.max(0, room - displayWidth(st[0]) - 1), ellipsis(caps));
  return paintSegs([...lead, ...(head ? [[head + ' '] as Seg] : []), st], caps);
}

/**
 * `key label` pairs on the left, `right` at the right edge, `caps.columns` columns when there is a right text. Labels go
 * before keys; the right text is cut before any key is lost.
 */
export function renderFooter(keys: readonly (readonly [key: string, label: string])[], right: string, caps: Caps, rightToken: Token = 'muted'): string {
  const cols = caps.columns, more = ellipsis(caps);
  const plain = (labels: boolean): string => keys.map(([k, l]) => (labels && l ? `${k} ${l}` : k)).join(labels ? '  ' : ' ');
  const styled = (labels: boolean): string => keys.map(([k, l]) => (labels && l ? `${bold(k, caps)} ${paint('muted', l, caps)}` : bold(k, caps))).join(labels ? '  ' : ' ');
  const line = (labels: boolean, r: string): string => {
    const gap = Math.max(1, cols - 1 - displayWidth(plain(labels)) - displayWidth(r));
    return ` ${styled(labels)}${r ? ' '.repeat(gap) + paint(rightToken, r, caps) : ''}`;
  };
  const fits = (labels: boolean, r: string): boolean => 1 + displayWidth(plain(labels)) + (r ? 2 + displayWidth(r) : 0) <= cols;
  const rest = (labels: boolean): number => cols - 1 - displayWidth(plain(labels)) - 2;
  if (fits(true, right)) return line(true, right);
  if (right && rest(true) >= 12) return line(true, cut(right, rest(true), more));
  if (fits(false, right)) return line(false, right);
  if (right && rest(false) >= 4) return line(false, cut(right, rest(false), more));
  if (fits(false, '')) return line(false, '');
  return ' ' + cut(plain(false), Math.max(0, cols - 1), more);
}
