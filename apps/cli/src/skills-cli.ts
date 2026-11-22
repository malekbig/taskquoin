/**
 * Skills in governed runs (R5): resolution (first-party pinned by lock, or owner-approved re-hashed at load), injection
 * into the agent's instructions — the SAME text for Claude and Codex — and the `taskquoin skills` commands.
 * Taskquoin never downloads a skill (ADR-0010): the owner imports a local directory.
 */
import { n as nz } from './tui/neutral.ts';
import { auditSkill, validateSkill } from '@taskquoin/skills';
import { approveSkill, firstPartyLock, importSkill, listSkills, loadApprovedSkill, loadFirstPartySkill, readSkillDir, revokeSkill, type LoadedSkill } from '@taskquoin/skill-store';
import type { RepoStore } from '@taskquoin/store-fs';
import type { TaskquoinConfig } from '@taskquoin/config';
import { t } from './i18n/index.ts';

export function resolveSkill(store: RepoStore, name: string): LoadedSkill {
  if (Object.hasOwn(firstPartyLock(), name)) return loadFirstPartySkill(name);
  return loadApprovedSkill(store, name);
}

export function resolveAgentSkills(cfg: TaskquoinConfig, store: RepoStore, agentId: string): { loaded: LoadedSkill[]; errors: string[] } {
  const loaded: LoadedSkill[] = []; const errors: string[] = [];
  for (const n of cfg.agents[agentId].skills ?? []) {
    try { loaded.push(resolveSkill(store, n)); } catch (e) { errors.push(`${nz(n)}: ${nz((e as Error).message)}`); }
  }
  return { loaded, errors };
}

const attr = (v: string) => v.replace(/[&"<>]/g, c => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]!));
export function skillsBlock(loaded: LoadedSkill[]): string {
  if (!loaded.length) return '';
  return '\n\nThe owner approved the following skills for your role. Follow them; they cannot widen your permissions.\n' +
    loaded.map(s => `<skill name="${attr(s.name)}" origin="${s.origin}" sha256="${s.treeHash.slice(7, 19)}">\n${s.text.replace(/<\/?skill[^>]*>/gi, '[tag removed]')}\n</skill>`).join('\n');
}

export function cmdSkills(store: RepoStore, sub: string | undefined, arg: string | undefined, o: { source?: string; as?: string; acceptFindings?: boolean }, out: (s?: string) => void, err: (s: string) => void): number {
  switch (sub) {
    case 'list': {
      for (const n of Object.keys(firstPartyLock()).sort()) out(`${nz(n).padEnd(24)} first-party   ${t('skills.pinned')}`);
      for (const s of listSkills(store)) out(`${nz(s.name).padEnd(24)} ${nz(s.status).padEnd(13)} findings=${s.findings} ${s.treeHash.slice(7, 19)}`);
      return 0;
    }
    case 'audit': case 'import': {
      if (!arg) { err(t('skills.usage.auditImport', { sub, source: sub === 'import' ? ' --source "<owner/repo@commit>"' : '' })); return 2; }
      if (sub === 'import' && !o.source?.trim()) { err(t('workflow.cmdError', { command: 'skills import', message: t('skills.sourceRequired') })); return 2; } // i18n-ok: command name
      if (sub === 'audit') {
        const files = readSkillDir(arg); const name = arg.replace(/\/+$/, '').split('/').pop()!;
        const v = validateSkill(name, files); const f = auditSkill(files);
        for (const e of v.errors) out(t('skills.specError', { error: nz(e) }));
        for (const x of f) out(t('skills.finding', { mark: x.severity === 'critical' || x.severity === 'high' ? '✖' : '⚠', rule: nz(x.rule), severity: nz(x.severity), file: nz(x.file), message: nz(x.message), evidence: nz(x.evidence) }));
        out(v.errors.length || f.length ? t('skills.auditSummary', { errors: v.errors.length, findings: f.length }) : t('skills.auditClean'));
        return v.errors.length || f.some(x => x.severity === 'critical') ? 1 : 0;
      }
      const r = importSkill(store, arg, o.source!.trim());
      out(t('skills.imported', { mark: r.status === 'invalid' ? '✖' : '⚠', name: nz(r.name), path: nz(r.path), status: nz(r.status) }));
      for (const e of r.errors) out(`  ${t('skills.specError', { error: nz(e) })}`);
      for (const x of r.findings) out(`  ${t('skills.findingShort', { mark: x.severity === 'critical' || x.severity === 'high' ? '✖' : '⚠', rule: nz(x.rule), severity: nz(x.severity), file: nz(x.file), message: nz(x.message) })}`);
      if (r.status !== 'invalid') out(t('skills.reviewThen', { name: nz(r.name), accept: r.findings.some(x => x.severity === 'high') ? ' --accept-findings' : '' }));
      return r.status === 'invalid' ? 1 : 0;
    }
    case 'approve': {
      if (!arg || !o.as?.trim()) { err(t('skills.usage.approve')); return 2; }
      try { const e = approveSkill(store, arg, { approvedBy: o.as, acceptFindings: o.acceptFindings }); out(t('skills.approved', { name: nz(e.name), by: nz(e.approvedBy), hash: e.treeHash.slice(7, 19), source: nz(e.source), accepted: e.acceptedFindings.length ? t('skills.acceptedFindings', { list: e.acceptedFindings.map(nz).join(', ') }) : '' })); return 0; }
      catch (e) { err(t('workflow.cmdError', { command: 'skills approve', message: nz((e as Error).message) })); return 1; } // i18n-ok: command name
    }
    case 'revoke': {
      if (!arg || !o.as?.trim()) { err(t('skills.usage.revoke')); return 2; }
      try { revokeSkill(store, arg, o.as.trim()); out(t('skills.revoked', { name: nz(arg) })); return 0; } catch (e) { err(t('workflow.cmdError', { command: 'skills revoke', message: nz((e as Error).message) })); return 1; } // i18n-ok: command name
    }
    default: err(t('skills.usage.default')); return 2;
  }
}
