// Resolved types — all fields required after loadConfig() validation and normalization
export interface ResolvedWatchItem {
  id: string;
  baseToken: string;
  quoteToken: string;
  condition: 'above' | 'below';
  alertMode: 'price' | 'avg_percent';
  pollInterval: number;
  alertCooldownSeconds: number;
  tradeCooldownSeconds: number;
  tradeConfirmations: number;
  priceQueryMinBaseAmount: number;
  tradeEnabled: boolean;
  maxSpreadPercent: number | null;
  // price mode only
  targetPrice?: number;
  // avg_percent mode only
  avgTargetPercent?: number;
  avgWindowMinutes?: number;
  avgResumeFactor?: number;
}

export interface ResolvedTradeConfig {
  enabled: boolean;
  mnemonicFile: string;
  derivationPath: string;
  rpcUrl: string;
  slippagePercent: number;
  suiGasReserve: number;
  maxTradePercent: number;
  fastTrackEnabled: boolean;
  fastTrackExtraPercent: number;
  fastTrackTradePercent: number;
  fastTrackSlippageMultiplier: number;
  fastTrackMaxSlippagePercent: number;
  statusPollDelayMs: number;
  statusPollIntervalMs: number;
  statusPollTimeoutMs: number;
}

export interface ResolvedTelegramConfig {
  enabled: boolean;
  botToken?: string;
  chatId?: string;
  messageThreadId?: number;
}

export interface ResolvedConfig {
  items: ResolvedWatchItem[];
  trade: ResolvedTradeConfig;
  telegram: ResolvedTelegramConfig;
}
