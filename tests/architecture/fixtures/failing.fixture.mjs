// Fixture for ci-reporter.test.ts — fails on purpose; never matched by the `npm test` globs (*.test.ts only).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
test('passes', () => {});
describe('Fonctionnalité: demo', () => {
  test('Scénario: le lanceur, avec: deux-points', () => { assert.equal(127, 0, 'command failed:\n\nexec: node: not found\n'); });
});
