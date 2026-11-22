/**
 * PROVES: loadPreferences tolerates a missing dir, invalid JSON and non-objects, keeps a string language and only a
 * valid runtimeSelection.claude; savePreferences merges into the file without losing other keys, writes mode 0600,
 * and creates the directory with mode 0700; a failed save throws and leaves no temporary file behind.
 * DOES NOT PROVE: behaviour under concurrent writers, nor how callers use the selection.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPreferences, savePreferences } from '../src/preferences.ts';

const tmp = (): string => mkdtempSync(join(tmpdir(), 'tq-prefs-'));

test('loadPreferences returns {} for a missing dir, bad JSON and arrays', () => {
  const dir = tmp();
  assert.deepEqual(loadPreferences(join(dir, 'absent')), {});
  writeFileSync(join(dir, 'preferences.json'), '{nope');
  assert.deepEqual(loadPreferences(dir), {});
  writeFileSync(join(dir, 'preferences.json'), '[1]');
  assert.deepEqual(loadPreferences(dir), {});
});

test('loadPreferences keeps a string language and only a valid selection', () => {
  const dir = tmp();
  const file = join(dir, 'preferences.json');
  writeFileSync(file, JSON.stringify({ language: 'de', runtimeSelection: { claude: 'path' } }));
  assert.deepEqual(loadPreferences(dir), { language: 'de', runtimeSelection: { claude: 'path' } });
  writeFileSync(file, JSON.stringify({ language: 3, runtimeSelection: { claude: 'yolo' } }));
  assert.deepEqual(loadPreferences(dir), {});
});

test('savePreferences keeps other keys, sets modes and creates the directory', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'preferences.json'), '{"language":"de","x":1}');
  savePreferences(dir, { runtimeSelection: { claude: 'path' } });
  assert.equal(readFileSync(join(dir, 'preferences.json'), 'utf8').trim(), '{"language":"de","x":1,"runtimeSelection":{"claude":"path"}}');
  assert.equal(statSync(join(dir, 'preferences.json')).mode & 0o777, 0o600);
  const fresh = join(dir, 'sub', 'state');
  savePreferences(fresh, { runtimeSelection: { claude: 'auto' } });
  assert.equal(statSync(fresh).mode & 0o777, 0o700);
  assert.deepEqual(loadPreferences(fresh), { runtimeSelection: { claude: 'auto' } });
});

test('savePreferences: a failed save throws and leaves no temporary file behind', () => {
  const dir = tmp();
  mkdirSync(join(dir, 'preferences.json')); writeFileSync(join(dir, 'preferences.json', 'x'), ''); // the rename cannot replace it
  assert.throws(() => savePreferences(dir, { runtimeSelection: { claude: 'path' } }));
  assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
});
