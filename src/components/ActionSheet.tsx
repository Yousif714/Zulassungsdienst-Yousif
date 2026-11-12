'use client';

import { useState } from 'react';

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

  const startEdit = () => {
    setValue(text);
    setEditing(true);
  };
  const saveEdit = () => {
    setEditing(false);
    if (value.trim() && value !== text) onEdit(value);
  };

  return (
    <section className="action-sheet" data-testid="action-sheet" data-status={action.status} aria-label={action.title}>
      <div className="action-sheet-head">
        <span>{action.title}</span>
        <DemoBadge />
      </div>

      {editing ? (
        <textarea
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
          <button type="button" className="btn btn-secondary" onClick={startEdit}>Ändern</button>
          <button type="button" className="btn btn-plain" onClick={onLater}>Später</button>
        </div>
      )}
      {action.status === 'draft' && editing && (
        <div className="action-sheet-buttons">
          <button type="button" className="btn btn-primary" onClick={saveEdit}>Übernehmen</button>
          <button type="button" className="btn btn-plain" onClick={() => setEditing(false)}>Abbrechen</button>
        </div>
      )}

      {action.status === 'executed' && (
        <div className="action-sheet-result" data-testid="action-status" role="status">
          <span className="action-sheet-ok"><IconCheck /></span>
          <span>Gesendet (Demo)</span>
        </div>
      )}
      {(action.status === 'failed' || action.status === 'uncertain') && (
        <div className="action-sheet-result action-sheet-error" data-testid="action-status" role="status">
          <IconWarning />
          <span>{action.status === 'failed' ? `Fehlgeschlagen${action.error ? `: ${action.error}` : ''}` : 'Ausgang unklar'}</span>
        </div>
      )}
      {(action.status === 'approved' || action.status === 'executing') && (
        <div className="action-sheet-result" data-testid="action-status" role="status">Wird gesendet …</div>
      )}
    </section>
  );
}
