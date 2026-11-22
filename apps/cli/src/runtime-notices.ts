/** Which Claude Code runs, and what the owner should know about it (doctor, the console banner, /upgrade). Pure. */
import { dirname } from 'node:path';
import type { CandidateReason, HostReport } from '@taskquoin/host-probe';
import { t } from './i18n/index.ts';
import { safe, shellWord } from './safe-text.ts';

export type RuntimeNotice = { kind: 'fallback' | 'action'; text: string };
/** Where the remedy is typed: `/upgrade …` in the console, `taskquoin upgrade …` in a shell. */
export type Surface = 'console' | 'cli';

const REASON: Record<CandidateReason, () => string> = {
  'link': () => t('runtime.reason.link'), 'not a file': () => t('runtime.reason.notAFile'),
  'parent not a directory': () => t('runtime.reason.parentNotADirectory'), 'not executable': () => t('runtime.reason.notExecutable'),
  'not owned': () => t('runtime.reason.notOwned'), 'writable by others': () => t('runtime.reason.writableByOthers'),
  'unreadable': () => t('runtime.reason.unreadable'), 'version mismatch': () => t('runtime.reason.versionMismatch'),
  'selection path': () => t('runtime.reason.selectionPath'),
};

/** The measured Claude Code is installed but the probe did not use it: why, and the one command that fixes it. */
export function unusedNotice(h: HostReport, measured: string, surface: Surface = 'console'): string | undefined {
  const c = h.claudeCandidate;
  if (!c) return undefined;
  const upgrade = surface === 'console' ? '/upgrade' : 'taskquoin upgrade';
  const command = c.reason === 'selection path' ? `${upgrade} auto`
    : c.reason === 'writable by others' ? `chmod go-w ${shellWord(dirname(c.bin))} ${shellWord(c.bin)}`
    : `${upgrade} install`;
  return t('runtime.unused', { measured: safe(measured), reason: (REASON[c.reason] ?? REASON.unreadable)(), command: safe(command) });
}

/**
 * `fallback`: the probe chose the measured Claude Code still installed instead of a newer PATH one.
 * `action`: Claude Code is not the measured version and the measured one is not used — installed but refused (the
 * reason and its fix), or not installed at all (only /upgrade install can fix it).
 */
export function runtimeNotices(h: HostReport, measured: string, surface: Surface = 'console'): RuntimeNotice[] {
  const p = h.runtimes.claude;
  if (p?.installed) return [{ kind: 'fallback', text: t('console.notice.fallback', { installed: safe(p.installed.version ?? '?'), version: safe(measured) }) }];
  const unused = unusedNotice(h, measured, surface);
  if (unused) return [{ kind: 'action', text: unused }];
  if (p?.version !== undefined && p.version !== measured) {
    const v = { installed: safe(p.version), measured: safe(measured) };
    return [{ kind: 'action', text: surface === 'console' ? t('console.notice.action', v) : t('cli.notice.action', v) }];
  }
  return [];
}
