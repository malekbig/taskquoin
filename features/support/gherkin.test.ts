/** PROVES: the minimal Gherkin parser reads FR/EN keywords, Contexte/Background, tags and keeps line numbers. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseFeature } from './gherkin.ts';

test('parses French and English keywords, background, tags', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tq-gh-')), 'x.feature');
  writeFileSync(f, ['# language: fr', 'Fonctionnalité: Démo', '  description libre', '  Contexte:', '    Soit un contexte', '  @sandbox', '  Scénario: Premier', '    Quand on agit', '    Alors ça marche', '    Et encore', 'Scenario: Second', '  Given x', '  When y', '  Then z'].join('\n'));
  const p = parseFeature(f);
  assert.equal(p.name, 'Démo');
  assert.deepEqual(p.background.map(s => s.text), ['un contexte']);
  assert.deepEqual(p.scenarios.map(s => [s.name, s.tags, s.steps.map(x => x.keyword)]), [['Premier', ['@sandbox'], ['Quand', 'Alors', 'Et']], ['Second', [], ['Given', 'When', 'Then']]]);
  assert.equal(p.scenarios[0].steps[0].line, 8);
});
