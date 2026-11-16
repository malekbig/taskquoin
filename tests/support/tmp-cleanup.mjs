// Loaded with --import before every test file (`npm test`, `npm run test:ci`): the file gets its own TMPDIR, removed
// when its process exits — even after a failure, even if a test left unreadable directories. Nothing is left in the
// system temp directory (tests/architecture/temp-cleanup.test.ts).
import { chmodSync, lstatSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'tq-suite-'));
process.env.TMPDIR = root;

/** Give the owner back rwx on every directory (tests chmod some to 000), so the tree can be removed. */
function unlock(dir) {
  try { chmodSync(dir, 0o700); } catch { return; }
  let names = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const n of names) {
    const p = join(dir, n);
    try { if (lstatSync(p).isDirectory()) unlock(p); } catch { /* vanished */ }
  }
}

process.on('exit', () => {
  try { rmSync(root, { recursive: true, force: true }); } catch {
    unlock(root);
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort: never fail a test run on cleanup */ }
  }
});
