import { IconSparkles } from './Icons';
import { PageHeader } from './PageHeader';

/** Platzhalterseite mit großem Titel, bis der Bereich gebaut ist. */
export function Placeholder({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="empty-state">
        <IconSparkles size={40} />
        <div>Dieser Bereich folgt in Kürze.</div>
      </div>
    </>
  );
}
