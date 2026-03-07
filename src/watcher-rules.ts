import type { WatchItem } from './config.js';
import type { AveragePauseRule } from './watcher-logic.js';
import { shouldEvaluateRule } from './watcher-logic.js';

interface EvaluateWatchRuleInput {
  item: WatchItem;
  price: number;
  avgWindowPrice: number | null;
  previousHitCount: number;
  pauseRule?: AveragePauseRule;
}

export interface RuleEvaluationResult {
  isPaused: boolean;
  resumed: boolean;
  isConditionMet: boolean;
  triggerThreshold: number | null;
  tradeSide: 'buy' | 'sell' | null;
  hitCount: number;
  isAlertConfirmed: boolean;
}

export function createAveragePauseRule(item: WatchItem, avgWindowPrice: number): AveragePauseRule {
  const deviation = Math.abs((item.avgTargetPercent || 100) - 100) / 100;
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
      alertMode: input.item.alertMode!,
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
      };
    }
  }

  const averageTargetPrice = input.avgWindowPrice === null
    ? null
    : input.avgWindowPrice * ((input.item.avgTargetPercent || 100) / 100);

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
  const requiredConfirmations = input.item.tradeConfirmations || 2;

  return {
    isPaused: false,
    resumed: input.pauseRule !== undefined,
    isConditionMet,
    triggerThreshold,
    tradeSide: isConditionMet ? (input.item.condition === 'below' ? 'buy' : 'sell') : null,
    hitCount,
    isAlertConfirmed: isConditionMet && hitCount >= requiredConfirmations,
  };
}
