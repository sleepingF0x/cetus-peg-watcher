# Large Quote Pricing Design

**Date:** 2026-03-09

## Goal

Make monitored prices meaningful for real trade sizes by quoting with a configurable base-token amount instead of always pricing exactly one token.

## Scope

- add a per-item query-size setting for monitor pricing
- use that configured size for polling, trigger evaluation, and alert text
- use the configured query size for the pre-trade re-quote as well
- make Telegram clearly distinguish quoted price from executed price
- document the new config and example usage

## Design

### Query Size Configuration

Add `items[].priceQueryMinBaseAmount` as a human-readable base-token amount.

- example: `1000` for USDY means quote at least `1000 USDY`
- default remains `1`
- validation requires a positive number

This stays per item because sensible query sizes vary widely across tokens.

### Monitor Price Semantics

The watcher should stop treating "1 base token" as the universal market price.

- polling price uses each rule's configured query size
- grouped polling must include query size in the group key so rules with different sizes do not share the same quote
- average windows continue to use the sampled quoted price from that configured size

### Trade Re-Quote Semantics

Trade safety needs to reflect the same quoted market depth used for the trigger.

- before executing a trade, re-quote using the configured `priceQueryMinBaseAmount`
- if that re-quoted price no longer satisfies the trigger threshold, skip the trade

This preserves alerting and trade gating on the same quoted size instead of mixing a 1-unit monitor price with a larger trade.

### Notification Wording

Telegram should describe the signal as a quoted price, not as an ambiguous "current" price.

- replace `Current` with `Quoted Price`
- add `Quoted Size`
- keep `Executed Price` for realized on-chain execution price

## Files Affected

- `src/config.ts`
- `src/cetus.ts`
- `src/watcher.ts`
- `src/watcher-actions.ts`
- `config.example.json`
- `README.md`
- `test/config.test.ts`
- `test/watcher-actions.test.ts`
- `test/formatters.test.ts`

## Non-Goals

- no dynamic monitor sizing from wallet balances during normal polling
- no quote-side notional targeting in this pass
- no change to trade execution sizing logic
