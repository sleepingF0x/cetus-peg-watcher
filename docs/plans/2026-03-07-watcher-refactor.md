# Watcher Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix watcher flow bugs and remove confirmed redundant code without broad architecture changes.

**Architecture:** Keep the polling orchestrator in `watcher.ts`, but move rule-key and pause decisions into small pure helpers that are directly testable. Reuse trade execution metrics already returned from the trader path and delete the unused Bark sender to reduce dead code.

**Tech Stack:** TypeScript, Node.js built-in test runner, ts-node ESM loader

---

### Task 1: Add failing watcher helper tests

**Files:**
- Create: `test/watcher-logic.test.ts`
- Create: `src/watcher-logic.ts`

**Step 1: Write the failing test**

Add tests for:

- rule-level alert keys differ for rules on the same base token
- paused average rules stay paused until the resume threshold is crossed
- serialized polling skips overlapping async executions

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-logic.test.ts`
Expected: FAIL because `src/watcher-logic.ts` does not exist yet.

**Step 3: Write minimal implementation**

Implement the smallest helper module needed by the tests.

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-logic.test.ts`
Expected: PASS

### Task 2: Refactor watcher flow to use helpers

**Files:**
- Modify: `src/watcher.ts`
- Modify: `src/config.ts`
- Modify: `src/formatters.ts`

**Step 1: Write the failing test**

Extend the helper tests if needed to cover any extracted logic.

**Step 2: Run test to verify it fails**

Run: `node --test --loader ts-node/esm test/watcher-logic.test.ts`

**Step 3: Write minimal implementation**

- switch alert cooldown to a rule-level key
- apply pause suppression before condition evaluation
- add per-group in-flight protection
- reuse `tradeResult.realizedPrice` directly in message formatting when present

**Step 4: Run test to verify it passes**

Run: `node --test --loader ts-node/esm test/watcher-logic.test.ts`
Expected: PASS

### Task 3: Remove dead Bark path and update docs

**Files:**
- Delete: `src/notifier.ts`
- Modify: `src/config.ts`
- Modify: `README.md`
- Modify: `config.example.json`

**Step 1: Write the failing test**

No extra automated test needed; this is dead code removal verified by build and search.

**Step 2: Write minimal implementation**

- remove the Bark sender file
- remove `barkUrl` from config types/docs/examples
- update README text to reflect Telegram-only notifications

**Step 3: Run verification**

Run: `rg -n "barkUrl|sendBarkAlert" src README.md config.example.json`
Expected: no matches

### Task 4: Final verification

**Files:**
- Verify: `src/watcher.ts`
- Verify: `src/watcher-logic.ts`
- Verify: `test/watcher-logic.test.ts`

**Step 1: Run focused tests**

Run: `node --test --loader ts-node/esm test/watcher-logic.test.ts`
Expected: PASS

**Step 2: Run build**

Run: `npm run build`
Expected: PASS
