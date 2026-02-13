import { Config } from './config.js';
import { getTokenPrice } from './cetus.js';
import { loadState, saveState, shouldAlert, recordAlert } from './state.js';
import { sendBarkAlert } from './notifier.js';

const STATE_FILE = 'state.json';

export async function startWatcher(config: Config) {
  const state = loadState(STATE_FILE);

  for (const item of config.items) {
    const pollIntervalMs = (item.pollInterval || 30) * 1000;

    const check = async () => {
      try {
        const price = await getTokenPrice(item.baseToken, item.quoteToken!);
        
        if (price !== null) {
          console.log(`Monitoring ${item.baseToken}: Current price $${price.toFixed(4)}`);

          const isConditionMet = 
            (item.condition === 'above' && price >= item.targetPrice) ||
            (item.condition === 'below' && price <= item.targetPrice);

          if (isConditionMet) {
            if (shouldAlert(item.baseToken, item.cooldownMinutes || 30, state)) {
              const title = 'Price Alert';
              const message = `${item.baseToken} price is $${price.toFixed(4)} (target: ${item.condition} $${item.targetPrice.toFixed(4)})`;
              
              const success = await sendBarkAlert(config.barkUrl, title, message);
              if (success) {
                recordAlert(item.baseToken, state);
                saveState(STATE_FILE, state);
              }
            }
          }
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
