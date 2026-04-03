import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResolvedWatchItem } from '../src/config/resolved.js';
import {
  buildAlertMessage,
  buildOpsAlertMessage,
  processAlertActions,
} from '../src/watcher-actions.js';

function makeItem(fields: Partial<ResolvedWatchItem> & Pick<ResolvedWatchItem, 'id' | 'baseToken' | 'quoteToken' | 'condition' | 'alertMode'>): ResolvedWatchItem {
  return {
    pollInterval: 30,
    alertCooldownSeconds: 1800,
    tradeCooldownSeconds: 1800,
    priceQueryMinBaseAmount: 1,
    tradeEnabled: true,
    tradeConfirmations: 2,
    maxSpreadPercent: null,
    ...fields,
  };
}

import type { ResolvedTradeConfig } from '../src/config/resolved.js';
function makeTradeConfig(fields: Partial<ResolvedTradeConfig>): ResolvedTradeConfig {
  return {
    enabled: false,
    mnemonicFile: '',
    derivationPath: "m/44'/784'/0'/0'/0'",
    rpcUrl: 'https://fullnode.mainnet.sui.io:443',
    slippagePercent: 0.1,
    suiGasReserve: 0.02,
    maxTradePercent: 100,
    fastTrackEnabled: true,
    fastTrackExtraPercent: 1.5,
    fastTrackTradePercent: 75,
    fastTrackSlippageMultiplier: 0.35,
    fastTrackMaxSlippagePercent: 2,
    statusPollDelayMs: 1500,
    statusPollIntervalMs: 1500,
    statusPollTimeoutMs: 15000,
    ...fields,
  };
}

test('processAlertActions returns without sending when alert cooldown is active', async () => {
  let sent = false;

  const result = await processAlertActions({
    item: makeItem({
      id: 'sui-below',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'below',
      targetPrice: 1.2,
      alertMode: 'price',
      alertCooldownSeconds: 1800,
      tradeEnabled: true,
    }),
    ruleKey: 'rule-1',
    pairSymbol: 'SUI/USDC',
    currentPrice: 1.1,
    quotedBaseAmount: 1000,
    reason: 'target: below $1.2000',
    tradeSide: 'buy',
    tradeCooldownKey: 'trade-1',
    triggerThreshold: 1.2,
    configTradeEnabled: false,
    configTrade: makeTradeConfig({}),
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
    item: makeItem({
      id: 'sui-below',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'below',
      targetPrice: 1.2,
      alertMode: 'price',
      alertCooldownSeconds: 1800,
      tradeEnabled: true,
    }),
    ruleKey: 'rule-1',
    pairSymbol: 'SUI/USDC',
    currentPrice: 1.1,
    quotedBaseAmount: 1000,
    reason: 'target: below $1.2000',
    tradeSide: 'buy',
    tradeCooldownKey: 'trade-1',
    triggerThreshold: 1.2,
    configTradeEnabled: false,
    configTrade: makeTradeConfig({}),
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
    quotedBaseAmount: 1000,
    tradeExecutionResult: {
      status: 'success',
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
  assert.match(message, /Mid Price: <code>\$1\.100000<\/code>/);
  assert.match(message, /Quoted Size: <code>1000 SUI<\/code>/);
});

test('buildAlertMessage shows failed trade status with on-chain reason', () => {
  const message = buildAlertMessage({
    pairSymbol: 'SUI/USDC',
    reason: 'target: above $1.2000',
    currentPrice: 1.3,
    quotedBaseAmount: 1000,
    tradeExecutionResult: {
      status: 'failure',
      side: 'sell',
      inputCoin: '0x2::sui::SUI',
      outputCoin: '0xquote::usdc::USDC',
      digest: '0xfailed',
      error: 'err_amount_out_slippage_check_failed',
    },
  });

  assert.match(message, /Price Alert \+ Trade Failed/);
  assert.match(message, /Status: <code>FAILED<\/code>/);
  assert.match(message, /err_amount_out_slippage_check_failed/);
  assert.doesNotMatch(message, /Current:/);
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
    item: makeItem({
      id: 'sui-below',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'below',
      targetPrice: 1.2,
      alertMode: 'price',
      alertCooldownSeconds: 1800,
      tradeCooldownSeconds: 1800,
      tradeEnabled: true,
    }),
    ruleKey: 'rule-1',
    pairSymbol: 'SUI/USDC',
    currentPrice: 1.1,
    quotedBaseAmount: 1000,
    reason: 'target: below $1.2000',
    tradeSide: 'buy',
    tradeCooldownKey: 'trade-1',
    triggerThreshold: 1.2,
    configTradeEnabled: true,
    configTrade: makeTradeConfig({}),
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

test('processAlertActions does not treat submitted trade with digest as executed', async () => {
  let sentMessage = '';

  const result = await processAlertActions({
    item: makeItem({
      id: 'sui-above',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      targetPrice: 1.2,
      alertMode: 'price',
      alertCooldownSeconds: 1800,
      tradeCooldownSeconds: 1800,
      tradeEnabled: true,
    }),
    ruleKey: 'rule-1',
    pairSymbol: 'SUI/USDC',
    currentPrice: 1.3,
    quotedBaseAmount: 1000,
    reason: 'target: above $1.2000',
    tradeSide: 'sell',
    tradeCooldownKey: 'trade-1',
    triggerThreshold: 1.2,
    configTradeEnabled: true,
    configTrade: makeTradeConfig({}),
    configTelegram: { enabled: true, botToken: 'token', chatId: 'chat' },
    state: { lastAlertTime: {} },
  }, {
    shouldAlertFn: () => true,
    sendTelegramFn: async (_config, message) => {
      sentMessage = message;
      return true;
    },
    executeTradeFn: async () => ({
      status: 'submitted' as const,
      side: 'sell' as const,
      inputCoin: '0x2::sui::SUI',
      outputCoin: '0xquote::usdc::USDC',
      digest: '0xsubmitted',
    }),
    repriceFn: async () => 1.3,
  });

  assert.equal(result.tradeExecuted, false);
  assert.equal(result.shouldRecordTradeCooldown, false);
  assert.equal(result.tradeExecutionResult?.status, 'submitted');
  assert.match(sentMessage, /Trade Submitted/);
  assert.doesNotMatch(sentMessage, /Trade Executed/);
});

test('processAlertActions sends failed trade status when chain reports failure', async () => {
  let sentMessage = '';

  const result = await processAlertActions({
    item: makeItem({
      id: 'sui-above',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      targetPrice: 1.2,
      alertMode: 'price',
      alertCooldownSeconds: 1800,
      tradeCooldownSeconds: 1800,
      tradeEnabled: true,
    }),
    ruleKey: 'rule-1',
    pairSymbol: 'SUI/USDC',
    currentPrice: 1.3,
    quotedBaseAmount: 1000,
    reason: 'target: above $1.2000',
    tradeSide: 'sell',
    tradeCooldownKey: 'trade-1',
    triggerThreshold: 1.2,
    configTradeEnabled: true,
    configTrade: makeTradeConfig({}),
    configTelegram: { enabled: true, botToken: 'token', chatId: 'chat' },
    state: { lastAlertTime: {} },
  }, {
    shouldAlertFn: () => true,
    sendTelegramFn: async (_config, message) => {
      sentMessage = message;
      return true;
    },
    executeTradeFn: async () => ({
      status: 'failure' as const,
      error: 'err_amount_out_slippage_check_failed',
      side: 'sell' as const,
      inputCoin: '0x2::sui::SUI',
      outputCoin: '0xquote::usdc::USDC',
      digest: '0xfailed',
    }),
    repriceFn: async () => 1.3,
  });

  assert.equal(result.tradeExecuted, false);
  assert.equal(result.shouldRecordTradeCooldown, false);
  assert.equal(result.tradeExecutionResult?.status, 'failure');
  assert.match(sentMessage, /Trade Failed/);
  assert.match(sentMessage, /err_amount_out_slippage_check_failed/);
});

test('processAlertActions only treats confirmed success as executed trade', async () => {
  let sentMessage = '';

  const result = await processAlertActions({
    item: makeItem({
      id: 'sui-above',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      targetPrice: 1.2,
      alertMode: 'price',
      alertCooldownSeconds: 1800,
      tradeCooldownSeconds: 1800,
      tradeEnabled: true,
    }),
    ruleKey: 'rule-1',
    pairSymbol: 'SUI/USDC',
    currentPrice: 1.3,
    quotedBaseAmount: 1000,
    reason: 'target: above $1.2000',
    tradeSide: 'sell',
    tradeCooldownKey: 'trade-1',
    triggerThreshold: 1.2,
    configTradeEnabled: true,
    configTrade: makeTradeConfig({}),
    configTelegram: { enabled: true, botToken: 'token', chatId: 'chat' },
    state: { lastAlertTime: {} },
  }, {
    shouldAlertFn: () => true,
    sendTelegramFn: async (_config, message) => {
      sentMessage = message;
      return true;
    },
    executeTradeFn: async () => ({
      status: 'success' as const,
      side: 'sell' as const,
      inputCoin: '0x2::sui::SUI',
      outputCoin: '0xquote::usdc::USDC',
      amountIn: '1000000000',
      amountOut: '1200000',
      realizedPrice: 1.2,
      digest: '0xsuccess',
      inputDecimals: 9,
      outputDecimals: 6,
    }),
    repriceFn: async () => 1.3,
  });

  assert.equal(result.tradeExecuted, true);
  assert.equal(result.shouldRecordTradeCooldown, true);
  assert.equal(result.tradeExecutionResult?.status, 'success');
  assert.match(sentMessage, /Trade Executed/);
});

test('processAlertActions sends pending trade status and schedules follow-up when final state is unknown', async () => {
  let sentMessage = '';
  let followUpScheduled = false;

  const result = await processAlertActions({
    item: makeItem({
      id: 'sui-above',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      targetPrice: 1.2,
      alertMode: 'price',
      alertCooldownSeconds: 1800,
      tradeCooldownSeconds: 1800,
      tradeEnabled: true,
    }),
    ruleKey: 'rule-1',
    pairSymbol: 'SUI/USDC',
    currentPrice: 1.3,
    quotedBaseAmount: 1000,
    reason: 'target: above $1.2000',
    tradeSide: 'sell',
    tradeCooldownKey: 'trade-1',
    triggerThreshold: 1.2,
    configTradeEnabled: true,
    configTrade: makeTradeConfig({}),
    configTelegram: { enabled: true, botToken: 'token', chatId: 'chat' },
    state: { lastAlertTime: {} },
  }, {
    shouldAlertFn: () => true,
    sendTelegramFn: async (_config, message) => {
      sentMessage = message;
      return true;
    },
    executeTradeFn: async () => ({
      status: 'unknown' as const,
      side: 'sell' as const,
      inputCoin: '0x2::sui::SUI',
      outputCoin: '0xquote::usdc::USDC',
      amountIn: '1000000000',
      digest: '0xpending',
    }),
    repriceFn: async () => 1.3,
    scheduleTradeStatusFollowUpFn: () => {
      followUpScheduled = true;
    },
  });

  assert.equal(result.tradeExecuted, false);
  assert.equal(result.shouldRecordTradeCooldown, false);
  assert.equal(result.tradeExecutionResult?.status, 'unknown');
  assert.equal(followUpScheduled, true);
  assert.match(sentMessage, /Trade Pending/);
});

test('processAlertActions recomputes fast-track context from requoted price before executing trade', async () => {
  let receivedExecutionContext: { fastTrack: boolean; overshootPercent: number } | null = null;

  const result = await processAlertActions({
    item: makeItem({
      id: 'sui-above',
      baseToken: '0x2::sui::SUI',
      quoteToken: '0xquote::usdc::USDC',
      condition: 'above',
      avgTargetPercent: 102.5,
      avgWindowMinutes: 15,
      avgResumeFactor: 0.95,
      alertMode: 'avg_percent',
      alertCooldownSeconds: 1800,
      tradeCooldownSeconds: 1800,
      tradeEnabled: true,
    }),
    ruleKey: 'rule-1',
    pairSymbol: 'SUI/USDC',
    currentPrice: 10.4,
    quotedBaseAmount: 1000,
    reason: '15m avg x 102.5%: above $10.2500',
    tradeSide: 'sell',
    tradeCooldownKey: 'trade-1',
    triggerThreshold: 10.25,
    avgWindowPrice: 10,
    configTradeEnabled: true,
    configTrade: makeTradeConfig({
      enabled: true,
      fastTrackEnabled: true,
      fastTrackExtraPercent: 1.5,
      fastTrackTradePercent: 75,
      slippagePercent: 0.5,
      fastTrackSlippageMultiplier: 0.35,
      fastTrackMaxSlippagePercent: 2,
    }),
    configTelegram: { enabled: true, botToken: 'token', chatId: 'chat' },
    state: { lastAlertTime: {} },
  }, {
    shouldAlertFn: () => true,
    sendTelegramFn: async () => true,
    executeTradeFn: async (executionContext) => {
      receivedExecutionContext = executionContext;
      return {
        status: 'submitted' as const,
        side: 'sell' as const,
        inputCoin: '0x2::sui::SUI',
        outputCoin: '0xquote::usdc::USDC',
        digest: '0xsubmitted',
      };
    },
    repriceFn: async () => 10.26,
  });

  assert.equal(result.tradeExecutionResult?.status, 'submitted');
  assert.deepEqual(receivedExecutionContext, {
    fastTrack: false,
    overshootPercent: 0.1,
  });
});
