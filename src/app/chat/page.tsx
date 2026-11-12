'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';

import { demoAI } from '@/ai/demo-ai';
import { createStateTools } from '@/ai/tools';
import type { ChatAnswer } from '@/ai/provider';
import { Bubble, LinkCards, RichText, TimeStamp, TypingBubble } from '@/components/Messages';
import { PageHeader } from '@/components/PageHeader';
import { useAppStore } from '@/data/store';
import { formatBerlin, now } from '@/domain/clock';

const QUESTIONS = [
  'Wer ist bei NEXUS überfällig?',
  'Was ist heute noch offen?',
  'Was fehlt für SEELE?',
  'Was ist mit dem Auftrag von Autohaus Schmidt?',
  'Wie viel Geld kommt diesen Monat noch rein?',
];

type Turn = { id: number; question: string; answer: ChatAnswer | null };

/** Kurze Denkpause mit Tipp-Indikator, damit die Antwort nicht hart hereinspringt. */
const TYPING_MS = 750;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function ChatPage() {
  const { state } = useAppStore();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const nextId = useRef(1);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [turns]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q) return;
    const id = nextId.current++;
    setTurns((t) => [...t, { id, question: q, answer: null }]);
    const [answer] = await Promise.all([demoAI.answer(q, { now: now(), tools: createStateTools(state, now()) }), pause(TYPING_MS)]);
    setTurns((t) => t.map((x) => (x.id === id ? { ...x, answer } : x)));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(input);
    setInput('');
  };

  return (
    <>
      <PageHeader title="Chat" subtitle="Frag den Assistenten nach deinen Zahlen und Aufgaben." />

      <section className="list-group" aria-labelledby="chat-suggestions">
        <h2 id="chat-suggestions" className="list-group-title">Vorschläge</h2>
        <div className="chat-suggestions">
          {QUESTIONS.map((q) => (
            <button key={q} type="button" className="btn btn-secondary chat-suggestion" onClick={() => void ask(q)}>{q}</button>
          ))}
        </div>
      </section>

      <ol className="imsg-list chat-log" aria-live="polite">
        {turns.length > 0 && <TimeStamp>Heute {formatBerlin(now(), 'HH:mm')}</TimeStamp>}
        {turns.map((t) => (
          <li key={t.id} className="chat-turn">
            <div className="imsg-row" data-side="out">
              <Bubble side="out" tail enter>{t.question}</Bubble>
            </div>
            <div className="imsg-row" data-side="in" data-testid="chat-answer">
              {t.answer ? (
                <>
                  <Bubble side="in" tail enter><RichText text={t.answer.text} /></Bubble>
                  <LinkCards links={t.answer.links} />
                </>
              ) : (
                <TypingBubble />
              )}
            </div>
          </li>
        ))}
      </ol>
      <div ref={endRef} className="imsg-end" />

      <form className="composer" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="chat-input">Frage</label>
        <input id="chat-input" data-testid="chat-input" className="composer-input" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Frage eingeben" autoComplete="off" />
        <button type="submit" data-testid="chat-send" className="btn btn-primary" disabled={!input.trim()}>Fragen</button>
      </form>
    </>
  );
}
