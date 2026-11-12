'use client';

import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react';

import { DemoBadge } from '@/components/DemoBadge';
import { Bubble, ContactHeader, LinkCards, RichText, TimeStamp, TypingBubble, placeMessages, type Placed } from '@/components/Messages';
import { useAI } from '@/data/ai-client';
import { useAppStore } from '@/data/store';
import { draftLink } from '@/domain/assistant';
import { buildBriefing, renderBriefingText } from '@/domain/briefing';
import { formatBerlin, now, todayBerlin } from '@/domain/clock';
import { chooseDelivery } from '@/domain/scheduler';
import type { AssistantMessage } from '@/domain/types';

const FOREIGN_NUMBER = '+4917099999';
const DELIVERY_LABEL = { whatsapp_freeform: 'WhatsApp', whatsapp_template: 'WhatsApp-Vorlage', push: 'Push' } as const;
const WINDOW_MS = 24 * 3_600_000;
/** So lange „schreibt“ der Assistent, bevor eine neue Antwort erscheint. */
const TYPING_MS = 750;

type Button = NonNullable<AssistantMessage['buttons']>[number];

function stampLabel(iso: string): string {
  const d = new Date(iso);
  return todayBerlin(d) === todayBerlin(now()) ? `Heute ${formatBerlin(d, 'HH:mm')}` : formatBerlin(d, 'dd.MM. HH:mm');
}

type LinkRef = NonNullable<AssistantMessage['links']>[number];

/**
 * `onButton` fehlt im Echtmodus: Knopf-Freigaben kommen dort nur über WhatsApp (Webhook), nicht aus der App.
 * Statt der Knöpfe zeigt der Echtmodus `draft`, den Link „Entwurf öffnen“.
 */
function Message({ p, fresh, onButton, draft }: { p: Placed<AssistantMessage>; fresh: boolean; onButton?: (b: Button) => void; draft?: LinkRef | null }) {
  const m = p.item;
  if (m.direction === 'ignored') {
    return (
      <li className="wa-ignored" data-testid="wa-ignored">
        <span>{m.from}: {m.text}</span>
      </li>
    );
  }
  return (
    <li className="imsg-row" data-side={p.side} data-first={p.first} data-testid="wa-msg">
      <Bubble side={p.side} tail={p.tail} enter={fresh}><RichText text={m.text} /></Bubble>
      {m.links && <LinkCards links={m.links} />}
      {draft && <LinkCards links={[draft]} />}
      {m.buttons && onButton && (
        <div className="imsg-pills">
          {m.buttons.map((b) => (
            <button key={b.label} type="button" className="imsg-pill" data-kind={b.label === 'Senden' ? 'primary' : undefined} onClick={() => onButton(b)}>{b.label}</button>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * Wie viele Nachrichten sichtbar sind. Neue Antworten des Assistenten erscheinen erst nach kurzem
 * Tipp-Indikator; eigene und ignorierte Nachrichten sofort. Beim Öffnen ist alles sofort da.
 */
function useReveal(chat: AssistantMessage[]) {
  const [shown, setShown] = useState(chat.length);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const length = chat.length;
  const nextIsReply = shown < length && chat[shown].direction === 'to_owner';

  // Demo zurückgesetzt: Zähler während des Renderns anpassen (React-Muster für abgeleiteten Zustand).
  if (shown > length) setShown(length);

  useEffect(() => {
    if (shown >= length) return;
    const id = chat[shown].id;
    const t = setTimeout(() => {
      setFresh((f) => new Set(f).add(id));
      setShown((n) => n + 1);
    }, nextIsReply ? TYPING_MS : 0);
    return () => clearTimeout(t);
  }, [chat, shown, length, nextIsReply]);

  return { visible: chat.slice(0, Math.min(shown, length)), typing: nextIsReply, fresh };
}

export default function AssistentPage() {
  const { state, dispatch, mode } = useAppStore();
  const ai = useAI();
  const demo = mode === 'demo';
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const chat = state.assistantChat;
  const { visible, typing, fresh } = useReveal(chat);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [visible.length, typing]);

  const send = async (text: string) => {
    setBusy(true);
    setError('');
    try {
      await ai.sendToAssistant(text);
    } catch {
      setError('Nachricht konnte nicht gesendet werden.');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void send(text);
  };

  const briefing = (kind: 'morning' | 'evening') => {
    const at = now();
    const lastOwner = chat.filter((m) => m.direction === 'from_owner').at(-1);
    const via = chooseDelivery({
      waConfigured: state.connections.find((c) => c.id === 'whatsapp_assistent')?.status === 'connected',
      windowOpenUntil: lastOwner ? new Date(Date.parse(lastOwner.at) + WINDOW_MS).toISOString() : null,
      templateApproved: true,
    }, at);
    const text = renderBriefingText(buildBriefing(state, kind, at));
    dispatch({ type: 'assistantOutbound', text: `${text}\n\nZustellweg: ${DELIVERY_LABEL[via]}` });
  };

  return (
    <>
      <ContactHeader name="Nexus Assistent" initials="NA" note={demo ? <DemoBadge /> : undefined} />

      {demo && <section className="list-group" aria-labelledby="wa-tools">
        <h2 id="wa-tools" className="list-group-title">Demo-Werkzeuge</h2>
        <div className="wa-tools">
          <button type="button" className="btn btn-secondary" onClick={() => briefing('morning')}>Morgenbriefing auslösen</button>
          <button type="button" className="btn btn-secondary" onClick={() => briefing('evening')}>Abendrückblick auslösen</button>
          {/* Fremde Absender ignoriert der Assistent ohne KI; das Ereignis reicht. */}
          <button type="button" className="btn btn-secondary" onClick={() => dispatch({ type: 'assistantInbound', from: FOREIGN_NUMBER, text: 'Hallo, wer ist da?' })}>
            Nachricht von fremder Nummer simulieren
          </button>
        </div>
      </section>}

      <div className="wa-chat">
        {chat.length === 0 ? (
          <p className="wa-empty">{demo ? 'Noch keine Nachrichten. Schreib dem Assistenten oder löse ein Briefing aus.' : 'Noch keine Nachrichten. Schreib dem Assistenten.'}</p>
        ) : (
          <ol className="imsg-list" aria-live="polite">
            {placeMessages(visible, (m) => (m.direction === 'ignored' ? null : m.direction === 'from_owner' ? 'out' : 'in'), (m) => m.at).map((p) => (
              <Fragment key={p.item.id}>
                {p.stamp && <TimeStamp dateTime={p.item.at}>{stampLabel(p.item.at)}</TimeStamp>}
                <Message p={p} fresh={fresh.has(p.item.id)}
                  onButton={demo ? (button) => dispatch({ type: 'assistantButton', button }) : undefined}
                  draft={!demo && p.item.buttons?.length ? draftLink(state, p.item.buttons[0].actionId) : null} />
              </Fragment>
            ))}
            {typing && <li className="imsg-row" data-side="in"><TypingBubble /></li>}
          </ol>
        )}
        <div ref={endRef} className="imsg-end" />
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}
      <form className="composer" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="wa-input">Nachricht an den Assistenten</label>
        <input id="wa-input" data-testid="wa-input" className="composer-input" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Nachricht" autoComplete="off" />
        <button type="submit" data-testid="wa-send" className="btn btn-primary" aria-label="Nachricht senden" disabled={!input.trim() || busy}>
          Senden
        </button>
      </form>
    </>
  );
}
