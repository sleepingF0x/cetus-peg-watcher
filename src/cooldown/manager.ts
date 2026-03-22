import { loadState, saveState, migrateLegacyStateKeys } from '../state.js';
import type { AlertState } from '../state.js';

export type { AlertState };

const PERSIST_DEBOUNCE_MS = 500;

export class CooldownManager {
  private readonly state: AlertState;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly filePath: string, initialState: AlertState) {
    this.state = initialState;
  }

  static load(
    filePath: string,
    items: Array<{ id: string; baseToken: string; quoteToken: string }>,
  ): CooldownManager {
    const loadedState = loadState(filePath);
    const state = migrateLegacyStateKeys(loadedState, items);
    return new CooldownManager(filePath, state);
  }

  shouldAlert(key: string, cooldownSeconds: number): boolean {
    const lastTime = this.state.lastAlertTime[key];
    if (!lastTime) return true;
    return Date.now() - lastTime >= cooldownSeconds * 1000;
  }

  recordAlert(key: string): void {
    this.state.lastAlertTime[key] = Date.now();
    this.schedulePersist();
  }

  /** Expose state for backward-compatible usage (e.g. passing to processAlertActions) */
  getState(): AlertState {
    return this.state;
  }

  /** Force an immediate write — call on graceful shutdown */
  flush(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    saveState(this.filePath, this.state);
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      saveState(this.filePath, this.state);
    }, PERSIST_DEBOUNCE_MS);
  }
}
