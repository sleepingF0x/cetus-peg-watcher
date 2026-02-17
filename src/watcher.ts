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

export async function startWatcher(config: Config) {
  const state = loadState(STATE_FILE);
  const priceHistory = new Map<string, PricePoint[]>();
  const averagePauseRules = new Map<string, AveragePauseRule>();

  for (const item of config.items) {
    const pollIntervalMs = (item.pollInterval || 30) * 1000;
    const priceKey = `${item.baseToken}::${item.quoteToken}`;
    const averageWindowMs = (item.avgWindowMinutes || 10) * 60 * 1000;

    const check = async () => {
      try {
        const price = await getTokenPrice(item.baseToken, item.quoteToken!);
        
        if (price !== null) {
          const now = Date.now();
          const history = priceHistory.get(priceKey) ?? [];
          const pauseRule = averagePauseRules.get(priceKey);

          if (pauseRule) {
            const shouldResume = pauseRule.condition === 'above'
              ? price <= pauseRule.resumePrice
              : price >= pauseRule.resumePrice;

            if (shouldResume) {
              averagePauseRules.delete(priceKey);
            }
          }

          const isAverageSamplingPaused = averagePauseRules.has(priceKey);
          pruneOldPrices(history, now, averageWindowMs);
          const avgWindowPrice = calculateAveragePrice(history);

          const avgWindowText = avgWindowPrice === null
            ? 'N/A'
            : `$${avgWindowPrice.toFixed(6)}`;
          console.log(
            `[Monitor] ${item.baseToken} | quote: ${item.quoteToken} | current: $${price.toFixed(6)} | avg(${item.avgWindowMinutes || 10}m): ${avgWindowText} | samples: ${history.length}`,
          );

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
            const tradeCooldownKey = `${item.baseToken}::${item.quoteToken}::${tradeSide}::trade`;

            if (shouldAlert(tradeCooldownKey, item.tradeCooldownSeconds || 1800, state)) {
              console.log(
                `[Trade] Triggered ${tradeSide.toUpperCase()} for ${item.baseToken} at $${price.toFixed(6)} (cooldown=${item.tradeCooldownSeconds || 1800}s)`,
              );
              try {
                const tradeResult = await executeTrade(config.trade, item, tradeSide);
                if (tradeResult.success) {
                  console.log(
                    `[Trade] Success ${tradeSide.toUpperCase()} for ${item.baseToken}, amountIn=${tradeResult.amountIn ?? '-'}, digest=${tradeResult.digest ?? '-'}`,
                  );
                  recordAlert(tradeCooldownKey, state);
                  saveState(STATE_FILE, state);

                  const title = `Trade Executed (${tradeSide.toUpperCase()})`;
                  const digestPart = tradeResult.digest ? `, tx: ${tradeResult.digest}` : '';
                  const message = `${item.baseToken} @ $${price.toFixed(4)}, amountIn: ${tradeResult.amountIn}${digestPart}`;
                  await sendBarkAlert(config.barkUrl, title, message);

                  const telegramMessage = [
                    `<b>Trade Executed (${tradeSide.toUpperCase()})</b>`,
                    `Pair: <code>${item.baseToken}</code> / <code>${item.quoteToken}</code>`,
                    `Price: <code>${price.toFixed(6)}</code>`,
                    `Amount In: <code>${tradeResult.amountIn ?? '-'}</code>`,
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

                  averagePauseRules.set(priceKey, {
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

          if (!isAverageSamplingPaused) {
            history.push({ timestamp: now, price });
          }
          priceHistory.set(priceKey, history);
        } else {
          console.error(`[Watcher] Failed to fetch price for ${item.baseToken}`);
        }
      } catch (error: any) {
        console.error(`[Watcher] Error in polling loop for ${item.baseToken}: ${error.message}`);
      }
    };

    check();
    setInterval(check, pollIntervalMs);
  }
}
