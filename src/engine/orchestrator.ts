import path from 'path';
import type { ResolvedConfig } from '../config.js';
import { CooldownManager } from '../cooldown/manager.js';
import { createAlertRuleKey } from '../watcher-logic.js';
import { WatchGroupRunner, type WatchGroup } from './runner.js';

const STATE_FILE = path.resolve('data/state.json');

function groupItems(config: ResolvedConfig): WatchGroup[] {
  const map = new Map<string, WatchGroup>();

  for (const item of config.items) {
    const pollIntervalMs = item.pollInterval * 1000;
    const queryBaseAmount = item.priceQueryMinBaseAmount;
    const groupKey = `${item.baseToken}::${item.quoteToken}::${pollIntervalMs}::${queryBaseAmount}`;
    const averageWindowMs = (item.avgWindowMinutes ?? 10) * 60 * 1000;
    const ruleKey = createAlertRuleKey(item.id);

    const existing = map.get(groupKey);
    if (existing) {
      existing.items.push({ item, ruleKey, averageWindowMs });
      if (averageWindowMs > existing.maxAverageWindowMs) {
        existing.maxAverageWindowMs = averageWindowMs;
      }
    } else {
      map.set(groupKey, {
        groupKey,
        baseToken: item.baseToken,
        quoteToken: item.quoteToken,
        queryBaseAmount,
        pollIntervalMs,
        maxAverageWindowMs: averageWindowMs,
        items: [{ item, ruleKey, averageWindowMs }],
      });
    }
  }

  return Array.from(map.values());
}

export async function startWatcher(config: ResolvedConfig): Promise<CooldownManager> {
  const cooldown = CooldownManager.load(
    STATE_FILE,
    config.items.map(({ id, baseToken, quoteToken }) => ({ id, baseToken, quoteToken })),
  );

  for (const group of groupItems(config)) {
    const runner = new WatchGroupRunner(group, cooldown, config);
    const check = runner.createCheck();
    void check();
    setInterval(() => void check(), group.pollIntervalMs);
  }

  return cooldown;
}
