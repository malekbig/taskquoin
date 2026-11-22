/**
 * The Events panel body: newest first, `HH:MM:SS  subject  text`, exactly `height` lines. An event that carried
 * hostile characters is followed by a red line saying how many were neutralised (AC-4: counted, never silent); the
 * count of lines the reader could not parse and the "older events not shown" notice sit at the bottom. Strings arrive
 * neutral from the model and are re-neutralised here (idempotent). No percentage, no bar. Pure.
 */
import { tn, t } from '../../i18n/index.ts';
import { displayWidth } from '../../i18n/width.ts';
import type { Caps } from '../caps.ts';
import { n } from '../neutral.ts';
import { clock, cut, pad } from '../text.ts';
import { ellipsis, mark, paint, type Token } from '../tokens.ts';

export interface EventLine { at: string; subject: string; text: string; tone?: Token; marked: number }

const SUBJECT_MAX = 12;

export function renderEvents(
  lines: EventLine[], o: { offset: number; height: number; width: number; skipped: number; cut: boolean }, caps: Caps,
): string[] {
  const { height, width } = o;
  if (height <= 0) return [];
  const more = ellipsis(caps);
  // Notices at the bottom, kept when there is room for them and at least one event line.
  const notes: string[] = [];
  if (o.skipped > 0) notes.push(paint('amber', cut(tn('dashboard.events.skipped', o.skipped), width, more), caps));
  if (o.cut) notes.push(paint('muted', cut(t('dashboard.events.cut'), width, more), caps));
  const room = height - (height > notes.length ? notes.length : 0);
  const shownNotes = height > notes.length ? notes : [];
  const visible = lines.slice(Math.max(0, o.offset));
  const subjects = visible.slice(0, Math.max(1, height)).map((l) => displayWidth(n(l.subject)));
  const sw = Math.min(SUBJECT_MAX, Math.max(0, ...subjects));
  const out: string[] = [];
  for (const l of visible) {
    if (out.length >= room) break;
    const time = clock(l.at);
    const head = `${time}  ${pad(cut(n(l.subject), sw, more), sw)}  `;
    const textRoom = Math.max(0, width - displayWidth(head));
    const text = cut(n(l.text), textRoom, more);
    out.push(`${paint('muted', head, caps)}${l.tone ? paint(l.tone, text, caps) : text}`);
    if (l.marked > 0 && out.length < room) {
      const indent = ' '.repeat(Math.min(displayWidth(head), Math.max(0, width - 1)));
      out.push(indent + paint('red', cut(`${mark('warn', caps)} ${tn('dashboard.events.marked', l.marked)}`, Math.max(0, width - displayWidth(indent)), more), caps));
    }
  }
  while (out.length < room) out.push('');
  return [...out.slice(0, room), ...shownNotes];
}
