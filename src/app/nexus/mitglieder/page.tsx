'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { BackLink } from '@/components/BackLink';
import { ListRow } from '@/components/ListRow';
import { PageHeader } from '@/components/PageHeader';
import { ProposalCard } from '@/components/ProposalCard';
import { Segmented } from '@/components/Segmented';
import { TrafficDot } from '@/components/TrafficDot';
import { portalRows } from '@/data/selectors';
import { useAppStore } from '@/data/store';
import { readXlsxRows } from '@/data/xlsx';
import { formatBerlinDe, formatIsoDe, now, todayBerlin } from '@/domain/clock';
import { decodeListFile, parsePortalList, parsePortalRows } from '@/domain/import/portal-list';
import { portalProposal, portalSummary, type PortalStatus } from '@/domain/portal';
import type { PortalMember } from '@/domain/types';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

type Filter = 'all' | 'no_invoice' | 'proposal' | 'contract';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Alle' }, { value: 'no_invoice', label: 'Ohne Rechnung' }, { value: 'proposal', label: 'Vorschlag' }, { value: 'contract', label: 'Vertrag' },
];

const STATUS_RANK: Record<PortalStatus, number> = { no_invoice: 0, invoice_only: 1, proposal: 2, contract: 3, ignored: 4 };

const dateText = (text: string | undefined, iso: string | null | undefined): string | null => text || (iso ? formatIsoDe(iso) : null);

export default function PortalMembersPage() {
  const { state, dispatch } = useAppStore();
  const router = useRouter();
  const today = todayBerlin(now());
  const rows = portalRows(state, today);
  const summary = portalSummary(rows);
  const [filter, setFilter] = useState<Filter>('all');
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [fileRows, setFileRows] = useState<{ name: string; rows: string[][] } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  const showImport = open || state.portalMembers.length === 0;
  const preview = useMemo(() => (fileRows ? parsePortalRows(fileRows.rows) : parsePortalList(text)), [fileRows, text]);
  const n = preview.entries.length;

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    const fail = (msg: string) => { setFileRows(null); setFileError(msg); };
    if (file.size > MAX_FILE_BYTES) return fail('Die Datei ist zu groß (über 2 MB). Bitte nur die Mitgliederliste exportieren.');
    const isXlsx = /\.xlsx$/i.test(file.name);
    if (!isXlsx && !/\.(csv|txt)$/i.test(file.name)) return fail('Dieses Dateiformat wird nicht gelesen. Bitte Excel (.xlsx) oder CSV wählen oder die Liste einfügen.');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (isXlsx) {
        setFileRows({ name: file.name, rows: await readXlsxRows(bytes) });
        setText('');
      } else {
        setFileRows(null);
        setText(decodeListFile(bytes));
      }
    } catch (err) {
      fail(err instanceof Error && /zu groß/.test(err.message) ? err.message : 'Die Datei konnte nicht gelesen werden. Bitte als Excel (.xlsx) oder CSV speichern oder die Liste einfügen.');
    }
  }

  async function doImport() {
    const { ok } = await dispatch({ type: 'importPortalList', entries: preview.entries });
    if (ok === false) return; // Fehlermeldung zeigt der Store; Eingabe bleibt stehen
    setText('');
    setFileRows(null);
    setOpen(false);
  }

  const visible = rows.filter((r) => {
    if (r.status === 'ignored') return false;
    if (filter === 'all') return true;
    if (filter === 'no_invoice') return r.status === 'no_invoice' || r.status === 'invoice_only';
    return r.status === filter;
  }).sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.member.name.localeCompare(b.member.name, 'de'));
  const nameOf = (id: string) => rows.find((r) => r.member.id === id)?.member.name ?? id;
  const statusText = (r: (typeof rows)[number]): string => ({
    contract: 'Vertrag', proposal: 'Vorschlag offen', ignored: 'Kein zahlendes Mitglied', no_invoice: 'Keine Rechnung',
    invoice_only: `Rechnung ohne Mitgliedschaft: ${r.invoices.map((i) => i.number).join(', ')}`,
  } satisfies Record<PortalStatus, string>)[r.status];
  const mails = (m: PortalMember) => (m.emails?.length ? m.emails : [m.email]).join(', ');

  return (
    <>
      <PageHeader title="Portal-Mitglieder" trailing={<BackLink href="/nexus" label="NEXUS" />} />

      {summary.total > 0 && (
        <section className="note-card">
          <p className="list-row-title" data-testid="portal-summary">
            {`${summary.total} im Portal · ${summary.contract} mit Vertrag · ${summary.proposal} Vorschlag offen · ${summary.noInvoice} ohne Rechnung`}
            {summary.invoiceOnly > 0 && ` · ${summary.invoiceOnly} Rechnung ohne Mitgliedschaft`}
            {summary.notInList > 0 && ` · ${summary.notInList} nicht mehr in Liste`}
          </p>
          {summary.listAt && <p className="list-row-subtitle">Liste vom {formatBerlinDe(new Date(summary.listAt), 'dd.MM.yyyy')}</p>}
        </section>
      )}

      <section className="list-group" data-testid="portal-import">
        {!showImport && <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>Mitgliederliste einfügen</button>}
        {showImport && (
          <div className="note-card sim-form">
            <h2 className="list-group-title">Mitgliederliste einfügen</h2>
            <label className="field">Mitgliederliste
              <textarea rows={6} value={text} onChange={(e) => { setText(e.target.value); setFileRows(null); }} />
            </label>
            <p className="list-row-subtitle">Auf portal.nexusnetzwerk.de/mitglieder alles markieren, kopieren und hier einfügen – oder die Excel-Datei (.xlsx) oder CSV wählen.</p>
            <label className="field">Excel- oder CSV-Datei
              <input type="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain"
                onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {fileRows && <p className="list-row-subtitle">Datei: {fileRows.name}</p>}
            {fileError && <p className="form-error" role="alert">{fileError}</p>}
            {(text.trim() !== '' || fileRows) && (
              <div data-testid="portal-preview-box">
                <p className="list-row-title" data-testid="portal-preview">{`${n} Mitglieder erkannt · ${preview.duplicates} doppelt · ${preview.withoutEmail.length} Zeilen ohne E-Mail`}</p>
                {preview.withoutEmail.length > 0 && (
                  <details>
                    <summary className="list-row-subtitle">Zeilen ohne E-Mail anzeigen</summary>
                    <ul>{preview.withoutEmail.map((l, i) => <li key={i} className="list-row-subtitle">{l}</li>)}</ul>
                  </details>
                )}
              </div>
            )}
            <div className="member-actions">
              <button type="button" className="btn btn-primary" disabled={n === 0} onClick={() => { void doImport(); }}>{`${n} Mitglieder übernehmen`}</button>
              {state.portalMembers.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => { setOpen(false); setText(''); setFileRows(null); setFileError(null); }}>Abbrechen</button>}
            </div>
          </div>
        )}
      </section>

      {state.portalMembers.length > 0 && (
        <section className="list-group" aria-labelledby="portal-title">
          <div className="list-group-headline">
            <h2 id="portal-title" className="list-group-title">Mitglieder</h2>
            <Segmented name="portal-filter" legend="Portal-Mitglieder filtern" value={filter} onChange={setFilter} options={FILTERS} />
          </div>
          <ul className="list-group-body">
            {visible.length === 0 && <li><ListRow title="Keine Mitglieder in dieser Ansicht." /></li>}
            {visible.map((r) => {
              const m = r.member;
              const href = r.status === 'contract' && r.contractId ? `/nexus/mitglieder/${r.contractId}` : r.status === 'proposal' ? '/nexus/mitglieder/vorschlaege' : undefined;
              const joined = dateText(m.joinedText, m.joinedOn);
              const active = dateText(m.lastActiveText, m.lastActiveOn);
              const actionable = r.status === 'no_invoice' || r.status === 'invoice_only';
              return (
                <li key={m.id}>
                  <ListRow href={href} testId={`portal-row-${m.externalId}`} title={m.name}
                    leading={r.status === 'contract' && r.traffic ? <TrafficDot traffic={r.traffic} /> : undefined}
                    subtitle={(
                      <>
                        <div>{mails(m)} · <span className="chip" data-status={r.status}>{statusText(r)}</span>{!r.inLatestList && ' · nicht mehr in Liste'}</div>
                        {(joined || active) && <div>{[joined && `Beigetreten ${joined}`, active && `Zuletzt aktiv ${active}`].filter(Boolean).join(' · ')}</div>}
                        {r.sharedWith.length > 0 && <div>teilt Kontakt mit {r.sharedWith.map(nameOf).join(', ')}</div>}
                      </>
                    )} />
                  {actionable && (
                    <div className="member-actions">
                      <button type="button" className="btn btn-secondary" aria-label={`Vertrag anlegen für ${m.name}`} onClick={() => setCreating(creating === m.externalId ? null : m.externalId)}>Vertrag anlegen</button>
                      <button type="button" className="btn btn-secondary" aria-label={`Kein zahlendes Mitglied: ${m.name}`} onClick={() => { void dispatch({ type: 'ignorePortalMember', externalId: m.externalId }); }}>Kein zahlendes Mitglied</button>
                    </div>
                  )}
                  {actionable && creating === m.externalId && (
                    <ProposalCard proposal={portalProposal(r)} contacts={state.contacts} dismissLabel="Kein zahlendes Mitglied"
                      onDismiss={() => { void dispatch({ type: 'ignorePortalMember', externalId: m.externalId }); setCreating(null); }}
                      onConfirm={async (draft, contactId) => {
                        const { created } = await dispatch({ type: 'createPortalContract', externalId: m.externalId, draft, contactId });
                        if (created[0]) router.push(`/nexus/mitglieder/${created[0]}/uebernahme`);
                      }} />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}
