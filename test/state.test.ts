import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateLegacyStateKeys } from '../src/state.js';

test('migrateLegacyStateKeys maps baseToken cooldowns to explicit rule ids', () => {
  const migrated = migrateLegacyStateKeys(
    {
      lastAlertTime: {
        '0x2::sui::SUI': 1000,
      },
    },
    [
      {
        id: 'sui-below',
        baseToken: '0x2::sui::SUI',
        quoteToken: '0xquote::usdc::USDC',
      },
      {
        id: 'sui-above',
        baseToken: '0x2::sui::SUI',
        quoteToken: '0xquote::usdc::USDC',
      },
    ],
  );

  assert.equal(migrated.lastAlertTime['rule::sui-below'], 1000);
  assert.equal(migrated.lastAlertTime['rule::sui-above'], 1000);
  assert.equal(migrated.lastAlertTime['0x2::sui::SUI'], undefined);
});

test('migrateLegacyStateKeys maps recent index-based rule and ops keys to explicit ids', () => {
  const migrated = migrateLegacyStateKeys(
    {
      lastAlertTime: {
        '0x2::sui::SUI::0xquote::usdc::USDC::alert::0': 2000,
        '0x2::sui::SUI::0xquote::usdc::USDC::alert::0::ops::trade_failed': 3000,
      },
    },
    [
      {
        id: 'sui-below',
        baseToken: '0x2::sui::SUI',
        quoteToken: '0xquote::usdc::USDC',
      },
    ],
  );

  assert.equal(migrated.lastAlertTime['rule::sui-below'], 2000);
  assert.equal(migrated.lastAlertTime['rule::sui-below::ops::trade_failed'], 3000);
  assert.equal(migrated.lastAlertTime['0x2::sui::SUI::0xquote::usdc::USDC::alert::0'], undefined);
});

test('migrateLegacyStateKeys keeps explicit ids and unrelated keys unchanged', () => {
  const migrated = migrateLegacyStateKeys(
    {
      lastAlertTime: {
        'rule::sui-below': 4000,
        '0x2::sui::SUI::0xquote::usdc::USDC::buy::trade': 5000,
      },
    },
    [
      {
        id: 'sui-below',
        baseToken: '0x2::sui::SUI',
        quoteToken: '0xquote::usdc::USDC',
      },
    ],
  );

  assert.equal(migrated.lastAlertTime['rule::sui-below'], 4000);
  assert.equal(migrated.lastAlertTime['0x2::sui::SUI::0xquote::usdc::USDC::buy::trade'], 5000);
});
