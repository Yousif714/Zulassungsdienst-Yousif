'use client';

import { useEffect, useRef, useState } from 'react';

import type { Action } from '@/domain/types';

import { DemoBadge } from './DemoBadge';
import { IconCheck, IconWarning } from './Icons';

type Props = {
  /** Die Aktion (gespeichert oder noch lokal). Der Entwurfstext steht in `payload.text`. */
  action: Action;
  onSend: () => void;
  /** Neuer Entwurfstext nach „Ändern“. Der Aufrufer schickt `editAction` (erhöht die Version). */
  onEdit: (text: string) => void;
  onLater: () => void;
};

/** Vorbereitete Aktion mit Entwurf: Senden (Demo) · Ändern · Später. Zeigt nach der Ausführung das Ergebnis. */
export function ActionSheet({ action, onSend, onEdit, onLater }: Props) {
  const text = typeof action.payload.text === 'string' ? action.payload.text : '';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const editor = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const backToEdit = useRef(false);
  const prevStatus = useRef(action.status);

  // Fokus folgt dem Zustand: Editor beim Ändern, danach zurück auf „Ändern“.
  useEffect(() => {
    if (editing) editor.current?.focus();
    else if (backToEdit.current) {
      backToEdit.current = false;
      editButton.current?.focus();
    }
  }, [editing]);

  // Nach dem Senden (Wechsel weg vom Entwurf) auf die Statusmeldung, damit sie nicht im Leeren endet.
  useEffect(() => {
    if (prevStatus.current === 'draft' && action.status !== 'draft') status.current?.focus();
    prevStatus.current = action.status;
  }, [action.status]);

  const startEdit = () => {
    setValue(text);
    setEditing(true);
  };
  const stopEdit = (save: boolean) => {
    backToEdit.current = true;
    setEditing(false);
    if (save && value.trim() && value !== text) onEdit(value);
  };

  const statusText =
    action.status === 'executed' ? 'Gesendet (Demo)'
      : action.status === 'failed' ? `Fehlgeschlagen${action.error ? `: ${action.error}` : ''}`
        : action.status === 'uncertain' ? 'Ausgang unklar'
          : action.status === 'approved' || action.status === 'executing' ? 'Wird gesendet …'
            : '';
  const isError = action.status === 'failed' || action.status === 'uncertain';

  return (
    <section className="action-sheet" data-testid="action-sheet" data-status={action.status} aria-label={action.title}>
      <div className="action-sheet-head">
        <span>{action.title}</span>
        <DemoBadge />
      </div>

      {editing ? (
        <textarea
          ref={editor}
          className="action-sheet-editor"
          data-testid="draft-editor"
          aria-label="Entwurf bearbeiten"
          value={value}
          rows={8}
          onChange={(e) => setValue(e.target.value)}
        />
      ) : (
        <div className="action-sheet-text" data-testid="draft-text">{text}</div>
      )}

      {action.status === 'draft' && !editing && (
        <div className="action-sheet-buttons">
          <button type="button" className="btn btn-primary" onClick={onSend}>
            <span>Senden</span>
            <DemoBadge />
          </button>
          <button ref={editButton} type="button" className="btn btn-secondary" onClick={startEdit}>Ändern</button>
          <button type="button" className="btn btn-plain" onClick={onLater}>Später</button>
        </div>
      )}
      {action.status === 'draft' && editing && (
        <div className="action-sheet-buttons">
          <button type="button" className="btn btn-primary" onClick={() => stopEdit(true)}>Übernehmen</button>
          <button type="button" className="btn btn-plain" onClick={() => stopEdit(false)}>Abbrechen</button>
        </div>
      )}

      {/* Immer vorhanden (anfangs leer), damit Screenreader die spätere Meldung ansagen. */}
      <div ref={status} tabIndex={-1} role="status" data-testid="action-status"
        className={statusText ? `action-sheet-result${isError ? ' action-sheet-error' : ''}` : 'action-sheet-status-empty'}>
        {action.status === 'executed' && <span className="action-sheet-ok"><IconCheck /></span>}
        {isError && <IconWarning />}
        {statusText && <span>{statusText}</span>}
      </div>
    </section>
  );
}
