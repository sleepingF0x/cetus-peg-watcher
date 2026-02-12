import fs from 'fs';

export interface WatchItem {
  baseToken: string;
  targetPrice: number;
  condition: 'above' | 'below';
  quoteToken?: string;
  pollInterval?: number;
  cooldownMinutes?: number;
}

export interface Config {
  barkUrl: string;
  items: WatchItem[];
}

const DEFAULT_QUOTE_TOKEN = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const DEFAULT_POLL_INTERVAL = 30;
const DEFAULT_COOLDOWN_MINUTES = 30;

export function loadConfig(filePath: string): Config {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  const rawData = fs.readFileSync(filePath, 'utf-8');
  const config = JSON.parse(rawData) as Config;

  if (!config.barkUrl) {
    throw new Error('barkUrl is required in config');
  }

  if (!config.items || !Array.isArray(config.items) || config.items.length === 0) {
    throw new Error('items array is required and must not be empty');
  }

  config.items = config.items.map((item, index) => {
    if (!item.baseToken) {
      throw new Error(`item[${index}].baseToken is required`);
    }
    if (item.targetPrice === undefined || typeof item.targetPrice !== 'number') {
      throw new Error(`item[${index}].targetPrice is required and must be a number`);
    }
    if (!['above', 'below'].includes(item.condition)) {
      throw new Error(`item[${index}].condition must be 'above' or 'below'`);
    }

    return {
      ...item,
      quoteToken: item.quoteToken || DEFAULT_QUOTE_TOKEN,
      pollInterval: item.pollInterval || DEFAULT_POLL_INTERVAL,
      cooldownMinutes: item.cooldownMinutes || DEFAULT_COOLDOWN_MINUTES,
    };
  });

  return config;
}
