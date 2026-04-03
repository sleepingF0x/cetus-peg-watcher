// Raw input types — all fields optional as they appear in config.json
export interface WatchItem {
  id: string;
  baseToken: string;
  targetPrice?: number;
  condition: 'above' | 'below';
  quoteToken?: string;
  priceQueryMinBaseAmount?: number;
  pollInterval?: number;
  cooldownSeconds?: number;
  alertCooldownSeconds?: number;
  tradeCooldownSeconds?: number;
  tradeConfirmations?: number;
  avgWindowMinutes?: number;
  avgTargetPercent?: number;
  avgResumeFactor?: number;
  alertMode?: 'price' | 'avg_percent';
  tradeEnabled?: boolean;
  maxSpreadPercent?: number;
}

export interface TradeConfig {
  enabled?: boolean;
  mnemonicFile?: string;
  derivationPath?: string;
  rpcUrl?: string;
  slippagePercent?: number;
  suiGasReserve?: number;
  maxTradePercent?: number;
  fastTrackEnabled?: boolean;
  fastTrackExtraPercent?: number;
  fastTrackTradePercent?: number;
  fastTrackSlippageMultiplier?: number;
  fastTrackMaxSlippagePercent?: number;
  statusPollDelayMs?: number;
  statusPollIntervalMs?: number;
  statusPollTimeoutMs?: number;
}

export interface TelegramConfig {
  enabled?: boolean;
  botToken?: string;
  chatId?: string;
  messageThreadId?: number;
}

export interface Config {
  items: WatchItem[];
  trade?: TradeConfig;
  telegram?: TelegramConfig;
}
