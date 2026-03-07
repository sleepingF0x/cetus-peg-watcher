# Watcher Refactor Design

**Date:** 2026-03-07

## Scope

Refactor the watcher flow without changing product intent:

- keep Telegram as the only active notification channel
- keep alert/trade behavior intact where it is already correct
- fix rule-level alert cooldown collisions
- make average-mode pause rules actually suppress retriggers until resume
- prevent overlapping polling runs for the same watch group
- remove duplicate price/decimals calculation paths where the same data is already available

## Chosen Approach

Use a balanced refactor:

1. Extract small pure watcher helpers for rule ids, pause gating, and polling serialization.
2. Change alert cooldown keys from `baseToken` to rule-level ids.
3. Apply pause rules before condition evaluation so paused average rules do not alert again.
4. Reuse trade execution metrics directly in alert formatting instead of recomputing them.
5. Remove the unused Bark sender and clean the related docs/config compatibility wording.

## Non-Goals

- no large watcher architecture rewrite
- no trading strategy changes
- no network/API behavior changes beyond removing duplicate requests
- no new notification channels
