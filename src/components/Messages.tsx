import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

import { IconChevron } from './Icons';

/**
 * Nachrichten im Stil von iMessage: Blasen mit Schwänzchen am Ende einer Gruppe, Zeitstempel nur
 * zwischen Gruppen, Tipp-Indikator, Link-Karten und Pillen-Knöpfe unter der Blase.
 */

export { placeMessages, type Placed, type Side } from './message-groups';
import type { Side } from './message-groups';

/** Zeitstempel zwischen Gruppen: mittig, klein, grau. */
export function TimeStamp({ children, dateTime }: { children: ReactNode; dateTime?: string }) {
  return (
    <li className="imsg-stamp" role="presentation">
      {dateTime ? <time dateTime={dateTime}>{children}</time> : children}
    </li>
  );
}

/** Beträge („1.234,56 €“) fett; interne Pfade („/nexus/…“) aus älteren Nachrichten als Link. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(-?\d{1,3}(?:\.\d{3})*(?:,\d{2})?\s€|(?<=^|\s)\/[a-z][\w\-/]*)/gi).map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        if (part.startsWith('/')) return <Link key={i} href={part} className="imsg-inline-link">{part}</Link>;
        return <strong key={i} className="imsg-amount">{part}</strong>;
      })}
    </>
  );
}

/** Die Blase selbst. `enter` = gerade angekommen (weiches Einblenden). */
export function Bubble({ side, tail, children, enter, className }: { side: Side; tail: boolean; children: ReactNode; enter?: boolean; className?: string }) {
  const cls = ['imsg-bubble', enter && 'imsg-enter', className].filter(Boolean).join(' ');
  return <div className={cls} data-side={side} data-tail={tail}>{children}</div>;
}

/** Drei pulsierende Punkte, solange der Assistent „schreibt“. */
export function TypingBubble({ label = 'Assistent schreibt …' }: { label?: string }) {
  return (
    <div className="imsg-bubble imsg-typing imsg-enter" data-side="in" data-tail="true" role="status" aria-label={label}>
      <span className="typing" aria-hidden="true"><span /><span /><span /></span>
    </div>
  );
}

/** Links als kleine Karten unter der Blase (Titel + Pfeil). Der zugängliche Name ist der Titel. */
export function LinkCards({ links }: { links: { label: string; href: string }[] }) {
  if (links.length === 0) return null;
  return (
    <div className="imsg-links">
      {links.map((l) => (
        <Link key={l.href + l.label} href={l.href} className="link-card">
          <span className="link-card-label">{l.label}</span>
          <IconChevron className="link-card-chevron" />
        </Link>
      ))}
    </div>
  );
}

/** Kopf wie in iMessage: rundes Avatar mit Initialen, Name, darunter klein ein Zusatz. */
export function ContactHeader({ name, initials, note }: { name: string; initials: string; note?: ReactNode }) {
  return (
    <header className="contact-header">
      <div className="contact-avatar" aria-hidden="true">{initials}</div>
      <h1 className="contact-name">{name}</h1>
      {note && <div className="contact-note">{note}</div>}
    </header>
  );
}
