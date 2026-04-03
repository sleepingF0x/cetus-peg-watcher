import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResolvedWatchItem } from '../src/config/resolved.js';
import { createAveragePauseRule, evaluateWatchRule } from '../src/watcher-rules.js';

function makeItem(fields: Partial<ResolvedWatchItem> & Pick<ResolvedWatchItem, 'id' | 'baseToken' | 'quoteToken' | 'condition' | 'alertMode' | 'tradeConfirmations'>): ResolvedWatchItem {
  return {
    pollInterval: 30,
    alertCooldownSeconds: 1800,
    tradeCooldownSeconds: 1800,
    priceQueryMinBaseAmount: 1,
    tradeEnabled: true,
    maxSpreadPercent: null,
    ...fields,
  };
}

const fastTrackTradeConfig = {
  fastTrackEnabled: true,
  fastTrackExtraPercent: 1.5,
};

test('evaluateWatchRule returns threshold hit for price mode', () => {
  const result = evaluateWatchRule({
    item: makeItem({
      id: 'sui-below',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'below',
      targetPrice: 1.2,
      alertMode: 'price',
      tradeConfirmations: 2,
    }),
    price: 1.1,
    avgWindowPrice: null,
    previousHitCount: 1,
    pauseRule: undefined,
    tradeConfig: fastTrackTradeConfig,
  });

  assert.equal(result.isPaused, false);
  assert.equal(result.isConditionMet, true);
  assert.equal(result.triggerThreshold, 1.2);
  assert.equal(result.tradeSide, 'buy');
  assert.equal(result.hitCount, 2);
  assert.equal(result.isAlertConfirmed, true);
  assert.equal(result.isFastTrack, false);
  assert.equal(result.tradeConfirmedImmediately, false);
  assert.equal(result.overshootPercent, 0);
});

test('evaluateWatchRule returns average threshold hit for avg_percent mode', () => {
  const result = evaluateWatchRule({
    item: makeItem({
      id: 'sui-above',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      avgTargetPercent: 103,
      avgWindowMinutes: 10,
      avgResumeFactor: 0.95,
      alertMode: 'avg_percent',
      tradeConfirmations: 2,
    }),
    price: 10.4,
    avgWindowPrice: 10,
    previousHitCount: 0,
    pauseRule: undefined,
    tradeConfig: fastTrackTradeConfig,
    allowFastTrack: true,
  });

  assert.equal(result.isConditionMet, true);
  assert.equal(result.triggerThreshold, 10.3);
  assert.equal(result.tradeSide, 'sell');
  assert.equal(result.hitCount, 1);
  assert.equal(result.isAlertConfirmed, false);
  assert.equal(result.isFastTrack, false);
  assert.equal(result.tradeConfirmedImmediately, false);
  assert.equal(result.overshootPercent, 1);
});

test('evaluateWatchRule keeps avg_percent rule paused until resume threshold is crossed', () => {
  const paused = evaluateWatchRule({
    item: makeItem({
      id: 'sui-above',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      avgTargetPercent: 103,
      avgWindowMinutes: 10,
      avgResumeFactor: 0.95,
      alertMode: 'avg_percent',
      tradeConfirmations: 2,
    }),
    price: 10.8,
    avgWindowPrice: 10,
    previousHitCount: 3,
    pauseRule: {
      condition: 'above',
      resumePrice: 10.2,
    },
    tradeConfig: fastTrackTradeConfig,
  });

  assert.equal(paused.isPaused, true);
  assert.equal(paused.resumed, false);
  assert.equal(paused.isConditionMet, false);
  assert.equal(paused.hitCount, 0);
  assert.equal(paused.isFastTrack, false);
  assert.equal(paused.tradeConfirmedImmediately, false);
  assert.equal(paused.overshootPercent, 0);

  const resumed = evaluateWatchRule({
    item: makeItem({
      id: 'sui-above',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      avgTargetPercent: 103,
      avgWindowMinutes: 10,
      avgResumeFactor: 0.95,
      alertMode: 'avg_percent',
      tradeConfirmations: 2,
    }),
    price: 10.2,
    avgWindowPrice: 10,
    previousHitCount: 0,
    pauseRule: {
      condition: 'above',
      resumePrice: 10.2,
    },
    tradeConfig: fastTrackTradeConfig,
  });

  assert.equal(resumed.isPaused, false);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.isConditionMet, false);
  assert.equal(resumed.isFastTrack, false);
  assert.equal(resumed.tradeConfirmedImmediately, false);
  assert.equal(resumed.overshootPercent, 0);
});

test('evaluateWatchRule enters fast-track for above avg_percent rule when overshoot reaches configured threshold', () => {
  const result = evaluateWatchRule({
    item: makeItem({
      id: 'sui-above',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      avgTargetPercent: 102.5,
      avgWindowMinutes: 15,
      avgResumeFactor: 0.95,
      alertMode: 'avg_percent',
      tradeConfirmations: 2,
    }),
    price: 10.4,
    avgWindowPrice: 10,
    previousHitCount: 0,
    pauseRule: undefined,
    tradeConfig: fastTrackTradeConfig,
    allowFastTrack: true,
  });

  assert.equal(result.isConditionMet, true);
  assert.equal(result.isFastTrack, true);
  assert.equal(result.tradeConfirmedImmediately, true);
  assert.equal(result.isAlertConfirmed, true);
  assert.equal(result.overshootPercent, 1.5);
});

test('evaluateWatchRule enters fast-track for below avg_percent rule when overshoot reaches configured threshold', () => {
  const result = evaluateWatchRule({
    item: makeItem({
      id: 'sui-below',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'below',
      avgTargetPercent: 95.5,
      avgWindowMinutes: 15,
      avgResumeFactor: 0.95,
      alertMode: 'avg_percent',
      tradeConfirmations: 2,
    }),
    price: 9.25,
    avgWindowPrice: 10,
    previousHitCount: 0,
    pauseRule: undefined,
    tradeConfig: fastTrackTradeConfig,
    allowFastTrack: true,
  });

  assert.equal(result.isConditionMet, true);
  assert.equal(result.isFastTrack, true);
  assert.equal(result.tradeConfirmedImmediately, true);
  assert.equal(result.isAlertConfirmed, true);
  assert.equal(result.overshootPercent, 3);
});

test('evaluateWatchRule never enters fast-track for price mode', () => {
  const result = evaluateWatchRule({
    item: makeItem({
      id: 'sui-above-price',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      targetPrice: 1.05,
      alertMode: 'price',
      tradeConfirmations: 3,
    }),
    price: 1.3,
    avgWindowPrice: null,
    previousHitCount: 0,
    pauseRule: undefined,
    tradeConfig: fastTrackTradeConfig,
  });

  assert.equal(result.isConditionMet, true);
  assert.equal(result.isFastTrack, false);
  assert.equal(result.tradeConfirmedImmediately, false);
  assert.equal(result.isAlertConfirmed, false);
  assert.equal(result.overshootPercent, 0);
});

test('evaluateWatchRule does not use fast-track when trading is not allowed', () => {
  const result = evaluateWatchRule({
    item: makeItem({
      id: 'sui-above',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      avgTargetPercent: 102.5,
      avgWindowMinutes: 15,
      avgResumeFactor: 0.95,
      alertMode: 'avg_percent',
      tradeConfirmations: 2,
      tradeEnabled: false,
    }),
    price: 10.4,
    avgWindowPrice: 10,
    previousHitCount: 0,
    pauseRule: undefined,
    tradeConfig: fastTrackTradeConfig,
    allowFastTrack: false,
  });

  assert.equal(result.isConditionMet, true);
  assert.equal(result.isFastTrack, false);
  assert.equal(result.tradeConfirmedImmediately, false);
  assert.equal(result.isAlertConfirmed, false);
  assert.equal(result.overshootPercent, 1.5);
});

test('createAveragePauseRule derives the resume threshold from avg target percent and resume factor', () => {
  const pauseRule = createAveragePauseRule(makeItem({
    id: 'sui-above',
    baseToken: '0x2::sui::SUI',
    quoteToken: '0xquote::usdc::USDC',
    condition: 'above',
    avgTargetPercent: 103,
    avgResumeFactor: 0.95,
    alertMode: 'avg_percent',
    tradeConfirmations: 2,
  }), 10);

  assert.equal(pauseRule.condition, 'above');
  assert.equal(pauseRule.resumePrice, 10.015);
});
