import type { ResolvedTradeConfig, ResolvedWatchItem } from './config.js';
import type { AveragePauseRule } from './watcher-logic.js';
import { shouldEvaluateRule } from './watcher-logic.js';

function roundMetric(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

interface EvaluateWatchRuleInput {
  item: ResolvedWatchItem;
  price: number;
  avgWindowPrice: number | null;
  previousHitCount: number;
  pauseRule?: AveragePauseRule;
  tradeConfig?: Pick<ResolvedTradeConfig, 'fastTrackEnabled' | 'fastTrackExtraPercent'>;
  allowFastTrack?: boolean;
}

export interface RuleEvaluationResult {
  isPaused: boolean;
  resumed: boolean;
  isConditionMet: boolean;
  triggerThreshold: number | null;
  tradeSide: 'buy' | 'sell' | null;
  hitCount: number;
  isAlertConfirmed: boolean;
  isFastTrack: boolean;
  overshootPercent: number;
  tradeConfirmedImmediately: boolean;
}

interface FastTrackContextInput {
  item: ResolvedWatchItem;
  price: number;
  avgWindowPrice: number | null;
  triggerThreshold: number | null;
  tradeConfig?: Pick<ResolvedTradeConfig, 'fastTrackEnabled' | 'fastTrackExtraPercent'>;
  allowFastTrack?: boolean;
  isConditionMet: boolean;
}

export function resolveFastTrackContext(input: FastTrackContextInput): {
  isFastTrack: boolean;
  overshootPercent: number;
} {
  const overshootPercent = input.item.alertMode === 'avg_percent'
    && input.avgWindowPrice !== null
    && input.triggerThreshold !== null
    && input.isConditionMet
    ? roundMetric((Math.abs(input.price - input.triggerThreshold) / input.avgWindowPrice) * 100)
    : 0;

  const isFastTrack = input.isConditionMet
    && input.item.alertMode === 'avg_percent'
    && input.allowFastTrack === true
    && input.tradeConfig?.fastTrackEnabled === true
    && overshootPercent >= (input.tradeConfig?.fastTrackExtraPercent ?? 0);

  return {
    isFastTrack,
    overshootPercent,
  };
}

export function createAveragePauseRule(item: ResolvedWatchItem, avgWindowPrice: number): AveragePauseRule {
  const deviation = Math.abs((item.avgTargetPercent ?? 100) - 100) / 100;
  const resumeFactor = item.avgResumeFactor ?? 0.95;
  const recoverDeviation = deviation * resumeFactor;
  const resumeMultiplier = item.condition === 'above'
    ? 1 + deviation - recoverDeviation
    : 1 - deviation + recoverDeviation;

  return {
    condition: item.condition,
    resumePrice: avgWindowPrice * resumeMultiplier,
  };
}

export function evaluateWatchRule(input: EvaluateWatchRuleInput): RuleEvaluationResult {
  if (input.pauseRule) {
    const resumed = shouldEvaluateRule({
      alertMode: input.item.alertMode,
      currentPrice: input.price,
      pauseRule: input.pauseRule,
    });

    if (!resumed) {
      return {
        isPaused: true,
        resumed: false,
        isConditionMet: false,
        triggerThreshold: null,
        tradeSide: null,
        hitCount: 0,
        isAlertConfirmed: false,
        isFastTrack: false,
        overshootPercent: 0,
        tradeConfirmedImmediately: false,
      };
    }
  }

  const averageTargetPrice = input.avgWindowPrice === null
    ? null
    : input.avgWindowPrice * ((input.item.avgTargetPercent ?? 100) / 100);

  const triggerThreshold = input.item.alertMode === 'price'
    ? input.item.targetPrice!
    : averageTargetPrice;

  const isConditionMet = input.item.alertMode === 'price'
    ? (
      (input.item.condition === 'above' && input.price >= input.item.targetPrice!) ||
      (input.item.condition === 'below' && input.price <= input.item.targetPrice!)
    )
    : averageTargetPrice !== null && (
      (input.item.condition === 'above' && input.price >= averageTargetPrice) ||
      (input.item.condition === 'below' && input.price <= averageTargetPrice)
    );

  const hitCount = isConditionMet ? input.previousHitCount + 1 : 0;
  const requiredConfirmations = input.item.tradeConfirmations;
  const { isFastTrack, overshootPercent } = resolveFastTrackContext({
    item: input.item,
    price: input.price,
    avgWindowPrice: input.avgWindowPrice,
    triggerThreshold,
    tradeConfig: input.tradeConfig,
    allowFastTrack: input.allowFastTrack,
    isConditionMet,
  });
  const tradeConfirmedImmediately = isFastTrack;

  return {
    isPaused: false,
    resumed: input.pauseRule !== undefined,
    isConditionMet,
    triggerThreshold,
    tradeSide: isConditionMet ? (input.item.condition === 'below' ? 'buy' : 'sell') : null,
    hitCount,
    isAlertConfirmed: isConditionMet && (tradeConfirmedImmediately || hitCount >= requiredConfirmations),
    isFastTrack,
    overshootPercent,
    tradeConfirmedImmediately,
  };
}
