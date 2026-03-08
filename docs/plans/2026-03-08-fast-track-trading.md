# Fast-Track Trading Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add fast-track trade execution for extreme price deviations, dynamic slippage, and truthful Telegram notifications based on final on-chain transaction status.

**Architecture:** Keep `watcher.ts` as the orchestration layer, extend rule evaluation to classify fast-track conditions, and move transaction outcome handling into `trader.ts` so success is based on chain effects instead of digest existence. `watcher-actions.ts` should build user-facing messages from explicit transaction states and only record trade cooldown after confirmed success.

**Tech Stack:** TypeScript, Node.js built-in test runner, ts-node ESM loader, Sui JSON-RPC, Cetus aggregator SDK

---

### Task 1: Add config coverage for fast-track and status polling

**Files:**
- Modify: `src/config.ts`
- Modify: `config.example.json`
- Test: `test/config.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- default values for `fastTrackEnabled`, `fastTrackExtraPercent`, `fastTrackTradePercent`, `fastTrackSlippageMultiplier`, `fastTrackMaxSlippagePercent`, `statusPollDelayMs`, `statusPollIntervalMs`, and `statusPollTimeoutMs`
- validation failures for out-of-range percentage and timing fields

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/config.test.ts`
Expected: FAIL because the new trade config fields do not exist yet.

**Step 3: Write minimal implementation**

Update `src/config.ts` and `config.example.json` to:

- add the new trade config fields
- validate their ranges
- apply the default values

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/config.test.ts`
Expected: PASS

### Task 2: Add fast-track rule evaluation

**Files:**
- Modify: `src/watcher-rules.ts`
- Test: `test/watcher-rules.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- normal rule evaluation still requires the configured confirmation count
- average-based `above` rule enters fast-track when overshoot reaches `fastTrackExtraPercent`
- average-based `below` rule enters fast-track when overshoot reaches `fastTrackExtraPercent`
- price-based rules never enter fast-track in this pass

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-rules.test.ts`
Expected: FAIL because rule evaluation does not expose fast-track metadata yet.

**Step 3: Write minimal implementation**

Update `src/watcher-rules.ts` to return:

- `isFastTrack`
- `overshootPercent`
- `tradeConfirmedImmediately`

Use the approved formula based on `avgWindowPrice`, `triggerThreshold`, and `trade.fastTrackExtraPercent`.

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-rules.test.ts`
Expected: PASS

### Task 3: Add truthful transaction state handling

**Files:**
- Modify: `src/trader.ts`
- Test: `test/watcher-actions.test.ts`

**Step 1: Write the failing test**

Add tests in `test/watcher-actions.test.ts` covering:

- transaction digest alone does not count as success
- chain `failure` produces a failure notification instead of a success notification
- only chain `success` is treated as an executed trade

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts`
Expected: FAIL because current code treats any returned trade result with `success: true` as executed.

**Step 3: Write minimal implementation**

Refactor `src/trader.ts` to:

- add explicit trade statuses such as `submitted`, `success`, `failure`, `unknown`
- inspect chain effects after submission
- attach chain failure errors when present
- fetch trade metrics only on confirmed success

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts`
Expected: PASS

### Task 4: Add fast-track sizing and dynamic slippage

**Files:**
- Modify: `src/trader.ts`
- Test: `test/watcher-actions.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- normal trades use `trade.maxTradePercent`
- fast-track trades use `trade.fastTrackTradePercent`
- fast-track slippage increases from the base value
- fast-track slippage never exceeds `trade.fastTrackMaxSlippagePercent`

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts`
Expected: FAIL because trade execution does not accept fast-track sizing or computed slippage yet.

**Step 3: Write minimal implementation**

Update `src/trader.ts` to:

- accept fast-track execution context
- compute dynamic slippage from overshoot
- use `fastTrackTradePercent` for fast-track amount sizing

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts`
Expected: PASS

### Task 5: Update watcher orchestration and notifications

**Files:**
- Modify: `src/watcher.ts`
- Modify: `src/watcher-actions.ts`
- Test: `test/watcher-actions.test.ts`
- Test: `test/watcher-rules.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- fast-track bypasses `tradeConfirmations`
- trade cooldown is recorded only after confirmed success
- failure and unknown states do not emit `trade_executed`
- pending state produces a pending message and later allows a final follow-up

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts test/watcher-rules.test.ts`
Expected: FAIL because watcher orchestration and notifications do not model the new states yet.

**Step 3: Write minimal implementation**

Update `src/watcher.ts` and `src/watcher-actions.ts` to:

- use fast-track metadata from rule evaluation
- pass overshoot data into trade execution
- log `trade_submitted`, `trade_confirmed_success`, `trade_confirmed_failure`, and `trade_status_unknown`
- send Telegram messages that match the final trade state
- record trade cooldown only for confirmed success

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts test/watcher-rules.test.ts`
Expected: PASS

### Task 6: Final verification

**Files:**
- Verify: `src/config.ts`
- Verify: `src/watcher-rules.ts`
- Verify: `src/trader.ts`
- Verify: `src/watcher-actions.ts`
- Verify: `src/watcher.ts`
- Verify: `test/config.test.ts`
- Verify: `test/watcher-rules.test.ts`
- Verify: `test/watcher-actions.test.ts`

**Step 1: Run targeted tests**

Run: `npm test -- test/config.test.ts test/watcher-rules.test.ts test/watcher-actions.test.ts`
Expected: PASS

**Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add docs/plans/2026-03-08-fast-track-trading-design.md docs/plans/2026-03-08-fast-track-trading.md src/config.ts src/watcher-rules.ts src/trader.ts src/watcher-actions.ts src/watcher.ts test/config.test.ts test/watcher-rules.test.ts test/watcher-actions.test.ts config.example.json
git commit -m "feat: add fast-track trading and true trade status"
```
