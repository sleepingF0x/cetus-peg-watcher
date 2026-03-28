import fs from 'fs';
import { loadConfig } from './config.js';
import type { CooldownManager } from './cooldown/manager.js';
import { startWatcher } from './engine/orchestrator.js';
import { createModuleLogger, toLogError } from './logger.js';

const CONFIG_FILE = fs.existsSync('config.toml') ? 'config.toml' : 'config.json';
const log = createModuleLogger('Index');

let cooldown: CooldownManager | null = null;

function shutdown(signal: string): void {
  log.info({ event: 'shutdown_signal', signal }, 'Shutting down gracefully');
  cooldown?.flush();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  log.info({ event: 'service_starting' }, 'Starting Cetus Peg Watcher');

  try {
    const config = loadConfig(CONFIG_FILE);
    log.info({ event: 'config_loaded', watchItemCount: config.items.length }, 'Loaded watch items');
    log.info({ event: 'watcher_starting' }, 'Starting price monitoring');

    cooldown = await startWatcher(config);
  } catch (error: unknown) {
    log.fatal({ event: 'service_start_failed', err: toLogError(error) }, 'Failed to start watcher');
    process.exit(1);
  }
}

main();
