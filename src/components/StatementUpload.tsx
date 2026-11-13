'use client';

import { useState } from 'react';

import { useAppStore } from '@/data/store';
import { unzip } from '@/data/xlsx';
import { now } from '@/domain/clock';
import { NOT_SPARKASSE, parseSparkasse, type SparkasseResult } from '@/domain/import/sparkasse';
import { previewStatement, previewText, statementSummary, summaryText } from '@/domain/import/statement';

export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;

const TOO_BIG = 'Die Datei ist zu groß (über 5 MB).';

/** Datei in die Liste der zu lesenden Auszugsdateien wandeln; ZIP wird hier (Data-Schicht) entpackt, nur .xml-Einträge. */
async function readFiles(file: File): Promise<{ name: string; bytes: Uint8Array }[]> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!file.name.toLowerCase().endsWith('.zip')) return [{ name: file.name, bytes }];
  const entries = await unzip(bytes);
  return [...entries].filter(([name]) => name.toLowerCase().endsWith('.xml')).map(([name, b]) => ({ name, bytes: b }));
}

/** Sparkassen-Auszug (CAMT, CSV oder ZIP) wählen, Vorschau zeigen, übernehmen und Ergebnis zusammenfassen. Die Datei verlässt den Browser nicht. */
export function StatementUpload() {
  const { state, dispatch } = useAppStore();
  const [parsed, setParsed] = useState<SparkasseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [before, setBefore] = useState<ReadonlySet<string> | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setParsed(null);
    setBefore(null);
    setError(null);
    if (file.size > MAX_STATEMENT_BYTES) {
      setError(TOO_BIG);
      return;
    }
    let files: { name: string; bytes: Uint8Array }[];
    try {
      files = await readFiles(file);
    } catch (err) {
      setError(err instanceof Error && /zu groß/.test(err.message) ? err.message : NOT_SPARKASSE);
      return;
    }
    const r = parseSparkasse(files);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setParsed(r);
  }

  async function take() {
    if (!parsed) return;
    const known = new Set(state.payments.map((p) => p.id));
    setBusy(true);
    const { ok } = await dispatch({ type: 'importBankStatement', connectionId: 'bank_sparkasse', payments: parsed.payments, statementTo: parsed.to! });
    setBusy(false);
    if (ok === false) return; // Fehlermeldung zeigt der Store; Vorschau bleibt stehen
    setBefore(known);
    setParsed(null);
  }

  const preview = parsed ? previewStatement(parsed, state.payments) : null;
  const newIds = before ? state.payments.filter((p) => p.connectionId === 'bank_sparkasse' && !before.has(p.id)).map((p) => p.id) : null;

  return (
    <section className="list-group" data-testid="statement-upload" aria-labelledby="statement-upload-title">
      <h2 id="statement-upload-title" className="list-group-title">Sparkassen-Auszug</h2>
      <div className="note-card sim-form">
        <p className="list-row-subtitle">Im Online-Banking den Auszug als CAMT (XML, auch als ZIP) oder CSV exportieren und hier wählen. Die Datei bleibt auf diesem Gerät.</p>
        <label className="field">Kontoauszug-Datei
          <input type="file" accept=".xml,.zip,.csv,.txt" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {preview && (
          <div data-testid="statement-preview">
            {previewText(preview).map((line, i) => <p key={i} className={i === 0 ? 'list-row-title' : 'list-row-subtitle'}>{line}</p>)}
            <div className="card-buttons">
              <button type="button" className="btn btn-primary" disabled={!preview.takeable || busy} onClick={() => { void take(); }}>{preview.fresh === 0 ? 'Stand übernehmen' : 'Übernehmen'}</button>
            </div>
          </div>
        )}
        {newIds && <p className="list-row-title" role="status" data-testid="statement-summary">{summaryText(statementSummary(state, newIds, now()))}</p>}
      </div>
    </section>
  );
}
