# Watcher Split Design

**Date:** 2026-03-07

## Goal

Reduce the cognitive load of `src/watcher.ts` by splitting rule evaluation and side-effect execution into focused modules, while keeping `watcher.ts` as the orchestration layer.

## Scope

- keep `src/watcher.ts` responsible for grouping items, polling prices, holding runtime state, and sequencing each loop
- move rule-level calculations into a new `src/watcher-rules.ts`
- move trade/alert action handling into a new `src/watcher-actions.ts`
- preserve current behavior from the previous refactor
- add focused tests for extracted pure logic and action-level branching

## Module Boundaries

### `src/watcher.ts`

Responsibilities:

- build `WatchGroup`s
- maintain `priceHistory`, `averagePauseRules`, `tradeCycleBaseAvailable`, and `consecutiveTradeHits`
- fetch prices
- call the rule evaluator
- call the action executor
- apply returned state changes

### `src/watcher-rules.ts`

Responsibilities:

- compute average target prices
- decide whether a paused rule may resume
- determine whether the current price satisfies the configured condition
- derive trade side and confirmation state
- return a single `RuleEvaluationResult`

This module should stay mostly pure and be easy to test directly.

### `src/watcher-actions.ts`

Responsibilities:

- handle trade prechecks and re-quote logic
- execute trades when permitted
- build Telegram message lines
- send the alert
- return action outcomes for the watcher to persist

This module will be dependency-oriented rather than fully pure, but should still keep branching localized and testable.

## Data Flow

Per rule, each polling cycle should follow:

1. `watcher.ts` gathers runtime inputs
2. `watcher-rules.ts` returns evaluation output
3. `watcher.ts` short-circuits if no action is needed
4. `watcher-actions.ts` performs optional trade + alert work
5. `watcher.ts` records cooldown timestamps and pause rules using returned results

## Non-Goals

- no new runtime features
- no change to config shape
- no change to notification channel
- no deeper decomposition beyond these two modules
