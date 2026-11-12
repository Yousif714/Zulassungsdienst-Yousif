'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { demoAI } from '@/ai/demo-ai';
import type { ChatAnswer } from '@/ai/provider';
import { PageHeader } from '@/components/PageHeader';
import { useAppStore } from '@/data/store';
import { now } from '@/domain/clock';

const QUESTIONS = [
  'Wer ist bei NEXUS überfällig?',
  'Was ist heute noch offen?',
  'Was fehlt für SEELE?',
  'Was ist mit dem Auftrag von Autohaus Schmidt?',
  'Wie viel Geld kommt diesen Monat noch rein?',
];

type Turn = { id: number; question: string; answer: ChatAnswer | null };

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
    const answer = await demoAI.answer(q, state, now());
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

      <ol className="bubbles chat-log" aria-live="polite">
        {turns.map((t) => (
          <li key={t.id} className="chat-turn">
            <div className="bubble" data-direction="out"><div className="bubble-body">{t.question}</div></div>
            <div className="bubble" data-testid="chat-answer">
              {t.answer ? (
                <>
                  <div className="bubble-body">{t.answer.text}</div>
                  {t.answer.links.length > 0 && (
                    <div className="link-chips">
                      {t.answer.links.map((l) => <Link key={l.href + l.label} href={l.href} className="link-chip">{l.label}</Link>)}
                    </div>
                  )}
                </>
              ) : (
                <div className="bubble-body">…</div>
              )}
            </div>
          </li>
        ))}
      </ol>
      <div ref={endRef} />

      <form className="composer" onSubmit={submit}>
        <label className="visually-hidden" htmlFor="chat-input">Frage</label>
        <input id="chat-input" data-testid="chat-input" className="composer-input" value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Frage eingeben" autoComplete="off" />
        <button type="submit" data-testid="chat-send" className="btn btn-primary" disabled={!input.trim()}>Fragen</button>
      </form>
    </>
  );
}
