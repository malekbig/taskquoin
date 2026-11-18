/**
 * PROVES (static, on the workflow files): every GitHub Action is pinned by full commit SHA; CI keeps read-only
 * permissions and runs the supply-chain gates in order — npm audit, registry signatures, a gitleaks binary checked
 * against a pinned sha256, then gitleaks over the whole history — and installs the real npm package before running it.
 * DOES NOT PROVE: that GitHub runs them as written (the CI runs themselves are the evidence).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';

interface Step { uses?: string; run?: string; with?: Record<string, unknown> }
interface Job { steps: Step[]; permissions?: unknown }
interface Workflow { on: unknown; permissions?: unknown; jobs: Record<string, Job> }

const dir = new URL('../../.github/workflows/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.yml'));
const load = (f: string) => parse(readFileSync(new URL(f, dir), 'utf8')) as Workflow;
/** Index of the first step whose `run` matches — -1 when none. */
const at = (job: Job, re: RegExp) => job.steps.findIndex(s => typeof s.run === 'string' && re.test(s.run));
const inOrder = (job: Job, res: RegExp[]) => {
  const idx = res.map(re => at(job, re));
  idx.forEach((i, k) => assert.ok(i >= 0, `no step runs ${res[k]}`));
  for (let k = 1; k < idx.length; k++) assert.ok(idx[k - 1] < idx[k], `${res[k - 1]} must run before ${res[k]}`);
};

test('every action is pinned by a full commit SHA', () => {
  for (const f of files) for (const job of Object.values(load(f).jobs)) for (const s of job.steps)
    if (s.uses) assert.match(s.uses, /@[0-9a-f]{40}$/, `${f}: ${s.uses}`);
});

test('CI stays read-only', () => {
  const ci = load('ci.yml');
  assert.deepEqual(ci.permissions, { contents: 'read' });
  for (const [id, job] of Object.entries(ci.jobs)) assert.equal(job.permissions, undefined, `job ${id} widens permissions`);
});

test('supply-chain job: npm audit, registry signatures, pinned gitleaks, gitleaks over the whole history', () => {
  const job = load('ci.yml').jobs['supply-chain'];
  assert.ok(job, 'job supply-chain missing');
  assert.equal(job.steps.find(s => s.uses?.startsWith('actions/checkout@'))?.with?.['fetch-depth'], 0);
  inOrder(job, [/npm audit --audit-level=low/, /npm audit signatures/, /sha256sum -c/, /gitleaks"? git .*--config \.gitleaks\.toml.*--exit-code 1/]);
  assert.match(job.steps[at(job, /sha256sum -c/)].run!, /\b[0-9a-f]{64}\b/);
});

test('package job: builds, packs, installs the tarball globally, runs the installed taskquoin', () => {
  const job = load('ci.yml').jobs.package;
  assert.ok(job, 'job package missing');
  inOrder(job, [/npm run package/, /npm pack/, /npm install -g/, /taskquoin version/]);
  assert.match(job.steps[at(job, /taskquoin version/)].run!, /PreToolUse hook entry: ✔/);
});

// Release (final review): a pushed tag brings its own workflow file, so the signature check is one layer and the
// protected environment `npm-publish` (required reviewer; npm trusted publisher bound to it) is the gate. The OIDC
// token exists only in `publish`, which runs no repository code: it publishes the tarball `build` produced.
test('release: only on v* tags; id-token and the npm secret only in the environment-gated publish job', () => {
  const rel = load('release.yml');
  assert.deepEqual(rel.on, { push: { tags: ['v*'] } });
  assert.deepEqual(rel.permissions, { contents: 'read' });
  assert.deepEqual(Object.keys(rel.jobs).sort(), ['build', 'publish']);
  assert.equal(rel.jobs.build.permissions, undefined);
  const pub = rel.jobs.publish as Job & { needs?: unknown; environment?: unknown };
  assert.deepEqual(pub.permissions, { contents: 'read', 'id-token': 'write' });
  assert.equal(pub.needs, 'build');
  assert.equal(pub.environment, 'npm-publish');
  const text = readFileSync(new URL('release.yml', dir), 'utf8');
  assert.deepEqual([...text.matchAll(/secrets\.([A-Z_]+)/g)].map(m => m[1]), ['NPM_TOKEN']);
  assert.ok(!JSON.stringify(rel.jobs.build).includes('secrets.'), 'build sees no secret');
});

test('release publish: runs no repository code — downloads the built tarball and publishes it with provenance', () => {
  const pub = load('release.yml').jobs.publish;
  assert.ok(!pub.steps.some(s => s.uses?.startsWith('actions/checkout@')), 'publish checks out the repository');
  assert.equal(at(pub, /npm (ci|run|test)\b/), -1);
  assert.ok(pub.steps.some(s => s.uses?.startsWith('actions/download-artifact@')));
  inOrder(pub, [/npm install -g --ignore-scripts npm@11\.\d+\.\d+/, /npm publish "\$RUNNER_TEMP"\/pkg\/taskquoin-\*\.tgz --provenance --access public/]);
});

test('release build: the tag is signed by a key main lists and is the commit being built, before anything is built', () => {
  const job = load('release.yml').jobs.build;
  inOrder(job, [
    /git fetch --force origin "\+refs\/tags\/\$\{GITHUB_REF_NAME\}:refs\/tags\/\$\{GITHUB_REF_NAME\}"/,
    /git show origin\/main:\.github\/allowed_signers/,
    /gpg\.format=ssh .*allowedSignersFile.* verify-tag "\$GITHUB_REF_NAME"/,
    /git rev-parse "refs\/tags\/\$\{GITHUB_REF_NAME\}\^\{commit\}"\)" = "\$\(git rev-parse HEAD\)"/,
    /GITHUB_REF_NAME.*= "v\$\(node -p/,
    /npm ci --ignore-scripts/, /npm run typecheck/, /npm run test:ci/, /npm audit --audit-level=low/,
    /npm run package/, /npm pack \.\/dist\/package/,
  ]);
  const upload = job.steps.findIndex(s => s.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(upload > at(job, /npm pack/), 'the tarball is uploaded after npm pack');
});
