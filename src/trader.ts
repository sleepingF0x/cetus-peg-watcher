import fs from 'fs';
import BN from 'bn.js';
import axios from 'axios';
import { AggregatorClient } from '@cetusprotocol/aggregator-sdk';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { TradeConfig, WatchItem } from './config.js';
import { getCoinDecimals } from './coin-metadata.js';
import { formatPair } from './formatters.js';

const SUI_MIST_PER_SUI = 1_000_000_000n;
const TRADE_PERCENT_SCALE = 10_000;
const TRADE_PERCENT_DENOMINATOR = 100 * TRADE_PERCENT_SCALE;

export type TradeSide = 'buy' | 'sell';

export interface TradeExecutionResult {
  success: boolean;
  skipped: boolean;
  reason: string;
  side: TradeSide;
  inputCoin: string;
  outputCoin: string;
  amountIn?: string;
  amountOut?: string;
  realizedPrice?: number;
  digest?: string;
  inputDecimals?: number;
  outputDecimals?: number;
}

interface ExecuteTradeOptions {
  lockedCycleAvailableAmount?: string;
}

interface TraderContext {
  keypair: Ed25519Keypair;
  walletAddress: string;
  suiClient: SuiClient;
  aggregator: AggregatorClient;
}

let cachedContextKey = '';
let cachedContext: TraderContext | null = null;

interface BalanceChange {
  owner?: {
    AddressOwner?: string;
  };
  coinType?: string;
  amount?: string;
}

interface TransactionBlockResult {
  balanceChanges?: BalanceChange[];
}

interface RpcResponse<T> {
  result?: T;
}

function loadKeypairFromMnemonic(mnemonicFile: string, derivationPath: string): Ed25519Keypair {
  const mnemonic = fs.readFileSync(mnemonicFile, 'utf-8').trim();
  if (!mnemonic) {
    throw new Error(`mnemonic file is empty: ${mnemonicFile}`);
  }

  return Ed25519Keypair.deriveKeypair(mnemonic, derivationPath);
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

function normalizeAddressOwner(owner: BalanceChange['owner']): string | null {
  const address = owner?.AddressOwner;
  if (!address) {
    return null;
  }
  return address.toLowerCase();
}

function sumCoinAmountForOwner(
  changes: BalanceChange[],
  ownerAddress: string,
  coinType: string,
): bigint {
  const normalizedOwner = ownerAddress.toLowerCase();
  const normalizedCoinType = coinType.toLowerCase();
  let total = 0n;

  for (const change of changes) {
    const owner = normalizeAddressOwner(change.owner);
    if (!owner || owner !== normalizedOwner) {
      continue;
    }
    if (!change.coinType || change.coinType.toLowerCase() !== normalizedCoinType) {
      continue;
    }
    total += parseSignedAmount(change.amount);
  }

  return total;
}

async function getExecutionMetrics(
  rpcUrl: string,
  digest: string,
  ownerAddress: string,
  inputCoin: string,
  outputCoin: string,
): Promise<{ amountOut?: string; realizedPrice?: number; inputDecimals?: number; outputDecimals?: number }> {
  const response = await axios.post<RpcResponse<TransactionBlockResult>>(rpcUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'sui_getTransactionBlock',
    params: [
      digest,
      {
        showBalanceChanges: true,
      },
    ],
  }, {
    timeout: 20000,
  });

  const balanceChanges = response.data.result?.balanceChanges ?? [];
  const inputDelta = sumCoinAmountForOwner(balanceChanges, ownerAddress, inputCoin);
  const outputDelta = sumCoinAmountForOwner(balanceChanges, ownerAddress, outputCoin);

  const actualInput = inputDelta < 0n ? -inputDelta : 0n;
  const actualOutput = outputDelta > 0n ? outputDelta : 0n;
  if (actualInput === 0n || actualOutput === 0n) {
    return {};
  }

  const [inputDecimals, outputDecimals] = await Promise.all([
    getCoinDecimals(inputCoin, rpcUrl),
    getCoinDecimals(outputCoin, rpcUrl),
  ]);

  if (inputDecimals === null || outputDecimals === null) {
    return {
      amountOut: actualOutput.toString(),
    };
  }

  const realizedPrice = (Number(actualOutput) / Number(actualInput))
    * Math.pow(10, inputDecimals - outputDecimals);

  return {
    amountOut: actualOutput.toString(),
    realizedPrice,
    inputDecimals,
    outputDecimals,
  };
}

function isSuiCoinType(coinType: string): boolean {
  return coinType.toLowerCase().endsWith('::sui::sui');
}

function calculateTradableAmount(totalBalance: bigint, inputCoin: string, tradeConfig: TradeConfig): bigint {
  let tradableAmount = totalBalance;

  if (isSuiCoinType(inputCoin)) {
    const reserveMist = BigInt(Math.floor((tradeConfig.suiGasReserve || 0) * Number(SUI_MIST_PER_SUI)));
    tradableAmount = tradableAmount > reserveMist ? tradableAmount - reserveMist : 0n;
  }

  return tradableAmount;
}

function calculateAmountByPercent(baseAmount: bigint, tradeConfig: TradeConfig): bigint {
  const maxTradePercentScaled = Math.floor((tradeConfig.maxTradePercent || 100) * TRADE_PERCENT_SCALE);
  return (baseAmount * BigInt(maxTradePercentScaled)) / BigInt(TRADE_PERCENT_DENOMINATOR);
}

export async function getCurrentTradableAmount(
  tradeConfig: TradeConfig,
  item: WatchItem,
  side: TradeSide,
): Promise<bigint> {
  const inputCoin = side === 'buy' ? item.quoteToken! : item.baseToken;
  const context = getTraderContext(tradeConfig);
  const balanceResponse = await context.suiClient.getBalance({
    owner: context.walletAddress,
    coinType: inputCoin,
  });
  const totalBalance = extractBalance(balanceResponse);
  return calculateTradableAmount(totalBalance, inputCoin, tradeConfig);
}

function getTraderContext(tradeConfig: TradeConfig): TraderContext {
  const mnemonicFile = tradeConfig.mnemonicFile!;
  const derivationPath = tradeConfig.derivationPath || "m/44'/784'/0'/0'/0'";
  const rpcUrl = tradeConfig.rpcUrl!;
  const cacheKey = `${mnemonicFile}|${derivationPath}|${rpcUrl}`;

  if (cachedContext && cachedContextKey === cacheKey) {
    return cachedContext;
  }

  const keypair = loadKeypairFromMnemonic(mnemonicFile, derivationPath);
  const walletAddress = keypair.getPublicKey().toSuiAddress();
  const suiClient = new SuiClient({ url: rpcUrl });
  const aggregator = new AggregatorClient({
    client: suiClient,
    signer: walletAddress,
  });

  cachedContext = {
    keypair,
    walletAddress,
    suiClient,
    aggregator,
  };
  cachedContextKey = cacheKey;

  return cachedContext;
}

export async function executeTrade(
  tradeConfig: TradeConfig,
  item: WatchItem,
  side: TradeSide,
  options?: ExecuteTradeOptions,
): Promise<TradeExecutionResult> {
  const inputCoin = side === 'buy' ? item.quoteToken! : item.baseToken;
  const outputCoin = side === 'buy' ? item.baseToken : item.quoteToken!;

  if (!tradeConfig.enabled) {
    console.log(`[Trade] Skip ${formatPair(inputCoin, outputCoin)}: trade disabled`);
    return {
      success: false,
      skipped: true,
      reason: 'trade disabled',
      side,
      inputCoin,
      outputCoin,
    };
  }

  const context = getTraderContext(tradeConfig);
  const balanceResponse = await context.suiClient.getBalance({
    owner: context.walletAddress,
    coinType: inputCoin,
  });
  const totalBalance = extractBalance(balanceResponse);
  const currentTradableAmount = calculateTradableAmount(totalBalance, inputCoin, tradeConfig);

  const cycleBaseAmount = options?.lockedCycleAvailableAmount
    ? parseSignedAmount(options.lockedCycleAvailableAmount)
    : currentTradableAmount;

  let tradableAmount = calculateAmountByPercent(cycleBaseAmount, tradeConfig);

  if (options?.lockedCycleAvailableAmount && tradableAmount > currentTradableAmount) {
    console.log(`[Trade] Skip ${formatPair(inputCoin, outputCoin)}: insufficient tradable balance for locked cycle amount`);
    return {
      success: false,
      skipped: true,
      reason: 'insufficient tradable balance for locked cycle amount',
      side,
      inputCoin,
      outputCoin,
      amountIn: tradableAmount.toString(),
    };
  }

  if (tradableAmount <= 0n) {
    console.log(`[Trade] Skip ${formatPair(inputCoin, outputCoin)}: insufficient tradable balance`);
    return {
      success: false,
      skipped: true,
      reason: 'insufficient tradable balance',
      side,
      inputCoin,
      outputCoin,
    };
  }

  const route = await context.aggregator.findRouters({
    from: inputCoin,
    target: outputCoin,
    amount: new BN(tradableAmount.toString()),
    byAmountIn: true,
  });

  if (!route || route.insufficientLiquidity || route.amountOut.toString() === '0') {
    console.log(`[Trade] Skip ${formatPair(inputCoin, outputCoin)}: no executable route (insufficientLiquidity=${route?.insufficientLiquidity})`);
    return {
      success: false,
      skipped: true,
      reason: 'no executable route',
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
    slippage: (tradeConfig.slippagePercent || 0.5) / 100,
  });

  const execution = await context.aggregator.sendTransaction(txb, context.keypair);
  const digest = extractDigest(execution);
  
  if (digest) {
    console.log(`[Trade] Submitted ${formatPair(inputCoin, outputCoin)} ${side.toUpperCase()} tx=${digest}`);
  }
  let amountOut: string | undefined;
  let realizedPrice: number | undefined;
  let inputDecimals: number | undefined;
  let outputDecimals: number | undefined;

  if (digest) {
    try {
      const executionMetrics = await getExecutionMetrics(
        tradeConfig.rpcUrl!,
        digest,
        context.walletAddress,
        inputCoin,
        outputCoin,
      );
      amountOut = executionMetrics.amountOut;
      realizedPrice = executionMetrics.realizedPrice;
      inputDecimals = executionMetrics.inputDecimals;
      outputDecimals = executionMetrics.outputDecimals;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Trade] Unable to fetch metrics for ${formatPair(inputCoin, outputCoin)} tx=${digest}: ${message}`);
    }
  }

  return {
    success: true,
    skipped: false,
    reason: 'trade executed',
    side,
    inputCoin,
    outputCoin,
    amountIn: tradableAmount.toString(),
    amountOut,
    realizedPrice,
    digest,
    inputDecimals,
    outputDecimals,
  };
}
