# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-15
**Commit:** 8397026
**Branch:** main

## OVERVIEW

Sui blockchain token price monitor. Polls Cetus DEX Aggregator API, sends Bark (iOS push) alerts when price thresholds breach. TypeScript, Node.js, Docker.

## STRUCTURE

```
./
├── src/           # All source (6 files, flat)
│   ├── index.ts   # Entry point, SIGINT/SIGTERM handling
│   ├── config.ts  # Config types + JSON loader with validation
│   ├── watcher.ts # Poll loop orchestrator (setInterval per item)
│   ├── cetus.ts   # Cetus Aggregator API client + SUI RPC decimals lookup
│   ├── notifier.ts# Bark push notification sender
│   └── state.ts   # Alert cooldown state (JSON file persistence)
├── config.json    # Runtime config (gitignored, must create from example)
├── state.json     # Alert timestamps (gitignored, auto-created)
└── Dockerfile     # Multi-stage: builder (tsc) → runtime (node:20-alpine)
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new token/pair | `config.json` | Copy pattern from `config.example.json` |
| Change price source | `src/cetus.ts` | `getTokenPrice()` — Cetus Aggregator API |
| Change notification channel | `src/notifier.ts` | Currently Bark only (`?call=1&level=critical`) |
| Change alert logic | `src/watcher.ts` | `isConditionMet` — simple above/below check |
| Change cooldown behavior | `src/state.ts` | `shouldAlert()` — timestamp-based cooldown |
| Add new config fields | `src/config.ts` | Update `WatchItem` interface + `loadConfig()` validation |

## DATA FLOW

```
config.json → loadConfig() → startWatcher() → [setInterval per item]
  → getTokenPrice(base, quote)       # Cetus Aggregator API
    → getDecimals(coinType)           # SUI RPC (cached in-memory)
  → shouldAlert(token, cooldown)     # Check state.json timestamps
  → sendBarkAlert(url, title, msg)   # HTTP GET to Bark API
  → recordAlert() + saveState()      # Persist to state.json
```

## CODE MAP

| Symbol | Type | File | Role |
|--------|------|------|------|
| `loadConfig` | fn | config.ts | Parse + validate `config.json`, apply defaults |
| `Config` | interface | config.ts | `{ barkUrl, items: WatchItem[] }` |
| `WatchItem` | interface | config.ts | `{ baseToken, targetPrice, condition, quoteToken?, pollInterval?, cooldownMinutes? }` |
| `startWatcher` | fn | watcher.ts | Starts one `setInterval` per watch item |
| `getTokenPrice` | fn | cetus.ts | Cetus API call with 3 retries + exponential backoff |
| `getDecimals` | fn | cetus.ts | SUI RPC `suix_getCoinMetadata`, results cached in `decimalsCache` |
| `sendBarkAlert` | fn | notifier.ts | GET request to Bark URL with encoded title/message |
| `loadState` / `saveState` | fn | state.ts | JSON file read/write for `AlertState` |
| `shouldAlert` | fn | state.ts | Cooldown check: `now - lastAlertTime >= cooldownMs` |
| `recordAlert` | fn | state.ts | Updates in-memory state (caller must `saveState`) |

## CONVENTIONS

- **ESM everywhere**: `"type": "module"` in package.json, `.js` extensions in imports (even for `.ts` files)
- **Strict TypeScript**: `"strict": true` in tsconfig
- **No linter/formatter**: No ESLint, Prettier, or EditorConfig configured
- **No tests**: `npm test` is a placeholder that exits 1
- **Minimal app deps**: Business logic depends on `axios`; TypeScript toolchain is in dependencies
- **No CI**: No `.github/workflows` present
- **Config pattern**: JSON file loaded at startup, not env vars. `config.json` is gitignored; `config.example.json` is committed

## ANTI-PATTERNS (THIS PROJECT)

- **Do NOT** use env vars for config — project reads `config.json` at CWD
- **Do NOT** import without `.js` extension — ESM requires it (`import { x } from './foo.js'`)
- **Do NOT** mount `state.json` as Docker volume — state is written in-container (previous bug: EISDIR error when directory was mounted)
- **Do NOT** add `data/` directory — was removed in favor of in-container `state.json` (commit 8397026)

## COMMANDS

```bash
# Development
npm start                    # ts-node --esm src/index.ts (requires config.json)
npm run build                # tsc → dist/
npm test                     # placeholder, exits 1

# Docker
docker-compose up --build    # Requires ./config.json to exist locally (mounted read-only)
docker-compose up -d         # Detached mode

# Setup
cp config.example.json config.json   # REQUIRED before first run
```

## NOTES

- **Price calculation**: `rawPrice = amountOut / amountIn`, then adjusted by `10^(baseDecimals - quoteDecimals)`. Queries 1 unit of base token.
- **Default quote token**: Native USDC on Sui (`0xdba34...::usdc::USDC`)
- **Decimals caching**: `getDecimals()` caches results in `Map` — survives across poll cycles but not restarts
- **Docker gotcha**: `config.json` must exist as a file before `docker-compose up`. If missing, Docker creates a directory, causing EISDIR crash.
- **No graceful drain**: `process.exit(0)` on SIGINT/SIGTERM — in-flight requests are dropped
- **Polling, not streaming**: Each item gets its own `setInterval`. No WebSocket or event-based price feeds.
- **Bark notification params**: `?call=1&level=critical` — triggers phone call sound + critical alert level
