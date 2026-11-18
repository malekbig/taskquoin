/**
 * FITNESS FUNCTION (i18n). PROVES: in the translated files, no `out(`, `err(`, `io.out(`, `io.err(`, `fail(`, `write(` or
 * `new Error(` call carries a string or template literal with two words (they must go through `t()` / `tn()`).
 * A line ending in `// i18n-ok: <reason>` is exempt (ids, paths, data).
 * DOES NOT PROVE: that a literal built elsewhere and passed by variable is translated, nor catalog completeness.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url).pathname;
const FILES = ['apps/cli/src/console.ts', 'apps/cli/src/main.ts', 'apps/cli/src/shortcut.ts', 'apps/cli/src/workflow-cli.ts', 'apps/cli/src/skills-cli.ts'];
const CALL = /(?:\bio\.out|\bio\.err|\bout|\berr|\bfail|\bwrite|\bask)\(|\bnew Error\(/;
const LITERAL = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g;
const TWO_WORDS = /[\p{L}]{2,}\s+[\p{L}]{2,}/u;

test('no untranslated user-facing literal in the translated files', () => {
  const bad: string[] = [];
  for (const f of FILES) {
    readFileSync(root + f, 'utf8').split('\n').forEach((line, i) => {
      if (/\/\/ i18n-ok: \S/.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const m = CALL.exec(line);
      if (!m) return;
      const lits = line.slice(m.index).match(LITERAL) ?? [];
      if (lits.some((l) => TWO_WORDS.test(l))) bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(bad, [], `untranslated literals (use t()/tn(), or end the line with // i18n-ok: <reason>):\n${bad.join('\n')}`);
});
