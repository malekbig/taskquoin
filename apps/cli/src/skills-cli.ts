/**
 * Skills in governed runs (R5): resolution (first-party pinned by lock, or owner-approved re-hashed at load), injection
 * into the agent's instructions — the SAME text for Claude and Codex — and the `taskquoin skills` commands.
 * Taskquoin never downloads a skill (ADR-0010): the owner imports a local directory.
 */
import { auditSkill, validateSkill } from '@taskquoin/skills';
import { approveSkill, firstPartyLock, importSkill, listSkills, loadApprovedSkill, loadFirstPartySkill, readSkillDir, revokeSkill, type LoadedSkill } from '@taskquoin/skill-store';
import type { RepoStore } from '@taskquoin/store-fs';
import type { TaskquoinConfig } from '@taskquoin/config';

export function resolveSkill(store: RepoStore, name: string): LoadedSkill {
  if (Object.hasOwn(firstPartyLock(), name)) return loadFirstPartySkill(name);
  return loadApprovedSkill(store, name);
}

export function resolveAgentSkills(cfg: TaskquoinConfig, store: RepoStore, agentId: string): { loaded: LoadedSkill[]; errors: string[] } {
  const loaded: LoadedSkill[] = []; const errors: string[] = [];
  for (const n of cfg.agents[agentId].skills ?? []) {
    try { loaded.push(resolveSkill(store, n)); } catch (e) { errors.push(`${n}: ${(e as Error).message}`); }
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
      for (const n of Object.keys(firstPartyLock()).sort()) out(`${n.padEnd(24)} first-party   (pinned by skills/first-party.lock.json)`);
      for (const s of listSkills(store)) out(`${s.name.padEnd(24)} ${s.status.padEnd(13)} findings=${s.findings} ${s.treeHash.slice(7, 19)}`);
      return 0;
    }
    case 'audit': case 'import': {
      if (!arg) { err(`usage: taskquoin skills ${sub} <local-skill-dir>${sub === 'import' ? ' --source "<owner/repo@commit>"' : ''}`); return 2; }
      if (sub === 'import' && !o.source?.trim()) { err('taskquoin skills import: --source "<owner/repo@full-commit-sha>" is required (provenance)'); return 2; }
      if (sub === 'audit') {
        const files = readSkillDir(arg); const name = arg.replace(/\/+$/, '').split('/').pop()!;
        const v = validateSkill(name, files); const f = auditSkill(files);
        for (const e of v.errors) out(`✖ spec: ${e}`);
        for (const x of f) out(`${x.severity === 'critical' || x.severity === 'high' ? '✖' : '⚠'} ${x.rule} ${x.severity} ${x.file}: ${x.message} — ${x.evidence}`);
        out(v.errors.length || f.length ? `${v.errors.length} spec error(s), ${f.length} finding(s) — signals, not a verdict` : '✔ no spec error, no finding (still review it yourself)');
        return v.errors.length || f.some(x => x.severity === 'critical') ? 1 : 0;
      }
      const r = importSkill(store, arg, o.source!.trim());
      out(`${r.status === 'invalid' ? '✖' : '⚠'} ${r.name} imported into QUARANTINE (${r.path}) — status ${r.status}`);
      for (const e of r.errors) out(`  ✖ spec: ${e}`);
      for (const x of r.findings) out(`  ${x.severity === 'critical' || x.severity === 'high' ? '✖' : '⚠'} ${x.rule} ${x.severity} ${x.file}: ${x.message}`);
      if (r.status !== 'invalid') out(`Review it, then: taskquoin skills approve ${r.name} --as <your name>${r.findings.some(x => x.severity === 'high') ? ' --accept-findings' : ''}`);
      return r.status === 'invalid' ? 1 : 0;
    }
    case 'approve': {
      if (!arg || !o.as?.trim()) { err('usage: taskquoin skills approve <name> --as <your name> [--accept-findings]'); return 2; }
      try { const e = approveSkill(store, arg, { approvedBy: o.as, acceptFindings: o.acceptFindings }); out(`✔ ${e.name} approved by ${e.approvedBy} (${e.treeHash.slice(7, 19)}, source ${e.source})${e.acceptedFindings.length ? ` — accepted findings: ${e.acceptedFindings.join(', ')}` : ''}`); return 0; }
      catch (e) { err(`taskquoin skills approve: ${(e as Error).message}`); return 1; }
    }
    case 'revoke': {
      if (!arg || !o.as?.trim()) { err('usage: taskquoin skills revoke <name> --as <your name>'); return 2; }
      try { revokeSkill(store, arg, o.as.trim()); out(`✔ ${arg} revoked`); return 0; } catch (e) { err(`taskquoin skills revoke: ${(e as Error).message}`); return 1; }
    }
    default: err('usage: taskquoin skills <list|audit <dir>|import <dir> --source ..|approve <name> --as ..|revoke <name> --as ..>'); return 2;
  }
}
