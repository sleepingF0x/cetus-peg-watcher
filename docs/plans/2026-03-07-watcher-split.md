# Watcher Split Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split watcher rule evaluation and action execution into dedicated modules without changing product behavior.

**Architecture:** Keep `src/watcher.ts` as the orchestration layer and extract two focused collaborators: `src/watcher-rules.ts` for pure decision logic and `src/watcher-actions.ts` for trade/alert side effects. The refactor should shrink the watcher loop, preserve the current runtime flow, and add tests around the extracted contracts.

**Tech Stack:** TypeScript, Node.js built-in test runner, ts-node ESM loader

---

### Task 1: Extract rule evaluation

**Files:**
- Create: `src/watcher-rules.ts`
- Modify: `src/watcher.ts`
- Test: `test/watcher-rules.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- price-mode threshold evaluation
- avg-percent threshold evaluation
- pause-resume handling for `avg_percent`
- confirmation count to alert/trade readiness mapping

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-rules.test.ts`
Expected: FAIL because `src/watcher-rules.ts` does not exist yet.

**Step 3: Write minimal implementation**

Implement a `evaluateWatchRule()` style function returning:

- `isConditionMet`
- `triggerThreshold`
- `tradeSide`
- `hitCount`
- `isAlertConfirmed`
- `isPaused`
- `resumed`

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-rules.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/watcher-rules.ts src/watcher.ts test/watcher-rules.test.ts
git commit -m "refactor: extract watcher rule evaluation"
```

### Task 2: Extract alert and trade actions

**Files:**
- Create: `src/watcher-actions.ts`
- Modify: `src/watcher.ts`
- Test: `test/watcher-actions.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- alert-only path when trade is disabled
- no-send path when alert cooldown is active
- message formatting uses actual trade input/output token directions

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts`
Expected: FAIL because `src/watcher-actions.ts` does not exist yet.

**Step 3: Write minimal implementation**

Implement helper functions such as:

- `maybeExecuteTradeForAlert()`
- `buildAlertMessage()`
- `sendAlertForRule()`

Keep external dependencies injectable where possible.

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/watcher-actions.ts src/watcher.ts test/watcher-actions.test.ts
git commit -m "refactor: extract watcher actions"
```

### Task 3: Simplify watcher orchestration

**Files:**
- Modify: `src/watcher.ts`
- Modify: `src/watcher-logic.ts`
- Test: `test/watcher-logic.test.ts`

**Step 1: Write the failing test**

Extend existing logic tests if orchestration helper contracts change.

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-logic.test.ts`

**Step 3: Write minimal implementation**

- remove duplicated branch logic now owned by the new modules
- keep state updates localized in `watcher.ts`
- ensure the loop still serializes each watch group

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-logic.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/watcher.ts src/watcher-logic.ts test/watcher-logic.test.ts
git commit -m "refactor: simplify watcher orchestration"
```

### Task 4: Final verification

**Files:**
- Verify: `src/watcher.ts`
- Verify: `src/watcher-rules.ts`
- Verify: `src/watcher-actions.ts`
- Verify: `test/watcher-logic.test.ts`
- Verify: `test/watcher-rules.test.ts`
- Verify: `test/watcher-actions.test.ts`

**Step 1: Run all tests**

Run: `npm test`
Expected: PASS

**Step 2: Run build**

Run: `npm run build`
Expected: PASS
