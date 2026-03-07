# Explicit Rule ID Design

**Date:** 2026-03-07

## Goal

Make watch rule identity explicit and stable by requiring `items[].id`, then migrate persisted cooldown state away from legacy keys.

## Scope

- add required `id` to every watch item
- reject configs with missing or duplicate ids
- use rule ids for signal and ops cooldown keys
- add one-time state migration from legacy `baseToken` keys and recent index-based keys
- update example and local config files

## Chosen Model

- `items[].id` is the only durable identity for a watch rule
- rule order no longer affects cooldown state
- changing thresholds does not change rule identity unless the operator changes `id`
- no long-term fallback logic remains after startup migration

## Migration

Startup should transform old keys into new rule-id-based keys before any cooldown checks:

- legacy base-token alert key -> matching rule ids for the same base token
- recent index-based alert key -> matching rule id for the same config item position

If a legacy key cannot be mapped safely, log a warning and drop it.

## Non-Goals

- no new config file format beyond adding `items[].id`
- no changes to trade logic
- no persistent backward-compatibility path after migration completes
