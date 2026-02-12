# Cetus Peg Watcher

A lightweight Node.js/TypeScript tool to monitor token prices on Cetus DEX (Sui blockchain) and receive Bark notifications when price thresholds are breached.

## Features

- 🔍 **Real-time Price Monitoring**: Polls Cetus Aggregator API for latest prices
- 🔔 **Bark Notifications**: Get instant alerts on your iOS device via Bark
- 🌡️ **Smart Cooldown**: Configurable cooldown period to prevent notification spam
- 💾 **Persistent State**: Alert history survives app restarts
- 🔄 **Automatic Retry**: Exponential backoff for API failures
- ⚡ **Lightweight**: No database, minimal dependencies

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure

Copy the example config and edit it:

```bash
cp config.example.json config.json
```

Edit `config.json` with your settings:

```json
{
  "barkUrl": "https://api.day.app/YOUR_DEVICE_KEY",
  "items": [
    {
      "baseToken": "0x2::sui::SUI",
      "targetPrice": 3.5,
      "condition": "above",
      "pollInterval": 60,
      "cooldownMinutes": 30
    }
  ]
}
```

### 3. Run

```bash
npm start
```

Or use the helper script:

```bash
./start.sh
```

## Configuration Options

### Global Settings

| Field | Description | Default |
|-------|-------------|---------|
| `barkUrl` | Your Bark device URL | Required |

### Watch Item Settings

| Field | Description | Default |
|-------|-------------|---------|
| `baseToken` | Token to monitor (Sui coin type) | Required |
| `targetPrice` | Price threshold to trigger alert | Required |
| `condition` | `above` or `below` target price | Required |
| `quoteToken` | Token to price against | USDC |
| `pollInterval` | Seconds between price checks | 30 |
| `cooldownMinutes` | Minutes before re-alerting | 30 |

### Common Token Addresses

| Token | Address |
|-------|---------|
| SUI | `0x2::sui::SUI` |
| Native USDC | `0xdba34672e30cb065b1f93e3ab55318768fd6fef66c159427221d6b5457b46522::usdc::USDC` |
| CETUS | `0x6864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS` |

## How It Works

1. **Polling**: The app periodically checks token prices via Cetus Aggregator API
2. **Threshold Check**: Compares current price against your configured target
3. **Cooldown**: Only sends one alert per cooldown period (default 30 min)
4. **Persistence**: Saves alert timestamps to `state.json` to survive restarts
5. **Notification**: Sends Bark push notification when threshold is breached

## Example Alert

When SUI price goes above $3.50:

```
Title: Price Alert
Message: 0x2::sui::SUI price is $3.55 (target: above $3.50)
```

## Development

### Build

```bash
npx tsc
```

### Run in Development Mode

```bash
npx ts-node --esm src/index.ts
```

## License

MIT
