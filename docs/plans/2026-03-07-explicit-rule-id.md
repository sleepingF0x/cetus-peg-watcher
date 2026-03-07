# Explicit Rule ID Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Require explicit watch item ids and migrate persisted cooldown state to stable rule-id-based keys.

**Architecture:** `src/config.ts` becomes the authority for rule ids by validating `items[].id` and uniqueness. `src/watcher-logic.ts` derives alert keys from rule ids, while `src/state.ts` performs a one-time startup migration from legacy keys before the watcher starts checking cooldowns.

**Tech Stack:** TypeScript, Node.js built-in test runner, ts-node ESM loader

---

### Task 1: Add config validation for explicit rule ids

**Files:**
- Modify: `src/config.ts`
- Modify: `config.example.json`
- Modify: `config.json`
- Test: `test/config.test.ts`

**Step 1: Write the failing test**

Add tests for:

- missing `items[].id` throws
- duplicate `items[].id` throws
- valid config preserves ids

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/config.test.ts`
Expected: FAIL because id validation does not exist yet.

**Step 3: Write minimal implementation**

Add `id` to `WatchItem`, require it, and reject duplicates.

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/config.test.ts`
Expected: PASS

### Task 2: Replace rule keys with explicit ids

**Files:**
- Modify: `src/watcher-logic.ts`
- Modify: `src/watcher.ts`
- Test: `test/watcher-logic.test.ts`

**Step 1: Write the failing test**

Add tests for:

- alert rule keys derive from explicit ids, not item index
- ops keys derive from the explicit rule key

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-logic.test.ts`
Expected: FAIL because the key helper still depends on item index.

**Step 3: Write minimal implementation**

Use `item.id` everywhere cooldown identity is derived.

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-logic.test.ts`
Expected: PASS

### Task 3: Add one-time legacy state migration

**Files:**
- Modify: `src/state.ts`
- Modify: `src/watcher.ts`
- Test: `test/state.test.ts`

**Step 1: Write the failing test**

Add tests for:

- legacy base-token keys migrate to matching explicit ids
- recent index-based keys migrate to the current explicit ids
- existing explicit-id keys remain unchanged

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/state.test.ts`
Expected: FAIL because migration helpers do not exist yet.

**Step 3: Write minimal implementation**

Implement a migration helper that rewrites legacy keys before cooldown checks begin.

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/state.test.ts`
Expected: PASS

### Task 4: Final verification

**Files:**
- Verify: `src/config.ts`
- Verify: `src/watcher-logic.ts`
- Verify: `src/state.ts`
- Verify: `src/watcher.ts`
- Verify: `config.example.json`
- Verify: `config.json`

**Step 1: Run all tests**

Run: `npm test`
Expected: PASS

**Step 2: Run build**

Run: `npm run build`
Expected: PASS
