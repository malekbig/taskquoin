/**
 * The help overlay (`?`): the dashboard's key table and the reminder that no key approves. The table lives here and
 * the loop (dashboard.ts) is tested against it, so help cannot name a key the loop ignores. Pure.
 */
import { t } from '../../i18n/index.ts';
import { displayWidth } from '../../i18n/width.ts';
import type { Caps } from '../caps.ts';
import { bold } from '../tokens.ts';
import { wrap } from '../text.ts';
import { panel } from './panel.ts';
import type { UiState } from './dashboard-frame.ts';

/** Every key the dashboard acts on; `label` is what help says it does. Upper case equals lower case except `G`. */
export const KEY_TABLE: readonly { keys: string; label: () => string }[] = [
  { keys: 'r', label: () => t('dashboard.frame.key.runs') },
  { keys: 'a', label: () => t('dashboard.frame.key.agents') },
  { keys: 'l', label: () => t('dashboard.frame.key.log') },
  { keys: 'd', label: () => t('dashboard.frame.key.diff') },
  { keys: 'v', label: () => t('dashboard.frame.key.verify') },
  { keys: 'p', label: () => t('dashboard.frame.key.approvals') },
  { keys: '?', label: () => t('dashboard.frame.key.help') },
  { keys: 'q', label: () => t('dashboard.frame.key.quit') },
  { keys: 'Tab', label: () => t('dashboard.help.next') },
  { keys: 'Shift+Tab', label: () => t('dashboard.help.prev') },
  { keys: 'j k', label: () => t('dashboard.help.move') },
  { keys: 'g G', label: () => t('dashboard.help.ends') },
  { keys: 'PgUp PgDn', label: () => t('dashboard.help.page') },
  { keys: 'Esc', label: () => t('dashboard.help.close') },
];

/** The viewer's keys (the diff and artifact viewer); the loop and the viewer act on exactly these. */
export const VIEWER_KEY_TABLE: readonly { keys: string; label: () => string }[] = [
  { keys: 'j k', label: () => t('dashboard.help.move') },
  { keys: 'g G', label: () => t('dashboard.help.ends') },
  { keys: 'PgUp PgDn', label: () => t('dashboard.help.page') },
  { keys: '/', label: () => t('dashboard.help.search') },
  { keys: 'n N', label: () => t('dashboard.help.fileMatch') },
  { keys: 'w', label: () => t('dashboard.help.wrap') },
  { keys: 'd', label: () => t('dashboard.frame.key.diff') },
  { keys: 'v', label: () => t('dashboard.frame.key.verify') },
  { keys: 'p', label: () => t('dashboard.frame.key.approvals') },
  { keys: '?', label: () => t('dashboard.frame.key.help') },
  { keys: 'q Esc', label: () => t('dashboard.help.back') },
];

/** The overlay box, at most `width` columns wide (52 at most); its height is its content. */
export function renderHelp(screen: UiState['screen'], width: number, caps: Caps): string[] {
  const w = Math.max(1, Math.min(width, 52)), inner = Math.max(1, w - 4);
  const entries = (screen === 'viewer' ? VIEWER_KEY_TABLE : KEY_TABLE).map((e) => ({ plain: `${e.keys} ${e.label()}`, styled: `${bold(e.keys, caps)} ${e.label()}` }));
  const body: string[] = [];
  let line = { plain: '', styled: '' };
  const flush = (): void => { if (line.plain !== '') body.push(line.styled); line = { plain: '', styled: '' }; };
  for (const e of entries) {
    if (line.plain !== '' && displayWidth(line.plain) + 3 + displayWidth(e.plain) > inner) flush();
    line = line.plain === '' ? e : { plain: `${line.plain}   ${e.plain}`, styled: `${line.styled}   ${e.styled}` };
  }
  flush();
  if (w >= 48) body.push('');
  body.push(...wrap(t('dashboard.help.hash'), inner), ...wrap(t('dashboard.help.route'), inner));
  return panel({ title: t('dashboard.help.title'), body, width: w, height: body.length + 2, focused: true }, caps);
}
