import type { TradeConfig, WatchItem, TelegramConfig } from './config.js';
import type { AlertState } from './state.js';
import type { TradeExecutionResult, TradeSide } from './trader.js';
import { resolveFastTrackContext } from './watcher-rules.js';
import {
  calculateExecutedPrice,
  formatAmount,
  formatPrice,
  getTokenSymbol,
} from './formatters.js';

export interface AlertMessageInput {
  pairSymbol: string;
  reason: string;
  currentPrice: number;
  tradeExecutionResult: TradeExecutionLike | null;
}

export interface OpsAlertMessageInput {
  title: string;
  pairSymbol: string;
  details: string[];
}

export interface TradeExecutionLike {
  status: 'submitted' | 'success' | 'failure' | 'unknown';
  side: string;
  inputCoin: string;
  outputCoin: string;
  amountIn?: string;
  amountOut?: string;
  realizedPrice?: number;
  digest?: string;
  inputDecimals?: number;
  outputDecimals?: number;
  error?: string;
}

interface ProcessAlertActionsInput {
  item: WatchItem;
  ruleKey: string;
  pairSymbol: string;
  currentPrice: number;
  reason: string;
  tradeSide: TradeSide | null;
  tradeCooldownKey: string | null;
  triggerThreshold: number | null;
  avgWindowPrice?: number | null;
  configTradeEnabled: boolean;
  configTrade?: TradeConfig;
  configTelegram: TelegramConfig | undefined;
  state: AlertState;
}

interface ActionDependencies {
  shouldAlertFn: (tokenId: string, cooldownSeconds: number, state: AlertState) => boolean;
  sendTelegramFn: (config: TelegramConfig | undefined, message: string) => Promise<boolean>;
  executeTradeFn: (executionContext: { fastTrack: boolean; overshootPercent: number }) => Promise<TradeExecutionResult>;
  repriceFn: () => Promise<number | null>;
  scheduleTradeStatusFollowUpFn?: (tradeResult: TradeExecutionLike) => void;
}

export interface ProcessAlertActionsResult {
  alertSent: boolean;
  tradeExecuted: boolean;
  shouldRecordAlert: boolean;
  shouldRecordTradeCooldown: boolean;
  tradeExecutionResult: TradeExecutionLike | null;
  opsNotification: {
    kind: 'trade_failed';
    title: string;
    message: string;
  } | null;
}

export function buildAlertMessage(input: AlertMessageInput): string {
  const tradeTitleByStatus: Record<TradeExecutionLike['status'], string> = {
    submitted: '🚨 <b>Price Alert + Trade Submitted</b>',
    success: '🚨 <b>Price Alert + Trade Executed</b>',
    failure: '🚨 <b>Price Alert + Trade Failed</b>',
    unknown: '🚨 <b>Price Alert + Trade Pending</b>',
  };
  const tradeStatusLabel: Record<TradeExecutionLike['status'], string> = {
    submitted: 'SUBMITTED',
    success: 'SUCCESS',
    failure: 'FAILED',
    unknown: 'PENDING',
  };
  const messageLines: string[] = [
    input.tradeExecutionResult ? tradeTitleByStatus[input.tradeExecutionResult.status] : '🚨 <b>Price Alert</b>',
    `Pair: <code>${input.pairSymbol}</code>`,
    `Trigger: <code>${input.reason}</code>`,
    `Current: <code>$${input.currentPrice.toFixed(6)}</code>`,
  ];

  if (input.tradeExecutionResult) {
    const inputSymbol = getTokenSymbol(input.tradeExecutionResult.inputCoin);
    const outputSymbol = getTokenSymbol(input.tradeExecutionResult.outputCoin);
    messageLines.push('');
    messageLines.push(`Status: <code>${tradeStatusLabel[input.tradeExecutionResult.status]}</code>`);

    if (input.tradeExecutionResult.status === 'success') {
      const inputDecimals = input.tradeExecutionResult.inputDecimals ?? 6;
      const outputDecimals = input.tradeExecutionResult.outputDecimals ?? 6;
      const amountInFormatted = formatAmount(input.tradeExecutionResult.amountIn, inputDecimals, 4);
      const amountOutFormatted = formatAmount(input.tradeExecutionResult.amountOut, outputDecimals, 4);
      const executedPrice = input.tradeExecutionResult.realizedPrice ?? calculateExecutedPrice(
        input.tradeExecutionResult.amountIn,
        input.tradeExecutionResult.amountOut,
        inputDecimals,
        outputDecimals,
      );

      messageLines.push(`Trade: <code>${input.tradeExecutionResult.side.toUpperCase()} ${amountInFormatted} ${inputSymbol} → ${amountOutFormatted} ${outputSymbol}</code>`);
      messageLines.push(`Executed Price: <code>${formatPrice(executedPrice)} ${outputSymbol}/${inputSymbol}</code>`);
    } else if (input.tradeExecutionResult.status === 'failure' && input.tradeExecutionResult.error) {
      messageLines.push(`Reason: <code>${input.tradeExecutionResult.error}</code>`);
    } else {
      messageLines.push(`Trade: <code>${input.tradeExecutionResult.side.toUpperCase()} ${inputSymbol} → ${outputSymbol}</code>`);
    }

    if (input.tradeExecutionResult.digest) {
      messageLines.push(`Tx: <code>${input.tradeExecutionResult.digest}</code>`);
    }
  }

  return messageLines.join('\n');
}

export function buildOpsAlertMessage(input: OpsAlertMessageInput): string {
  return [
    `⚠️ <b>Ops Warning: ${input.title}</b>`,
    `Pair: <code>${input.pairSymbol}</code>`,
    ...input.details.map((detail) => detail.startsWith('<') ? detail : detail),
  ].join('\n');
}

export async function processAlertActions(
  input: ProcessAlertActionsInput,
  deps: ActionDependencies,
): Promise<ProcessAlertActionsResult> {
  if (!deps.shouldAlertFn(input.ruleKey, input.item.alertCooldownSeconds || 1800, input.state)) {
    return {
      alertSent: false,
      tradeExecuted: false,
      shouldRecordAlert: false,
      shouldRecordTradeCooldown: false,
      tradeExecutionResult: null,
      opsNotification: null,
    };
  }

  let tradeExecutionResult: TradeExecutionLike | null = null;
  let shouldRecordTradeCooldown = false;
  let opsNotification: ProcessAlertActionsResult['opsNotification'] = null;

  if (
    input.configTradeEnabled &&
    input.item.tradeEnabled &&
    input.tradeSide !== null &&
    input.tradeCooldownKey !== null &&
    input.triggerThreshold !== null &&
    deps.shouldAlertFn(input.tradeCooldownKey, input.item.tradeCooldownSeconds || 1800, input.state)
  ) {
    const requotedPrice = await deps.repriceFn();
    if (requotedPrice !== null) {
      const stillValid = input.item.condition === 'above'
        ? requotedPrice >= input.triggerThreshold
        : requotedPrice <= input.triggerThreshold;

      if (stillValid) {
        try {
          const executionContext = resolveFastTrackContext({
            item: input.item,
            price: requotedPrice,
            avgWindowPrice: input.avgWindowPrice ?? null,
            triggerThreshold: input.triggerThreshold,
            tradeConfig: input.configTrade,
            allowFastTrack: input.configTradeEnabled,
            isConditionMet: true,
          });
          const tradeResult = await deps.executeTradeFn({
            fastTrack: executionContext.isFastTrack,
            overshootPercent: executionContext.overshootPercent,
          });
          if (!tradeResult.skipped && tradeResult.status !== 'skipped') {
            tradeExecutionResult = {
              status: tradeResult.status,
              side: tradeResult.side,
              inputCoin: tradeResult.inputCoin,
              outputCoin: tradeResult.outputCoin,
              amountIn: tradeResult.amountIn,
              amountOut: tradeResult.amountOut,
              realizedPrice: tradeResult.realizedPrice,
              digest: tradeResult.digest,
              inputDecimals: tradeResult.inputDecimals,
              outputDecimals: tradeResult.outputDecimals,
              error: tradeResult.error,
            };
            shouldRecordTradeCooldown = tradeResult.status === 'success';
            if (tradeResult.status === 'unknown') {
              deps.scheduleTradeStatusFollowUpFn?.(tradeExecutionResult);
            }
          }
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          opsNotification = {
            kind: 'trade_failed',
            title: 'Trade Failed',
            message: buildOpsAlertMessage({
              title: 'Trade Failed',
              pairSymbol: input.pairSymbol,
              details: [
                `Reason: ${message}`,
                `Side: ${input.tradeSide.toUpperCase()}`,
              ],
            }),
          };
        }
      }
    }
  }

  const message = buildAlertMessage({
    pairSymbol: input.pairSymbol,
    reason: input.reason,
    currentPrice: input.currentPrice,
    tradeExecutionResult,
  });
  const alertSent = await deps.sendTelegramFn(input.configTelegram, message);

  return {
    alertSent,
    tradeExecuted: tradeExecutionResult?.status === 'success',
    shouldRecordAlert: alertSent,
    shouldRecordTradeCooldown: alertSent && shouldRecordTradeCooldown,
    tradeExecutionResult,
    opsNotification,
  };
}
