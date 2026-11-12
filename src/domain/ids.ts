/** Neue Datensatz-IDs: UUID v4 (im Browser und auf dem Server verfügbar). */
export const newId = (): string => crypto.randomUUID();
