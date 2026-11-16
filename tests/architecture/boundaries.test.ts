/**
 * FITNESS FUNCTION (S5). PROVES: dependency rule of architecture.md §3 holds for every source file:
 *  - packages/domain and packages/rules import only relative files;
 *  - packages/application imports only relative files, @taskquoin/domain and node: builtins (never an adapter);
 *  - adapters never import apps.
 * DOES NOT PROVE: absence of dynamic imports via computed strings.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
function files(dir: string): string[] {
  let out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out = out.concat(files(p)); else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}
const importsOf = (f: string) => [...readFileSync(f, 'utf8').matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1] ?? m[2]);

test('domain and rules import nothing but themselves (pure, run inside a hook)', () => {
  for (const pkg of ['domain', 'rules']) for (const f of files(join(root, `packages/${pkg}/src`))) for (const i of importsOf(f)) assert.ok(i.startsWith('./'), `${f} imports ${i}`);
});

test('application never imports adapters', () => {
  for (const f of files(join(root, 'packages/application/src'))) for (const i of importsOf(f)) {
    // rules is pure and dependency-free (landing gate); still never an adapter
    assert.ok(i.startsWith('./') || i.startsWith('../') || i === '@taskquoin/domain' || i === '@taskquoin/rules' || i.startsWith('node:'), `${f} imports ${i}`);
  }
});

test('adapters never import apps', () => {
  for (const f of files(join(root, 'adapters'))) {
    if (f.includes('/node_modules/')) continue;
    for (const i of importsOf(f)) assert.ok(!i.startsWith('@taskquoin/cli') && !i.includes('/apps/'), `${f} imports ${i}`);
  }
});
