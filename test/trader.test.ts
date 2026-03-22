import test from 'node:test';
import assert from 'node:assert/strict';
import type { ResolvedTradeConfig } from '../src/config/resolved.js';
import {
  pollTradeExecutionUntilFinal,
  resolveTradePercent,
  resolveTradeSlippagePercent,
} from '../src/trader.js';

const tradeConfig: ResolvedTradeConfig = {
  enabled: true,
  mnemonicFile: '',
  derivationPath: "m/44'/784'/0'/0'/0'",
  rpcUrl: 'https://fullnode.mainnet.sui.io:443',
  slippagePercent: 0.5,
  suiGasReserve: 0.02,
  maxTradePercent: 50,
  fastTrackEnabled: true,
  fastTrackExtraPercent: 1.5,
  fastTrackTradePercent: 75,
  fastTrackSlippageMultiplier: 0.35,
  fastTrackMaxSlippagePercent: 2,
  statusPollDelayMs: 1500,
  statusPollIntervalMs: 1500,
  statusPollTimeoutMs: 15000,
};

test('resolveTradePercent uses normal trade percent outside fast-track', () => {
  const percent = resolveTradePercent(tradeConfig, {
    fastTrack: false,
  });

  assert.equal(percent, 50);
});

test('resolveTradePercent uses fast-track trade percent in fast-track mode', () => {
  const percent = resolveTradePercent(tradeConfig, {
    fastTrack: true,
  });

  assert.equal(percent, 75);
});

test('resolveTradeSlippagePercent increases slippage from overshoot in fast-track mode', () => {
  const slippage = resolveTradeSlippagePercent(tradeConfig, {
    fastTrack: true,
    overshootPercent: 2.5,
  });

  assert.equal(slippage, 0.85);
});

test('resolveTradeSlippagePercent caps fast-track slippage at configured maximum', () => {
  const slippage = resolveTradeSlippagePercent(tradeConfig, {
    fastTrack: true,
    overshootPercent: 10,
  });

  assert.equal(slippage, 2);
});

test('pollTradeExecutionUntilFinal retries unknown results until a final status exists', async () => {
  let attempts = 0;

  const result = await pollTradeExecutionUntilFinal(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        return {
          status: 'unknown' as const,
          side: 'sell' as const,
          inputCoin: '0x2::sui::SUI',
          outputCoin: '0xquote::usdc::USDC',
          digest: '0xpending',
        };
      }

      return {
        status: 'success' as const,
        side: 'sell' as const,
        inputCoin: '0x2::sui::SUI',
        outputCoin: '0xquote::usdc::USDC',
        digest: '0xpending',
      };
    },
    0,
  );

  assert.equal(attempts, 3);
  assert.equal(result.status, 'success');
});

test('pollTradeExecutionUntilFinal stops after maxAttempts and returns unknown', async () => {
  let attempts = 0;

  const result = await pollTradeExecutionUntilFinal(
    async () => {
      attempts += 1;
      return {
        status: 'unknown' as const,
        side: 'buy' as const,
        inputCoin: '0xquote::usdc::USDC',
        outputCoin: '0x2::sui::SUI',
        digest: '0xstuck',
      };
    },
    0,
    3,
  );

  assert.equal(attempts, 3);
  assert.equal(result.status, 'unknown');
});
