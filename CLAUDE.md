# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# First-time setup
cp config.example.json config.json   # Required before running

# Build
npm run build                        # Compile TypeScript to dist/

# Test
npm test                             # Node.js test runner with ts-node loader

# Run
npm start                            # Run with ts-node (requires config.json)
LOG_PRETTY=true npm start            # Human-readable logs
LOG_LEVEL=debug npm start            # Debug verbosity

# Docker
docker-compose up --build
docker-compose up -d
```

## Architecture

**Cetus Peg Watcher** monitors Sui token prices via the Cetus DEX Aggregator API, sends Telegram alerts when prices breach thresholds, and optionally executes automated trades on Sui.

### Data Flow

```
config.json
  → loadConfig()                     # src/config/ — validate + resolve all fields
    → startWatcher(config)           # src/engine/orchestrator.ts
      → CooldownManager.load()       # src/cooldown/ — load + migrate state.json
      → [Per group: WatchGroupRunner.tick()]   # src/engine/runner.ts
        → getTokenPrice()            # src/pricing/ — PriceOracle, keep-alive, dedup
        → evaluateWatchRule()        # Price vs threshold or rolling avg
        → processAlertActions()      # Build message + send Telegram + trade
          → executeTrade()           # Sui SDK → sign tx → SuiClient status poll
        → cooldown.recordAlert()     # Debounced write to state.json (500ms)
```

### Key Modules

| File | Responsibility |
|------|----------------|
| `config/types.ts` | Raw input types (all optional) from `config.json` |
| `config/resolved.ts` | Resolved types (all required) after validation |
| `config/loader.ts` | `loadConfig()` — validate, resolve defaults, return `ResolvedConfig` |
| `config.ts` | Backward-compat re-exports from `config/` |
| `pricing/oracle.ts` | `PriceOracle` class — instance-level cache, HTTP keep-alive, forceRefresh fix |
| `cetus.ts` | Backward-compat shim wrapping a singleton `PriceOracle` |
| `trading/types.ts` | `TradeSide`, `TradeStatus`, `TradeExecutionResult` types |
| `trading/context.ts` | `TraderContext` + `getTraderContext()` factory (cached per config key) |
| `cooldown/manager.ts` | `CooldownManager` — in-memory cooldown state + debounced persist (500ms) |
| `engine/orchestrator.ts` | `startWatcher()` — group items, create runners, set up intervals |
| `engine/runner.ts` | `WatchGroupRunner` — per-group state, tick loop, alert dispatch |
| `watcher.ts` | Backward-compat re-export shim → `engine/orchestrator.ts` |
| `watcher-rules.ts` | Alert condition evaluation, fast-track logic |
| `watcher-actions.ts` | `processAlertActions()` — reprice, trade execution, message building |
| `watcher-logic.ts` | State key helpers, pause rule evaluation, serialized poll runner |
| `trader.ts` | Trade execution: route finding, tx signing, SuiClient status polling |
| `state.ts` | File I/O helpers for `state.json` (used by `CooldownManager`) |
| `telegram.ts` | Telegram Bot API notifications with 429/5xx retry |
| `formatters.ts` | Number/amount formatting, price calculations |
| `logger.ts` | Pino structured logging |

### Alert Modes

- **`price`**: Compare current price to a fixed `targetPrice`
- **`avg_percent`**: Compare current price to a rolling average × `avgTargetPercent / 100` over `avgWindowMinutes`

### Trade Execution

1. Wait for `tradeConfirmations` consecutive hits (default: 2)
2. Determine direction: price below threshold → buy, above → sell
3. Size position: `walletBalance × maxTradePercent / 100`
4. Route via Cetus Aggregator SDK, apply slippage tolerance
5. Sign and broadcast Sui transaction, poll for finality
6. Notify via Telegram

**Fast-track mode**: When price overshoots by `fastTrackExtraPercent` (default 1.5%), skip confirmations, use `fastTrackTradePercent` of balance, and apply dynamic slippage scaling.

### State Keys (in `state.json`)

- Alert cooldown: `rule::{item.id}`
- Trade cooldown: `{baseToken}::{quoteToken}::{side}::trade`
- Ops error cooldown: `rule::{item.id}::ops::{issueType}` (default 3600s)

### Alert Levels

- **signal**: Price alerts, trade submissions/results — sent to Telegram
- **ops**: Config errors, balance issues, exceptions — sent to Telegram
- **silent**: Polling, cooldowns, pause/resume — logs only

## Conventions

- **ESM**: Project is `"type": "module"`. Import paths must use `.js` extensions even when importing `.ts` files.
- **Config file only**: Runtime config lives in `config.json`, not environment variables. `LOG_LEVEL` and `LOG_PRETTY` are the only env overrides.
- **Strict TypeScript**: `"strict": true` in tsconfig.
- **state.json**: Auto-generated at runtime; never mount as a Docker volume (causes EISDIR).
- **No linter configured**: No ESLint or Prettier in this project.

## Logging

Default output is structured JSON (Pino). To filter:

```bash
npm start 2>&1 | jq -c 'select(.level >= 50)'   # errors only
```

Key log fields: `time`, `level` (numeric), `levelName`, `module`, `event`, `msg`, `err`.
