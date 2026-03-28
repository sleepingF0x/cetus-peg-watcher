import fs from 'fs';
import path from 'path';
import { parse as parseToml } from 'smol-toml';
import type { Config, WatchItem, TradeConfig, TelegramConfig } from './types.js';
import type { ResolvedConfig, ResolvedWatchItem, ResolvedTradeConfig, ResolvedTelegramConfig } from './resolved.js';

const DEFAULT_QUOTE_TOKEN = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const DEFAULT_POLL_INTERVAL = 30;
const DEFAULT_ALERT_COOLDOWN_SECONDS = 1800;
const DEFAULT_TRADE_COOLDOWN_SECONDS = 1800;
const DEFAULT_TRADE_CONFIRMATIONS = 2;
const DEFAULT_AVG_WINDOW_MINUTES = 10;
const DEFAULT_AVG_RESUME_FACTOR = 0.95;
const DEFAULT_TRADE_RPC_URL = 'https://fullnode.mainnet.sui.io:443';
const DEFAULT_SLIPPAGE_PERCENT = 0.1;
const DEFAULT_SUI_GAS_RESERVE = 0.02;
const DEFAULT_MAX_TRADE_PERCENT = 100;
const DEFAULT_FAST_TRACK_ENABLED = true;
const DEFAULT_FAST_TRACK_EXTRA_PERCENT = 1.5;
const DEFAULT_FAST_TRACK_TRADE_PERCENT = 75;
const DEFAULT_FAST_TRACK_SLIPPAGE_MULTIPLIER = 0.35;
const DEFAULT_FAST_TRACK_MAX_SLIPPAGE_PERCENT = 2;
const DEFAULT_STATUS_POLL_DELAY_MS = 1500;
const DEFAULT_STATUS_POLL_INTERVAL_MS = 1500;
const DEFAULT_STATUS_POLL_TIMEOUT_MS = 15000;

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}

function validateTelegram(cfg: TelegramConfig): void {
  if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean') {
    throw new Error('telegram.enabled must be a boolean');
  }
  if (cfg.messageThreadId !== undefined && (!Number.isInteger(cfg.messageThreadId) || cfg.messageThreadId <= 0)) {
    throw new Error('telegram.messageThreadId must be a positive integer');
  }
  if (cfg.enabled && (!cfg.botToken || typeof cfg.botToken !== 'string')) {
    throw new Error('telegram.botToken is required when telegram.enabled is true');
  }
  if (cfg.enabled && (!cfg.chatId || typeof cfg.chatId !== 'string')) {
    throw new Error('telegram.chatId is required when telegram.enabled is true');
  }
}

function validateTrade(cfg: TradeConfig): void {
  if (cfg.enabled !== undefined && typeof cfg.enabled !== 'boolean') {
    throw new Error('trade.enabled must be a boolean');
  }
  if (cfg.slippagePercent !== undefined && (typeof cfg.slippagePercent !== 'number' || cfg.slippagePercent <= 0 || cfg.slippagePercent >= 100)) {
    throw new Error('trade.slippagePercent must be a number between 0 and 100');
  }
  if (cfg.suiGasReserve !== undefined && (typeof cfg.suiGasReserve !== 'number' || cfg.suiGasReserve < 0)) {
    throw new Error('trade.suiGasReserve must be a non-negative number');
  }
  if (cfg.maxTradePercent !== undefined && (typeof cfg.maxTradePercent !== 'number' || cfg.maxTradePercent <= 0 || cfg.maxTradePercent > 100)) {
    throw new Error('trade.maxTradePercent must be a number between 0 and 100');
  }
  if (cfg.fastTrackEnabled !== undefined && typeof cfg.fastTrackEnabled !== 'boolean') {
    throw new Error('trade.fastTrackEnabled must be a boolean');
  }
  if (cfg.fastTrackExtraPercent !== undefined && (typeof cfg.fastTrackExtraPercent !== 'number' || cfg.fastTrackExtraPercent <= 0 || cfg.fastTrackExtraPercent >= 100)) {
    throw new Error('trade.fastTrackExtraPercent must be a number between 0 and 100');
  }
  if (cfg.fastTrackTradePercent !== undefined && (typeof cfg.fastTrackTradePercent !== 'number' || cfg.fastTrackTradePercent <= 0 || cfg.fastTrackTradePercent > 100)) {
    throw new Error('trade.fastTrackTradePercent must be a number between 0 and 100');
  }
  if (cfg.fastTrackSlippageMultiplier !== undefined && (typeof cfg.fastTrackSlippageMultiplier !== 'number' || cfg.fastTrackSlippageMultiplier < 0)) {
    throw new Error('trade.fastTrackSlippageMultiplier must be a non-negative number');
  }
  if (cfg.fastTrackMaxSlippagePercent !== undefined && (typeof cfg.fastTrackMaxSlippagePercent !== 'number' || cfg.fastTrackMaxSlippagePercent <= 0 || cfg.fastTrackMaxSlippagePercent >= 100)) {
    throw new Error('trade.fastTrackMaxSlippagePercent must be a number between 0 and 100');
  }
  if (cfg.statusPollDelayMs !== undefined && !isPositiveInteger(cfg.statusPollDelayMs)) {
    throw new Error('trade.statusPollDelayMs must be a positive integer');
  }
  if (cfg.statusPollIntervalMs !== undefined && !isPositiveInteger(cfg.statusPollIntervalMs)) {
    throw new Error('trade.statusPollIntervalMs must be a positive integer');
  }
  if (cfg.statusPollTimeoutMs !== undefined && !isPositiveInteger(cfg.statusPollTimeoutMs)) {
    throw new Error('trade.statusPollTimeoutMs must be a positive integer');
  }
  if (cfg.enabled && (!cfg.mnemonicFile || typeof cfg.mnemonicFile !== 'string')) {
    throw new Error('trade.mnemonicFile is required when trade.enabled is true');
  }
  if (cfg.enabled && !fs.existsSync(cfg.mnemonicFile!)) {
    throw new Error(`trade.mnemonicFile not found: ${cfg.mnemonicFile}`);
  }
  if (cfg.enabled) {
    const mode = fs.statSync(cfg.mnemonicFile!).mode & 0o777;
    if (mode !== 0o600) {
      throw new Error(`trade.mnemonicFile must have permission 600, current mode is ${mode.toString(8)}`);
    }
  }
}

function resolveItem(item: WatchItem, index: number): ResolvedWatchItem {
  if (!item.id || typeof item.id !== 'string') {
    throw new Error(`item[${index}].id is required`);
  }
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
  if (item.priceQueryMinBaseAmount !== undefined && (typeof item.priceQueryMinBaseAmount !== 'number' || item.priceQueryMinBaseAmount <= 0)) {
    throw new Error(`item[${index}].priceQueryMinBaseAmount must be a positive number`);
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
  if (item.tradeConfirmations !== undefined && (!Number.isInteger(item.tradeConfirmations) || item.tradeConfirmations <= 0)) {
    throw new Error(`item[${index}].tradeConfirmations must be a positive integer`);
  }

  const hasTargetPrice = item.targetPrice !== undefined;
  const hasAvgTargetPercent = item.avgTargetPercent !== undefined;
  if (hasTargetPrice === hasAvgTargetPercent) {
    throw new Error(`item[${index}] must set exactly one of targetPrice or avgTargetPercent`);
  }

  const alertMode: 'price' | 'avg_percent' = hasAvgTargetPercent ? 'avg_percent' : 'price';
  if (item.alertMode !== undefined && item.alertMode !== alertMode) {
    throw new Error(`item[${index}].alertMode does not match configured target field`);
  }

  return {
    id: item.id,
    baseToken: item.baseToken,
    quoteToken: item.quoteToken || DEFAULT_QUOTE_TOKEN,
    condition: item.condition,
    alertMode,
    pollInterval: item.pollInterval || DEFAULT_POLL_INTERVAL,
    alertCooldownSeconds: item.alertCooldownSeconds || item.cooldownSeconds || DEFAULT_ALERT_COOLDOWN_SECONDS,
    tradeCooldownSeconds: item.tradeCooldownSeconds || item.cooldownSeconds || DEFAULT_TRADE_COOLDOWN_SECONDS,
    tradeConfirmations: item.tradeConfirmations ?? DEFAULT_TRADE_CONFIRMATIONS,
    priceQueryMinBaseAmount: item.priceQueryMinBaseAmount ?? 1,
    tradeEnabled: item.tradeEnabled !== false,
    targetPrice: alertMode === 'price' ? item.targetPrice : undefined,
    avgTargetPercent: alertMode === 'avg_percent' ? item.avgTargetPercent : undefined,
    avgWindowMinutes: alertMode === 'avg_percent' ? (item.avgWindowMinutes || DEFAULT_AVG_WINDOW_MINUTES) : undefined,
    avgResumeFactor: alertMode === 'avg_percent' ? (item.avgResumeFactor ?? DEFAULT_AVG_RESUME_FACTOR) : undefined,
  };
}

function resolveTrade(cfg: TradeConfig): ResolvedTradeConfig {
  return {
    enabled: cfg.enabled === true,
    mnemonicFile: cfg.mnemonicFile || '',
    derivationPath: cfg.derivationPath || "m/44'/784'/0'/0'/0'",
    rpcUrl: cfg.rpcUrl || DEFAULT_TRADE_RPC_URL,
    slippagePercent: cfg.slippagePercent || DEFAULT_SLIPPAGE_PERCENT,
    suiGasReserve: cfg.suiGasReserve ?? DEFAULT_SUI_GAS_RESERVE,
    maxTradePercent: cfg.maxTradePercent || DEFAULT_MAX_TRADE_PERCENT,
    fastTrackEnabled: cfg.fastTrackEnabled ?? DEFAULT_FAST_TRACK_ENABLED,
    fastTrackExtraPercent: cfg.fastTrackExtraPercent ?? DEFAULT_FAST_TRACK_EXTRA_PERCENT,
    fastTrackTradePercent: cfg.fastTrackTradePercent ?? DEFAULT_FAST_TRACK_TRADE_PERCENT,
    fastTrackSlippageMultiplier: cfg.fastTrackSlippageMultiplier ?? DEFAULT_FAST_TRACK_SLIPPAGE_MULTIPLIER,
    fastTrackMaxSlippagePercent: cfg.fastTrackMaxSlippagePercent ?? DEFAULT_FAST_TRACK_MAX_SLIPPAGE_PERCENT,
    statusPollDelayMs: cfg.statusPollDelayMs ?? DEFAULT_STATUS_POLL_DELAY_MS,
    statusPollIntervalMs: cfg.statusPollIntervalMs ?? DEFAULT_STATUS_POLL_INTERVAL_MS,
    statusPollTimeoutMs: cfg.statusPollTimeoutMs ?? DEFAULT_STATUS_POLL_TIMEOUT_MS,
  };
}

function resolveTelegram(cfg: TelegramConfig): ResolvedTelegramConfig {
  return {
    enabled: cfg.enabled === true,
    botToken: cfg.botToken,
    chatId: cfg.chatId,
    messageThreadId: cfg.messageThreadId,
  };
}

export function loadConfig(filePath: string): ResolvedConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }

  const rawData = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  const raw = (ext === '.toml' ? parseToml(rawData) : JSON.parse(rawData)) as Config;

  if (!raw.items || !Array.isArray(raw.items) || raw.items.length === 0) {
    throw new Error('items array is required and must not be empty');
  }

  const tradeConfig = raw.trade || {};
  const telegramConfig = raw.telegram || {};

  validateTelegram(telegramConfig);
  validateTrade(tradeConfig);

  const items = raw.items.map(resolveItem);

  const itemIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.id)) {
      throw new Error(`item ids must be unique: ${item.id}`);
    }
    itemIds.add(item.id);
  }

  return {
    items,
    trade: resolveTrade(tradeConfig),
    telegram: resolveTelegram(telegramConfig),
  };
}
