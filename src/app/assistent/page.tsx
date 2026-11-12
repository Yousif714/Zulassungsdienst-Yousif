'use client';

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { demoAI } from '@/ai/demo-ai';
import { DemoBadge } from '@/components/DemoBadge';
import { PageHeader } from '@/components/PageHeader';
import { useAppStore } from '@/data/store';
import { handleInbound } from '@/domain/assistant';
import { buildBriefing, renderBriefingText } from '@/domain/briefing';
import { formatBerlin, now } from '@/domain/clock';
import { chooseDelivery } from '@/domain/scheduler';
import type { AssistantMessage } from '@/domain/types';

const FOREIGN_NUMBER = '+4917099999';
const DELIVERY_LABEL = { whatsapp_freeform: 'WhatsApp', whatsapp_template: 'WhatsApp-Vorlage', push: 'Push' } as const;
const WINDOW_MS = 24 * 3_600_000;

/** Interne Pfade („/nexus/…“) im Text werden antippbare Links. */
function linkify(text: string): ReactNode[] {
  return text.split(/((?<=^|\s)\/[a-z][\w\-/]*)/gi).map((part, i) =>
    /^\/[a-z]/i.test(part) ? <Link key={i} href={part}>{part}</Link> : <Fragment key={i}>{part}</Fragment>,
  );
}

function Bubble({ m, onButton }: { m: AssistantMessage; onButton: (b: NonNullable<AssistantMessage['buttons']>[number]) => void }) {
  const time = formatBerlin(new Date(m.at), 'HH:mm');
  if (m.direction === 'ignored') {
    return (
      <li className="wa-ignored" data-testid="wa-ignored">
        <span>{m.from}: {m.text}</span>
      </li>
    );
  }
  return (
    <li className="wa-bubble" data-direction={m.direction} data-testid="wa-msg">
      <div className="bubble-body">{linkify(m.text)}</div>
      <span className="bubble-time">{time}</span>
      {m.buttons && (
        <div className="wa-buttons">
          {m.buttons.map((b) => (
            <button key={b.label} type="button" className="wa-button" onClick={() => onButton(b)}>{b.label}</button>
          ))}
        </div>
      )}
    </li>
  );
}

export default function AssistentPage() {
  const { state, dispatch } = useAppStore();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const chat = state.assistantChat;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [chat.length]);

  const inbound = async (from: string, text: string) => {
    setBusy(true);
    try {
      const r = await handleInbound(state, from, text, now(), demoAI);
      r.events.forEach(dispatch);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    void inbound(state.settings.ownerPhone, text);
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
      <PageHeader title="Nexus Assistent" subtitle="WhatsApp, simuliert" badge={<DemoBadge />} />

      <section className="list-group" aria-labelledby="wa-tools">
        <h2 id="wa-tools" className="list-group-title">Demo-Werkzeuge</h2>
        <div className="wa-tools">
          <button type="button" className="btn btn-secondary" onClick={() => briefing('morning')}>Morgenbriefing auslösen</button>
          <button type="button" className="btn btn-secondary" onClick={() => briefing('evening')}>Abendrückblick auslösen</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void inbound(FOREIGN_NUMBER, 'Hallo, wer ist da?')}>
            Nachricht von fremder Nummer simulieren
          </button>
        </div>
      </section>

      <div className="wa-chat">
        {chat.length === 0 ? (
          <p className="wa-empty">Noch keine Nachrichten. Schreib dem Assistenten oder löse ein Briefing aus.</p>
        ) : (
          <ol className="wa-list" aria-live="polite">
            {chat.map((m) => (
              <Bubble key={m.id} m={m} onButton={(button) => dispatch({ type: 'assistantButton', button })} />
            ))}
          </ol>
        )}
        <div ref={endRef} />
      </div>

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
