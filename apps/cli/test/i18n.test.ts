/**
 * PROVES: the language list (22 codes, order, rtl, machine flags), locale normalization (POSIX/BCP 47 spellings, legacy
 * codes, zh/pt rules), the resolution order (TASKQUOIN_LANG, preference, LC_ALL, LC_MESSAGES, LANG, C = en), a
 * tolerant preferences reader, `translate` (parameters, English fallback, CLDR plural categories), and that a corrupt
 * locale file falls back to English with exactly one stderr warning.
 * It also proves the C/POSIX LC_ALL spellings (C.UTF-8, C.utf8) force English, and the run's prose-language glue
 * (`proseLanguageFor`: undefined for English, the English language name otherwise; unit-tested because a real run needs live agents).
 * DOES NOT PROVE: that any locale file is complete or well translated, nor how the console uses the catalogs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LANGUAGES } from '../src/i18n/languages.ts';
import { proseLanguageFor } from '../src/workflow-cli.ts';
import { currentLanguage, loadPreferences, normalizeLanguage, resolveLanguage, setLanguage, t, tn, translate } from '../src/i18n/index.ts';

test('normalizeLanguage maps locale spellings to supported codes', () => {
  for (const [raw, want] of [['fr_FR.UTF-8','fr'],['fr_FR@euro','fr'],['pt_PT','pt-BR'],['pt_BR.UTF-8','pt-BR'],['zh_TW','zh-TW'],['zh_Hant_HK','zh-TW'],['zh_SG','zh-CN'],['iw_IL','he'],['in_ID','id'],['es_MX','es'],['de-AT','de'],['C',undefined],['POSIX',undefined],['',undefined],['klingon',undefined]] as const)
    assert.equal(normalizeLanguage(raw), want, raw);
});

test('resolveLanguage follows the documented precedence', () => {
  assert.equal(resolveLanguage({ TASKQUOIN_LANG: 'es', LANG: 'fr_FR.UTF-8' }, {}), 'es');
  assert.equal(resolveLanguage({ TASKQUOIN_LANG: 'klingon', LANG: 'fr_FR.UTF-8' }, {}), 'fr');
  assert.equal(resolveLanguage({ LANG: 'fr_FR.UTF-8' }, { language: 'ja' }), 'ja');
  assert.equal(resolveLanguage({ LC_ALL: 'C', LANG: 'fr_FR.UTF-8' }, {}), 'en');
  assert.equal(resolveLanguage({}, {}), 'en');
});

test('resolveLanguage: LC_ALL C / POSIX in any spelling forces English; a normal LC_ALL still wins; unset falls through', () => {
  for (const v of ['C.UTF-8', 'C.utf8', 'POSIX', 'c.utf-8', 'posix.UTF-8'])
    assert.equal(resolveLanguage({ LC_ALL: v, LANG: 'fr_FR.UTF-8' }, {}), 'en', v);
  assert.equal(resolveLanguage({ LC_ALL: 'de_DE.UTF-8', LANG: 'fr_FR.UTF-8' }, {}), 'de');
  assert.equal(resolveLanguage({ LANG: 'fr_FR.UTF-8' }, {}), 'fr');
});

test('loadPreferences tolerates a missing directory and invalid JSON', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tq-i18n-'));
  assert.deepEqual(loadPreferences(join(dir, 'absent')), {});
  writeFileSync(join(dir, 'preferences.json'), '{not json');
  assert.deepEqual(loadPreferences(dir), {});
  writeFileSync(join(dir, 'preferences.json'), '{"language":"de"}');
  assert.deepEqual(loadPreferences(dir), { language: 'de' });
});

test('translate: parameters, English fallback, plurals', () => {
  assert.equal(translate('fr', { k: 'Hi {name}' }, { k: 'Salut {name}' }, 'k', { name: 'Ada' }), 'Salut Ada');
  assert.equal(translate('fr', { k: 'Hi', j: 'Yo' }, { k: 'Salut' }, 'j'), 'Yo');
  const en = { n_one: '{count} run', n_other: '{count} runs' };
  assert.equal(translate('en', en, undefined, 'n', { count: 1 }), '1 run');
  assert.equal(translate('en', en, undefined, 'n', { count: 2 }), '2 runs');
  const ru = { n_one: '{count} запуск', n_few: '{count} запуска', n_many: '{count} запусков' };
  assert.equal(translate('ru', en, ru, 'n', { count: 1 }), '1 запуск');
  assert.equal(translate('ru', en, ru, 'n', { count: 3 }), '3 запуска');
  assert.equal(translate('ru', en, ru, 'n', { count: 5 }), '5 запусков');
});

test('translate: count on a non-plural key still finds the key', () => {
  assert.equal(translate('en', { k: '{count} files' }, undefined, 'k', { count: 3 }), '3 files');
});

test('non-string catalog values never throw: they fall back to English per key', () => {
  try {
    for (const bad of ['5', '{}', '["x"]', 'null']) {
      setLanguage('fr', () => `{"console.unknownCommand": ${bad}}`);
      assert.equal(t('console.unknownCommand', { name: 'x' }), 'unknown command: /x — /help for the list', bad);
    }
    assert.equal(translate('fr', { k: 'Hi' }, { k: 5 } as unknown as Record<string, string>, 'k'), 'Hi');
  } finally {
    setLanguage('en');
  }
});

test('t and tn use the current language; a corrupt locale gives English and one stderr warning', () => {
  try {
    const writes: string[] = [];
    const orig = process.stderr.write;
    process.stderr.write = ((s: string) => { writes.push(String(s)); return true; }) as typeof process.stderr.write;
    try {
      setLanguage('fr', () => '{oops');
    } finally {
      process.stderr.write = orig;
    }
    assert.equal(writes.length, 1, writes.join());
    assert.equal(currentLanguage(), 'en');
    assert.equal(t('console.unknownCommand', { name: 'x' }), 'unknown command: /x — /help for the list');
    assert.equal(tn('console.typeAhead', 2), '(2 lines typed before the prompt were ignored)');
    setLanguage('fr', () => JSON.stringify({ 'console.unknownCommand': 'inconnue : /{name}' }));
    assert.equal(currentLanguage(), 'fr');
    assert.equal(t('console.unknownCommand', { name: 'x' }), 'inconnue : /x');
    assert.equal(t('console.help.footer'), 'Tab completes a command; typing / shows this menu.');
    setLanguage('fr', () => '{}'); // an empty catalog: English text, no warning
    assert.equal(tn('console.typeAhead', 1), '(1 line typed before the prompt was ignored)');
  } finally {
    setLanguage('en');
  }
});

test('LANGUAGES: 22 unique codes in order with the rtl and machine flags', () => {
  const codes = LANGUAGES.map((x) => x.code);
  assert.deepEqual(codes, ['en','fr','es','pt-BR','de','it','nl','pl','ru','uk','tr','ar','fa','he','hi','id','vi','th','zh-CN','zh-TW','ja','ko']);
  assert.equal(new Set(codes).size, 22);
  for (const x of LANGUAGES) {
    assert.equal(x.machine, !['en', 'fr'].includes(x.code), x.code);
    assert.equal(x.rtl, ['ar', 'fa', 'he'].includes(x.code), x.code);
  }
});

test('proseLanguageFor: the language a run tells its agents to write in', () => {
  assert.equal(proseLanguageFor('en'), undefined);
  assert.equal(proseLanguageFor('fr'), 'French');
  assert.equal(proseLanguageFor('pt-BR'), LANGUAGES.find((x) => x.code === 'pt-BR')!.englishName);
});
