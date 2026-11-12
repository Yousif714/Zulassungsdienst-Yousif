'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';

import { BackLink } from '@/components/BackLink';
import { PageHeader } from '@/components/PageHeader';
import { useAI } from '@/data/ai-client';
import { useAppStore } from '@/data/store';
import { formatBerlin } from '@/domain/clock';
import { gammaText, slideHeading } from '@/domain/slides';
import type { Call } from '@/domain/types';

type Slide = Call['slides'][number];

const STATUS_LABEL: Record<Call['slidesStatus'], string> = { todo: 'Noch keine Folientexte', draft: 'Entwurf', reviewed: 'Geprüft', copied: 'Kopiert' };

function SlideEditor({ slide, onSave }: { slide: Slide; onSave: (s: Slide) => void }) {
  const [title, setTitle] = useState(slideHeading(slide));
  const [body, setBody] = useState(slide.body);
  // Gespeicherte Änderungen übernehmen, ohne die Zeile neu einzuhängen (Fokus und Cursor bleiben erhalten).
  const [saved, setSaved] = useState(slide);
  if (saved.title !== slide.title || saved.body !== slide.body) {
    setSaved(slide);
    setTitle(slideHeading(slide));
    setBody(slide.body);
  }
  const commit = () => {
    const next = { ...slide, title: `Folie ${slide.position}: ${title.trim()}`, body };
    if (next.title !== slide.title || next.body !== slide.body) onSave(next);
  };
  return (
    <li className="slide" data-testid="slide">
      <div className="slide-no">Folie {slide.position}</div>
      <label className="visually-hidden" htmlFor={`slide-title-${slide.position}`}>Titel Folie {slide.position}</label>
      <input id={`slide-title-${slide.position}`} className="slide-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={commit} />
      <label className="visually-hidden" htmlFor={`slide-body-${slide.position}`}>Text Folie {slide.position}</label>
      <textarea id={`slide-body-${slide.position}`} className="slide-body" value={body} rows={4} onChange={(e) => setBody(e.target.value)} onBlur={commit} />
    </li>
  );
}

export default function CallPage() {
  const { id } = useParams<{ id: string }>();
  const { state, dispatch } = useAppStore();
  const ai = useAI();
  const call = state.calls.find((c) => c.id === id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const back = <BackLink href="/nexus" label="NEXUS" />;

  if (!call) {
    return (
      <>
        <PageHeader title="Call" trailing={back} />
        <div className="empty-state">Diesen Call gibt es nicht.</div>
      </>
    );
  }

  const setSlides = (slides: Slide[], status: Call['slidesStatus']) => dispatch({ type: 'setSlides', callId: call.id, slides, status });

  const prepare = async () => {
    setBusy(true);
    try {
      setSlides(await ai.slidesFor(call.id), 'draft');
    } catch {
      setError('Folientexte konnten nicht erstellt werden.');
    } finally {
      setBusy(false);
    }
  };

  const save = (next: Slide) => setSlides(call.slides.map((s) => (s.position === next.position ? next : s)), 'draft');

  const copy = async () => {
    setError('');
    try {
      await navigator.clipboard.writeText(gammaText(call.slides));
      setSlides(call.slides, 'copied');
    } catch {
      setError('Kopieren nicht möglich: Die Zwischenablage ist nicht freigegeben.');
    }
  };

  const hasSlides = call.slides.length > 0;
  const startsAt = new Date(call.startsAt);

  return (
    <>
      <PageHeader title={call.series} subtitle={`${call.topic} · ${formatBerlin(startsAt, 'dd.MM.yyyy, HH:mm')} Uhr`} trailing={back} />

      <section className="list-group" aria-labelledby="slides-state-title">
        <h2 id="slides-state-title" className="list-group-title">Folienstand</h2>
        <div className="card">
          <div className="card-head">
            <div className="card-title">{call.slides.length} von {call.slideCount} Folien</div>
            <span className="chip" data-status={call.slidesStatus} data-testid="slides-status">{STATUS_LABEL[call.slidesStatus]}</span>
          </div>
          <div className="card-buttons">
            {!hasSlides && (
              <button type="button" className="btn btn-primary" onClick={prepare} disabled={busy}>Folientexte vorbereiten</button>
            )}
            {hasSlides && call.slidesStatus === 'draft' && (
              <button type="button" className="btn btn-secondary" onClick={() => setSlides(call.slides, 'reviewed')}>Geprüft</button>
            )}
            {hasSlides && (
              <button type="button" className="btn btn-primary" onClick={copy}>Für Gamma kopieren</button>
            )}
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
      </section>

      {hasSlides && (
        <section className="list-group" aria-labelledby="slides-title">
          <h2 id="slides-title" className="list-group-title">Folien</h2>
          <ol className="slides">
            {call.slides.map((s) => <SlideEditor key={s.position} slide={s} onSave={save} />)}
          </ol>
        </section>
      )}
    </>
  );
}
