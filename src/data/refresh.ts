/** Hilfen fürs Neuladen im Echtmodus: Drossel und Zieh-Fortschritt (rein, ohne React). */

/** Ab dieser Zugstrecke (px) löst Loslassen das Neuladen aus. */
export const PULL_THRESHOLD = 70;
const DAMPING = 0.5;

/** Gibt `true`, wenn seit dem letzten Durchlass mindestens `minGapMs` vergangen sind (und merkt sich dann den Zeitpunkt). */
export function createReloadGate(minGapMs: number, clock: () => number = () => Date.now()): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const t = clock();
    if (t - last < minGapMs) return false;
    last = t;
    return true;
  };
}

/** Zieh-Fortschritt 0..1+ (1 = Schwelle erreicht). Nur nach unten und überwiegend senkrecht, sonst 0 (Wisch-Aktionen, Quer-Scrollen). */
export function pullProgress(dx: number, dy: number): number {
  if (dy <= 0 || Math.abs(dx) >= dy) return 0;
  return (dy * DAMPING) / (PULL_THRESHOLD * DAMPING);
}
