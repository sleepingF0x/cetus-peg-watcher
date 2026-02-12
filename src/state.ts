import fs from 'fs';

export interface AlertState {
  lastAlertTime: Record<string, number>;
}

export function loadState(filePath: string): AlertState {
  if (!fs.existsSync(filePath)) {
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

export function shouldAlert(tokenId: string, cooldownMinutes: number, state: AlertState): boolean {
  const lastTime = state.lastAlertTime[tokenId];
  if (!lastTime) {
    return true;
  }

  const now = Date.now();
  const cooldownMs = cooldownMinutes * 60 * 1000;
  return now - lastTime >= cooldownMs;
}

export function recordAlert(tokenId: string, state: AlertState): void {
  state.lastAlertTime[tokenId] = Date.now();
}
