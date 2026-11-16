/**
 * Orchestrator-side git (host). Never by an agent (ADR-0011). Tree-based governance (ADR-0013, Codex R4 N1/N2):
 *  - every invocation disables repository hooks and fsmonitor (no repository-controlled code runs on the host);
 *  - the candidate is a tree id computed through a TEMPORARY index (the developer's index is never touched);
 *  - diffs and policy checks are tree-to-tree, NUL-delimited, without rename detection;
 *  - the commit is `git commit-tree <approved tree> -p <expected parent>` + compare-and-swap `update-ref`:
 *    exactly the approved tree, on the expected parent, without hooks or filters.
 */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { runProcess } from '@taskquoin/process-runner';

const BRANCH_RE = /^taskquoin\/[A-Za-z0-9._-]{1,64}$/;
const OID_RE = /^[0-9a-f]{40}$/;
/** Safe defaults for every git call made by Taskquoin. */
export const SAFE_GIT_CONFIG = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', '-c', 'diff.renames=false'];

export interface Change { status: string; path: string }

export class GitWorkspace {
  private readonly o: { gitBin: string; cwd: string; env: Record<string, string>; scratchDir: string };
  constructor(o: { gitBin: string; cwd: string; env: Record<string, string>; scratchDir: string }) { this.o = o; }

  private async git(args: string[], extraEnv: Record<string, string> = {}, maxOutputBytes = 64 * 1024 * 1024): Promise<string> {
    const r = await runProcess({ bin: this.o.gitBin, args: [...SAFE_GIT_CONFIG, ...args], cwd: this.o.cwd, env: { ...this.o.env, ...extraEnv }, timeoutMs: 120_000, maxOutputBytes });
    if (r.status !== 'completed') throw new Error(`git ${args[0]} failed: ${r.stderr.slice(0, 500)}`);
    if (r.truncated) throw new Error(`git ${args[0]} output exceeded the limit`);
    return r.stdout;
  }

  async isClean(): Promise<boolean> { return (await this.git(['status', '--porcelain'])).trim() === ''; }
  async head(): Promise<string> { return (await this.git(['rev-parse', 'HEAD'])).trim(); }
  async currentBranch(): Promise<string> { return (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim(); }
  async branchHead(branch: string): Promise<string> { return (await this.git(['rev-parse', `refs/heads/${branch}`])).trim(); }

  async startRunBranch(name: string): Promise<string> {
    if (!BRANCH_RE.test(name) || name.includes('..')) throw new Error(`invalid branch name ${JSON.stringify(name)}`);
    const base = await this.head();
    await this.git(['switch', '-q', '-c', name]);
    return base;
  }

  /** Tree id of the working tree (tracked + untracked-not-ignored) relative to `base`, via a temporary index. */
  async candidateTree(base: string): Promise<string> {
    if (!OID_RE.test(base)) throw new Error('invalid base commit');
    const dir = mkdtempSync(join(this.o.scratchDir, 'idx-'));
    const env = { GIT_INDEX_FILE: join(dir, 'index') };
    try {
      await this.git(['read-tree', base], env);
      await this.git(['add', '-A'], env);
      return (await this.git(['write-tree'], env)).trim();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  /** The entry at exactly `path` in `treeish` (ls-tree output filtered on the exact name), or undefined. */
  private async treeEntry(treeish: string, path: string): Promise<{ mode: string; oid: string } | undefined> {
    for (const line of (await this.git(['ls-tree', '-z', treeish, '--', path])).split('\0')) {
      const tab = line.indexOf('\t'); if (tab < 0 || line.slice(tab + 1) !== path) continue;
      const [mode, , oid] = line.slice(0, tab).split(' '); return { mode, oid };
    }
    return undefined;
  }

  /** Write exactly `tree` into the empty directory `dir` (clean room, ADR-0014): no .git, no ignored files. */
  async materialize(tree: string, dir: string): Promise<void> {
    if (!OID_RE.test(tree)) throw new Error('invalid tree id');
    if (!isAbsolute(dir) || readdirSync(dir).length) throw new Error(`clean room ${dir} is not empty`);
    const idx = mkdtempSync(join(this.o.scratchDir, 'idx-'));
    const env = { GIT_INDEX_FILE: join(idx, 'index') };
    try {
      await this.git(['read-tree', tree], env);
      await this.git(['checkout-index', '-a', `--prefix=${dir.endsWith('/') ? dir : dir + '/'}`], env);
    } finally { rmSync(idx, { recursive: true, force: true }); }
  }

  /** Tree id of a directory outside the repository (e.g. the clean room after the tests), relative to `base`. */
  async dirTree(dir: string, base: string): Promise<string> {
    if (!OID_RE.test(base) || !isAbsolute(dir)) throw new Error('invalid base or directory');
    const idx = mkdtempSync(join(this.o.scratchDir, 'idx-'));
    const env = { GIT_INDEX_FILE: join(idx, 'index') };
    try {
      await this.git(['read-tree', base], env);
      await this.git(['--work-tree', dir, 'add', '-A'], env);
      return (await this.git(['write-tree'], env)).trim();
    } finally { rmSync(idx, { recursive: true, force: true }); }
  }

  /**
   * Paths of the working directory that an ignore rule matches, collapsed at the matching directory (`node_modules`,
   * not its files; not `apps/` merely because it only holds ignored files). `--no-optional-locks`: the developer's
   * index is never refreshed or written.
   */
  async ignoredEntries(): Promise<{ path: string; dir: boolean }[]> {
    const out = await this.git(['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--ignored=matching', '--untracked-files=normal']);
    return out.split('\0').filter(l => l.startsWith('!! ')).map(l => l.slice(3))
      .map(p => (p.endsWith('/') ? { path: p.slice(0, -1), dir: true } : { path: p, dir: false }));
  }

  /** base tree + only the changed paths accepted by `isTest` (deletions included): the tree that must FAIL (RED proof). */
  async redTree(base: string, green: string, isTest: (path: string) => boolean): Promise<string> {
    const changed = (await this.changes(base, green)).filter(c => isTest(c.path));
    const dir = mkdtempSync(join(this.o.scratchDir, 'idx-'));
    const env = { GIT_INDEX_FILE: join(dir, 'index') };
    try {
      await this.git(['read-tree', base], env);
      for (const c of changed) {
        if (c.status === 'D') { await this.git(['update-index', '--force-remove', '--', c.path], env); continue; }
        const e = await this.treeEntry(green, c.path);
        if (!e) throw new Error(`changed path ${JSON.stringify(c.path)} not found in the verified tree`);
        await this.git(['update-index', '--add', '--cacheinfo', `${e.mode},${e.oid},${c.path}`], env);
      }
      return (await this.git(['write-tree'], env)).trim();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }

  /**
   * The diff a JUDGE receives (multi-LLM A3): per changed path, in order. Never sent to a judge (placeholders instead):
   * a path `isSecret` accepts; a binary change (git's verdict OR a NUL byte in either side — .gitattributes cannot force
   * text); and any file containing a line of a secret file of the base or the candidate tree (a renamed or copied
   * secret, final review). The human approves the full diff.
   */
  async judgeDiff(base: string, tree: string, isSecret: (path: string) => boolean): Promise<string> {
    const parts: string[] = [];
    for (const e of (await this.judgeView(base, tree, isSecret)).entries) {
      if (e.kind === 'secret') parts.push(`[fichier secret modifié : ${e.path} — contenu non envoyé]`);
      else if (e.kind === 'binary') parts.push(`[changement binaire : ${e.path}]`);
      else if (e.kind === 'secret-content') parts.push(`[fichier masqué : contient des lignes d'un fichier secret — ${e.path}]`);
      else parts.push((await this.git(['diff', '--no-color', '--no-renames', '--no-ext-diff', '--no-textconv', base, tree, '--', `:(literal)${e.path}`])).replace(/\n$/, ''));
    }
    return parts.join('\n') + (parts.length ? '\n' : '');
  }

  /** Full new text of the added/modified files a judge may see (see judgeDiff), in path order, within `budgetChars`. */
  async changedTexts(base: string, tree: string, isSecret: (path: string) => boolean, budgetChars: number): Promise<{ path: string; text: string }[]> {
    const view = await this.judgeView(base, tree, isSecret);
    const wanted = view.entries.filter(e => e.kind === 'text' && e.status !== 'D');
    const out: { path: string; text: string }[] = []; let used = 0;
    for (let i = 0; i < wanted.length; i++) {
      const text = view.newText.get(wanted[i].path)!;
      if (used + text.length > budgetChars) { out.push({ path: '…', text: `[budget atteint : ${wanted.length - i} fichier(s) non inclus]` }); break; }
      out.push({ path: wanted[i].path, text }); used += text.length;
    }
    return out;
  }

  private async judgeView(base: string, tree: string, isSecret: (path: string) => boolean):
    Promise<{ entries: { path: string; status: string; kind: 'secret' | 'binary' | 'secret-content' | 'text' }[]; newText: Map<string, string> }> {
    const gitBinary = await this.binaryPaths(base, tree);
    const secretLines = new Set([...(await this.secretLinesOf(base, isSecret)), ...(await this.secretLinesOf(tree, isSecret))]);
    const blob = async (rev: string, path: string) => { try { return await this.git(['cat-file', 'blob', `${rev}:${path}`]); } catch { return undefined; } };
    const entries: { path: string; status: string; kind: 'secret' | 'binary' | 'secret-content' | 'text' }[] = []; const newText = new Map<string, string>();
    for (const c of await this.changes(base, tree)) {
      if (isSecret(c.path)) { entries.push({ ...c, kind: 'secret' }); continue; }
      const sides = [c.status === 'A' ? undefined : await blob(base, c.path), c.status === 'D' ? undefined : await blob(tree, c.path)];
      if (gitBinary.has(c.path) || sides.some(t => t !== undefined && t.slice(0, 8000).includes('\0'))) { entries.push({ ...c, kind: 'binary' }); continue; }
      if (sides.some(t => t !== undefined && t.split('\n').some(l => secretLines.has(l.trim())))) { entries.push({ ...c, kind: 'secret-content' }); continue; }
      entries.push({ ...c, kind: 'text' });
      if (sides[1] !== undefined) newText.set(c.path, sides[1]);
    }
    return { entries, newText };
  }

  /** Meaningful lines (≥ 8 chars, not comments) of every secret file of `rev`: a file containing one is a moved/copied secret. */
  private async secretLinesOf(rev: string, isSecret: (path: string) => boolean): Promise<string[]> {
    const paths = (await this.git(['ls-tree', '-r', '-z', '--name-only', rev])).split('\0').filter(Boolean).filter(isSecret);
    const lines: string[] = [];
    for (const p of paths) {
      const text = await this.git(['cat-file', 'blob', `${rev}:${p}`]);
      for (const l of text.split('\n')) { const t = l.trim(); if (t.length >= 8 && !t.startsWith('#')) lines.push(t); }
    }
    return lines;
  }

  /** Paths whose change is binary according to git (`git diff --numstat` reports "-\t-"). */
  private async binaryPaths(base: string, tree: string): Promise<Set<string>> {
    const out = await this.git(['diff', '--numstat', '-z', '--no-renames', base, tree]);
    return new Set(out.split('\0').filter(Boolean).filter(r => r.startsWith('-\t-\t')).map(r => r.slice(4)));
  }

  async diff(base: string, tree: string): Promise<string> {
    return this.git(['diff', '--binary', '--no-color', '--no-renames', '--no-ext-diff', '--no-textconv', base, tree]);
  }

  async changes(base: string, tree: string): Promise<Change[]> {
    const out = await this.git(['diff', '--name-status', '-z', '--no-renames', base, tree]);
    const parts = out.split('\0'); const res: Change[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) if (parts[i]) res.push({ status: parts[i], path: parts[i + 1] });
    return res;
  }

  /** Paths of gitlinks (submodules) in a tree — unsupported in governed runs. */
  async gitlinks(tree: string): Promise<string[]> {
    const out = await this.git(['ls-tree', '-r', '-z', tree]);
    return out.split('\0').filter(Boolean).filter(l => l.startsWith('160000 ')).map(l => l.slice(l.indexOf('\t') + 1));
  }

  async treeOf(commit: string): Promise<string> { return (await this.git(['rev-parse', `${commit}^{tree}`])).trim(); }

  /** Commit exactly `tree` on `parent`, moving `branch` only if it still points at `parent` (compare-and-swap). */
  async commitTree(tree: string, parent: string, branch: string, message: string): Promise<string> {
    if (!OID_RE.test(tree) || !OID_RE.test(parent)) throw new Error('invalid tree or parent id');
    if (!BRANCH_RE.test(branch)) throw new Error(`invalid branch name ${JSON.stringify(branch)}`);
    const current = await this.branchHead(branch);
    if (current !== parent) throw new Error(`branch ${branch} moved (expected ${parent.slice(0, 12)}, found ${current.slice(0, 12)})`);
    const sha = (await this.git(['commit-tree', tree, '-p', parent, '-m', message])).trim();
    await this.git(['update-ref', `refs/heads/${branch}`, sha, parent]);
    if ((await this.treeOf(sha)) !== tree) throw new Error('committed tree differs from the approved tree');
    if ((await this.currentBranch()) === branch) await this.git(['reset', '-q']); // sync the index to the new HEAD; working tree untouched
    return sha;
  }
}
