import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAlertRuleKey,
  createOpsCooldownKey,
  shouldEvaluateRule,
  createSerializedPollRunner,
} from '../src/watcher-logic.js';

test('createAlertRuleKey distinguishes rules for the same base token', () => {
  const first = createAlertRuleKey('usdy-below');
  const second = createAlertRuleKey('usdy-above');
  const third = createAlertRuleKey('cetus-below');

  assert.notEqual(first, second);
  assert.notEqual(first, third);
  assert.equal(first, 'rule::usdy-below');
});

test('shouldEvaluateRule suppresses paused avg rule until resume threshold is crossed', () => {
  assert.equal(
    shouldEvaluateRule({
      alertMode: 'avg_percent',
      currentPrice: 110,
      pauseRule: {
        condition: 'above',
        resumePrice: 105,
      },
    }),
    false,
  );

  assert.equal(
    shouldEvaluateRule({
      alertMode: 'avg_percent',
      currentPrice: 105,
      pauseRule: {
        condition: 'above',
        resumePrice: 105,
      },
    }),
    true,
  );
});

test('createSerializedPollRunner ignores overlapping executions', async () => {
  let activeRuns = 0;
  let maxActiveRuns = 0;
  let completedRuns = 0;

  const runner = createSerializedPollRunner(async () => {
    activeRuns += 1;
    maxActiveRuns = Math.max(maxActiveRuns, activeRuns);
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeRuns -= 1;
    completedRuns += 1;
  });

  await Promise.all([runner(), runner(), runner()]);

  assert.equal(maxActiveRuns, 1);
  assert.equal(completedRuns, 1);
});

test('createOpsCooldownKey is distinct from signal alert keys', () => {
  const ruleKey = createAlertRuleKey('usdy-below');
  const opsKey = createOpsCooldownKey(ruleKey, 'trade_failed');

  assert.notEqual(ruleKey, opsKey);
  assert.equal(opsKey, `${ruleKey}::ops::trade_failed`);
});
