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

/** Zählt Schreibzugriffe und Zustandswechsel, damit ein langsam geladener Zustand einen neueren nicht überschreibt. */
export function createWriteTracker() {
  let pending = 0;
  let epoch = 0;
  return {
    begin() { pending += 1; epoch += 1; },
    end() { pending -= 1; epoch += 1; },
    /** Ein anderer Weg (KI-Antwort, Abgleich) hat einen neueren Zustand gesetzt. */
    bump() { epoch += 1; },
    get pending() { return pending; },
    /** Stand vor dem Laden merken. */
    snapshot() { return epoch; },
    /** Darf ein seit `snap` geladener Zustand übernommen werden? */
    canApply(snap: number) { return pending === 0 && epoch === snap; },
  };
}

/** Das Minimum eines DOM-Elements, das die Prüfung braucht (testbar ohne Browser). */
export interface PullNode {
  parentElement: PullNode | null;
  scrollTop: number;
  tagName: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

/** Soll ein Zug, der hier beginnt, nicht als „Herunterziehen“ gelten? Eingabefelder, Dialoge/Sheets, weiter oben gescrollte Bereiche. */
export function pullBlocked(target: PullNode | null): boolean {
  for (let n = target; n; n = n.parentElement) {
    if (n.hasAttribute('data-no-pull') || n.getAttribute('role') === 'dialog') return true;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName)) return true;
    if (n.scrollTop > 0) return true;
  }
  return false;
}
