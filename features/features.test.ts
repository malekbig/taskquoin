/**
 * E2E features (Gherkin, French) — the readable specification of how Taskquoin chains its steps.
 * Drives the REAL CLI, git, control store and bubblewrap verification; Claude and Codex are deterministic fakes
 * (zero tokens). Scenarios tagged @sandbox need bubblewrap + socat and are skipped (with the reason) otherwise.
 * PROVES: the orchestration and policy behaviour written in the .feature files.
 * DOES NOT PROVE: real model behaviour or runtime sandboxes (see tests/live-*.e2e.test.ts).
 */
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { parseFeature, runFeature } from './support/gherkin.ts';
import { World } from './support/world.ts';
import { steps } from './steps.ts';

// Real availability (namespaces can be disabled even when the binaries exist) — Codex R4.
const sandbox = (() => { try { execFileSync('bwrap', ['--ro-bind', '/', '/', '--unshare-net', '--dev', '/dev', 'true']); execFileSync('sh', ['-c', 'command -v socat']); return true; } catch { return false; } })();
const dir = new URL('./', import.meta.url).pathname;
for (const f of readdirSync(dir).filter(n => n.endsWith('.feature')).sort()) {
  runFeature(parseFeature(dir + f), steps, () => new World(), tag => (tag === '@sandbox' && !sandbox ? 'bubblewrap + socat required' : false));
}
