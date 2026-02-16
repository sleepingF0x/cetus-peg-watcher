import fs from 'fs';
import BN from 'bn.js';
import { AggregatorClient } from '@cetusprotocol/aggregator-sdk';
import { SuiClient } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { TradeConfig, WatchItem } from './config.js';

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
  digest?: string;
}

interface TraderContext {
  keypair: Ed25519Keypair;
  walletAddress: string;
  suiClient: SuiClient;
  aggregator: AggregatorClient;
}

let cachedContextKey = '';
let cachedContext: TraderContext | null = null;

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

function isSuiCoinType(coinType: string): boolean {
  return coinType.toLowerCase().endsWith('::sui::sui');
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
): Promise<TradeExecutionResult> {
  const inputCoin = side === 'buy' ? item.quoteToken! : item.baseToken;
  const outputCoin = side === 'buy' ? item.baseToken : item.quoteToken!;

  if (!tradeConfig.enabled) {
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

  let tradableAmount = totalBalance;
  if (isSuiCoinType(inputCoin)) {
    const reserveMist = BigInt(Math.floor((tradeConfig.suiGasReserve || 0) * Number(SUI_MIST_PER_SUI)));
    tradableAmount = tradableAmount > reserveMist ? tradableAmount - reserveMist : 0n;
  }

  const maxTradePercentScaled = Math.floor((tradeConfig.maxTradePercent || 100) * TRADE_PERCENT_SCALE);
  tradableAmount = (tradableAmount * BigInt(maxTradePercentScaled)) / BigInt(TRADE_PERCENT_DENOMINATOR);

  if (tradableAmount <= 0n) {
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
    slippage: (tradeConfig.slippagePercent || 0.1) / 100,
  });

  const execution = await context.aggregator.sendTransaction(txb, context.keypair);
  return {
    success: true,
    skipped: false,
    reason: 'trade executed',
    side,
    inputCoin,
    outputCoin,
    amountIn: tradableAmount.toString(),
    digest: extractDigest(execution),
  };
}
