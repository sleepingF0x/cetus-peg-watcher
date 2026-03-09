import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDisplayAmount,
  scaleHumanAmountToAtomicAmount,
} from '../src/formatters.js';

test('scaleHumanAmountToAtomicAmount converts whole human units to atomic units', () => {
  assert.equal(scaleHumanAmountToAtomicAmount(1000, 6), 1000000000n);
});

test('scaleHumanAmountToAtomicAmount preserves decimal human units', () => {
  assert.equal(scaleHumanAmountToAtomicAmount(12.3456, 6), 12345600n);
});

test('formatDisplayAmount trims trailing zeros for quoted size output', () => {
  assert.equal(formatDisplayAmount(1000), '1000');
  assert.equal(formatDisplayAmount(12.34), '12.34');
});
