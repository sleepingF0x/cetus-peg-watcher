# Large Quote Pricing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Quote monitored prices using a configurable large base-token amount and use that same quoted size for pre-trade re-quotes.

**Architecture:** Extend item config with a per-rule minimum base-token quote amount. Update the Cetus quote helper to accept human-readable query sizes, then thread that size through watcher polling, trade re-quote checks, and Telegram messages. Keep trade execution logic unchanged.

**Tech Stack:** TypeScript, Node.js built-in test runner, ts-node ESM loader, Cetus router API, Sui RPC

---

### Task 1: Add config coverage for large quote sizing

**Files:**
- Modify: `src/config.ts`
- Test: `test/config.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- `priceQueryMinBaseAmount` defaulting to `1`
- explicit positive values being preserved
- non-positive values being rejected

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/config.test.ts`
Expected: FAIL because the field does not exist yet.

**Step 3: Write minimal implementation**

Update `src/config.ts` to add validation and defaulting for `items[].priceQueryMinBaseAmount`.

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/config.test.ts`
Expected: PASS

### Task 2: Add quoted-size alert coverage

**Files:**
- Modify: `src/watcher-actions.ts`
- Test: `test/watcher-actions.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- alert messages render `Quoted Price`
- alert messages render `Quoted Size`
- executed-price wording remains unchanged for successful trades

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts`
Expected: FAIL because the message still says `Current`.

**Step 3: Write minimal implementation**

Update `src/watcher-actions.ts` to accept and render quoted-size information.

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts`
Expected: PASS

### Task 3: Add quote-size conversion helpers

**Files:**
- Modify: `src/formatters.ts`
- Test: `test/formatters.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- converting a human-readable base amount into on-chain units
- formatting quoted size for Telegram output

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/formatters.test.ts`
Expected: FAIL because those helpers do not exist yet.

**Step 3: Write minimal implementation**

Expose small pure helpers from `src/formatters.ts` for quote-size conversion and display.

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/formatters.test.ts`
Expected: PASS

### Task 4: Thread quote size through polling and re-quote checks

**Files:**
- Modify: `src/cetus.ts`
- Modify: `src/watcher.ts`
- Modify: `src/watcher-actions.ts`
- Test: `test/watcher-actions.test.ts`

**Step 1: Write the failing test**

Add tests covering:

- the watcher uses the configured human-readable quote size during polling
- trade re-quote uses that same configured quote size
- the user-facing alert reports the configured quoted size

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts test/formatters.test.ts`
Expected: FAIL because the size is not threaded yet.

**Step 3: Write minimal implementation**

Update the watcher and Cetus quote helper to use the configured quoted size during polling and the same-sized re-quote before trading.

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-actions.test.ts test/formatters.test.ts`
Expected: PASS

### Task 5: Update docs and example config

**Files:**
- Modify: `config.example.json`
- Modify: `README.md`

**Step 1: Update docs**

Document the new item field and clarify that `Quoted Price` is based on the configured quote size.

**Step 2: Verify docs**

Check that the example and README use consistent terminology.

### Task 6: Final verification

**Files:**
- Verify: `src/config.ts`
- Verify: `src/cetus.ts`
- Verify: `src/watcher.ts`
- Verify: `src/watcher-actions.ts`
- Verify: `test/config.test.ts`
- Verify: `test/formatters.test.ts`
- Verify: `test/watcher-actions.test.ts`

**Step 1: Run targeted tests**

Run: `node --test --loader ts-node/esm test/config.test.ts test/formatters.test.ts test/watcher-actions.test.ts`
Expected: PASS

**Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 3: Run build**

Run: `npm run build`
Expected: PASS
