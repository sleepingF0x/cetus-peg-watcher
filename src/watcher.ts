import { Config } from './config.js';
import { getTokenPrice } from './cetus.js';
import { loadState, saveState, shouldAlert, recordAlert } from './state.js';
import { sendBarkAlert } from './notifier.js';
import { executeTrade } from './trader.js';

const STATE_FILE = 'state.json';

interface PricePoint {
  timestamp: number;
  price: number;
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
          pruneOldPrices(history, now, averageWindowMs);
          const avgWindowPrice = calculateAveragePrice(history);

          console.log(`Monitoring ${item.baseToken}: Current price $${price.toFixed(4)}`);

          const isTargetConditionMet = item.alertMode === 'price' && (
            (item.condition === 'above' && price >= item.targetPrice!) ||
            (item.condition === 'below' && price <= item.targetPrice!)
          );

          const averageTargetPrice = avgWindowPrice === null
            ? null
            : avgWindowPrice * ((item.avgTargetPercent || 100) / 100);

          const referencePrice = item.alertMode === 'price' ? item.targetPrice! : averageTargetPrice;

          const isAverageConditionMet = item.alertMode === 'avg_percent' && averageTargetPrice !== null && (
            (item.condition === 'above' && price >= averageTargetPrice) ||
            (item.condition === 'below' && price <= averageTargetPrice)
          );

          const isConditionMet = item.alertMode === 'price'
            ? isTargetConditionMet
            : isAverageConditionMet;

          const tradeSide = referencePrice === null
            ? null
            : (price < referencePrice ? 'buy' : (price > referencePrice ? 'sell' : null));

          if (config.trade?.enabled && item.tradeEnabled && tradeSide !== null) {
            const tradeCooldownKey = `${item.baseToken}::${item.quoteToken}::${tradeSide}::trade`;

            if (shouldAlert(tradeCooldownKey, item.cooldownSeconds || 1800, state)) {
              try {
                const tradeResult = await executeTrade(config.trade, item, tradeSide);
                if (tradeResult.success) {
                  recordAlert(tradeCooldownKey, state);
                  saveState(STATE_FILE, state);

                  const title = `Trade Executed (${tradeSide.toUpperCase()})`;
                  const digestPart = tradeResult.digest ? `, tx: ${tradeResult.digest}` : '';
                  const message = `${item.baseToken} @ $${price.toFixed(4)}, amountIn: ${tradeResult.amountIn}${digestPart}`;
                  await sendBarkAlert(config.barkUrl, title, message);
                } else if (!tradeResult.skipped) {
                  console.error(`[Trade] Execution failed for ${item.baseToken}: ${tradeResult.reason}`);
                }
              } catch (error: unknown) {
                const err = error as Error;
                console.error(`[Trade] Error executing ${tradeSide} for ${item.baseToken}: ${err.message}`);
              }
            }
          }

          if (isConditionMet) {
            if (shouldAlert(item.baseToken, item.cooldownSeconds || 1800, state)) {
              const title = 'Price Alert';
              const targetPrice = item.targetPrice;
              const reason = item.alertMode === 'price'
                ? `target: ${item.condition} $${targetPrice!.toFixed(4)}`
                : `${item.avgWindowMinutes}m avg x ${item.avgTargetPercent}%: ${item.condition} $${averageTargetPrice!.toFixed(4)}`;
              const message = `${item.baseToken} price is $${price.toFixed(4)} (${reason})`;
              
              const success = await sendBarkAlert(config.barkUrl, title, message);
              if (success) {
                recordAlert(item.baseToken, state);
                saveState(STATE_FILE, state);
              }
            }
          }

          history.push({ timestamp: now, price });
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
