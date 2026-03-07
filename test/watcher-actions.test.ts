import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAlertMessage,
  buildOpsAlertMessage,
  processAlertActions,
} from '../src/watcher-actions.js';

test('processAlertActions returns without sending when alert cooldown is active', async () => {
  let sent = false;

  const result = await processAlertActions({
    item: {
      id: 'sui-below',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'below',
      targetPrice: 1.2,
      alertMode: 'price',
      alertCooldownSeconds: 1800,
      tradeEnabled: true,
    },
    ruleKey: 'rule-1',
    pairSymbol: 'SUI/USDC',
    currentPrice: 1.1,
    reason: 'target: below $1.2000',
    tradeSide: 'buy',
    tradeCooldownKey: 'trade-1',
    triggerThreshold: 1.2,
    configTradeEnabled: false,
    configTelegram: { enabled: true, botToken: 'token', chatId: 'chat' },
    state: { lastAlertTime: { 'rule-1': Date.now() } },
  }, {
    shouldAlertFn: () => false,
    sendTelegramFn: async () => {
      sent = true;
      return true;
    },
    executeTradeFn: async () => {
      throw new Error('should not trade');
    },
    repriceFn: async () => null,
  });

  assert.equal(result.alertSent, false);
  assert.equal(sent, false);
});

test('processAlertActions sends alert without trade when trade is disabled', async () => {
  let sentMessage = '';

  const result = await processAlertActions({
    item: {
      id: 'sui-below',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'below',
      targetPrice: 1.2,
      alertMode: 'price',
      alertCooldownSeconds: 1800,
      tradeEnabled: true,
    },
    ruleKey: 'rule-1',
    pairSymbol: 'SUI/USDC',
    currentPrice: 1.1,
    reason: 'target: below $1.2000',
    tradeSide: 'buy',
    tradeCooldownKey: 'trade-1',
    triggerThreshold: 1.2,
    configTradeEnabled: false,
    configTelegram: { enabled: true, botToken: 'token', chatId: 'chat' },
    state: { lastAlertTime: {} },
  }, {
    shouldAlertFn: () => true,
    sendTelegramFn: async (_config, message) => {
      sentMessage = message;
      return true;
    },
    executeTradeFn: async () => {
      throw new Error('should not trade');
    },
    repriceFn: async () => null,
  });

  assert.equal(result.alertSent, true);
  assert.equal(result.tradeExecuted, false);
  assert.match(sentMessage, /Price Alert/);
});

test('buildAlertMessage uses actual trade input and output token direction', () => {
  const message = buildAlertMessage({
    pairSymbol: 'SUI/USDC',
    reason: 'target: below $1.2000',
    currentPrice: 1.1,
    tradeExecutionResult: {
      side: 'buy',
      inputCoin: '0xquote::usdc::USDC',
      outputCoin: '0x2::sui::SUI',
      amountIn: '1250000',
      amountOut: '1000000000',
      inputDecimals: 6,
      outputDecimals: 9,
      realizedPrice: 1.25,
      digest: '0xdigest',
    },
  });

  assert.match(message, /BUY 1\.25 USDC → 1 SUI/);
  assert.match(message, /1\.25(?:0+)? SUI\/USDC/);
});

test('buildOpsAlertMessage prefixes the title with Ops Warning', () => {
  const message = buildOpsAlertMessage({
    title: 'Trade Failed',
    pairSymbol: 'SUI/USDC',
    details: [
      'Reason: aggregator timeout',
      'Side: BUY',
    ],
  });

  assert.match(message, /Ops Warning: Trade Failed/);
  assert.match(message, /Pair: <code>SUI\/USDC<\/code>/);
});

test('processAlertActions still sends the signal alert when trade execution throws', async () => {
  const sentMessages: string[] = [];

  const result = await processAlertActions({
    item: {
      id: 'sui-below',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'below',
      targetPrice: 1.2,
      alertMode: 'price',
      alertCooldownSeconds: 1800,
      tradeCooldownSeconds: 1800,
      tradeEnabled: true,
    },
    ruleKey: 'rule-1',
    pairSymbol: 'SUI/USDC',
    currentPrice: 1.1,
    reason: 'target: below $1.2000',
    tradeSide: 'buy',
    tradeCooldownKey: 'trade-1',
    triggerThreshold: 1.2,
    configTradeEnabled: true,
    configTelegram: { enabled: true, botToken: 'token', chatId: 'chat' },
    state: { lastAlertTime: {} },
  }, {
    shouldAlertFn: () => true,
    sendTelegramFn: async (_config, message) => {
      sentMessages.push(message);
      return true;
    },
    executeTradeFn: async () => {
      throw new Error('aggregator timeout');
    },
    repriceFn: async () => 1.1,
  });

  assert.equal(result.alertSent, true);
  assert.equal(result.tradeExecuted, false);
  assert.equal(result.opsNotification?.kind, 'trade_failed');
  assert.match(sentMessages[0], /Price Alert/);
});
