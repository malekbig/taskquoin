/**
 * PROVES: the npm package builder's pure parts — `@taskquoin/<name>` import specifiers become paths relative to each
 * emitted file (nested files included), comments are left alone, an unknown workspace name stops the build; the
 * published manifest (name, version = root version, bin, engines, exactly-pinned third-party dependencies only).
 * DOES NOT PROVE: that the built tarball installs and runs — tests/package/installed.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackage, packageManifest, rewriteSpecifiers, workspaceMap } from '../../scripts/package/build.ts';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const map = workspaceMap(repo);
const S = '/stage';

test('workspaceMap: every importable workspace package maps to its compiled entry', () => {
  assert.equal(map['@taskquoin/domain'], 'packages/domain/src/index.js');
  assert.equal(map['@taskquoin/runtime-claude'], 'adapters/runtime-claude/src/index.js');
  assert.ok(!('@taskquoin/cli' in map), 'the CLI is an entry point, not imported');
});

test('a nested file gets a relative path to the package entry', () => {
  const out = rewriteSpecifiers("import { a } from '@taskquoin/domain';", `${S}/packages/application/src/use-cases/x.js`, S, map);
  assert.equal(out, "import { a } from '../../../domain/src/index.js';");
});

test('export-from and dynamic import are rewritten; a sibling package path starts with ./ or ../', () => {
  const out = rewriteSpecifiers("export * from '@taskquoin/rules';\nconst r = await import('@taskquoin/rules');", `${S}/packages/domain/src/x.js`, S, map);
  assert.equal(out, "export * from '../../rules/src/index.js';\nconst r = await import('../../rules/src/index.js');");
});

test('a comment that names a package is not an import and stays as it is', () => {
  const src = '// generated from the shared @taskquoin/rules lists\n';
  assert.equal(rewriteSpecifiers(src, `${S}/adapters/runtime-claude/src/p.js`, S, map), src);
});

test('an unknown workspace package stops the build', () => {
  assert.throws(() => rewriteSpecifiers("import x from '@taskquoin/nope';", `${S}/apps/cli/src/main.js`, S, map), /unknown workspace package @taskquoin\/nope/);
});

test('the build never replaces a directory that is neither empty nor a previous taskquoin package build', () => {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'tq-out-'));
  writeFileSync(join(dir, 'keep.txt'), 'user data');
  assert.throws(() => buildPackage(repo, dir), /refusing to replace/);
  assert.equal(readFileSync(join(dir, 'keep.txt'), 'utf8'), 'user data');
  writeFileSync(join(dir, 'package.json'), '{"name":"something-else"}');
  assert.throws(() => buildPackage(repo, dir), /refusing to replace/);
  assert.equal(readFileSync(join(dir, 'keep.txt'), 'utf8'), 'user data');
});

test('manifest: published as taskquoin, root version, compiled bin, only exactly-pinned third-party dependencies', () => {
  const m = packageManifest(repo, {}) as Record<string, any>;
  const root = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(m.name, 'taskquoin');
  assert.equal(m.version, root.version);
  assert.equal(m.type, 'module');
  assert.deepEqual(m.bin, { taskquoin: 'apps/cli/src/main.js' });
  assert.equal(m.engines.node, '>=22.18');
  assert.deepEqual(m.dependencies, { yaml: '2.9.1' });
  assert.equal(m.license, 'Apache-2.0');
  assert.equal(m.private, undefined);
});

// npm provenance requires repository.url to name the repository that builds the package: taken from the CI
// environment, never written in the source (the public export refuses personal names).
test('manifest: repository, homepage and bugs come from GITHUB_REPOSITORY — none without it', () => {
  const m = packageManifest(repo, { GITHUB_REPOSITORY: 'acme/taskquoin', GITHUB_SERVER_URL: 'https://github.com' }) as Record<string, any>;
  assert.deepEqual(m.repository, { type: 'git', url: 'git+https://github.com/acme/taskquoin.git' });
  assert.equal(m.homepage, 'https://github.com/acme/taskquoin#readme');
  assert.deepEqual(m.bugs, { url: 'https://github.com/acme/taskquoin/issues' });
  const local = packageManifest(repo, {}) as Record<string, any>;
  assert.equal(local.repository, undefined);
  assert.equal(local.homepage, undefined);
  assert.throws(() => packageManifest(repo, { GITHUB_REPOSITORY: 'no-slash' }), /GITHUB_REPOSITORY/);
});
