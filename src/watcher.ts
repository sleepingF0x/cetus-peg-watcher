import { Config } from './config.js';
import { getTokenPrice } from './cetus.js';
import { loadState, migrateLegacyStateKeys, saveState, shouldAlert, recordAlert } from './state.js';
import { executeTrade, getCurrentTradableAmount } from './trader.js';
import { sendTelegramMessage } from './telegram.js';
import { formatPair } from './formatters.js';
import {
  createAlertRuleKey,
  createOpsCooldownKey,
  createSerializedPollRunner,
} from './watcher-logic.js';
import type { AveragePauseRule } from './watcher-logic.js';
import { createAveragePauseRule, evaluateWatchRule } from './watcher-rules.js';
import { buildOpsAlertMessage, processAlertActions } from './watcher-actions.js';

const STATE_FILE = 'state.json';
const DEFAULT_OPS_COOLDOWN_SECONDS = 3600;

interface PricePoint {
  timestamp: number;
  price: number;
}

interface GroupedWatchItem {
  item: Config['items'][number];
  ruleKey: string;
  averageWindowMs: number;
}

interface WatchGroup {
  groupKey: string;
  baseToken: string;
  quoteToken: string;
  pollIntervalMs: number;
  maxAverageWindowMs: number;
  items: GroupedWatchItem[];
}

function pruneOldPrices(history: PricePoint[], now: number, windowMs: number): void {
  while (history.length > 0 && now - history[0].timestamp > windowMs) {
    history.shift();
  }
}

function calculateAveragePriceWithinWindow(history: PricePoint[], now: number, windowMs: number): number | null {
  const cutoff = now - windowMs;
  let count = 0;
  let total = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const point = history[i];
    if (point.timestamp < cutoff) {
      break;
    }
    total += point.price;
    count += 1;
  }

  if (count === 0) {
    return null;
  }

  return total / count;
}

export async function startWatcher(config: Config) {
  const loadedState = loadState(STATE_FILE);
  const state = migrateLegacyStateKeys(loadedState, config.items.map((item) => ({
    id: item.id,
    baseToken: item.baseToken,
    quoteToken: item.quoteToken!,
  })));
  if (JSON.stringify(state.lastAlertTime) !== JSON.stringify(loadedState.lastAlertTime)) {
    console.log('[State] Migrated legacy cooldown keys to explicit rule ids');
    saveState(STATE_FILE, state);
  }
  const priceHistory = new Map<string, PricePoint[]>();
  const averagePauseRules = new Map<string, AveragePauseRule>();
  const tradeCycleBaseAvailable = new Map<string, string>();
  const consecutiveTradeHits = new Map<string, number>();
  const watchGroups = new Map<string, WatchGroup>();

  const maybeSendOpsAlert = async (
    ruleKey: string,
    issueType: string,
    message: string,
  ): Promise<boolean> => {
    const opsCooldownKey = createOpsCooldownKey(ruleKey, issueType);
    if (!shouldAlert(opsCooldownKey, DEFAULT_OPS_COOLDOWN_SECONDS, state)) {
      console.log(`[Ops] Cooldown active for ${issueType} (${ruleKey}), skip for ${DEFAULT_OPS_COOLDOWN_SECONDS}s window`);
      return false;
    }

    const sent = await sendTelegramMessage(config.telegram, message);
    if (sent) {
      console.log(`[Ops] Alert sent for ${issueType} (${ruleKey})`);
      recordAlert(opsCooldownKey, state);
      saveState(STATE_FILE, state);
    } else {
      console.error(`[Ops] Alert failed for ${issueType} (${ruleKey})`);
    }

    return sent;
  };

  config.items.forEach((item, index) => {
    const pollIntervalMs = (item.pollInterval || 30) * 1000;
    const pairKey = `${item.baseToken}::${item.quoteToken}`;
    const groupKey = `${pairKey}::${pollIntervalMs}`;
    const averageWindowMs = (item.avgWindowMinutes || 10) * 60 * 1000;
    const ruleKey = createAlertRuleKey(item.id);

    const existingGroup = watchGroups.get(groupKey);
    if (existingGroup) {
      existingGroup.items.push({ item, ruleKey, averageWindowMs });
      if (averageWindowMs > existingGroup.maxAverageWindowMs) {
        existingGroup.maxAverageWindowMs = averageWindowMs;
      }
      return;
    }

    watchGroups.set(groupKey, {
      groupKey,
      baseToken: item.baseToken,
      quoteToken: item.quoteToken!,
      pollIntervalMs,
      maxAverageWindowMs: averageWindowMs,
      items: [{ item, ruleKey, averageWindowMs }],
    });
  });

  for (const group of watchGroups.values()) {
    const check = createSerializedPollRunner(async () => {
      try {
        const price = await getTokenPrice(group.baseToken, group.quoteToken);

        if (price === null) {
          console.error(`[Watcher] Failed to fetch price for ${formatPair(group.baseToken, group.quoteToken)}`);
          return;
        }

        const now = Date.now();
        const history = priceHistory.get(group.groupKey) ?? [];

        pruneOldPrices(history, now, group.maxAverageWindowMs);

        const windowSummary = new Map<number, number | null>();
        for (const groupedItem of group.items) {
          if (!windowSummary.has(groupedItem.averageWindowMs)) {
            windowSummary.set(
              groupedItem.averageWindowMs,
              calculateAveragePriceWithinWindow(history, now, groupedItem.averageWindowMs),
            );
          }
        }

        const averageText = Array.from(windowSummary.entries())
          .map(([windowMs, avg]) => {
            const minutes = Math.round(windowMs / 60000);
            return `${minutes}m=${avg === null ? 'N/A' : `$${avg.toFixed(6)}`}`;
          })
          .join(', ');

        console.log(
          `[Monitor] ${formatPair(group.baseToken, group.quoteToken)} | current: $${price.toFixed(6)} | windows: ${averageText} | samples: ${history.length} | rules: ${group.items.length}`,
        );

        for (const groupedItem of group.items) {
          const { item, ruleKey, averageWindowMs } = groupedItem;
          const avgWindowPrice = windowSummary.get(averageWindowMs) ?? null;
          const evaluation = evaluateWatchRule({
            item,
            price,
            avgWindowPrice,
            previousHitCount: consecutiveTradeHits.get(ruleKey) ?? 0,
            pauseRule: averagePauseRules.get(ruleKey),
          });

          if (evaluation.resumed) {
            averagePauseRules.delete(ruleKey);
          }

          if (evaluation.isPaused) {
            consecutiveTradeHits.delete(ruleKey);
            continue;
          }

          const averageTargetPrice = item.alertMode === 'avg_percent' && avgWindowPrice !== null
            ? avgWindowPrice * ((item.avgTargetPercent || 100) / 100)
            : null;
          const isConditionMet = evaluation.isConditionMet;
          const triggerThreshold = evaluation.triggerThreshold;

          if (isConditionMet) {
            console.log(
              `[Trigger] ${formatPair(item.baseToken, item.quoteToken!)} hit condition=${item.condition} mode=${item.alertMode} | current=$${price.toFixed(6)} | threshold=$${triggerThreshold!.toFixed(6)}`,
            );
          }

          const tradeSide = evaluation.tradeSide;
          const hitCount = evaluation.hitCount;
          if (isConditionMet) {
            consecutiveTradeHits.set(ruleKey, hitCount);
          } else {
            consecutiveTradeHits.delete(ruleKey);
          }

          const tradeCooldownKey = tradeSide !== null
            ? `${item.baseToken}::${item.quoteToken}::${tradeSide}::trade`
            : null;

          if (config.trade?.enabled && item.tradeEnabled && tradeSide !== null) {
            const requiredConfirmations = item.tradeConfirmations || 2;

            if (triggerThreshold === null) {
              console.warn(`[Trade] Skip ${tradeSide.toUpperCase()} for ${formatPair(item.baseToken, item.quoteToken!)}: missing trigger threshold`);

              const opsMessage = buildOpsAlertMessage({
                title: 'Config Error',
                pairSymbol: formatPair(item.baseToken, item.quoteToken!),
                details: [
                  `Reason: missing trigger threshold`,
                  `Side: ${tradeSide.toUpperCase()}`,
                ],
              });
              await maybeSendOpsAlert(ruleKey, 'config_error', opsMessage).catch(() => {});

              continue;
            }

            let lockedCycleAvailableAmount = tradeCycleBaseAvailable.get(tradeCooldownKey!);
            if (!lockedCycleAvailableAmount) {
              const currentTradableAmount = await getCurrentTradableAmount(config.trade, item, tradeSide);
              if (currentTradableAmount <= 0n) {
                console.warn(`[Trade] Skip ${tradeSide.toUpperCase()} for ${formatPair(item.baseToken, item.quoteToken!)}: insufficient tradable balance`);

                const opsMessage = buildOpsAlertMessage({
                  title: 'Insufficient Balance',
                  pairSymbol: formatPair(item.baseToken, item.quoteToken!),
                  details: [
                    'Reason: insufficient tradable balance',
                    `Side: ${tradeSide.toUpperCase()}`,
                  ],
                });
                await maybeSendOpsAlert(ruleKey, 'insufficient_balance', opsMessage).catch(() => {});

                continue;
              }
              lockedCycleAvailableAmount = currentTradableAmount.toString();
              tradeCycleBaseAvailable.set(tradeCooldownKey!, lockedCycleAvailableAmount);
            }

            if (hitCount < requiredConfirmations) {
              console.log(
                `[Trade] Waiting confirmation ${hitCount}/${requiredConfirmations} for ${formatPair(item.baseToken, item.quoteToken!)} (${tradeSide})`,
              );
              continue;
            }
          }

          if (!isConditionMet) {
            tradeCycleBaseAvailable.delete(`${item.baseToken}::${item.quoteToken}::buy::trade`);
            tradeCycleBaseAvailable.delete(`${item.baseToken}::${item.quoteToken}::sell::trade`);
          }

          const isAlertConfirmed = evaluation.isAlertConfirmed;

          if (isAlertConfirmed && shouldAlert(ruleKey, item.alertCooldownSeconds || 1800, state)) {
            console.log(
              `[Alert] Triggered for ${formatPair(item.baseToken, item.quoteToken!)} at $${price.toFixed(6)} (cooldown=${item.alertCooldownSeconds || 1800}s)`,
            );

            const reason = item.alertMode === 'price'
              ? `target: ${item.condition} $${item.targetPrice!.toFixed(4)}`
              : `${item.avgWindowMinutes}m avg x ${item.avgTargetPercent}%: ${item.condition} $${averageTargetPrice!.toFixed(4)}`;
            const actionResult = await processAlertActions({
              item,
              ruleKey,
              pairSymbol: formatPair(item.baseToken, item.quoteToken!),
              currentPrice: price,
              reason,
              tradeSide,
              tradeCooldownKey,
              triggerThreshold,
              configTradeEnabled: config.trade?.enabled === true,
              configTelegram: config.telegram,
              state,
            }, {
              shouldAlertFn: shouldAlert,
              sendTelegramFn: sendTelegramMessage,
              repriceFn: () => getTokenPrice(group.baseToken, group.quoteToken, undefined, { forceRefresh: true }),
              executeTradeFn: () => executeTrade(config.trade!, item, tradeSide!, {
                lockedCycleAvailableAmount: tradeCooldownKey
                  ? tradeCycleBaseAvailable.get(tradeCooldownKey)
                  : undefined,
              }),
            });

            if (actionResult.tradeExecuted && actionResult.tradeExecutionResult?.digest) {
              console.log(
                `[Trade] Executed ${tradeSide!.toUpperCase()} for ${formatPair(item.baseToken, item.quoteToken!)} | digest=${actionResult.tradeExecutionResult.digest}`,
              );
            }

            if (actionResult.opsNotification) {
              await maybeSendOpsAlert(ruleKey, actionResult.opsNotification.kind, actionResult.opsNotification.message);
            }

            if (actionResult.alertSent) {
              console.log(`[Telegram] Alert sent for ${formatPair(item.baseToken, item.quoteToken!)}`);
              recordAlert(ruleKey, state);
              if (actionResult.shouldRecordTradeCooldown && tradeCooldownKey) {
                recordAlert(tradeCooldownKey, state);
              }

              if (item.alertMode === 'avg_percent' && avgWindowPrice !== null) {
                averagePauseRules.set(ruleKey, createAveragePauseRule(item, avgWindowPrice));
              }

              saveState(STATE_FILE, state);
            } else {
              console.error(`[Telegram] Alert failed for ${formatPair(item.baseToken, item.quoteToken!)}`);
            }
          } else if (isAlertConfirmed) {
            console.log(
              `[Alert] Cooldown active for ${formatPair(item.baseToken, item.quoteToken!)}, skip for ${item.alertCooldownSeconds || 1800}s window`,
            );
          }
        }

        const shouldSamplePrice = group.items.some(({ ruleKey }) => !averagePauseRules.has(ruleKey));
        if (shouldSamplePrice) {
          history.push({ timestamp: now, price });
        }
        priceHistory.set(group.groupKey, history);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Watcher] Error in polling loop for ${formatPair(group.baseToken, group.quoteToken)}: ${message}`);
      }
    });

    void check();
    setInterval(() => {
      void check();
    }, group.pollIntervalMs);
  }
}
