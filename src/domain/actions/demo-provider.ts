import type { Action } from '../types';
import type { ActionProvider, ExecuteOutcome } from './machine';

/** Merkt sich ausgeführte Schlüssel, führt nie extern aus. */
export class DemoProvider implements ActionProvider {
  readonly simulated = true;
  private done = new Map<string, number>();

  async execute(_a: Action, key: string): Promise<ExecuteOutcome> {
    if (!this.done.has(key)) this.done.set(key, 1);
    return 'ok';
  }

  async lookup(key: string): Promise<boolean> {
    return this.done.has(key);
  }

  executedCount(key: string): number {
    return this.done.get(key) ?? 0;
  }
}
