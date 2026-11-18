/**
 * Builds the npm package `taskquoin` from the workspaces. Node refuses to strip types under node_modules, so the
 * package ships JavaScript: tsc emits every workspace `src/` into the output directory WITH THE REPOSITORY LAYOUT
 * (so every `new URL('../../../…', import.meta.url)` asset path keeps working), then each `@taskquoin/<name>`
 * specifier is rewritten to a path relative to the emitting file. No bundler, no new dependency.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';

const GROUPS = ['packages', 'adapters', 'apps'] as const;
const DOCS = ['README.md', 'LICENSE', 'SECURITY.md', 'CHANGELOG.md'] as const;
/** `from '@taskquoin/x'`, `export … from '@taskquoin/x'`, `import('@taskquoin/x')`, `import '@taskquoin/x'`. */
const SPECIFIER = /(\b(?:from|import)\s*\(?\s*)(['"])@taskquoin\/([a-z0-9-]+)\2/g;

interface Manifest { name: string; version: string; description?: string; license?: string; exports?: Record<string, string>; dependencies?: Record<string, string> }
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Manifest;
const posix = (p: string) => p.split(sep).join('/');

function workspaces(repoRoot: string): { dir: string; manifest: Manifest }[] {
  return GROUPS.flatMap(g => readdirSync(join(repoRoot, g), { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(repoRoot, g, d.name, 'package.json')))
    .map(d => ({ dir: `${g}/${d.name}`, manifest: readJson(join(repoRoot, g, d.name, 'package.json')) })));
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = join(dir, d.name);
    return d.isDirectory() ? walk(p) : [p];
  });
}

/** Workspace package name → its compiled entry, relative to the package root (packages with an `exports['.']`). */
export function workspaceMap(repoRoot: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const { dir, manifest } of workspaces(repoRoot)) {
    const entry = manifest.exports?.['.'];
    if (entry) map[manifest.name] = `${dir}/${entry.replace(/^\.\//, '').replace(/\.ts$/, '.js')}`;
  }
  return map;
}

/** Rewrites the `@taskquoin/<name>` specifiers of one emitted file (`file`, inside `stageRoot`). */
export function rewriteSpecifiers(code: string, file: string, stageRoot: string, map: Record<string, string>): string {
  return code.replace(SPECIFIER, (_m, pre: string, q: string, name: string) => {
    const target = map[`@taskquoin/${name}`];
    if (!target) throw new Error(`unknown workspace package @taskquoin/${name} (in ${file})`);
    let rel = posix(relative(dirname(file), join(stageRoot, target)));
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return `${pre}${q}${rel}${q}`;
  });
}

type Env = Record<string, string | undefined>;

/** repository/homepage/bugs of the repository that builds the package (GitHub Actions: GITHUB_REPOSITORY). npm
 *  provenance requires repository.url to name it; the source never hard-codes it. None for a local build. */
function repositoryFields(env: Env): Record<string, unknown> {
  const slug = env.GITHUB_REPOSITORY;
  if (!slug) return {};
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(slug)) throw new Error(`GITHUB_REPOSITORY is not owner/name: ${slug}`);
  const web = `${(env.GITHUB_SERVER_URL ?? 'https://github.com').replace(/\/$/, '')}/${slug}`;
  return { repository: { type: 'git', url: `git+${web}.git` }, homepage: `${web}#readme`, bugs: { url: `${web}/issues` } };
}

/** The published package.json: third-party dependencies of every workspace, each pinned to one exact version. */
export function packageManifest(repoRoot: string, env: Env = process.env): Record<string, unknown> {
  const root = readJson(join(repoRoot, 'package.json'));
  const dependencies: Record<string, string> = {};
  for (const { dir, manifest } of workspaces(repoRoot)) {
    for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
      if (name.startsWith('@taskquoin/')) continue;
      if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`${dir}: dependency ${name}@${version} is not pinned to an exact version`);
      if (dependencies[name] && dependencies[name] !== version) throw new Error(`dependency ${name} pinned twice: ${dependencies[name]} and ${version}`);
      dependencies[name] = version;
    }
  }
  return {
    name: 'taskquoin', version: root.version, description: root.description, license: 'Apache-2.0', type: 'module',
    bin: { taskquoin: 'apps/cli/src/main.js' }, engines: { node: '>=22.18' },
    ...repositoryFields(env),
    dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** Only an absent or empty directory, or a previous build of this package, may be replaced: never a mistyped path. */
function assertReplaceable(repo: string, out: string): void {
  if (repo === out || repo.startsWith(out + sep) || out === parse(out).root) throw new Error(`refusing to replace ${out}`);
  if (!existsSync(out) || readdirSync(out).length === 0) return;
  let name: string | undefined;
  try { name = readJson(join(out, 'package.json')).name; } catch { /* not a package build */ }
  if (name !== 'taskquoin') throw new Error(`refusing to replace ${out}: not empty and not a previous taskquoin package build`);
}

/** Builds the package into `outDir` (replaced). Returns its files, relative and sorted. */
export function buildPackage(repoRoot: string, outDir: string, env: Env = process.env): { files: string[] } {
  const repo = resolve(repoRoot), out = resolve(outDir);
  assertReplaceable(repo, out);
  rmSync(out, { recursive: true, force: true });

  const tsc = spawnSync(process.execPath, [join(repo, 'node_modules/typescript/bin/tsc'), '-p', join(repo, 'tsconfig.build.json'), '--outDir', out],
    { cwd: repo, encoding: 'utf8' });
  if (tsc.status !== 0) throw new Error(`tsc failed (${tsc.status ?? tsc.signal}):\n${tsc.stdout}${tsc.stderr}`);

  const map = workspaceMap(repo);
  for (const f of walk(out)) if (f.endsWith('.js')) {
    const code = readFileSync(f, 'utf8'); const next = rewriteSpecifiers(code, f, out, map);
    if (next !== code) writeFileSync(f, next);
  }
  // Runtime assets beside the code (capability matrices, measured hosts…): every non-TypeScript file under src/.
  for (const { dir } of workspaces(repo)) {
    const src = join(repo, dir, 'src');
    if (!existsSync(src)) continue;
    for (const f of walk(src)) if (!f.endsWith('.ts')) {
      const to = join(out, relative(repo, f)); mkdirSync(dirname(to), { recursive: true }); cpSync(f, to);
    }
  }
  // First-party skills are verified by tree hash: npm drops or renames some dotfiles, which would quarantine them.
  const dotfiles = walk(join(repo, 'skills')).filter(f => relative(join(repo, 'skills'), f).split(sep).some(s => s.startsWith('.')));
  if (dotfiles.length) throw new Error(`skills/ holds dotfiles npm would not publish as they are: ${dotfiles.map(f => relative(repo, f)).join(', ')}`);
  cpSync(join(repo, 'skills'), join(out, 'skills'), { recursive: true });
  for (const d of DOCS) cpSync(join(repo, d), join(out, d));
  writeFileSync(join(out, 'package.json'), JSON.stringify(packageManifest(repo, env), null, 2) + '\n');

  const files = walk(out).map(f => posix(relative(out, f))).sort();
  const bad = [
    ...files.filter(f => f.endsWith('.ts')).map(f => `TypeScript source shipped: ${f}`),
    ...files.filter(f => /(^|\/)tests?\//.test(f)).map(f => `test file shipped: ${f}`),
    ...files.filter(f => f.endsWith('.js') && new RegExp(SPECIFIER.source).test(readFileSync(join(out, f), 'utf8'))).map(f => `unresolved @taskquoin specifier: ${f}`),
  ];
  if (bad.length) throw new Error(`package check failed:\n${bad.join('\n')}`);
  if (!statSync(join(out, 'apps/cli/src/main.js')).isFile()) throw new Error('apps/cli/src/main.js missing');
  return { files };
}
