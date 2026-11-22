/**
 * The Agents panel body: `glyph role runtime model READY|NOT READY note activity`. READY comes only from the squad's
 * own verdict (ready and accepted-risk both read READY, blocked reads NOT READY); the state word is never dropped.
 * A model that was not recorded is `?` (undefined); one that does not apply is `—` (null). Columns go from the right
 * (note, model, runtime, activity) until the line fits. Strings arrive neutral and are re-neutralised (idempotent). Pure.
 */
import { t } from '../../i18n/index.ts';
import { displayWidth } from '../../i18n/width.ts';
import type { Caps } from '../caps.ts';
import { n } from '../neutral.ts';
import { cut, duration, pad } from '../text.ts';
import { ellipsis, glyph, mark, paint, stateToken, type Token } from '../tokens.ts';

export interface AgentRow {
  id?: string; role: string; runtime: string;
  /** undefined: not recorded (`?`); null: not applicable (`—`). */
  model?: string | null;
  state: 'ready' | 'risk' | 'blocked';
  note?: string;
  /** ISO time the agent's running step began; only set while its process is alive. */
  workingSince?: string;
}

const MAX = { role: 14, runtime: 22, model: 18 };

export function renderAgents(rows: AgentRow[], width: number, caps: Caps, now: number): string[] {
  const dash = caps.charset === 'utf8' ? '—' : '-';
  const cells = rows.map((r) => {
    const since = r.workingSince ? Date.parse(r.workingSince) : NaN;
    const activity = Number.isFinite(since)
      ? { text: `${glyph('running', caps)} ${t('dashboard.agents.working', { time: duration(now - since) })}`, token: 'cyan' as Token }
      : { text: `${mark('sep', caps)} ${t('dashboard.agents.idle')}`, token: 'muted' as Token };
    return {
      role: n(r.role), runtime: n(r.runtime), model: r.model === undefined ? '?' : r.model === null ? dash : n(r.model),
      word: r.state === 'blocked' ? t('console.banner.notReady') : t('console.banner.ready'), state: r.state,
      note: r.note ? n(r.note) : '', activity,
    };
  });
  const w = (f: (c: (typeof cells)[number]) => string, cap: number): number => Math.min(cap, Math.max(0, ...cells.map((c) => displayWidth(f(c)))));
  const rw = w((c) => c.role, MAX.role), uw = w((c) => c.runtime, MAX.runtime), mw = w((c) => c.model, MAX.model);
  const sw = Math.max(0, ...cells.map((c) => displayWidth(c.word)));
  const aw = Math.max(0, ...cells.map((c) => displayWidth(c.activity.text)));
  const nw = Math.max(0, ...cells.map((c) => displayWidth(c.note)));
  // Columns kept, by priority: the state word always; dropped from the right: activity, runtime, model, note (note first).
  const keep = { note: nw > 0, model: true, runtime: true, activity: true };
  const gw = Math.max(...(['ready', 'risk', 'blocked', 'running'] as const).map((k) => displayWidth(glyph(k, caps))));
  const total = (): number => gw + 1 + rw + 2 + sw
    + (keep.runtime ? 2 + uw : 0) + (keep.model ? 2 + mw : 0) + (keep.note ? 2 + nw : 0) + (keep.activity ? 2 + aw : 0);
  for (const col of ['note', 'model', 'runtime', 'activity'] as const) {
    if (total() <= width) break;
    keep[col] = false;
  }
  return cells.map((c, i) => {
    const row = rows[i];
    const sg = glyph(row.state, caps);
    const fixed = gw + 1 + rw + 2 + sw + (keep.runtime ? 2 + uw : 0) + (keep.model ? 2 + mw : 0) + (keep.activity ? 2 + aw : 0);
    const roleRoom = Math.max(1, Math.min(rw, width - gw - 1 - 2 - sw));
    let out = `${paint(stateToken(c.state), pad(sg, gw), caps)} ${pad(cut(c.role, roleRoom, ellipsis(caps)), Math.min(rw, roleRoom))}`;
    if (keep.runtime) out += '  ' + pad(cut(c.runtime, uw, ellipsis(caps)), uw);
    if (keep.model) out += '  ' + pad(cut(c.model, mw, ellipsis(caps)), mw);
    out += '  ' + paint(stateToken(c.state), pad(c.word, sw), caps);
    if (keep.note) out += '  ' + pad(cut(c.note, Math.max(0, Math.min(nw, width - fixed - 2)), ellipsis(caps)), Math.min(nw, Math.max(0, width - fixed - 2)));
    if (keep.activity) out += '  ' + paint(c.activity.token, c.activity.text, caps);
    return displayWidth(out) > width ? out.replace(/\s+$/, '') : out;
  });
}
