// Backward-compatibility re-exports — consumers will be migrated to import directly from config/
export type { WatchItem, TradeConfig, TelegramConfig, Config } from './config/types.js';
export type { ResolvedConfig, ResolvedWatchItem, ResolvedTradeConfig, ResolvedTelegramConfig } from './config/resolved.js';
export { loadConfig } from './config/loader.js';
