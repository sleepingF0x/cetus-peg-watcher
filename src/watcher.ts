import { Config } from './config.js';
import { getTokenPrice } from './cetus.js';
import { loadState, saveState, shouldAlert, recordAlert } from './state.js';
import { sendBarkAlert } from './notifier.js';
import { executeTrade } from './trader.js';
import { sendTelegramMessage } from './telegram.js';

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

function pruneOldPrices(history: PricePoint[], now: number, windowMs: number): void {
  while (history.length > 0 && now - history[0].timestamp > windowMs) {
    history.shift();
  }
}

function calculateAveragePrice(history: PricePoint[]): number | null {
  if (history.length === 0) {
    return null;
  }

  const total = history.reduce((sum, point) => sum + point.price, 0);
  return total / history.length;
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

function isConditionMetByPrice(
  condition: 'above' | 'below',
  observedPrice: number,
  thresholdPrice: number,
): boolean {
  if (condition === 'above') {
    return observedPrice >= thresholdPrice;
  }
  return observedPrice <= thresholdPrice;
}

function calculateEdgeBps(
  condition: 'above' | 'below',
  observedPrice: number,
  thresholdPrice: number,
): number {
  if (thresholdPrice <= 0) {
    return 0;
  }

  if (condition === 'above') {
    return ((observedPrice - thresholdPrice) / thresholdPrice) * 10000;
  }

  return ((thresholdPrice - observedPrice) / thresholdPrice) * 10000;
}

export async function startWatcher(config: Config) {
  const state = loadState(STATE_FILE);
  const priceHistory = new Map<string, PricePoint[]>();
  const averagePauseRules = new Map<string, AveragePauseRule>();
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

            if (config.trade?.enabled && item.tradeEnabled && tradeSide !== null) {
              const triggerThreshold = item.alertMode === 'price'
                ? item.targetPrice!
                : averageTargetPrice;

              if (triggerThreshold === null) {
                console.warn(`[Trade] Skip ${tradeSide.toUpperCase()} for ${item.baseToken}: missing trigger threshold`);
                continue;
              }

              const tradeCooldownKey = `${item.baseToken}::${item.quoteToken}::${tradeSide}::trade`;

              if (shouldAlert(tradeCooldownKey, item.tradeCooldownSeconds || 1800, state)) {
                console.log(
                  `[Trade] Triggered ${tradeSide.toUpperCase()} for ${item.baseToken} at $${price.toFixed(6)} (cooldown=${item.tradeCooldownSeconds || 1800}s)`,
                );

                const requotedPrice = await getTokenPrice(group.baseToken, group.quoteToken, undefined, { forceRefresh: true });
                if (requotedPrice === null) {
                  console.warn(`[Trade] Skip ${tradeSide.toUpperCase()} for ${item.baseToken}: failed to re-quote before execution`);
                  continue;
                }

                const stillValid = isConditionMetByPrice(item.condition, requotedPrice, triggerThreshold);
                if (!stillValid) {
                  console.log(
                    `[Trade] Skip ${tradeSide.toUpperCase()} for ${item.baseToken}: trigger no longer valid (re-quote=$${requotedPrice.toFixed(6)}, threshold=$${triggerThreshold.toFixed(6)})`,
                  );
                  continue;
                }

                const edgeBps = calculateEdgeBps(item.condition, requotedPrice, triggerThreshold);
                if (edgeBps < (item.minTradeEdgeBps || 0)) {
                  console.log(
                    `[Trade] Skip ${tradeSide.toUpperCase()} for ${item.baseToken}: edge ${edgeBps.toFixed(2)}bps < minTradeEdgeBps ${(item.minTradeEdgeBps || 0).toFixed(2)}bps`,
                  );
                  continue;
                }

                try {
                  const tradeResult = await executeTrade(config.trade, item, tradeSide);
                  if (tradeResult.success) {
                    const realizedPriceText = tradeResult.realizedPrice === undefined
                      ? '-'
                      : `$${tradeResult.realizedPrice.toFixed(6)}`;
                    console.log(
                      `[Trade] Success ${tradeSide.toUpperCase()} for ${item.baseToken}, amountIn=${tradeResult.amountIn ?? '-'}, amountOut=${tradeResult.amountOut ?? '-'}, realized=${realizedPriceText}, digest=${tradeResult.digest ?? '-'}`,
                    );
                    recordAlert(tradeCooldownKey, state);
                    saveState(STATE_FILE, state);

                    const title = `Trade Executed (${tradeSide.toUpperCase()})`;
                    const digestPart = tradeResult.digest ? `, tx: ${tradeResult.digest}` : '';
                    const realizedPart = tradeResult.realizedPrice === undefined
                      ? ''
                      : `, realized: $${tradeResult.realizedPrice.toFixed(4)}`;
                    const amountOutPart = tradeResult.amountOut ? `, amountOut: ${tradeResult.amountOut}` : '';
                    const message = `${item.baseToken} quote @ $${requotedPrice.toFixed(4)}${realizedPart}, amountIn: ${tradeResult.amountIn}${amountOutPart}${digestPart}`;
                    await sendBarkAlert(config.barkUrl, title, message);

                    const telegramMessage = [
                      `<b>Trade Executed (${tradeSide.toUpperCase()})</b>`,
                      `Pair: <code>${item.baseToken}</code> / <code>${item.quoteToken}</code>`,
                      `Quote: <code>${requotedPrice.toFixed(6)}</code>`,
                      `Realized: <code>${tradeResult.realizedPrice === undefined ? '-' : tradeResult.realizedPrice.toFixed(6)}</code>`,
                      `Threshold: <code>${triggerThreshold.toFixed(6)}</code>`,
                      `Edge: <code>${edgeBps.toFixed(2)}bps</code>`,
                      `Amount In: <code>${tradeResult.amountIn ?? '-'}</code>`,
                      `Amount Out: <code>${tradeResult.amountOut ?? '-'}</code>`,
                      `Tx: <code>${tradeResult.digest ?? '-'}</code>`,
                    ].join('\n');
                    const telegramSent = await sendTelegramMessage(config.telegram, telegramMessage);
                    if (config.telegram?.enabled) {
                      if (telegramSent) {
                        console.log(`[Telegram] Trade message sent for ${item.baseToken}`);
                      } else {
                        console.error(`[Telegram] Trade message failed for ${item.baseToken}`);
                      }
                    }
                  } else if (tradeResult.skipped) {
                    console.warn(`[Trade] Skipped ${tradeSide.toUpperCase()} for ${item.baseToken}: ${tradeResult.reason}`);
                  } else if (!tradeResult.skipped) {
                    console.error(`[Trade] Execution failed for ${item.baseToken}: ${tradeResult.reason}`);
                  }
                } catch (error: unknown) {
                  const err = error as Error;
                  console.error(`[Trade] Error executing ${tradeSide} for ${item.baseToken}: ${err.message}`);
                }
              } else {
                console.log(
                  `[Trade] Cooldown active for ${item.baseToken} (${tradeSide}), skip for ${item.tradeCooldownSeconds || 1800}s window`,
                );
              }
            }

            if (isConditionMet) {
              if (shouldAlert(item.baseToken, item.alertCooldownSeconds || 1800, state)) {
                console.log(
                  `[Alert] Triggered for ${item.baseToken} at $${price.toFixed(6)} (cooldown=${item.alertCooldownSeconds || 1800}s)`,
                );
                const title = 'Price Alert';
                const targetPrice = item.targetPrice;
                const reason = item.alertMode === 'price'
                  ? `target: ${item.condition} $${targetPrice!.toFixed(4)}`
                  : `${item.avgWindowMinutes}m avg x ${item.avgTargetPercent}%: ${item.condition} $${averageTargetPrice!.toFixed(4)}`;
                const message = `${item.baseToken} price is $${price.toFixed(4)} (${reason})`;

                const success = await sendBarkAlert(config.barkUrl, title, message);
                if (success) {
                  console.log(`[Alert] Bark notification sent for ${item.baseToken}`);
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
                  console.error(`[Alert] Bark notification failed for ${item.baseToken}`);
                }
              } else {
                console.log(
                  `[Alert] Cooldown active for ${item.baseToken}, skip for ${item.alertCooldownSeconds || 1800}s window`,
                );
              }
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
