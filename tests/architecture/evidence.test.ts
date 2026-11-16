/**
 * PROVES: every `measured` variant in both capability matrices cites at least one evidence artifact that EXISTS in the
 * repository (a docs/reports/*.txt evidence file or a *.test.ts file) — Codex R3 §3 "evidenceRef is just a string".
 * DOES NOT PROVE: that the cited artifact substantiates the claim (reviewed by humans and independent reviewers).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url).pathname;
for (const rt of ['claude', 'codex', 'opencode']) {
  test(`every measured variant cites an existing evidence file: ${rt}`, () => {
    const m = JSON.parse(readFileSync(`${root}adapters/runtime-${rt}/src/capabilities.json`, 'utf8'));
    for (const [cap, variants] of Object.entries(m.entries as Record<string, { evidence: string; evidenceRef?: string }[]>)) {
      for (const v of variants) {
        if (v.evidence !== 'measured') continue;
        const paths = [...(v.evidenceRef ?? '').matchAll(/((?:docs\/reports|adapters|packages|tests)\/[\w./-]+\.(?:txt|ts))/g)].map(x => x[1]);
        assert.ok(paths.length > 0, `${rt}/${cap}: evidenceRef names no file: ${v.evidenceRef}`);
        for (const p of paths) assert.ok(existsSync(root + p), `${rt}/${cap}: cited file does not exist: ${p}`);
      }
    }
  });
}
