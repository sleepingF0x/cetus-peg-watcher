import { Config } from './config.js';
import { getTokenPrice, getCoinDecimals } from './cetus.js';
import { loadState, saveState, shouldAlert, recordAlert } from './state.js';
import { executeTrade, getCurrentTradableAmount } from './trader.js';
import { sendTelegramMessage } from './telegram.js';
import {
  getTokenSymbol,
  formatPair,
  formatAmount,
  formatPrice,
  calculateExecutedPrice,
} from './formatters.js';

const STATE_FILE = 'state.json';

interface PricePoint {
  timestamp: number;
  price: number;
}

interface AveragePauseRule {
  resumePrice: number;
  condition: 'above' | 'below';
}

interface GroupedWatchItem {
  item: Config['items'][number];
  itemId: string;
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

interface TradeExecutionSummary {
  side: string;
  amountIn?: string;
  amountOut?: string;
  realizedPrice?: number;
  digest?: string;
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
  const state = loadState(STATE_FILE);
  const priceHistory = new Map<string, PricePoint[]>();
  const averagePauseRules = new Map<string, AveragePauseRule>();
  const tradeCycleBaseAvailable = new Map<string, string>();
  const consecutiveTradeHits = new Map<string, number>();
  const watchGroups = new Map<string, WatchGroup>();

  config.items.forEach((item, index) => {
    const pollIntervalMs = (item.pollInterval || 30) * 1000;
    const pairKey = `${item.baseToken}::${item.quoteToken}`;
    const groupKey = `${pairKey}::${pollIntervalMs}`;
    const averageWindowMs = (item.avgWindowMinutes || 10) * 60 * 1000;
    const itemId = `${groupKey}::${index}`;

    const existingGroup = watchGroups.get(groupKey);
    if (existingGroup) {
      existingGroup.items.push({ item, itemId, averageWindowMs });
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
      items: [{ item, itemId, averageWindowMs }],
    });
  });

  for (const group of watchGroups.values()) {

    const check = async () => {
      try {
        const price = await getTokenPrice(group.baseToken, group.quoteToken);

        if (price !== null) {
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
            `[Monitor] ${group.baseToken} | quote: ${group.quoteToken} | current: $${price.toFixed(6)} | windows: ${averageText} | samples: ${history.length} | rules: ${group.items.length}`,
          );

          for (const groupedItem of group.items) {
            const { item, itemId, averageWindowMs } = groupedItem;
            const pauseRule = averagePauseRules.get(itemId);

            if (pauseRule) {
              const shouldResume = pauseRule.condition === 'above'
                ? price <= pauseRule.resumePrice
                : price >= pauseRule.resumePrice;

              if (shouldResume) {
                averagePauseRules.delete(itemId);
              }
            }

            const avgWindowPrice = windowSummary.get(averageWindowMs) ?? null;

            const isTargetConditionMet = item.alertMode === 'price' && (
              (item.condition === 'above' && price >= item.targetPrice!) ||
              (item.condition === 'below' && price <= item.targetPrice!)
            );

            const averageTargetPrice = avgWindowPrice === null
              ? null
              : avgWindowPrice * ((item.avgTargetPercent || 100) / 100);

            const isAverageConditionMet = item.alertMode === 'avg_percent' && averageTargetPrice !== null && (
              (item.condition === 'above' && price >= averageTargetPrice) ||
              (item.condition === 'below' && price <= averageTargetPrice)
            );

            const isConditionMet = item.alertMode === 'price'
              ? isTargetConditionMet
              : isAverageConditionMet;

            if (isConditionMet) {
              const triggerThreshold = item.alertMode === 'price'
                ? item.targetPrice!
                : averageTargetPrice!;
              console.log(
                `[Trigger] ${item.baseToken} hit condition=${item.condition} mode=${item.alertMode} | current=$${price.toFixed(6)} | threshold=$${triggerThreshold.toFixed(6)}`,
              );
            }

            const tradeSide = isConditionMet
              ? (item.condition === 'below' ? 'buy' : 'sell')
              : null;

            const hitCount = isConditionMet
              ? (consecutiveTradeHits.get(itemId) ?? 0) + 1
              : 0;
            if (isConditionMet) {
              consecutiveTradeHits.set(itemId, hitCount);
            } else {
              consecutiveTradeHits.delete(itemId);
            }

            const tradeCooldownKey = tradeSide !== null 
                ? `${item.baseToken}::${item.quoteToken}::${tradeSide}::trade`
                : null;

            if (config.trade?.enabled && item.tradeEnabled && tradeSide !== null) {
              const requiredConfirmations = item.tradeConfirmations || 2;
              const triggerThreshold = item.alertMode === 'price'
                ? item.targetPrice!
                : averageTargetPrice;

              if (triggerThreshold === null) {
                console.warn(`[Trade] Skip ${tradeSide.toUpperCase()} for ${item.baseToken}: missing trigger threshold`);

                const alertMessage = [
                  '<b>⚠️ 交易配置错误</b>',
                  `Token: <code>${item.baseToken}</code>`,
                  `Side: <code>${tradeSide.toUpperCase()}</code>`,
                  `原因: 缺少触发阈值配置`,
                ].join('\n');
                await sendTelegramMessage(config.telegram, alertMessage).catch(() => {});

                continue;
              }
              let lockedCycleAvailableAmount: string | undefined;

              lockedCycleAvailableAmount = tradeCycleBaseAvailable.get(tradeCooldownKey!);
              if (!lockedCycleAvailableAmount) {
                const currentTradableAmount = await getCurrentTradableAmount(config.trade, item, tradeSide);
                if (currentTradableAmount <= 0n) {
                  console.warn(`[Trade] Skip ${tradeSide.toUpperCase()} for ${item.baseToken}: insufficient tradable balance`);

                  const alertMessage = [
                    '<b>⚠️ 交易余额不足</b>',
                    `Pair: <code>${item.baseToken}</code> / <code>${item.quoteToken}</code>`,
                    `Side: <code>${tradeSide.toUpperCase()}</code>`,
                    `原因: 钱包中可用于交易的余额不足`,
                  ].join('\n');
                  await sendTelegramMessage(config.telegram, alertMessage).catch(() => {});

                  continue;
                }
                lockedCycleAvailableAmount = currentTradableAmount.toString();
                tradeCycleBaseAvailable.set(tradeCooldownKey!, lockedCycleAvailableAmount);
              }

              if (hitCount < requiredConfirmations) {
                console.log(
                  `[Trade] Waiting confirmation ${hitCount}/${requiredConfirmations} for ${item.baseToken} (${tradeSide})`,
                );
                continue;
              }

              // Trade execution moved to alert section for combined messaging
            }

            if (!isConditionMet) {
              tradeCycleBaseAvailable.delete(`${item.baseToken}::${item.quoteToken}::buy::trade`);
              tradeCycleBaseAvailable.delete(`${item.baseToken}::${item.quoteToken}::sell::trade`);
            }

            const requiredConfirmations = item.tradeConfirmations || 2;
            const isAlertConfirmed = isConditionMet && hitCount >= requiredConfirmations;
            let tradeExecutionResult: TradeExecutionSummary | null = null;

            if (isAlertConfirmed && shouldAlert(item.baseToken, item.alertCooldownSeconds || 1800, state)) {
              console.log(
                `[Alert] Triggered for ${item.baseToken} at $${price.toFixed(6)} (cooldown=${item.alertCooldownSeconds || 1800}s)`,
              );

              // Execute trade if enabled (before sending alert, so we can include trade info)
              if (config.trade?.enabled && item.tradeEnabled && tradeSide !== null) {
                const triggerThreshold = item.alertMode === 'price'
                  ? item.targetPrice!
                  : averageTargetPrice;

                if (triggerThreshold !== null && shouldAlert(tradeCooldownKey!, item.tradeCooldownSeconds || 1800, state)) {
                  const requotedPrice = await getTokenPrice(group.baseToken, group.quoteToken, undefined, { forceRefresh: true });
                  if (requotedPrice !== null) {
                    const stillValid = item.condition === 'above'
                      ? requotedPrice >= triggerThreshold
                      : requotedPrice <= triggerThreshold;
                    
                    if (stillValid) {
                      try {
                        const tradeResult = await executeTrade(config.trade, item, tradeSide, {
                          lockedCycleAvailableAmount: tradeCycleBaseAvailable.get(tradeCooldownKey!),
                        });
                        if (tradeResult.success) {
                          tradeExecutionResult = {
                            side: tradeSide,
                            amountIn: tradeResult.amountIn,
                            amountOut: tradeResult.amountOut,
                            realizedPrice: tradeResult.realizedPrice,
                            digest: tradeResult.digest,
                          };
                          recordAlert(tradeCooldownKey!, state);
                        }
                      } catch (e) {
                        const err = e as Error;
                        console.error(`[Trade] Execution failed for ${item.baseToken}: ${err.message}`);
                      }
                    }
                  }
                }
              }

              // Build combined message
              const targetPrice = item.targetPrice;
              const reason = item.alertMode === 'price'
                ? `target: ${item.condition} $${targetPrice!.toFixed(4)}`
                : `${item.avgWindowMinutes}m avg x ${item.avgTargetPercent}%: ${item.condition} $${averageTargetPrice!.toFixed(4)}`;
              
              const pairSymbol = formatPair(item.baseToken, item.quoteToken!);
              const baseSymbol = getTokenSymbol(item.baseToken);
              const quoteSymbol = getTokenSymbol(item.quoteToken!);

              let messageLines: string[] = [];
              
              if (tradeExecutionResult) {
                messageLines.push(`🚨 <b>Price Alert + Trade Executed</b>`);
              } else {
                messageLines.push(`🚨 <b>Price Alert</b>`);
              }
              
              messageLines.push(`Pair: <code>${pairSymbol}</code>`);
              messageLines.push(`Trigger: <code>${reason}</code>`);
              messageLines.push(`Current: <code>$${price.toFixed(6)}</code>`);

              if (tradeExecutionResult) {
                const [baseDecimals, quoteDecimals] = await Promise.all([
                  getCoinDecimals(item.baseToken),
                  getCoinDecimals(item.quoteToken!),
                ]);
                
                const amountInFormatted = formatAmount(tradeExecutionResult.amountIn, baseDecimals ?? 6, 4);
                const amountOutFormatted = formatAmount(tradeExecutionResult.amountOut, quoteDecimals ?? 6, 4);
                const execPrice = calculateExecutedPrice(
                  tradeExecutionResult.amountIn,
                  tradeExecutionResult.amountOut,
                  baseDecimals ?? 6,
                  quoteDecimals ?? 6,
                );
                
                messageLines.push('');
                messageLines.push(`Trade: <code>${tradeExecutionResult.side.toUpperCase()} ${amountInFormatted} ${baseSymbol} → ${amountOutFormatted} ${quoteSymbol}</code>`);
                messageLines.push(`Executed Price: <code>${formatPrice(execPrice)} ${quoteSymbol}/${baseSymbol}</code>`);
                if (tradeExecutionResult.digest) {
                  messageLines.push(`Tx: <code>${tradeExecutionResult.digest}</code>`);
                }
              }

              const telegramMessage = messageLines.join('\n');
              const telegramSent = await sendTelegramMessage(config.telegram, telegramMessage);
              
              if (telegramSent) {
                console.log(`[Telegram] Combined alert message sent for ${item.baseToken}`);
                recordAlert(item.baseToken, state);

                if (item.alertMode === 'avg_percent' && avgWindowPrice !== null) {
                  const deviation = Math.abs((item.avgTargetPercent || 100) - 100) / 100;
                  const resumeFactor = item.avgResumeFactor ?? 0.95;
                  const recoverDeviation = deviation * resumeFactor;
                  const resumeMultiplier = item.condition === 'above'
                    ? 1 + deviation - recoverDeviation
                    : 1 - deviation + recoverDeviation;

                  averagePauseRules.set(itemId, {
                    condition: item.condition,
                    resumePrice: avgWindowPrice * resumeMultiplier,
                  });
                }

                saveState(STATE_FILE, state);
              } else {
                console.error(`[Telegram] Alert message failed for ${item.baseToken}`);
              }
            } else if (isAlertConfirmed) {
              console.log(
                `[Alert] Cooldown active for ${item.baseToken}, skip for ${item.alertCooldownSeconds || 1800}s window`,
              );
            }
          }

          const shouldSamplePrice = group.items.some(({ itemId }) => !averagePauseRules.has(itemId));
          if (shouldSamplePrice) {
            history.push({ timestamp: now, price });
          }
          priceHistory.set(group.groupKey, history);
        } else {
          console.error(`[Watcher] Failed to fetch price for ${group.baseToken}`);
        }
      } catch (error: any) {
        console.error(`[Watcher] Error in polling loop for ${group.baseToken}: ${error.message}`);
      }
    };

    check();
    setInterval(check, group.pollIntervalMs);
  }
}
