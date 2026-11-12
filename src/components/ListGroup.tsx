import { Children, type ReactNode } from 'react';

/** Gruppierte Liste mit Einzug (iOS-Einstellungen). Jedes Kind (`ListRow`/`TaskRow`) wird eine Zeile mit Haarlinie dazwischen. */
export function ListGroup({ title, children, testId }: { title?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="list-group" data-testid={testId}>
      {title && <h2 className="list-group-title">{title}</h2>}
      <ul className="list-group-body">
        {Children.toArray(children).map((row, i) => (
          <li key={(row as { key?: string | null }).key ?? i}>{row}</li>
        ))}
      </ul>
    </section>
  );
}
