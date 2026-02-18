import fs from 'fs';

export interface WatchItem {
  baseToken: string;
  targetPrice?: number;
  condition: 'above' | 'below';
  quoteToken?: string;
  pollInterval?: number;
  cooldownSeconds?: number;
  alertCooldownSeconds?: number;
  tradeCooldownSeconds?: number;
  avgWindowMinutes?: number;
  avgTargetPercent?: number;
  avgResumeFactor?: number;
  alertMode?: 'price' | 'avg_percent';
  tradeEnabled?: boolean;
}

export interface TradeConfig {
  enabled?: boolean;
  mnemonicFile?: string;
  derivationPath?: string;
  rpcUrl?: string;
  slippagePercent?: number;
  suiGasReserve?: number;
  maxTradePercent?: number;
}

export interface TelegramConfig {
  enabled?: boolean;
  botToken?: string;
  chatId?: string;
  messageThreadId?: number;
}

export interface Config {
  barkUrl: string;
  items: WatchItem[];
  trade?: TradeConfig;
  telegram?: TelegramConfig;
}

const DEFAULT_QUOTE_TOKEN = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const DEFAULT_POLL_INTERVAL = 30;
const DEFAULT_ALERT_COOLDOWN_SECONDS = 1800;
const DEFAULT_TRADE_COOLDOWN_SECONDS = 1800;
const DEFAULT_AVG_WINDOW_MINUTES = 10;
const DEFAULT_AVG_RESUME_FACTOR = 0.95;
const DEFAULT_TRADE_RPC_URL = 'https://fullnode.mainnet.sui.io:443';
const DEFAULT_SLIPPAGE_PERCENT = 0.1;
const DEFAULT_SUI_GAS_RESERVE = 0.02;
const DEFAULT_MAX_TRADE_PERCENT = 100;

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

  const tradeConfig = config.trade || {};
  const telegramConfig = config.telegram || {};

  if (telegramConfig.enabled !== undefined && typeof telegramConfig.enabled !== 'boolean') {
    throw new Error('telegram.enabled must be a boolean');
  }
  if (telegramConfig.messageThreadId !== undefined && (!Number.isInteger(telegramConfig.messageThreadId) || telegramConfig.messageThreadId <= 0)) {
    throw new Error('telegram.messageThreadId must be a positive integer');
  }
  if (telegramConfig.enabled && (!telegramConfig.botToken || typeof telegramConfig.botToken !== 'string')) {
    throw new Error('telegram.botToken is required when telegram.enabled is true');
  }
  if (telegramConfig.enabled && (!telegramConfig.chatId || typeof telegramConfig.chatId !== 'string')) {
    throw new Error('telegram.chatId is required when telegram.enabled is true');
  }

  if (tradeConfig.enabled !== undefined && typeof tradeConfig.enabled !== 'boolean') {
    throw new Error('trade.enabled must be a boolean');
  }
  if (tradeConfig.slippagePercent !== undefined && (typeof tradeConfig.slippagePercent !== 'number' || tradeConfig.slippagePercent <= 0 || tradeConfig.slippagePercent >= 100)) {
    throw new Error('trade.slippagePercent must be a number between 0 and 100');
  }
  if (tradeConfig.suiGasReserve !== undefined && (typeof tradeConfig.suiGasReserve !== 'number' || tradeConfig.suiGasReserve < 0)) {
    throw new Error('trade.suiGasReserve must be a non-negative number');
  }
  if (tradeConfig.maxTradePercent !== undefined && (typeof tradeConfig.maxTradePercent !== 'number' || tradeConfig.maxTradePercent <= 0 || tradeConfig.maxTradePercent > 100)) {
    throw new Error('trade.maxTradePercent must be a number between 0 and 100');
  }
  if (tradeConfig.enabled && (!tradeConfig.mnemonicFile || typeof tradeConfig.mnemonicFile !== 'string')) {
    throw new Error('trade.mnemonicFile is required when trade.enabled is true');
  }
  if (tradeConfig.enabled && !fs.existsSync(tradeConfig.mnemonicFile!)) {
    throw new Error(`trade.mnemonicFile not found: ${tradeConfig.mnemonicFile}`);
  }
  if (tradeConfig.enabled) {
    const mode = fs.statSync(tradeConfig.mnemonicFile!).mode & 0o777;
    if (mode !== 0o600) {
      throw new Error(`trade.mnemonicFile must have permission 600, current mode is ${mode.toString(8)}`);
    }
  }

  config.items = config.items.map((item, index) => {
    if (!item.baseToken) {
      throw new Error(`item[${index}].baseToken is required`);
    }
    if (!['above', 'below'].includes(item.condition)) {
      throw new Error(`item[${index}].condition must be 'above' or 'below'`);
    }
    if (item.alertMode !== undefined && !['price', 'avg_percent'].includes(item.alertMode)) {
      throw new Error(`item[${index}].alertMode must be 'price' or 'avg_percent'`);
    }
    if (item.targetPrice !== undefined && typeof item.targetPrice !== 'number') {
      throw new Error(`item[${index}].targetPrice must be a number`);
    }
    if (item.avgWindowMinutes !== undefined && (typeof item.avgWindowMinutes !== 'number' || item.avgWindowMinutes <= 0)) {
      throw new Error(`item[${index}].avgWindowMinutes must be a positive number`);
    }
    if (item.avgTargetPercent !== undefined && (typeof item.avgTargetPercent !== 'number' || item.avgTargetPercent <= 0)) {
      throw new Error(`item[${index}].avgTargetPercent must be a positive number`);
    }
    if (item.avgResumeFactor !== undefined && (typeof item.avgResumeFactor !== 'number' || item.avgResumeFactor < 0 || item.avgResumeFactor > 1)) {
      throw new Error(`item[${index}].avgResumeFactor must be a number between 0 and 1`);
    }
    if (item.cooldownSeconds !== undefined && (typeof item.cooldownSeconds !== 'number' || item.cooldownSeconds <= 0)) {
      throw new Error(`item[${index}].cooldownSeconds must be a positive number`);
    }
    if (item.alertCooldownSeconds !== undefined && (typeof item.alertCooldownSeconds !== 'number' || item.alertCooldownSeconds <= 0)) {
      throw new Error(`item[${index}].alertCooldownSeconds must be a positive number`);
    }
    if (item.tradeCooldownSeconds !== undefined && (typeof item.tradeCooldownSeconds !== 'number' || item.tradeCooldownSeconds <= 0)) {
      throw new Error(`item[${index}].tradeCooldownSeconds must be a positive number`);
    }
    const hasTargetPrice = item.targetPrice !== undefined;
    const hasAvgTargetPercent = item.avgTargetPercent !== undefined;
    if (hasTargetPrice === hasAvgTargetPercent) {
      throw new Error(`item[${index}] must set exactly one of targetPrice or avgTargetPercent`);
    }

    const inferredMode: 'price' | 'avg_percent' = hasAvgTargetPercent ? 'avg_percent' : 'price';
    if (item.alertMode !== undefined && item.alertMode !== inferredMode) {
      throw new Error(`item[${index}].alertMode does not match configured target field`);
    }

    return {
      ...item,
      quoteToken: item.quoteToken || DEFAULT_QUOTE_TOKEN,
      pollInterval: item.pollInterval || DEFAULT_POLL_INTERVAL,
      alertCooldownSeconds: item.alertCooldownSeconds || item.cooldownSeconds || DEFAULT_ALERT_COOLDOWN_SECONDS,
      tradeCooldownSeconds: item.tradeCooldownSeconds || item.cooldownSeconds || DEFAULT_TRADE_COOLDOWN_SECONDS,
      alertMode: inferredMode,
      tradeEnabled: item.tradeEnabled !== false,
      avgWindowMinutes: inferredMode === 'avg_percent'
        ? (item.avgWindowMinutes || DEFAULT_AVG_WINDOW_MINUTES)
        : undefined,
      avgResumeFactor: inferredMode === 'avg_percent'
        ? (item.avgResumeFactor ?? DEFAULT_AVG_RESUME_FACTOR)
        : undefined,
    };
  });

  config.trade = {
    ...tradeConfig,
    enabled: tradeConfig.enabled === true,
    rpcUrl: tradeConfig.rpcUrl || DEFAULT_TRADE_RPC_URL,
    slippagePercent: tradeConfig.slippagePercent || DEFAULT_SLIPPAGE_PERCENT,
    suiGasReserve: tradeConfig.suiGasReserve ?? DEFAULT_SUI_GAS_RESERVE,
    maxTradePercent: tradeConfig.maxTradePercent || DEFAULT_MAX_TRADE_PERCENT,
    derivationPath: tradeConfig.derivationPath || "m/44'/784'/0'/0'/0'",
  };

  config.telegram = {
    ...telegramConfig,
    enabled: telegramConfig.enabled === true,
  };

  return config;
}
