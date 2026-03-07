# Alert Tiering Design

**Date:** 2026-03-07

## Goal

Separate runtime notifications into signal, ops, and silent classes so Telegram remains actionable without losing important operational visibility.

## Scope

- keep Telegram as the only notification transport
- keep price alerts and trade success as `signal`
- send config errors, insufficient balance, and trade failures as `ops`
- keep polling, cooldown, confirmation wait, pause/resume, and re-quote skips as log-only
- add dedicated cooldown keys for `ops` notifications so they do not interfere with signal alerts

## Notification Classes

### `signal`

High-value events a human likely wants to act on immediately:

- price threshold reached
- trade executed successfully

These keep the current alert flow, with concise titles and current context.

### `ops`

Operational issues that should reach Telegram but must be throttled:

- invalid trade configuration
- insufficient tradable balance
- trade execution failure

These should use a distinct title prefix such as `Ops Warning`, carry a short reason, and use cooldown keys based on `rule + issue type`.

### `silent`

Runtime status that should remain in logs only:

- monitoring snapshots
- cooldown hits
- confirmation waits
- paused rules
- requote invalidation

## Data Model

Introduce notification kinds and helper functions that:

- build `signal` and `ops` message bodies
- derive stable ops cooldown keys like `ruleKey::ops::insufficient_balance`
- keep alert delivery independent from trade execution failure handling

## Non-Goals

- no new transport beyond Telegram
- no batching or digesting
- no recovery notifications in this pass
