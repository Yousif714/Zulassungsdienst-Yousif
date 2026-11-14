import type { Settings } from './types';

/** Standard-Einstellungen; fehlende Schlüssel in alten Ständen werden daraus ergänzt (migrateState). */
export const DEFAULT_SETTINGS: Settings = {
  replyThresholdHours: 2, briefingsEnabled: true, ownerPhone: '', suppressedCoachKeys: [],
  takeoverReminderDays: 3, takeoverLinkNudgeDays: 7,
};
