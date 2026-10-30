import test from 'node:test';
import assert from 'node:assert/strict';
import { toPaise, fromPaise } from '../../server/accounting/money.js';

test('service invoice uses exact INR paise for tax and totals', () => {
  assert.equal(toPaise('10000.00'), 1000000);
  assert.equal(toPaise('900.00'), 90000);
  assert.equal(toPaise('11800.00'), 1180000);
  assert.equal(fromPaise(1180000), '11800.00');
});

test('invalid or overflowing ledger money cannot be stored', () => {
  for (const bad of ['-1.00', '0.001', '1e3', 'NaN', '90071992547409.92', '', null, Infinity]) {
    assert.throws(() => toPaise(bad));
  }
});
