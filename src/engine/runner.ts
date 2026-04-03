import { getBidirectionalPrice, getTokenPrice } from '../cetus.js';
import type { ResolvedConfig } from '../config.js';
import type { CooldownManager } from '../cooldown/manager.js';
import { formatPair } from '../formatters.js';
import { createModuleLogger, toLogError } from '../logger.js';
import { sendTelegramMessage } from '../telegram.js';
import {
  confirmTradeExecution,
  executeTrade,
  getCurrentTradableAmount,
  pollTradeExecutionUntilFinal,
} from '../trader.js';
import type { TradeExecutionResult } from '../trading/types.js';
import type { AveragePauseRule } from '../watcher-logic.js';
import { createOpsCooldownKey, createSerializedPollRunner } from '../watcher-logic.js';
import { buildAlertMessage, buildOpsAlertMessage, processAlertActions } from '../watcher-actions.js';
import { createAveragePauseRule, evaluateWatchRule } from '../watcher-rules.js';

const DEFAULT_OPS_COOLDOWN_SECONDS = 3600;
const log = createModuleLogger('Runner');

interface PricePoint {
  timestamp: number;
  price: number;
}

export interface GroupedWatchItem {
  item: ResolvedConfig['items'][number];
  ruleKey: string;
  averageWindowMs: number;
}

export interface WatchGroup {
  groupKey: string;
  baseToken: string;
  quoteToken: string;
  queryBaseAmount: number;
  pollIntervalMs: number;
  maxAverageWindowMs: number;
  items: GroupedWatchItem[];
}

export class WatchGroupRunner {
  private readonly priceHistory: PricePoint[] = [];
  private readonly pauseRules = new Map<string, AveragePauseRule>();
  private readonly hitCounts = new Map<string, number>();
  private readonly tradeCycleBaseAvailable = new Map<string, string>();

  constructor(
    private readonly group: WatchGroup,
    private readonly cooldown: CooldownManager,
    private readonly config: ResolvedConfig,
  ) {}

  createCheck(): () => Promise<void> {
    return createSerializedPollRunner(() => this.tick());
  }

  private async maybeSendOpsAlert(ruleKey: string, issueType: string, message: string): Promise<boolean> {
    const opsCooldownKey = createOpsCooldownKey(ruleKey, issueType);
    if (!this.cooldown.shouldAlert(opsCooldownKey, DEFAULT_OPS_COOLDOWN_SECONDS)) {
      log.info(
        { event: 'ops_cooldown_active', issueType, ruleKey, cooldownSeconds: DEFAULT_OPS_COOLDOWN_SECONDS },
        'Ops alert cooldown active',
      );
      return false;
    }

    const sent = await sendTelegramMessage(this.config.telegram, message);
    if (sent) {
      log.info({ event: 'ops_alert_sent', issueType, ruleKey }, 'Ops alert sent');
      this.cooldown.recordAlert(opsCooldownKey);
    } else {
      log.error({ event: 'ops_alert_failed', issueType, ruleKey }, 'Ops alert failed');
    }
    return sent;
  }

  private async tick(): Promise<void> {
    const { group } = this;
    try {
      const biPrice = await getBidirectionalPrice(group.baseToken, group.quoteToken, group.queryBaseAmount, {
        amountMode: 'human',
      });

      if (biPrice === null) {
        log.error(
          { event: 'price_fetch_failed', pair: formatPair(group.baseToken, group.quoteToken) },
          'Failed to fetch price',
        );
        return;
      }

      const { sellPrice, buyPrice, midPrice, spreadPercent } = biPrice;
      const now = Date.now();
      this.pruneHistory(now);
      const windowSummary = this.computeWindowAverages(now);

      log.info(
        {
          event: 'monitor_tick',
          pair: formatPair(group.baseToken, group.quoteToken),
          sellPrice,
          buyPrice,
          midPrice,
          spreadPercent,
          quotedBaseAmount: group.queryBaseAmount,
          windows: Array.from(windowSummary.entries())
            .map(([ms, avg]) => `${Math.round(ms / 60000)}m=${avg === null ? 'N/A' : `$${avg.toFixed(6)}`}`)
            .join(', '),
          samples: this.priceHistory.length,
          rules: group.items.length,
        },
        'Monitor snapshot',
      );

      for (const groupedItem of group.items) {
        await this.processItem(groupedItem, midPrice, spreadPercent, now, windowSummary);
      }

      const shouldSample = group.items.some(({ ruleKey }) => !this.pauseRules.has(ruleKey));
      if (shouldSample) {
        this.priceHistory.push({ timestamp: now, price: midPrice });
      }
    } catch (error: unknown) {
      log.error(
        { event: 'poll_loop_error', pair: formatPair(group.baseToken, group.quoteToken), err: toLogError(error) },
        'Error in polling loop',
      );
    }
  }

  private pruneHistory(now: number): void {
    while (
      this.priceHistory.length > 0 &&
      now - this.priceHistory[0].timestamp > this.group.maxAverageWindowMs
    ) {
      this.priceHistory.shift();
    }
  }

  private computeWindowAverages(now: number): Map<number, number | null> {
    const summary = new Map<number, number | null>();
    for (const { averageWindowMs } of this.group.items) {
      if (summary.has(averageWindowMs)) continue;
      const cutoff = now - averageWindowMs;
      let count = 0;
      let total = 0;
      for (let i = this.priceHistory.length - 1; i >= 0; i--) {
        const p = this.priceHistory[i];
        if (p.timestamp < cutoff) break;
        total += p.price;
        count++;
      }
      summary.set(averageWindowMs, count === 0 ? null : total / count);
    }
    return summary;
  }

  private async processItem(
    { item, ruleKey, averageWindowMs }: GroupedWatchItem,
    price: number,
    spreadPercent: number,
    now: number,
    windowSummary: Map<number, number | null>,
  ): Promise<void> {
    const { config, cooldown } = this;
    const pair = formatPair(item.baseToken, item.quoteToken);

    if (item.maxSpreadPercent !== null && spreadPercent > item.maxSpreadPercent) {
      log.warn(
        { event: 'spread_too_wide', pair, spreadPercent, maxSpreadPercent: item.maxSpreadPercent, ruleKey },
        'Bid-ask spread exceeds limit — skipping tick',
      );
      await this.maybeSendOpsAlert(ruleKey, 'spread_too_wide', buildOpsAlertMessage({
        title: 'Spread Too Wide',
        pairSymbol: pair,
        details: [
          `Spread: <code>${spreadPercent.toFixed(2)}%</code> (limit: ${item.maxSpreadPercent}%)`,
          `Reason: routing anomaly — tick skipped, no trade executed`,
        ],
      })).catch(() => {});
      return;
    }

    const avgWindowPrice = windowSummary.get(averageWindowMs) ?? null;

    const evaluation = evaluateWatchRule({
      item,
      price,
      avgWindowPrice,
      previousHitCount: this.hitCounts.get(ruleKey) ?? 0,
      pauseRule: this.pauseRules.get(ruleKey),
      tradeConfig: config.trade,
      allowFastTrack: config.trade.enabled && item.tradeEnabled !== false,
    });

    if (evaluation.resumed) this.pauseRules.delete(ruleKey);

    if (evaluation.isPaused) {
      this.hitCounts.delete(ruleKey);
      return;
    }

    const { isConditionMet, triggerThreshold, tradeSide, hitCount, isAlertConfirmed } = evaluation;

    if (isConditionMet) {
      log.info(
        {
          event: 'condition_triggered',
          pair: formatPair(item.baseToken, item.quoteToken),
          condition: item.condition,
          mode: item.alertMode,
          currentPrice: price,
          quotedBaseAmount: item.priceQueryMinBaseAmount,
          threshold: triggerThreshold,
          overshootPercent: evaluation.overshootPercent,
          fastTrack: evaluation.isFastTrack,
        },
        'Rule condition triggered',
      );
      this.hitCounts.set(ruleKey, hitCount);
    } else {
      this.hitCounts.delete(ruleKey);
    }

    const tradeCooldownKey = tradeSide !== null
      ? `${item.baseToken}::${item.quoteToken}::${tradeSide}::trade`
      : null;

    if (config.trade.enabled && item.tradeEnabled && tradeSide !== null) {
      const proceed = await this.runTradePreChecks(
        item, ruleKey, tradeSide, tradeCooldownKey!,
        triggerThreshold, hitCount, evaluation.tradeConfirmedImmediately,
      );
      if (!proceed) return;
    }

    if (!isConditionMet) {
      this.tradeCycleBaseAvailable.delete(`${item.baseToken}::${item.quoteToken}::buy::trade`);
      this.tradeCycleBaseAvailable.delete(`${item.baseToken}::${item.quoteToken}::sell::trade`);
    }

    if (isAlertConfirmed && cooldown.shouldAlert(ruleKey, item.alertCooldownSeconds)) {
      await this.dispatchAlert(item, ruleKey, price, avgWindowPrice, tradeSide, tradeCooldownKey, triggerThreshold);
    } else if (isAlertConfirmed) {
      log.info(
        { event: 'alert_cooldown_active', pair: formatPair(item.baseToken, item.quoteToken), ruleKey, cooldownSeconds: item.alertCooldownSeconds },
        'Alert cooldown active',
      );
    }

    // suppress unused-variable warning — now is used only to push into history in tick()
    void now;
  }

  private async runTradePreChecks(
    item: GroupedWatchItem['item'],
    ruleKey: string,
    tradeSide: 'buy' | 'sell',
    tradeCooldownKey: string,
    triggerThreshold: number | null,
    hitCount: number,
    tradeConfirmedImmediately: boolean,
  ): Promise<boolean> {
    const { config } = this;
    const pair = formatPair(item.baseToken, item.quoteToken);

    if (triggerThreshold === null) {
      log.warn(
        { event: 'trade_skipped', reason: 'missing_trigger_threshold', side: tradeSide, pair },
        'Skip trade: missing trigger threshold',
      );
      await this.maybeSendOpsAlert(ruleKey, 'config_error', buildOpsAlertMessage({
        title: 'Config Error',
        pairSymbol: pair,
        details: [`Reason: missing trigger threshold`, `Side: ${tradeSide.toUpperCase()}`],
      })).catch(() => {});
      return false;
    }

    let lockedCycleAvailableAmount = this.tradeCycleBaseAvailable.get(tradeCooldownKey);
    if (!lockedCycleAvailableAmount) {
      const currentTradableAmount = await getCurrentTradableAmount(config.trade, item, tradeSide);
      if (currentTradableAmount <= 0n) {
        log.warn(
          { event: 'trade_skipped', reason: 'insufficient_tradable_balance', side: tradeSide, pair },
          'Skip trade: insufficient tradable balance',
        );
        await this.maybeSendOpsAlert(ruleKey, 'insufficient_balance', buildOpsAlertMessage({
          title: 'Insufficient Balance',
          pairSymbol: pair,
          details: [`Reason: insufficient tradable balance`, `Side: ${tradeSide.toUpperCase()}`],
        })).catch(() => {});
        return false;
      }
      lockedCycleAvailableAmount = currentTradableAmount.toString();
      this.tradeCycleBaseAvailable.set(tradeCooldownKey, lockedCycleAvailableAmount);
    }

    const requiredConfirmations = item.tradeConfirmations;
    if (tradeConfirmedImmediately) {
      log.info(
        { event: 'trade_fast_track_triggered', pair, side: tradeSide, hitCount, requiredConfirmations },
        'Fast-track triggered, skipping confirmation wait',
      );
    } else if (hitCount < requiredConfirmations) {
      log.info(
        { event: 'trade_confirmation_waiting', pair, side: tradeSide, hitCount, requiredConfirmations },
        'Waiting for trade confirmations',
      );
      return false;
    }

    return true;
  }

  private async dispatchAlert(
    item: GroupedWatchItem['item'],
    ruleKey: string,
    price: number,
    avgWindowPrice: number | null,
    tradeSide: 'buy' | 'sell' | null,
    tradeCooldownKey: string | null,
    triggerThreshold: number | null,
  ): Promise<void> {
    const { config, cooldown, group } = this;
    const pair = formatPair(item.baseToken, item.quoteToken);

    log.info({ event: 'alert_triggered', pair, currentPrice: price, ruleKey }, 'Alert triggered');

    const averageTargetPrice = item.alertMode === 'avg_percent' && avgWindowPrice !== null
      ? avgWindowPrice * ((item.avgTargetPercent ?? 100) / 100)
      : null;

    const reason = item.alertMode === 'price'
      ? `target: ${item.condition} $${item.targetPrice!.toFixed(4)}`
      : `${item.avgWindowMinutes}m avg x ${item.avgTargetPercent}%: ${item.condition} $${averageTargetPrice!.toFixed(4)}`;

    const actionResult = await processAlertActions({
      item,
      ruleKey,
      pairSymbol: pair,
      currentPrice: price,
      quotedBaseAmount: item.priceQueryMinBaseAmount,
      reason,
      tradeSide,
      tradeCooldownKey,
      triggerThreshold,
      avgWindowPrice,
      configTradeEnabled: config.trade.enabled,
      configTrade: config.trade,
      configTelegram: config.telegram,
      state: cooldown.getState(),
    }, {
      shouldAlertFn: (key, secs) => cooldown.shouldAlert(key, secs),
      sendTelegramFn: sendTelegramMessage,
      repriceFn: () => getTokenPrice(group.baseToken, group.quoteToken, item.priceQueryMinBaseAmount, {
        forceRefresh: true,
        amountMode: 'human',
      }),
      executeTradeFn: (ctx) => executeTrade(config.trade, item, tradeSide!, {
        lockedCycleAvailableAmount: tradeCooldownKey
          ? this.tradeCycleBaseAvailable.get(tradeCooldownKey)
          : undefined,
        fastTrack: ctx.fastTrack,
        overshootPercent: ctx.overshootPercent,
      }),
      scheduleTradeStatusFollowUpFn: (tradeResult) => {
        if (!tradeResult.digest || !tradeSide) return;
        void this.runFollowUp(
          item, ruleKey, tradeSide, tradeCooldownKey,
          tradeResult.digest, tradeResult, reason, price,
        );
      },
    });

    if (actionResult.tradeExecutionResult?.digest) {
      const { status, digest, error: txError } = actionResult.tradeExecutionResult;
      if (status === 'success') {
        log.info({ event: 'trade_confirmed_success', side: tradeSide, pair, digest }, 'Trade confirmed on-chain');
      } else if (status === 'failure') {
        log.warn({ event: 'trade_confirmed_failure', side: tradeSide, pair, digest, error: txError }, 'Trade failed on-chain');
      } else if (status === 'unknown') {
        log.warn({ event: 'trade_status_unknown', side: tradeSide, pair, digest }, 'Trade status unknown, follow-up scheduled');
      }
    }

    if (actionResult.opsNotification) {
      await this.maybeSendOpsAlert(ruleKey, actionResult.opsNotification.kind, actionResult.opsNotification.message);
    }

    if (actionResult.alertSent) {
      log.info({ event: 'telegram_alert_sent', pair, ruleKey }, 'Telegram alert sent');
      cooldown.recordAlert(ruleKey);
      if (actionResult.shouldRecordTradeCooldown && tradeCooldownKey) {
        cooldown.recordAlert(tradeCooldownKey);
      }
      if (item.alertMode === 'avg_percent' && avgWindowPrice !== null) {
        this.pauseRules.set(ruleKey, createAveragePauseRule(item, avgWindowPrice));
      }
    } else {
      log.error({ event: 'telegram_alert_failed', pair, ruleKey }, 'Telegram alert failed');
    }
  }

  private async runFollowUp(
    item: GroupedWatchItem['item'],
    ruleKey: string,
    tradeSide: 'buy' | 'sell',
    tradeCooldownKey: string | null,
    followUpDigest: string,
    tradeResult: TradeExecutionResult,
    reason: string,
    price: number,
  ): Promise<void> {
    const { config, cooldown } = this;
    const pair = formatPair(item.baseToken, item.quoteToken);

    try {
      const finalTradeResult = await pollTradeExecutionUntilFinal(
        () => confirmTradeExecution(config.trade, {
          digest: followUpDigest,
          side: tradeSide,
          inputCoin: tradeResult.inputCoin,
          outputCoin: tradeResult.outputCoin,
          amountIn: tradeResult.amountIn,
        }),
        config.trade.statusPollIntervalMs,
      );

      const finalResult: TradeExecutionResult = {
        ...finalTradeResult,
        digest: finalTradeResult.digest ?? followUpDigest,
      };

      if (finalTradeResult.status === 'success') {
        log.info({ event: 'trade_confirmed_success', side: tradeSide, pair, digest: followUpDigest }, 'Trade confirmed on-chain');
      } else {
        log.warn({ event: 'trade_confirmed_failure', side: tradeSide, pair, digest: followUpDigest, error: finalTradeResult.error }, 'Trade failed on-chain');
      }

      const followUpMessage = buildAlertMessage({
        pairSymbol: pair,
        reason,
        currentPrice: price,
        quotedBaseAmount: item.priceQueryMinBaseAmount,
        tradeExecutionResult: finalResult,
      });

      const followUpSent = await sendTelegramMessage(config.telegram, followUpMessage);
      if (followUpSent) {
        log.info({ event: 'telegram_alert_sent', pair, ruleKey, digest: followUpDigest, followUp: true }, 'Telegram follow-up alert sent');
      } else {
        log.error({ event: 'telegram_alert_failed', pair, ruleKey, digest: followUpDigest, followUp: true }, 'Telegram follow-up alert failed');
      }

      if (finalTradeResult.status === 'success' && tradeCooldownKey) {
        cooldown.recordAlert(tradeCooldownKey);
      }
    } catch (error: unknown) {
      log.error(
        { event: 'trade_follow_up_error', pair, ruleKey, digest: followUpDigest, err: toLogError(error) },
        'Error while resolving background trade follow-up',
      );
    }
  }
}
