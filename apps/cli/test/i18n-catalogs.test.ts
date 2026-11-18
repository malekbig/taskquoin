/**
 * PROVES: every language in LANGUAGES has a locale file that parses; each catalog holds no key unknown to English
 * (plural keys need an English `_other` base and a CLDR suffix), keeps exactly the English `{param}` set and every
 * `/command` word unchanged; no locale holds an English-only key (those end up in `check --json`); `fr` has every
 * English key except the English-only ones, and the en catalog has no test-fixture keys. A diagnostic lists the
 * keys each machine language lacks.
 * DOES NOT PROVE: that a translation is accurate or idiomatic (the 20 machine languages are unreviewed), nor that
 * a catalog is complete for the machine languages (missing keys fall back to English by design).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { en, ENGLISH_ONLY } from '../src/i18n/en.ts';
import { LANGUAGES } from '../src/i18n/languages.ts';

const dir = new URL('../src/i18n/locales/', import.meta.url);
const SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const english = en as Record<string, string>;
const only = new Set<string>(ENGLISH_ONLY);
const params = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const commands = (s: string) => [...new Set([...s.matchAll(/(?<![\w/])\/[a-z][a-z-]*/g)].map((m) => m[0]))].sort();
/** The English key a locale key answers to: itself, or its plural base's `_other` form. */
const englishKeyOf = (key: string): string | undefined => {
  if (key in english) return key;
  const m = /^(.*)_(zero|one|two|few|many|other)$/.exec(key);
  return m && SUFFIXES.includes(m[2]) && `${m[1]}_other` in english ? `${m[1]}_other` : undefined;
};
const load = (code: string): Record<string, string> => JSON.parse(readFileSync(new URL(`${code}.json`, dir), 'utf8'));

test('en holds no test-fixture keys', () => {
  for (const k of ['console.runs_one', 'console.runs_other', 'console.greeting']) assert.ok(!(k in english), k);
  for (const k of ENGLISH_ONLY) assert.ok(k in english, k);
});

test('fr is complete: every en key except the English-only ones', () => {
  const fr = load('fr');
  const missing = Object.keys(english).filter((k) => !only.has(k) && !(k in fr));
  assert.deepEqual(missing, []);
});

for (const { code } of LANGUAGES.filter((l) => l.code !== 'en')) {
  test(`locale ${code}`, (t) => {
    assert.ok(existsSync(new URL(`${code}.json`, dir)), `${code}.json is missing`);
    const cat = load(code);
    for (const [k, v] of Object.entries(cat)) {
      assert.ok(!only.has(k), `${k}: English-only key must be absent`);
      const ek = englishKeyOf(k);
      assert.ok(ek, `${k}: unknown key`);
      assert.equal(typeof v, 'string', `${k}: not a string`);
      assert.deepEqual(params(v), params(english[ek]), `${k}: {param} set differs`);
      assert.deepEqual(commands(english[ek]).filter((c) => !v.includes(c)), [], `${k}: /command changed`);
    }
    if (code !== 'fr') {
      const bases = new Set(Object.keys(cat).map((k) => englishKeyOf(k)));
      const missing = Object.keys(english).filter((k) => !only.has(k) && !bases.has(k) && !(k.endsWith('_one') && bases.has(k.replace(/_one$/, '_other'))));
      t.diagnostic(`${code}: ${missing.length} missing key(s)${missing.length ? ': ' + missing.join(', ') : ''}`);
    }
  });
}
