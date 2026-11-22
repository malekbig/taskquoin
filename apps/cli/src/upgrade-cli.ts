/**
 * `/upgrade` and `taskquoin upgrade`: which runtime version is installed, used and measured; the automatic fallback
 * switch; the reinstall of the measured Claude Code after a typed confirmation; and, unless offline, the check for a
 * newer Taskquoin. Everything outside (network, files, installer) arrives through `UpgradeEnv`; text that comes from
 * outside (paths, versions) is printed as data with control, bidi and invisible characters replaced.
 */
import { realpathSync } from 'node:fs';
import { relative, isAbsolute } from 'node:path';
import { claudeVersionsDir, type HostReport } from '@taskquoin/host-probe';
import { t } from './i18n/index.ts';
import { alignColumns, displayWidth, padEndDisplay } from './i18n/width.ts';
import type { Selection } from './preferences.ts';
import { unusedNotice, type Surface } from './runtime-notices.ts';
import { safe, shellWord } from './safe-text.ts';
import { newerCalver, type Latest } from './upgrade-check.ts';

export interface UpgradeEnv {
  h: HostReport; measured: Record<'claude' | 'codex' | 'opencode', string>; selection: Selection;
  packaged: boolean; version: string; offline: boolean;
  /** The installer's working directory; undefined when no absolute home is known (install is then refused). */
  home: string | undefined;
  /** Where the remedies are typed: `/upgrade …` (console) or `taskquoin upgrade …` (shell). */
  surface: Surface;
  out(s?: string): void; err(s: string): void; ask(q: string): Promise<string | undefined>;
  save(s: Selection): void; reprobe(): Promise<HostReport>; latest(): Promise<Latest>;
  run(bin: string, args: string[], cwd: string): Promise<number>;
}

const TOOLS = ['claude', 'codex', 'opencode'] as const;
const DASH = '—';

function table(e: UpgradeEnv, h: HostReport): void {
  const rows: string[][] = [[t('upgrade.title'), t('upgrade.colInstalled'), t('upgrade.colUsed'), t('upgrade.colMeasured', { version: safe(e.version) })]];
  for (const rt of TOOLS) {
    const p = h.runtimes[rt];
    const used = p?.version;
    const installed = (rt === 'claude' ? p?.installed?.version : undefined) ?? used;
    const mark = used !== undefined && used === e.measured[rt] ? ' ✔' : '';
    rows.push([rt, installed === undefined ? DASH : safe(installed), used === undefined ? DASH : t('upgrade.row', { version: safe(used), mark }), safe(e.measured[rt])]);
  }
  const w = [0, 1, 2].map((i) => Math.max(...rows.map((r) => displayWidth(r[i]!))) + 2);
  const lines = alignColumns(rows.map((r, i) => [
    r.slice(0, 3).map((c, j) => padEndDisplay(c, w[j]!)).join(''),
    i > 0 && r[0] === 'claude' ? `${r[3]}  ${t(`upgrade.selection.${e.selection}`)}` : r[3]!,
  ] as const), 0);
  for (const l of lines) e.out(l.trimEnd());
  const unused = unusedNotice(h, e.measured.claude, e.surface);
  if (unused) e.out(unused);
}

async function checkLine(e: UpgradeEnv): Promise<void> {
  if (e.offline) { e.out(t('upgrade.offline')); return; }
  e.out(); e.out(t('upgrade.checking'));
  const r = await e.latest();
  switch (r.kind) {
    case 'unpublished': e.out(t('upgrade.unpublished')); return;
    case 'offline': e.out(t('upgrade.unreachable')); return;
    case 'invalid': e.out(t('upgrade.invalid')); return;
    case 'latest': {
      if (!newerCalver(r.version, e.version)) { e.out(t('upgrade.upToDate', { version: safe(e.version) })); return; }
      const p = e.h.runtimes.claude;
      const installed = p?.installed?.version ?? p?.version;
      const m = r.measured.claude;
      const latest = safe(r.version);
      if (m !== undefined && installed === m) {
        e.out(e.packaged
          ? t('upgrade.newer', { latest, measured: safe(m), command: `npm install -g taskquoin@${latest}` })
          : t('upgrade.gitPull', { latest, measured: safe(m) }));
      } else {
        e.out(t('upgrade.newerOther', { latest, measured: m === undefined ? DASH : safe(m), installed: installed === undefined ? DASH : safe(installed) }));
      }
    }
  }
}

const OTHER_PACKAGES = { codex: '@openai/codex', opencode: 'opencode-ai' } as const;

/** Codex and OpenCode: the command is printed when the tool is installed with another version than the measured one; never run. */
function otherCommands(e: UpgradeEnv): void {
  for (const rt of ['codex', 'opencode'] as const) {
    const p = e.h.runtimes[rt];
    if (!p || p.version === e.measured[rt]) continue;
    e.out(t('upgrade.otherCommand', { tool: rt, command: `npm install -g ${OTHER_PACKAGES[rt]}@${safe(e.measured[rt])}` }));
  }
}

function isNative(bin: string, home: string): boolean {
  let real = bin;
  try { real = realpathSync(bin); } catch { /* not on disk: judge the path as given */ }
  let dir = claudeVersionsDir(home);
  try { dir = realpathSync(dir); } catch { /* missing: keep the plain path */ }
  const rel = relative(dir, real);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

export async function cmdUpgrade(sub: string | undefined, e: UpgradeEnv): Promise<number> {
  switch (sub) {
    case undefined:
      table(e, e.h);
      otherCommands(e);
      await checkLine(e);
      return 0;
    case 'auto': case 'path':
      // An unwritable preferences file is reported, never thrown: it must not end the console session.
      try { e.save(sub); } catch (x) { e.err(t('upgrade.saveFailed', { reason: safe((x as Error).message) })); return 1; }
      e.selection = sub;
      e.h = await e.reprobe();
      e.out(t('upgrade.saved', { selection: sub }));
      table(e, e.h);
      return 0;
    case 'install': {
      const p = e.h.runtimes.claude;
      const want = e.measured.claude;
      if (p && !p.installed && p.version === want) { e.out(t('upgrade.nothing', { version: safe(want) })); otherCommands(e); return 0; }
      // The installer runs in $HOME, never in the current directory (the repository): no absolute home, no install.
      const home = e.home;
      if (home === undefined) { e.err(t('upgrade.noHome')); return 1; }
      const pathClaude = p ? (p.installed?.bin ?? p.bin) : undefined;
      const [bin, args] = pathClaude !== undefined && isNative(pathClaude, home)
        ? [pathClaude, ['install', want]] as const
        : ['npm', ['install', '-g', `@anthropic-ai/claude-code@${want}`]] as const;
      // Consent covers what was shown: a command that cannot be shown exactly as it will run is never offered.
      const shown = [bin, ...args].map(shellWord).join(' ');
      if (safe(shown) !== shown) { e.err(t('upgrade.unsafeCommand', { command: safe(shown) })); return 1; }
      e.out(t('upgrade.command', { command: shown }));
      e.out(t('upgrade.warning'));
      otherCommands(e);
      const answer = (await e.ask(t('upgrade.confirm')))?.trim().toLowerCase();
      const word = t('upgrade.yes').trim().toLowerCase();
      if (!answer || (answer !== 'yes' && (word === '' || answer !== word))) { e.out(t('upgrade.cancelled')); return 0; }
      const code = await e.run(bin, [...args], home);
      if (code !== 0) e.err(t('upgrade.failed', { code }));
      e.h = await e.reprobe();
      table(e, e.h);
      return code === 0 ? 0 : 1; // the documented 0/1/2, whatever the installer's own code
    }
    default:
      e.err(t('upgrade.usage'));
      return 2;
  }
}
