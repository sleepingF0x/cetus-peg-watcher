import fs from 'fs';

export interface AlertState {
  lastAlertTime: Record<string, number>;
}

interface StateMigrationItem {
  id: string;
  baseToken: string;
  quoteToken: string;
}

export function loadState(filePath: string): AlertState {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return { lastAlertTime: {} };
  }

  try {
    const rawData = fs.readFileSync(filePath, 'utf-8').trim();
    if (!rawData) {
      return { lastAlertTime: {} };
    }
    return JSON.parse(rawData) as AlertState;
  } catch (error) {
    console.error(`Error loading state from ${filePath}:`, error);
    return { lastAlertTime: {} };
  }
}

export function saveState(filePath: string, state: AlertState): void {
  try {
    const data = JSON.stringify(state, null, 2);
    fs.writeFileSync(filePath, data, 'utf-8');
  } catch (error) {
    console.error(`Error saving state to ${filePath}:`, error);
    throw error;
  }
}

export function migrateLegacyStateKeys(
  state: AlertState,
  items: StateMigrationItem[],
): AlertState {
  const migratedState: AlertState = {
    lastAlertTime: { ...state.lastAlertTime },
  };
  const migratedKeys = new Set<string>();

  items.forEach((item, index) => {
    const explicitRuleKey = `rule::${item.id}`;
    const legacyBaseTokenKey = item.baseToken;
    const legacyIndexedRuleKey = `${item.baseToken}::${item.quoteToken}::alert::${index}`;

    if (
      migratedState.lastAlertTime[explicitRuleKey] === undefined &&
      migratedState.lastAlertTime[legacyBaseTokenKey] !== undefined
    ) {
      migratedState.lastAlertTime[explicitRuleKey] = migratedState.lastAlertTime[legacyBaseTokenKey];
      migratedKeys.add(legacyBaseTokenKey);
    }

    if (
      migratedState.lastAlertTime[explicitRuleKey] === undefined &&
      migratedState.lastAlertTime[legacyIndexedRuleKey] !== undefined
    ) {
      migratedState.lastAlertTime[explicitRuleKey] = migratedState.lastAlertTime[legacyIndexedRuleKey];
      migratedKeys.add(legacyIndexedRuleKey);
    }

    for (const [key, value] of Object.entries(migratedState.lastAlertTime)) {
      const opsPrefix = `${legacyIndexedRuleKey}::ops::`;
      if (key.startsWith(opsPrefix)) {
        const issueType = key.slice(opsPrefix.length);
        migratedState.lastAlertTime[`${explicitRuleKey}::ops::${issueType}`] = value;
        migratedKeys.add(key);
      }
    }
  });

  for (const key of migratedKeys) {
    delete migratedState.lastAlertTime[key];
  }

  return migratedState;
}

export function shouldAlert(tokenId: string, cooldownSeconds: number, state: AlertState): boolean {
  const lastTime = state.lastAlertTime[tokenId];
  if (!lastTime) {
    return true;
  }

  const now = Date.now();
  const cooldownMs = cooldownSeconds * 1000;
  return now - lastTime >= cooldownMs;
}

export function recordAlert(tokenId: string, state: AlertState): void {
  state.lastAlertTime[tokenId] = Date.now();
}
