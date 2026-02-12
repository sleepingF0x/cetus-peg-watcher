import { loadConfig } from './config.js';
import { startWatcher } from './watcher.js';

const CONFIG_FILE = 'config.json';

async function main() {
  console.log('🚀 Starting Cetus Peg Watcher...');
  console.log('Press Ctrl+C to stop\n');

  try {
    const config = loadConfig(CONFIG_FILE);
    console.log(`✅ Loaded ${config.items.length} watch item(s)`);
    console.log('Starting price monitoring...\n');

    await startWatcher(config);
  } catch (error: any) {
    console.error('❌ Failed to start watcher:', error.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down gracefully...');
  process.exit(0);
});

main();
