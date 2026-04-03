import type { ResolvedTradeConfig, ResolvedWatchItem, ResolvedTelegramConfig } from './config.js';
import type { AlertState } from './state.js';
import type { TradeExecutionResult, TradeSide } from './trading/types.js';
import { resolveFastTrackContext } from './watcher-rules.js';
import {
  calculateExecutedPrice,
  formatAmount,
  formatDisplayAmount,
  formatPrice,
  getTokenSymbol,
} from './formatters.js';

export interface AlertMessageInput {
  pairSymbol: string;
  reason: string;
  currentPrice: number;
  quotedBaseAmount: number;
  tradeExecutionResult: TradeExecutionResult | null;
}

export interface OpsAlertMessageInput {
  title: string;
  pairSymbol: string;
  details: string[];
}

interface ProcessAlertActionsInput {
  item: ResolvedWatchItem;
  ruleKey: string;
  pairSymbol: string;
  currentPrice: number;
  quotedBaseAmount: number;
  reason: string;
  tradeSide: TradeSide | null;
  tradeCooldownKey: string | null;
  triggerThreshold: number | null;
  avgWindowPrice?: number | null;
  configTradeEnabled: boolean;
  configTrade: ResolvedTradeConfig;
  configTelegram: ResolvedTelegramConfig | undefined;
  state: AlertState;
}

interface ActionDependencies {
  shouldAlertFn: (tokenId: string, cooldownSeconds: number, state: AlertState) => boolean;
  sendTelegramFn: (config: ResolvedTelegramConfig | undefined, message: string) => Promise<boolean>;
  executeTradeFn: (executionContext: { fastTrack: boolean; overshootPercent: number }) => Promise<TradeExecutionResult>;
  repriceFn: () => Promise<number | null>;
  scheduleTradeStatusFollowUpFn?: (tradeResult: TradeExecutionResult) => void;
}

export interface ProcessAlertActionsResult {
  alertSent: boolean;
  tradeExecuted: boolean;
  shouldRecordAlert: boolean;
  shouldRecordTradeCooldown: boolean;
  tradeExecutionResult: TradeExecutionResult | null;
  opsNotification: {
    kind: 'trade_failed';
    title: string;
    message: string;
  } | null;
}

export function buildAlertMessage(input: AlertMessageInput): string {
  const baseSymbol = input.pairSymbol.split('/')[0] || input.pairSymbol;
  const tradeTitleByStatus: Partial<Record<TradeExecutionResult['status'], string>> = {
    submitted: '🚨 <b>Price Alert + Trade Submitted</b>',
    success: '🚨 <b>Price Alert + Trade Executed</b>',
    failure: '🚨 <b>Price Alert + Trade Failed</b>',
    unknown: '🚨 <b>Price Alert + Trade Pending</b>',
  };
  const tradeStatusLabel: Partial<Record<TradeExecutionResult['status'], string>> = {
    submitted: 'SUBMITTED',
    success: 'SUCCESS',
    failure: 'FAILED',
    unknown: 'PENDING',
  };
  const messageLines: string[] = [
    input.tradeExecutionResult ? (tradeTitleByStatus[input.tradeExecutionResult.status] ?? '🚨 <b>Price Alert + Trade</b>') : '🚨 <b>Price Alert</b>',
    `Pair: <code>${input.pairSymbol}</code>`,
    `Trigger: <code>${input.reason}</code>`,
    `Mid Price: <code>$${input.currentPrice.toFixed(6)}</code>`,
    `Quoted Size: <code>${formatDisplayAmount(input.quotedBaseAmount)} ${baseSymbol}</code>`,
  ];

  if (input.tradeExecutionResult) {
    const inputSymbol = getTokenSymbol(input.tradeExecutionResult.inputCoin);
    const outputSymbol = getTokenSymbol(input.tradeExecutionResult.outputCoin);
    messageLines.push('');
    messageLines.push(`Status: <code>${tradeStatusLabel[input.tradeExecutionResult.status] ?? input.tradeExecutionResult.status.toUpperCase()}</code>`);

    if (input.tradeExecutionResult.status === 'success') {
      const inputDecimals = input.tradeExecutionResult.inputDecimals ?? 6;
      const outputDecimals = input.tradeExecutionResult.outputDecimals ?? 6;
      const amountInFormatted = formatAmount(input.tradeExecutionResult.amountIn, inputDecimals, 4);
      const amountOutFormatted = formatAmount(input.tradeExecutionResult.amountOut, outputDecimals, 4);
      const rawExecutedPrice = input.tradeExecutionResult.realizedPrice ?? calculateExecutedPrice(
        input.tradeExecutionResult.amountIn,
        input.tradeExecutionResult.amountOut,
        inputDecimals,
        outputDecimals,
      );

      // rawExecutedPrice is always output/input. For BUY (input=quote, output=base),
      // invert to express as quote/base so it matches the Quoted Price convention.
      const isBuy = input.tradeExecutionResult.side === 'buy';
      const executedPrice = isBuy && rawExecutedPrice !== null && rawExecutedPrice > 0
        ? 1 / rawExecutedPrice
        : rawExecutedPrice;
      const executedPriceLabel = isBuy ? `${inputSymbol}/${outputSymbol}` : `${outputSymbol}/${inputSymbol}`;

      messageLines.push(`Trade: <code>${input.tradeExecutionResult.side.toUpperCase()} ${amountInFormatted} ${inputSymbol} → ${amountOutFormatted} ${outputSymbol}</code>`);
      messageLines.push(`Executed Price: <code>${formatPrice(executedPrice)} ${executedPriceLabel}</code>`);
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
    ...input.details,
  ].join('\n');
}

export async function processAlertActions(
  input: ProcessAlertActionsInput,
  deps: ActionDependencies,
): Promise<ProcessAlertActionsResult> {
  if (!deps.shouldAlertFn(input.ruleKey, input.item.alertCooldownSeconds, input.state)) {
    return {
      alertSent: false,
      tradeExecuted: false,
      shouldRecordAlert: false,
      shouldRecordTradeCooldown: false,
      tradeExecutionResult: null,
      opsNotification: null,
    };
  }

  let tradeExecutionResult: TradeExecutionResult | null = null;
  let shouldRecordTradeCooldown = false;
  let opsNotification: ProcessAlertActionsResult['opsNotification'] = null;

  if (
    input.configTradeEnabled &&
    input.item.tradeEnabled &&
    input.tradeSide !== null &&
    input.tradeCooldownKey !== null &&
    input.triggerThreshold !== null &&
    deps.shouldAlertFn(input.tradeCooldownKey, input.item.tradeCooldownSeconds, input.state)
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
          if (tradeResult.status !== 'skipped') {
            tradeExecutionResult = tradeResult;
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
    quotedBaseAmount: input.quotedBaseAmount,
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
