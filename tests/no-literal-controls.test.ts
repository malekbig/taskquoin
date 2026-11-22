/**
 * PROVES: no tracked .ts/.mjs/.cjs/.json/.md/.feature/.yml/.yaml/.sh/.py/.toml/.txt file (code, data, docs, Gherkin,
 * CI, shell) holds a literal C0/C1 control (except newline and tab), bidi control or invisible character;
 * U+200C/U+200D (Persian and Hindi text) are allowed in .json and .md only.
 * An editor or a tool can turn a \u escape into the real character (and a literal U+2028 ends a JS regex literal).
 * DOES NOT PROVE: untracked files.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FORBIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff9-\ufffb]|[\u{1bca0}-\u{1bca3}\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/gu;
const ROOT = new URL('..', import.meta.url).pathname;

test('no literal control, bidi or invisible character in tracked sources', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(f => /\.(ts|mjs|cjs|json|md|feature|ya?ml|sh|py|toml|txt)$/.test(f));
  assert.ok(files.length > 100, 'the scan sees the repository');
  for (const ext of ['.feature', '.yml', '.sh']) assert.ok(files.some(f => f.endsWith(ext)), `the scan covers ${ext} files (Gherkin, CI, shell)`);
  const bad: string[] = [];
  for (const f of files) {
    const natural = /\.(json|md)$/.test(f);
    const text = readFileSync(ROOT + f, 'utf8');
    text.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(FORBIDDEN)) {
        const cp = m[0].codePointAt(0)!;
        if (natural && (cp === 0x200c || cp === 0x200d)) continue;
        bad.push(`${f}:${i + 1} U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
      }
    });
  }
  assert.deepEqual(bad, []);
});
