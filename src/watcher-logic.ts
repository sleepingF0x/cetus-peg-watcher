export interface AveragePauseRule {
  resumePrice: number;
  condition: 'above' | 'below';
}

interface RuleEvaluationInput {
  alertMode: 'price' | 'avg_percent';
  currentPrice: number;
  pauseRule?: AveragePauseRule;
}

export function createAlertRuleKey(
  itemId: string,
): string {
  return `rule::${itemId}`;
}

export function createOpsCooldownKey(
  ruleKey: string,
  issueType: string,
): string {
  return `${ruleKey}::ops::${issueType}`;
}

export function shouldEvaluateRule(input: RuleEvaluationInput): boolean {
  if (input.alertMode !== 'avg_percent' || !input.pauseRule) {
    return true;
  }

  return input.pauseRule.condition === 'above'
    ? input.currentPrice <= input.pauseRule.resumePrice
    : input.currentPrice >= input.pauseRule.resumePrice;
}

export function createSerializedPollRunner(
  task: () => Promise<void>,
): () => Promise<void> {
  let inFlight = false;

  return async () => {
    if (inFlight) {
      return;
    }

    inFlight = true;
    try {
      await task();
    } finally {
      inFlight = false;
    }
  };
}
