import type { Call } from './types';

type Slide = Call['slides'][number];

/** Folientitel ohne vorangestelltes „Folie n:“. */
export const slideHeading = (s: Slide): string => s.title.replace(/^Folie\s+\d+:\s*/, '');

/** Gamma-Eingabe: pro Folie `# Folie n: Titel`, Leerzeile, Text, Trenner `---`. */
export function gammaText(slides: Slide[]): string {
  return slides.map((s) => `# Folie ${s.position}: ${slideHeading(s)}\n\n${s.body}\n\n---\n\n`).join('');
}
