# Alert Tiering Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split Telegram notifications into signal and ops tiers with independent cooldown behavior and reduced noise.

**Architecture:** Keep `watcher.ts` as the orchestration layer and extend `watcher-actions.ts` with tier-aware message builders and ops notification helpers. Signal alerts remain rule-based, while ops notifications get their own stable cooldown keys so operational warnings cannot suppress price alerts or vice versa.

**Tech Stack:** TypeScript, Node.js built-in test runner, ts-node ESM loader

---

### Task 1: Add tier-aware message helpers

**Files:**
- Modify: `src/watcher-actions.ts`
- Test: `test/watcher-actions.test.ts`

**Step 1: Write the failing test**

Add tests for:

- signal alert titles remain `Price Alert` / `Price Alert + Trade Executed`
- ops alert titles are prefixed with `Ops Warning`
- trade failure does not suppress signal alert delivery

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts`
Expected: FAIL on missing tier-aware helpers or changed message expectations.

**Step 3: Write minimal implementation**

Implement helper functions that:

- build signal messages
- build ops messages
- catch trade execution failures and return ops notification payload instead of rejecting

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts`
Expected: PASS

### Task 2: Add ops cooldown keys and watcher integration

**Files:**
- Modify: `src/watcher.ts`
- Modify: `src/watcher-logic.ts`
- Test: `test/watcher-logic.test.ts`

**Step 1: Write the failing test**

Add tests for:

- stable ops cooldown key generation by `ruleKey + issue type`
- signal cooldown and ops cooldown do not collide

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-logic.test.ts`
Expected: FAIL because the ops cooldown key helper does not exist yet.

**Step 3: Write minimal implementation**

Add helpers for ops cooldown keys and update watcher paths for:

- config error ops alert
- insufficient balance ops alert
- trade failure ops alert

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-logic.test.ts`
Expected: PASS

### Task 3: Reclassify silent events and tighten logging

**Files:**
- Modify: `src/watcher.ts`
- Modify: `README.md`

**Step 1: Write the failing test**

No new automated test required; behavior is verified by existing tests plus targeted search.

**Step 2: Write minimal implementation**

- keep monitor, cooldown, confirmation wait, pause/resume, and requote invalidation as log-only
- ensure ops-only Telegram sends happen only for the chosen categories
- update README to document the signal/ops/silent split

**Step 3: Run verification**

Run: `rg -n "Ops Warning|Price Alert|cooldown" src README.md`
Expected: tiered terminology appears in code/docs and cooldown semantics remain readable.

### Task 4: Final verification

**Files:**
- Verify: `src/watcher.ts`
- Verify: `src/watcher-actions.ts`
- Verify: `test/watcher-actions.test.ts`
- Verify: `test/watcher-logic.test.ts`

**Step 1: Run all tests**

Run: `npm test`
Expected: PASS

**Step 2: Run build**

Run: `npm run build`
Expected: PASS
