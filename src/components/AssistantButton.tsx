import Link from 'next/link';

import { IconSparkles } from './Icons';

/** Schwebender Knopf, öffnet den Chat mit dem Assistenten. */
export function AssistantButton() {
  return (
    <Link href="/chat" className="assistant-button" data-testid="assistant-button" aria-label="Assistent fragen">
      <IconSparkles size={26} />
    </Link>
  );
}
