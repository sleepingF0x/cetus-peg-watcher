import { loadConfig } from './config.js';
import { startWatcher } from './watcher.js';
import { createModuleLogger, toLogError } from './logger.js';

const CONFIG_FILE = 'config.json';
const log = createModuleLogger('Index');

async function main() {
  log.info({ event: 'service_starting' }, 'Starting Cetus Peg Watcher');

  try {
    const config = loadConfig(CONFIG_FILE);
    log.info({ event: 'config_loaded', watchItemCount: config.items.length }, 'Loaded watch items');
    log.info({ event: 'watcher_starting' }, 'Starting price monitoring');

    await startWatcher(config);
  } catch (error: unknown) {
    log.fatal({ event: 'service_start_failed', err: toLogError(error) }, 'Failed to start watcher');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  log.info({ event: 'shutdown_signal', signal: 'SIGINT' }, 'Shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  log.info({ event: 'shutdown_signal', signal: 'SIGTERM' }, 'Shutting down gracefully');
  process.exit(0);
});

main();
