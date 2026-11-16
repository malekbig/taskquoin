/**
 * PROVES: binaries are found only through absolute PATH entries and resolved to real paths; versions are parsed from
 * `--version`; bash-sandbox is false when bubblewrap/socat are not on PATH; git root is detected.
 * DOES NOT PROVE: anything about the real runtimes (fakes are used).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findOnPath, probeHost } from '../src/index.ts';

const root = realpathSync(mkdtempSync(join(tmpdir(), 'tq-probe-')));
const bin = join(root, 'bin'); mkdirSync(bin);
const fake = (name: string, out: string) => { const p = join(bin, name); writeFileSync(p, `#!/bin/sh\necho "${out}"\n`); chmodSync(p, 0o755); };
fake('claude', '2.1.325 (Claude Code)'); fake('codex', 'codex-cli 0.157.1');
const gitBin = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();

test('relative PATH entries are ignored', () => {
  assert.equal(findOnPath('claude', `bin:${bin}`), join(bin, 'claude'));
  assert.equal(findOnPath('claude', 'bin'), undefined);
});

test('probeHost: versions, no sandbox without bwrap/socat, git root', async () => {
  const ws = join(root, 'ws'); mkdirSync(ws); execFileSync(gitBin, ['init', '-q'], { cwd: ws });
  const PATH = `${bin}:${gitBin.replace(/\/git$/, '')}`;
  const h = await probeHost({ cwd: ws, PATH, HOME: root });
  assert.deepEqual(h.runtimes.claude, { bin: join(bin, 'claude'), version: '2.1.325' });
  assert.deepEqual(h.runtimes.codex, { bin: join(bin, 'codex'), version: '0.157.1' });
  if (!PATH.split(':').some(d => { try { return !!findOnPath('bwrap', d) && !!findOnPath('socat', d); } catch { return false; } })) assert.equal(h.bashSandbox, false);
  assert.equal(h.gitRoot, ws);
});

test('probeHost: OpenCode found with its version; fileSandbox = Taskquoin\'s own bubblewrap profile usable', async () => {
  fake('opencode', '1.19.5');
  const h = await probeHost({ cwd: root, PATH: `${bin}:/usr/bin:/bin`, HOME: root });
  assert.deepEqual(h.runtimes.opencode, { bin: join(bin, 'opencode'), version: '1.19.5' });
  const { sandboxedToolAvailable } = await import('@taskquoin/local-tool');
  assert.equal(h.fileSandbox, await sandboxedToolAvailable());
});
