// Fixture for temp-cleanup.test.ts — leaves a temp dir behind (and an unwritable one), then FAILS on purpose; never
// matched by the `npm test` globs (*.test.ts only).
import { test } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('leaves temp dirs behind, then fails', () => {
  const d = mkdtempSync(join(tmpdir(), process.env.TQ_LEAK_PREFIX ?? 'tq-leak-'));
  writeFileSync(join(d, 'f'), 'x'); mkdirSync(join(d, 'locked')); chmodSync(join(d, 'locked'), 0o000);
  console.log('LEAKY-FIXTURE-RAN');
  throw new Error('fails on purpose');
});
