import test from 'node:test';
import assert from 'node:assert/strict';
import { createAveragePauseRule, evaluateWatchRule } from '../src/watcher-rules.js';

test('evaluateWatchRule returns threshold hit for price mode', () => {
  const result = evaluateWatchRule({
    item: {
      id: 'sui-below',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'below',
      targetPrice: 1.2,
      alertMode: 'price',
      tradeConfirmations: 2,
    },
    price: 1.1,
    avgWindowPrice: null,
    previousHitCount: 1,
    pauseRule: undefined,
  });

  assert.equal(result.isPaused, false);
  assert.equal(result.isConditionMet, true);
  assert.equal(result.triggerThreshold, 1.2);
  assert.equal(result.tradeSide, 'buy');
  assert.equal(result.hitCount, 2);
  assert.equal(result.isAlertConfirmed, true);
});

test('evaluateWatchRule returns average threshold hit for avg_percent mode', () => {
  const result = evaluateWatchRule({
    item: {
      id: 'sui-above',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      avgTargetPercent: 103,
      avgWindowMinutes: 10,
      avgResumeFactor: 0.95,
      alertMode: 'avg_percent',
      tradeConfirmations: 2,
    },
    price: 10.4,
    avgWindowPrice: 10,
    previousHitCount: 0,
    pauseRule: undefined,
  });

  assert.equal(result.isConditionMet, true);
  assert.equal(result.triggerThreshold, 10.3);
  assert.equal(result.tradeSide, 'sell');
  assert.equal(result.hitCount, 1);
  assert.equal(result.isAlertConfirmed, false);
});

test('evaluateWatchRule keeps avg_percent rule paused until resume threshold is crossed', () => {
  const paused = evaluateWatchRule({
    item: {
      id: 'sui-above',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      avgTargetPercent: 103,
      avgWindowMinutes: 10,
      avgResumeFactor: 0.95,
      alertMode: 'avg_percent',
      tradeConfirmations: 2,
    },
    price: 10.8,
    avgWindowPrice: 10,
    previousHitCount: 3,
    pauseRule: {
      condition: 'above',
      resumePrice: 10.2,
    },
  });

  assert.equal(paused.isPaused, true);
  assert.equal(paused.resumed, false);
  assert.equal(paused.isConditionMet, false);
  assert.equal(paused.hitCount, 0);

  const resumed = evaluateWatchRule({
    item: {
      id: 'sui-above',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      avgTargetPercent: 103,
      avgWindowMinutes: 10,
      avgResumeFactor: 0.95,
      alertMode: 'avg_percent',
      tradeConfirmations: 2,
    },
    price: 10.2,
    avgWindowPrice: 10,
    previousHitCount: 0,
    pauseRule: {
      condition: 'above',
      resumePrice: 10.2,
    },
  });

  assert.equal(resumed.isPaused, false);
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.isConditionMet, false);
});

test('createAveragePauseRule derives the resume threshold from avg target percent and resume factor', () => {
  const pauseRule = createAveragePauseRule({
    id: 'sui-above',
    baseToken: '0x2::sui::SUI',
    quoteToken: '0xquote::usdc::USDC',
    condition: 'above',
    avgTargetPercent: 103,
    avgResumeFactor: 0.95,
    alertMode: 'avg_percent',
  }, 10);

  assert.equal(pauseRule.condition, 'above');
  assert.equal(pauseRule.resumePrice, 10.015);
});
