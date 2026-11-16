/**
 * PROVES: Taskquoin's OpenCode connection lives in its own directory; each run gets fresh dirs holding ONLY the credential
 * of its model's provider (plus the catalogue and plugin manifests fetched at connect time); a refreshed credential comes
 * back without ever touching another provider (Review Focus 4). Secrets are never returned or printed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { connectedProviders, mergeBackCredential, prepareRunDirs, userOpenCodeDirs } from '../src/credentials.ts';
import { authPath, modelsPath, pluginDir } from '../src/facts.ts';

const fresh = () => realpathSync(mkdtempSync(join(tmpdir(), 'tq-ocb-')));
function seed(base: string, entries: unknown) {
  const u = userOpenCodeDirs(base); mkdirSync(dirname(authPath(u)), { recursive: true });
  writeFileSync(authPath(u), typeof entries === 'string' ? entries : JSON.stringify(entries), { mode: 0o600 }); return u;
}
const OPENAI = { type: 'oauth', access: 'SECRET-ACCESS', refresh: 'SECRET-REFRESH', expires: 1, accountId: 'acct' };
const ROUTER = { type: 'api', key: 'SECRET-KEY' };

test('connectedProviders: provider ids and their non-secret type, never a secret; corrupt or absent → []', () => {
  const u = seed(fresh(), { openai: OPENAI, openrouter: ROUTER });
  assert.deepEqual(connectedProviders(u), [{ id: 'openai', type: 'oauth' }, { id: 'openrouter', type: 'api' }]);
  assert.ok(!JSON.stringify(connectedProviders(u)).includes('SECRET'));
  assert.deepEqual(connectedProviders(seed(fresh(), '{not json')), []);
  assert.deepEqual(connectedProviders(userOpenCodeDirs(fresh())), []);
  assert.equal(statSync(join(dirname(u.config))).mode & 0o077, 0); // <base>/opencode is 0700
});

test("prepareRunDirs: fresh dirs with ONLY the model's provider credential (0600), the catalogue and plugin manifests; unknown provider → refused", () => {
  const base = fresh(); const u = seed(base, { openai: OPENAI, openrouter: ROUTER });
  mkdirSync(dirname(modelsPath(u)), { recursive: true }); writeFileSync(modelsPath(u), '{"openai":{}}');
  mkdirSync(pluginDir(u), { recursive: true }); writeFileSync(join(pluginDir(u), 'package.json'), '{"dependencies":{}}');
  const run = prepareRunDirs(u, join(base, 'runs'), 'openai');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(authPath(run.dirs), 'utf8'))), ['openai']);
  assert.equal(statSync(authPath(run.dirs)).mode & 0o077, 0);
  assert.equal(readFileSync(modelsPath(run.dirs), 'utf8'), '{"openai":{}}');
  assert.ok(existsSync(join(pluginDir(run.dirs), 'package.json')));
  assert.ok(run.dirs.config.startsWith(run.root + '/'));
  assert.throws(() => prepareRunDirs(u, join(base, 'runs'), 'mistral'), /fournisseur "mistral" non connecté pour Taskquoin — lancez : taskquoin connect opencode/);
});

test('mergeBackCredential: a refreshed credential comes back; other providers never move; an unreadable run file changes nothing', () => {
  const base = fresh(); const u = seed(base, { openai: OPENAI, openrouter: ROUTER });
  const run = prepareRunDirs(u, join(base, 'runs'), 'openai');
  writeFileSync(authPath(run.dirs), JSON.stringify({ openai: { ...OPENAI, access: 'SECRET-NEW' }, openrouter: { type: 'api', key: 'FORGED' } }));
  assert.equal(mergeBackCredential(u, run.dirs, 'openai'), undefined);
  const after = JSON.parse(readFileSync(authPath(u), 'utf8'));
  assert.equal(after.openai.access, 'SECRET-NEW'); assert.deepEqual(after.openrouter, ROUTER);
  assert.equal(statSync(authPath(u)).mode & 0o077, 0);
  writeFileSync(authPath(run.dirs), '{broken');
  assert.match(mergeBackCredential(u, run.dirs, 'openai') ?? '', /unchanged/);
  assert.deepEqual(JSON.parse(readFileSync(authPath(u), 'utf8')), after);
});

test('final review: a run that did not change the credential never rolls back a newer one; of two refreshes the later expiry wins', () => {
  const base = fresh(); const u = seed(base, { openai: { ...OPENAI, access: 'A', expires: 1 } });
  const r1 = prepareRunDirs(u, join(base, 'runs'), 'openai'); const r2 = prepareRunDirs(u, join(base, 'runs'), 'openai');
  writeFileSync(authPath(r1.dirs), JSON.stringify({ openai: { ...OPENAI, access: 'B', expires: 2 } }));
  assert.equal(mergeBackCredential(u, r1.dirs, 'openai', r1.initial), undefined);
  assert.equal(mergeBackCredential(u, r2.dirs, 'openai', r2.initial), undefined); // r2 unchanged (A): must not roll back to A
  assert.equal(JSON.parse(readFileSync(authPath(u), 'utf8')).openai.access, 'B');
  const r3 = prepareRunDirs(u, join(base, 'runs'), 'openai'); const r4 = prepareRunDirs(u, join(base, 'runs'), 'openai');
  writeFileSync(authPath(r3.dirs), JSON.stringify({ openai: { ...OPENAI, access: 'C', expires: 3 } })); mergeBackCredential(u, r3.dirs, 'openai', r3.initial);
  writeFileSync(authPath(r4.dirs), JSON.stringify({ openai: { ...OPENAI, access: 'D', expires: 2.5 } }));
  assert.match(mergeBackCredential(u, r4.dirs, 'openai', r4.initial) ?? '', /newer/);
  assert.equal(JSON.parse(readFileSync(authPath(u), 'utf8')).openai.access, 'C');
});

test('final review (Claude I1): merge-back never re-creates a removed connection, never overwrites an unreadable one, and waits for a lock', () => {
  const base = fresh(); const u = seed(base, { openai: { ...OPENAI, access: 'A', expires: 1 }, openrouter: ROUTER });
  const r1 = prepareRunDirs(u, join(base, 'runs'), 'openai');
  writeFileSync(authPath(r1.dirs), JSON.stringify({ openai: { ...OPENAI, access: 'B', expires: 2 } }));
  writeFileSync(authPath(u), '{corrupt'); // unreadable user connection: keep it as it is
  assert.match(mergeBackCredential(u, r1.dirs, 'openai', r1.initial) ?? '', /unreadable/); assert.equal(readFileSync(authPath(u), 'utf8'), '{corrupt');
  rmSync(authPath(u)); // `connect opencode --remove` during the run: never re-created
  assert.match(mergeBackCredential(u, r1.dirs, 'openai', r1.initial) ?? '', /removed/); assert.ok(!existsSync(authPath(u)));
  const u2 = seed(fresh(), { openai: { ...OPENAI, access: 'A', expires: 1 } }); const r2 = prepareRunDirs(u2, join(base, 'runs2'), 'openai');
  writeFileSync(authPath(r2.dirs), JSON.stringify({ openai: { ...OPENAI, access: 'B', expires: 2 } }));
  writeFileSync(authPath(u2) + '.lock', String(process.pid)); // another merge in progress
  assert.match(mergeBackCredential(u2, r2.dirs, 'openai', r2.initial, 50) ?? '', /busy/);
  assert.equal(JSON.parse(readFileSync(authPath(u2), 'utf8')).openai.access, 'A');
});
