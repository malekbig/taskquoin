/**
 * The V2 home screen of the console (layouts.md: Console Full / Compact / Minimal). Pure: a model and the caps in,
 * lines out. READY is the gate's verdict (SquadView) and nothing else; every text from outside Taskquoin is made inert
 * again here (`n()` is idempotent), so a renderer never trusts its caller; no line is wider than the terminal.
 */
import type { SquadMember } from '@taskquoin/application';
import type { Caps } from '../caps.ts';
import { glyph, paint, stateToken, type Token } from '../tokens.ts';
import { cutNeutral, n, type Neutral } from '../neutral.ts';
import { displayWidth, padEndDisplay } from '../../i18n/width.ts';
import { t, tn } from '../../i18n/index.ts';
import { homeMode, LOGO_ROWS, LOGO_SIDE_COL, renderLogo, type HomeMode } from './logo.ts';

export { homeMode, LOGO_ROWS };
export type { HomeMode };

export interface HomeModel {
  version: string;
  repo: string;
  branch?: string;
  clean?: boolean;
  sandbox: { bubblewrap: boolean; socat: boolean; verify: boolean };
  policy: { digest: string; acceptedRisks: { capability: string; expires: string }[] };
  squad: SquadMember[];
  notices: { kind: 'fallback' | 'action'; text: string }[];
}

/** Taskquoin's own sandboxed Verify, the last member of the squad (projectSquad). Not an agent: it is not in the agents count. */
const TESTER_WHO = 'verify · bubblewrap';
const isTester = (m: SquadMember): boolean => m.who === TESTER_WHO;

type Seg = [Token | undefined, string];
const INDENT = 2;

/** Segments painted and clipped to `max` columns: the tail is cut (with an ellipsis), never an escape. */
function line(segs: Seg[], max: number, caps: Caps): string {
  let left = max, out = '';
  for (const [tok, text] of segs) {
    if (!text) continue;
    if (left <= 0) break;
    const w = displayWidth(text);
    const shown = w <= left ? text : cutNeutral(text as Neutral, left, { ascii: caps.charset === 'ascii' });
    left -= displayWidth(shown);
    out += tok ? paint(tok, shown, caps) : shown;
  }
  return out;
}

/**
 * A note fitted to `max` columns on a word boundary, with an ellipsis when something is left out. A text already cut
 * mid-word by an earlier stage (it ends with an ellipsis) loses that partial word. A single word longer than the room
 * is cut by characters, the only case a word is split.
 */
export function wordCut(text: string, max: number, ascii = false): string {
  const more = ascii ? '...' : '…';
  if (max <= 0) return '';
  const cut = text.endsWith('…') || text.endsWith('...');
  if (!cut && displayWidth(text) <= max) return text;
  const body = text.replace(/(…|\.\.\.)$/, '');
  const words = body.split(' ').filter(Boolean);
  if (cut) words.pop();
  while (words.length && displayWidth(words.join(' ')) + displayWidth(more) > max) words.pop();
  if (words.length) return words.join(' ') + more;
  return cutNeutral(body as Neutral, max, { ascii });
}

/** Text wrapped on spaces to `width` columns. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = []; let cur = '';
  for (const w of text.match(/\S+ {0,2}/g) ?? []) {
    if (cur && displayWidth((cur + w).trimEnd()) > width) { lines.push(cur.trimEnd()); cur = w; } else cur += w;
  }
  if (cur) lines.push(cur.trimEnd());
  return lines.length ? lines : [''];
}

/** What a refusal says, shortened by meaning: a version mismatch is "not measured", never a cut sentence. */
function blockedNote(raw: string, compact: boolean): string {
  const m = /measured for \S+ (\S+?)(?:,|\s|$)/.exec(raw);
  if (m) return compact ? t('home.note.notMeasuredShort') : t('home.note.notMeasured', { version: n(m[1]) });
  return raw;
}
function noteOf(m: SquadMember, compact: boolean): string {
  if (m.state === 'ready') return '';
  const raw = m.note ? n(m.note) : '';
  if (m.state === 'blocked') return blockedNote(raw, compact);
  return compact || !raw ? t('home.note.risk') : t('home.note.riskNote', { note: raw });
}

function actionLines(m: HomeModel, caps: Caps, width: number, withBlocked: boolean): string[] {
  const out: string[] = [];
  const texts = m.notices.map(x => ({ kind: x.kind, text: n(x.text) as string }));
  const blocked = m.squad.filter(x => x.state === 'blocked').length;
  if (withBlocked && blocked && !texts.some(x => x.kind === 'action')) {
    texts.push({ kind: 'action', text: `${glyph('waiting', caps)} ${t('home.action.label')}  ${tn('home.action.blocked', blocked)}` });
  }
  for (const x of texts) {
    const rows = wrap(x.text, width - INDENT - 3);
    rows.forEach((r, i) => {
      const pad = i ? ' '.repeat(INDENT + 3) : ' '.repeat(INDENT);
      if (x.kind === 'action') out.push(line([[undefined, pad], ['orange', r]], width, caps));
      else if (!i && r.startsWith('⬆')) out.push(line([[undefined, pad], ['cyan', '⬆'], ['muted', r.slice(1)]], width, caps));
      else out.push(line([[undefined, pad], ['muted', r]], width, caps));
    });
  }
  return out;
}

const repoShort = (repo: string): string => { const p = repo.replace(/\/+$/, '').split('/'); return p[p.length - 1] || repo; };

interface Counts { agents: number; ready: number; tester?: boolean; risks: number }
function counts(m: HomeModel): Counts {
  const agents = m.squad.filter(x => !isTester(x));
  const tester = m.squad.find(isTester);
  return { agents: agents.length, ready: agents.filter(x => x.state !== 'blocked').length, ...(tester ? { tester: tester.state !== 'blocked' } : {}), risks: m.policy.acceptedRisks.length };
}

export function renderHome(m: HomeModel, caps: Caps): string[] {
  const mode = homeMode(caps);
  const ascii = caps.charset === 'ascii';
  const width = mode === 'full' ? Math.min(caps.columns, 100) : caps.columns;
  const c = counts(m);
  const squad = m.squad.map(x => ({ ...x, role: n(x.role) as string, who: n(x.who) as string }));
  const version = n(m.version);
  const repo = n(m.repo), branch = m.branch === undefined ? undefined : n(m.branch);
  const ready = t('console.banner.ready'), notReady = t('console.banner.notReady');
  const stateW = Math.max(displayWidth(ready), displayWidth(notReady));
  const word = (x: SquadMember) => (x.state === 'blocked' ? notReady : ready);
  const treeWord = (short: boolean) => (m.clean === undefined ? '' : m.clean ? t(short ? 'home.tree.cleanShort' : 'home.tree.clean') : t(short ? 'home.tree.dirtyShort' : 'home.tree.dirty'));
  const okGlyph = (v: boolean): Seg => [v ? 'green' : 'red', glyph(v ? 'done' : 'failed', caps)];
  const out: string[] = [];

  if (mode === 'minimal') {
    const roleW = Math.min(Math.max(0, ...squad.map(x => displayWidth(x.role))), 12);
    out.push(line([[undefined, renderLogo(caps, version)[0]], [undefined, ` · ${repoShort(repo)}${branch ? ` (${branch})` : ''}`]], width, caps));
    out.push(line([[undefined, [t('home.min.agents', { ready: c.ready, total: c.agents }), ...(c.tester === undefined ? [] : [t(c.tester ? 'home.min.verifyReady' : 'home.min.verifyNotReady')]),
      ...(c.risks ? [tn('home.min.risk', c.risks)] : [])].join(' · ')]], width, caps));
    for (const x of squad) {
      const role = padEndDisplay(displayWidth(x.role) > roleW ? cutNeutral(x.role as Neutral, roleW, { ascii }) : x.role, roleW);
      const room = width - displayWidth(glyph(x.state, caps)) - 1 - roleW - 1 - stateW - 1;
      out.push(line([[stateToken(x.state), glyph(x.state, caps)], [undefined, ' ' + role + ' '], [stateToken(x.state), room > 6 && noteOf(x, true) ? padEndDisplay(word(x), stateW) : word(x)],
        [x.state === 'risk' ? 'amber' : 'muted', room > 6 && noteOf(x, true) ? ' ' + wordCut(noteOf(x, true), room, ascii) : '']], width, caps));
    }
    out.push(...actionLines(m, caps, width, false));
    out.push(line([['muted', t('home.min.hint')]], width, caps));
    return out;
  }

  // Full and Compact: the logo (rows 3-4 carry the tagline in Full, the context in Compact), then the squad.
  const labelW = mode === 'full' ? Math.max(...(['home.label.repository', 'home.label.sandbox', 'home.label.policy'] as const).map(k => displayWidth(t(k)))) + 2 : 0;
  const side = (s: Seg[]) => line(s, width - LOGO_SIDE_COL, caps);
  const bwOk = m.sandbox.bubblewrap && m.sandbox.socat;
  const risksText = c.risks ? tn('home.compact.risk', c.risks) : '';
  const logo = mode === 'full'
    ? renderLogo(caps, version)
    : renderLogo(caps, version, [
      side([[undefined, repo], ['muted', branch ? `  ${branch}${treeWord(true) ? ' · ' + treeWord(true) : ''}` : treeWord(true) ? '  ' + treeWord(true) : '']]),
      side([[undefined, 'sandbox '], okGlyph(bwOk && m.sandbox.verify), ...(risksText ? [['muted', ' · ' + risksText] as Seg] : [])])]);
  out.push(...logo);
  out.push('');
  const tester = squad.find(isTester);
  const summary = tn('home.squad.summary', c.agents, { ready: c.ready });

  if (mode === 'full') {
    const lab = (k: 'home.label.repository' | 'home.label.sandbox' | 'home.label.policy') => padEndDisplay(t(k), labelW);
    const tree = [branch, treeWord(false)].filter(Boolean).join(' · ');
    out.push(line([[undefined, ' '.repeat(INDENT)], ['muted', lab('home.label.repository')], [undefined, repo + (tree ? '   ' + tree : '')]], width, caps));
    out.push(line([[undefined, ' '.repeat(INDENT)], ['muted', lab('home.label.sandbox')], okGlyph(m.sandbox.bubblewrap), [undefined, ' bubblewrap  '], okGlyph(m.sandbox.socat), [undefined, ' socat · '],
      [m.sandbox.verify ? undefined : 'red', t(m.sandbox.verify ? 'home.sandbox.verify' : 'home.sandbox.noVerify')]], width, caps));
    const until = [...m.policy.acceptedRisks].map(r => n(r.expires) as string).sort()[0];
    out.push(line([[undefined, ' '.repeat(INDENT)], ['muted', lab('home.label.policy')], [undefined, `taskquoin.yaml ${n(m.policy.digest).slice(0, 12)} · `],
      [c.risks ? 'amber' : undefined, c.risks ? tn('home.policy.risk', c.risks, { date: until }) : t('home.policy.noRisk')]], width, caps));
    out.push('');
    const right = [summary, ...(tester ? [t(tester.state === 'blocked' ? 'home.verify.notReady' : 'home.verify.ready')] : [])].join(' · ');
    const title = t('home.squad.title');
    const fill = Math.max(2, width - INDENT - 3 - displayWidth(title) - 1 - 1 - displayWidth(right) - 1 - 2);
    out.push(line([[undefined, ' '.repeat(INDENT)], ['line', '── '], [undefined, title + ' '], ['line', '─'.repeat(fill) + ' '], ['muted', right + ' '], ['line', '──']], width, caps));
  }

  const rows = squad;
  const roleW = Math.min(Math.max(...rows.map(x => displayWidth(x.role))), Math.max(8, Math.floor(width / 4)));
  const whoOf = (x: { who: string }) => (mode === 'full' ? x.who : (x.who.includes(' · ') ? x.who.slice(x.who.indexOf(' · ') + 3) : x.who));
  const fixed = INDENT + 2 + roleW + 2 + 2 + stateW + 2;
  const whoW = Math.min(Math.max(...rows.map(x => displayWidth(whoOf(x)))), Math.max(6, width - fixed - 4));
  for (const x of rows) {
    const role = displayWidth(x.role) > roleW ? cutNeutral(x.role as Neutral, roleW, { ascii }) : x.role;
    const who = displayWidth(whoOf(x)) > whoW ? cutNeutral(whoOf(x) as Neutral, whoW, { ascii }) : whoOf(x);
    const note = noteOf(x, mode === 'compact');
    const room = width - fixed - whoW;
    out.push(line([[undefined, ' '.repeat(INDENT)], [stateToken(x.state), glyph(x.state, caps)], [undefined, ' ' + padEndDisplay(role, roleW) + '  '], ['muted', padEndDisplay(who, whoW) + '  '],
      [stateToken(x.state), room >= 6 && note ? padEndDisplay(word(x), stateW) : word(x)], [x.state === 'risk' ? 'amber' : 'muted', room >= 6 && note ? '  ' + wordCut(note, room, ascii) : '']], width, caps));
  }
  if (mode === 'compact') out.push(line([[undefined, ' '.repeat(INDENT)], [undefined, t('home.compact.summary', { summary })]], width, caps));
  const actions = actionLines(m, caps, width, mode === 'full');
  if (actions.length) out.push('', ...actions);
  out.push('');
  return out;
}
