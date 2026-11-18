/**
 * PROVES: `layoutOf` finds the paths that differ between a source checkout (`.ts`, run by type stripping) and an npm
 * install (`.js`, under node_modules where Node refuses to strip types): the PreToolUse hook entry, the shortcut
 * launcher (none when installed by npm: npm already put `taskquoin` on the PATH) and the version (root package.json,
 * kept equal to apps/cli's). Paths are real file paths even when the install path contains a space (no `%20`).
 * DOES NOT PROVE: that an npm tarball contains those files — tests/package/installed.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { layoutOf } from '../src/layout.ts';

const versionOf = (u: URL) => (JSON.parse(readFileSync(u, 'utf8')) as { version: string }).version;

test('source layout: .ts hook entry that exists, the repo launcher, the root version (= apps/cli version)', () => {
  const l = layoutOf(new URL('../src/main.ts', import.meta.url).href);
  assert.equal(l.packaged, false);
  assert.ok(l.hookEntry.endsWith('adapters/hooks-claude/src/main.ts'), l.hookEntry);
  assert.ok(existsSync(l.hookEntry), l.hookEntry);
  assert.ok(l.launcher?.endsWith('bin/taskquoin'), l.launcher);
  assert.equal(l.version, versionOf(new URL('../../../package.json', import.meta.url)));
  assert.equal(l.version, versionOf(new URL('../package.json', import.meta.url)));
});

test('packaged layout under a path with a space: .js hook entry, no launcher, version of the installed package.json', () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'tq-layout-')));
  const root = join(tmp, 'with space');
  mkdirSync(join(root, 'apps/cli/src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '9.9.9' }));
  const l = layoutOf(pathToFileURL(join(root, 'apps/cli/src/main.js')).href);
  assert.equal(l.packaged, true);
  assert.equal(l.root, root);
  assert.equal(l.hookEntry, join(root, 'adapters/hooks-claude/src/main.js'));
  assert.equal(l.launcher, undefined);
  assert.equal(l.version, '9.9.9');
});
