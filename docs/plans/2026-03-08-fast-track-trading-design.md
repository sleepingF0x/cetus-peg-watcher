# Fast-Track Trading Design

**Date:** 2026-03-08

## Goal

Reduce missed trades during sharp price dislocations, report true on-chain execution status, and avoid marking failed trades as successful.

## Scope

- add a fast-track path that skips `tradeConfirmations` when price moves far beyond the configured average-based trigger
- add dynamic slippage for fast-track trades, capped by a hard maximum
- separate transaction submission from final chain outcome
- notify Telegram with real trade outcomes: success, failure, or pending followed by final resolution
- record trade cooldown only for confirmed on-chain successes

## Fast-Track Trigger

Fast-track applies only to average-based rules because it depends on the current average window.

- compute `currentRatio = currentPrice / avgWindowPrice`
- compute `triggerRatio = triggerThreshold / avgWindowPrice`
- compute `overshootPercent = abs(currentRatio - triggerRatio) * 100`
- if `overshootPercent >= trade.fastTrackExtraPercent`, treat the rule as trade-confirmed immediately

This applies to both directions:

- `above`: large upside deviation triggers immediate sell
- `below`: large downside deviation triggers immediate buy

Default values:

- `trade.fastTrackEnabled = true`
- `trade.fastTrackExtraPercent = 1.5`

## Fast-Track Size And Slippage

Fast-track trades use their own position size and slippage settings.

- normal trades continue to use `trade.maxTradePercent`
- fast-track trades use `trade.fastTrackTradePercent`
- normal trades continue to use `trade.slippagePercent`
- fast-track trades increase slippage from the base value according to excess overshoot

Formula:

- `extraOvershootPercent = max(0, overshootPercent - trade.fastTrackExtraPercent)`
- `dynamicSlippage = trade.slippagePercent + extraOvershootPercent * trade.fastTrackSlippageMultiplier`
- `finalSlippage = min(dynamicSlippage, trade.fastTrackMaxSlippagePercent)`

Default values:

- `trade.fastTrackTradePercent = 75`
- `trade.fastTrackSlippageMultiplier = 0.35`
- `trade.fastTrackMaxSlippagePercent = 2.0`

## Transaction Status Model

Transaction execution must no longer infer success from a returned digest.

New status model:

- `submitted`: transaction digest exists but final chain status is not known yet
- `success`: chain effects status is success
- `failure`: chain effects status is failure, with the chain error attached
- `unknown`: final status could not be confirmed before timeout

The trader should:

- submit the transaction
- wait briefly before polling final status
- poll `sui_getTransactionBlock` until success, failure, or timeout
- fetch realized trade metrics only for confirmed success

Default timing:

- `trade.statusPollDelayMs = 1500`
- `trade.statusPollIntervalMs = 1500`
- `trade.statusPollTimeoutMs = 15000`

## Notification Behavior

Telegram should reflect the real state of the transaction.

- if final status is available quickly, send one final message only
- if final status is still pending after timeout, send a pending message with the digest
- when a pending transaction later resolves, send a follow-up final message

Message types:

- signal success: includes side, amount, executed price, digest, and whether fast-track was used
- signal failure: includes digest, chain error, side, and whether fast-track was used
- signal pending: includes digest and that the bot is waiting for chain confirmation
- ops warning remains for internal failures such as quote fetch or status polling errors

## Cooldown Rules

- alert cooldown behavior remains unchanged
- trade cooldown is recorded only on confirmed `success`
- `failure` and `unknown` do not consume trade cooldown

## Files Affected

- `src/config.ts`
- `src/watcher-rules.ts`
- `src/watcher.ts`
- `src/trader.ts`
- `src/watcher-actions.ts`
- `src/telegram.ts` if message helpers need new templates only
- `test/watcher-rules.test.ts`
- `test/watcher-actions.test.ts`
- `test/config.test.ts`

## Non-Goals

- no new notification transport beyond Telegram
- no per-rule fast-track overrides in this pass
- no order splitting or retrying failed swaps in this pass
- no replacement of Cetus price sourcing in this pass
