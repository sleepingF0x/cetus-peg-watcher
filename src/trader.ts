import BN from 'bn.js';
import { Transaction } from '@mysten/sui/transactions';
import type { ResolvedTradeConfig, ResolvedWatchItem } from './config.js';
import { formatPair } from './formatters.js';
import { createModuleLogger, toLogError } from './logger.js';
import type { TradeSide, TradeStatus, TradeExecutionResult } from './trading/types.js';
import { getTraderContext } from './trading/context.js';

const SUI_MIST_PER_SUI = 1_000_000_000n;
const TRADE_PERCENT_SCALE = 10_000;
const TRADE_PERCENT_DENOMINATOR = 100 * TRADE_PERCENT_SCALE;
const log = createModuleLogger('Trade');

export type { TradeSide, TradeStatus, TradeExecutionResult } from './trading/types.js';

interface ExecuteTradeOptions {
  lockedCycleAvailableAmount?: string;
  fastTrack?: boolean;
  overshootPercent?: number;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retryRpc<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries) throw error;
      await delay(1000 * (i + 1));
    }
  }
  throw new Error('unreachable');
}

export async function pollTradeExecutionUntilFinal(
  pollFn: () => Promise<TradeExecutionResult>,
  retryDelayMs: number,
  maxAttempts = 10,
): Promise<TradeExecutionResult> {
  let lastResult: TradeExecutionResult = { status: 'unknown', side: 'buy', inputCoin: '', outputCoin: '' };
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    lastResult = await pollFn();
    if (lastResult.status !== 'unknown') return lastResult;
    if (attempt < maxAttempts - 1) await delay(retryDelayMs);
  }
  log.warn(
    { event: 'trade_status_poll_exhausted', maxAttempts },
    `Trade status still unknown after ${maxAttempts} poll attempts`,
  );
  return lastResult;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractStringField(value: unknown, field: string): string | null {
  const record = readRecord(value);
  if (!record) {
    return null;
  }

  const candidate = record[field];
  return typeof candidate === 'string' ? candidate : null;
}

function extractBalance(response: unknown): bigint {
  const direct = extractStringField(response, 'totalBalance');
  if (direct) {
    return BigInt(direct);
  }

  const nestedRecord = readRecord(response);
  if (nestedRecord) {
    const nested = nestedRecord.balance;
    const nestedDirect = extractStringField(nested, 'totalBalance') || extractStringField(nested, 'balance');
    if (nestedDirect) {
      return BigInt(nestedDirect);
    }
  }

  return 0n;
}

function extractDigest(response: unknown): string | undefined {
  const digest = extractStringField(response, 'digest') || extractStringField(response, 'transactionDigest');
  return digest || undefined;
}

function parseSignedAmount(value: string | undefined): bigint {
  if (!value) {
    return 0n;
  }

  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function normalizeAddress(address: string | null | undefined): string | null {
  return address ? address.toLowerCase() : null;
}

function sumCoinAmountForOwner(
  changes: Array<{ owner: unknown; coinType?: string; amount?: string }>,
  ownerAddress: string,
  coinType: string,
): bigint {
  const normalizedOwner = ownerAddress.toLowerCase();
  const normalizedCoinType = coinType.toLowerCase();
  let total = 0n;

  for (const change of changes) {
    const ownerRecord = readRecord(change.owner);
    const addressOwner = normalizeAddress(extractStringField(ownerRecord, 'AddressOwner'));
    if (!addressOwner || addressOwner !== normalizedOwner) continue;
    if (!change.coinType || change.coinType.toLowerCase() !== normalizedCoinType) continue;
    total += parseSignedAmount(change.amount);
  }

  return total;
}

async function getTransactionDetails(
  suiClient: import('@mysten/sui/client').SuiClient,
  digest: string,
): Promise<{
  chainStatus: { status: 'success' | 'failure' | 'unknown'; error?: string };
  balanceChanges: Array<{ owner: unknown; coinType?: string; amount?: string }>;
}> {
  try {
    const tx = await suiClient.getTransactionBlock({
      digest,
      options: {
        showEffects: true,
        showBalanceChanges: true,
      },
    });

    const txStatus = tx.effects?.status?.status;
    const txError = tx.effects?.status?.error;

    const chainStatus = txStatus === 'success'
      ? { status: 'success' as const }
      : txStatus === 'failure'
        ? { status: 'failure' as const, error: txError }
        : { status: 'unknown' as const };

    const balanceChanges = (tx.balanceChanges ?? []) as Array<{ owner: unknown; coinType?: string; amount?: string }>;

    return { chainStatus, balanceChanges };
  } catch {
    return { chainStatus: { status: 'unknown' }, balanceChanges: [] };
  }
}

async function waitForFinalTransactionDetails(
  suiClient: import('@mysten/sui/client').SuiClient,
  tradeConfig: ResolvedTradeConfig,
  digest: string,
): Promise<{
  chainStatus: { status: 'success' | 'failure' | 'unknown'; error?: string };
  balanceChanges: Array<{ owner: unknown; coinType?: string; amount?: string }>;
}> {
  const delayMs = tradeConfig.statusPollDelayMs;
  const intervalMs = tradeConfig.statusPollIntervalMs;
  const timeoutMs = tradeConfig.statusPollTimeoutMs;
  const startedAt = Date.now();

  await delay(delayMs);

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const details = await getTransactionDetails(suiClient, digest);
      if (details.chainStatus.status !== 'unknown') {
        return details;
      }
    } catch (error: unknown) {
      log.warn(
        { event: 'trade_status_poll_failed', digest, err: toLogError(error) },
        'Unable to poll trade status',
      );
    }

    await delay(intervalMs);
  }

  return { chainStatus: { status: 'unknown' }, balanceChanges: [] };
}

function isSuiCoinType(coinType: string): boolean {
  return coinType.toLowerCase().endsWith('::sui::sui');
}

function calculateTradableAmount(totalBalance: bigint, inputCoin: string, tradeConfig: ResolvedTradeConfig): bigint {
  let tradableAmount = totalBalance;

  if (isSuiCoinType(inputCoin)) {
    const reserveMist = BigInt(Math.floor(tradeConfig.suiGasReserve * Number(SUI_MIST_PER_SUI)));
    tradableAmount = tradableAmount > reserveMist ? tradableAmount - reserveMist : 0n;
  }

  return tradableAmount;
}

export function resolveTradePercent(
  tradeConfig: ResolvedTradeConfig,
  options?: Pick<ExecuteTradeOptions, 'fastTrack'>,
): number {
  if (options?.fastTrack) {
    return tradeConfig.fastTrackTradePercent;
  }

  return tradeConfig.maxTradePercent;
}

export function resolveTradeSlippagePercent(
  tradeConfig: ResolvedTradeConfig,
  options?: Pick<ExecuteTradeOptions, 'fastTrack' | 'overshootPercent'>,
): number {
  const baseSlippagePercent = tradeConfig.slippagePercent;
  if (!options?.fastTrack) {
    return baseSlippagePercent;
  }

  const fastTrackExtraPercent = tradeConfig.fastTrackExtraPercent;
  const overshootPercent = options.overshootPercent ?? 0;
  const extraOvershootPercent = Math.max(0, overshootPercent - fastTrackExtraPercent);
  const dynamicSlippage = baseSlippagePercent + (extraOvershootPercent * tradeConfig.fastTrackSlippageMultiplier);
  const cappedSlippage = Math.min(dynamicSlippage, tradeConfig.fastTrackMaxSlippagePercent);

  return Math.round(cappedSlippage * 1_000_000) / 1_000_000;
}

function calculateAmountByPercent(baseAmount: bigint, tradePercent: number): bigint {
  const tradePercentScaled = Math.floor(tradePercent * TRADE_PERCENT_SCALE);
  return (baseAmount * BigInt(tradePercentScaled)) / BigInt(TRADE_PERCENT_DENOMINATOR);
}

export async function getCurrentTradableAmount(
  tradeConfig: ResolvedTradeConfig,
  item: ResolvedWatchItem,
  side: TradeSide,
): Promise<bigint> {
  const inputCoin = side === 'buy' ? item.quoteToken : item.baseToken;
  const context = getTraderContext(tradeConfig);
  const balanceResponse = await retryRpc(() => context.suiClient.getBalance({
    owner: context.walletAddress,
    coinType: inputCoin,
  }));
  const totalBalance = extractBalance(balanceResponse);
  return calculateTradableAmount(totalBalance, inputCoin, tradeConfig);
}

export async function confirmTradeExecution(
  tradeConfig: ResolvedTradeConfig,
  trade: {
    digest: string;
    side: TradeSide;
    inputCoin: string;
    outputCoin: string;
    amountIn?: string;
  },
): Promise<TradeExecutionResult> {
  const context = getTraderContext(tradeConfig);
  const { chainStatus, balanceChanges } = await waitForFinalTransactionDetails(
    context.suiClient,
    tradeConfig,
    trade.digest,
  );

  if (chainStatus.status === 'failure') {
    return {
      status: 'failure',
      error: chainStatus.error,
      side: trade.side,
      inputCoin: trade.inputCoin,
      outputCoin: trade.outputCoin,
      amountIn: trade.amountIn,
      digest: trade.digest,
    };
  }

  if (chainStatus.status === 'unknown') {
    return {
      status: 'unknown',
      side: trade.side,
      inputCoin: trade.inputCoin,
      outputCoin: trade.outputCoin,
      amountIn: trade.amountIn,
      digest: trade.digest,
    };
  }

  // success — extract metrics from balance changes already fetched in the same call
  let amountOut: string | undefined;
  let realizedPrice: number | undefined;
  let inputDecimals: number | undefined;
  let outputDecimals: number | undefined;

  try {
    const inputDelta = sumCoinAmountForOwner(balanceChanges, context.walletAddress, trade.inputCoin);
    const outputDelta = sumCoinAmountForOwner(balanceChanges, context.walletAddress, trade.outputCoin);
    const actualInput = inputDelta < 0n ? -inputDelta : 0n;
    const actualOutput = outputDelta > 0n ? outputDelta : 0n;

    if (actualInput > 0n && actualOutput > 0n) {
      amountOut = actualOutput.toString();

      const [inDecimals, outDecimals] = await Promise.all([
        context.suiClient.getCoinMetadata({ coinType: trade.inputCoin }),
        context.suiClient.getCoinMetadata({ coinType: trade.outputCoin }),
      ]);

      if (inDecimals?.decimals !== undefined && outDecimals?.decimals !== undefined) {
        inputDecimals = inDecimals.decimals;
        outputDecimals = outDecimals.decimals;
        realizedPrice = (Number(actualOutput) / Number(actualInput))
          * Math.pow(10, inputDecimals - outputDecimals);
      }
    }
  } catch (error: unknown) {
    log.warn(
      {
        event: 'trade_metrics_fetch_failed',
        pair: formatPair(trade.inputCoin, trade.outputCoin),
        side: trade.side,
        digest: trade.digest,
        err: toLogError(error),
      },
      'Unable to fetch trade metrics',
    );
  }

  return {
    status: 'success',
    side: trade.side,
    inputCoin: trade.inputCoin,
    outputCoin: trade.outputCoin,
    amountIn: trade.amountIn,
    amountOut,
    realizedPrice,
    digest: trade.digest,
    inputDecimals,
    outputDecimals,
  };
}

export async function executeTrade(
  tradeConfig: ResolvedTradeConfig,
  item: ResolvedWatchItem,
  side: TradeSide,
  options?: ExecuteTradeOptions,
): Promise<TradeExecutionResult> {
  const inputCoin = side === 'buy' ? item.quoteToken : item.baseToken;
  const outputCoin = side === 'buy' ? item.baseToken : item.quoteToken;

  if (!tradeConfig.enabled) {
    log.info(
      {
        event: 'trade_skipped',
        reason: 'trade_disabled',
        pair: formatPair(inputCoin, outputCoin),
        side,
      },
      'Skip trade: trade disabled',
    );
    return {
      status: 'skipped',
      side,
      inputCoin,
      outputCoin,
    };
  }

  const context = getTraderContext(tradeConfig);
  const balanceResponse = await retryRpc(() => context.suiClient.getBalance({
    owner: context.walletAddress,
    coinType: inputCoin,
  }));
  const totalBalance = extractBalance(balanceResponse);
  const currentTradableAmount = calculateTradableAmount(totalBalance, inputCoin, tradeConfig);

  const cycleBaseAmount = options?.lockedCycleAvailableAmount
    ? parseSignedAmount(options.lockedCycleAvailableAmount)
    : currentTradableAmount;

  const tradePercent = resolveTradePercent(tradeConfig, options);
  let tradableAmount = calculateAmountByPercent(cycleBaseAmount, tradePercent);

  if (options?.lockedCycleAvailableAmount && tradableAmount > currentTradableAmount) {
    log.info(
      {
        event: 'trade_skipped',
        reason: 'insufficient_tradable_balance_locked_cycle',
        pair: formatPair(inputCoin, outputCoin),
        side,
      },
      'Skip trade: insufficient tradable balance for locked cycle amount',
    );
    return {
      status: 'skipped',
      side,
      inputCoin,
      outputCoin,
      amountIn: tradableAmount.toString(),
    };
  }

  if (tradableAmount <= 0n) {
    log.info(
      {
        event: 'trade_skipped',
        reason: 'insufficient_tradable_balance',
        pair: formatPair(inputCoin, outputCoin),
        side,
      },
      'Skip trade: insufficient tradable balance',
    );
    return {
      status: 'skipped',
      side,
      inputCoin,
      outputCoin,
    };
  }

  const route = await retryRpc(() => context.aggregator.findRouters({
    from: inputCoin,
    target: outputCoin,
    amount: new BN(tradableAmount.toString()),
    byAmountIn: true,
  }));

  if (!route || route.insufficientLiquidity || route.amountOut.toString() === '0') {
    log.info(
      {
        event: 'trade_skipped',
        reason: 'no_executable_route',
        pair: formatPair(inputCoin, outputCoin),
        side,
        insufficientLiquidity: route?.insufficientLiquidity,
      },
      'Skip trade: no executable route',
    );
    return {
      status: 'skipped',
      side,
      inputCoin,
      outputCoin,
      amountIn: tradableAmount.toString(),
    };
  }

  const txb = new Transaction();
  await context.aggregator.fastRouterSwap({
    router: route,
    txb,
    slippage: resolveTradeSlippagePercent(tradeConfig, options) / 100,
  });

  const execution = await context.aggregator.sendTransaction(txb, context.keypair);
  const digest = extractDigest(execution);

  if (digest) {
    log.info(
      {
        event: 'trade_submitted',
        pair: formatPair(inputCoin, outputCoin),
        side,
        digest,
      },
      'Submitted trade transaction',
    );
  }

  if (!digest) {
    return {
      status: 'unknown',
      side,
      inputCoin,
      outputCoin,
      amountIn: tradableAmount.toString(),
    };
  }

  return confirmTradeExecution(tradeConfig, {
    digest,
    side,
    inputCoin,
    outputCoin,
    amountIn: tradableAmount.toString(),
  });
}
