'use client';

import { useState, useSyncExternalStore } from 'react';

import { useAppStore } from '@/data/store';
import { formatIsoDe } from '@/domain/clock';
import { formatEuro } from '@/domain/money';
import { currentTakeover, openTakeoverAction, takeoverStatus, TAKEOVER_STATUS_LABEL } from '@/domain/takeover/status';
import { shareText } from '@/domain/takeover/texts';
import type { Installment, MemberContract } from '@/domain/types';

import { DemoBadge } from './DemoBadge';
import { IconWarning } from './Icons';
import { ListGroup } from './ListGroup';
import { ListRow } from './ListRow';

/** Aus einem relativen Demo-Link (`/zahlung/demo-…`) wird für Anzeige und Kopie ein absoluter Link; im State bleibt er relativ. */
export function absoluteLink(link: string, origin: string): string {
  return link.startsWith('/') ? `${origin}${link}` : link;
}

/** Relative Demo-Links (`/zahlung/demo-…`) in einem Text werden für die Anzeige absolut. */
export function absolutizeDemoLinks(text: string, origin: string): string {
  return text.replace(/(^|\s)(\/zahlung\/demo-\S+)/g, (_m, pre: string, link: string) => `${pre}${origin}${link}`);
}

/** Server und erster Client-Render: leer (kein Hydration-Fehler), danach die Adresse der App. */
export function useOrigin(): string {
  return useSyncExternalStore(() => () => {}, () => window.location.origin, () => '');
}

const rateList = (rates: Installment[]) => rates.map((r) => formatEuro(r.amountCents)).join(' · ');

/** Umstellung eines Vertrags auf Stripe: Status, Plan, Freigabe, Link zum Teilen, Zurückziehen. */
export function TakeoverCard({ contractId, name, mode, blockReason }: { contractId: string; name: string; mode: MemberContract['catchUpMode']; blockReason: string | null }) {
  const { state, dispatch } = useAppStore();
  const origin = useOrigin();
  const [copied, setCopied] = useState(false);

  const status = takeoverStatus(state, contractId);
  const open = openTakeoverAction(state, contractId);
  const t = currentTakeover(state, contractId);
  const prepare = () => dispatch({ type: 'prepareTakeover', contractId, mode });
  const withdraw = () => dispatch({ type: 'withdrawTakeover', contractId });
  const prepareButton = (label: string) => (
    <button type="button" className="btn btn-primary" onClick={prepare} disabled={!!blockReason}>{label}</button>
  );

  const link = t ? absoluteLink(t.link, origin) : '';
  const copy = async () => {
    const text = shareText({ name, link, rates: t!.rates });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const failed = open && (open.status === 'failed' || open.status === 'uncertain');
  const running = open && (open.status === 'approved' || open.status === 'executing');
  const rates = (open?.payload.rates as Installment[] | undefined) ?? [];

  return (
    <section className="takeover-card" data-testid="takeover-card" aria-label="Umstellung auf Stripe">
      {status === null ? (
        <div className="member-actions">
          {prepareButton('Auf Stripe umstellen')}
          {blockReason && <p className="confirm-line" data-testid="takeover-block">{blockReason}</p>}
        </div>
      ) : (
        <ListGroup title="Umstellung auf Stripe" testId="takeover-group">
          <ListRow key="status" title="Status" accessory={<span className="chip" data-testid="takeover-status">{TAKEOVER_STATUS_LABEL[status]}</span>}
            subtitle={t?.isDemo || open?.isDemo ? <DemoBadge /> : undefined} />

          {open && (
            <ListRow key="plan" title={`${rates.length} Raten`} subtitle={<span data-testid="takeover-plan">{rateList(rates)}</span>} />
          )}

          {open?.status === 'draft' && (
            <ListRow key="draft-actions" title="Vorbereitet" subtitle="Nichts ist verschickt, bis du freigibst." />
          )}
          {open?.status === 'draft' && (
            <div key="draft-buttons" className="takeover-share">
              <div className="member-actions">
                <button type="button" className="btn btn-primary" onClick={() => dispatch({ type: 'approveAction', id: open.id, version: open.version, via: 'app' })}>Freigeben</button>
                <button type="button" className="btn btn-plain destructive" onClick={withdraw}>Zurückziehen</button>
              </div>
            </div>
          )}
          {running && <ListRow key="running" role="status" title="Link wird erstellt …" />}
          {failed && (
            <ListRow key="failed" role="status" leading={<IconWarning />} title={open.status === 'failed' ? `Fehlgeschlagen${open.error ? `: ${open.error}` : ''}` : 'Ausgang unklar'}
              accessory={open.status === 'failed'
                ? <button type="button" className="btn btn-secondary btn-small" onClick={() => dispatch({ type: 'retryAction', id: open.id })}>Erneut versuchen</button>
                : <button type="button" className="btn btn-secondary btn-small" onClick={() => dispatch({ type: 'checkAction', id: open.id })}>Prüfen</button>} />
          )}

          {!open && t && status === 'link_sent' && (
            <ListRow key="sent-plan" title={`${t.rates.length} Raten`} subtitle={<span data-testid="takeover-plan">{rateList(t.rates)}</span>} />
          )}
          {!open && t && status === 'link_sent' && (
            <div key="share" className="takeover-share">
                <textarea className="action-sheet-editor" readOnly rows={7} aria-label="Nachricht an das Mitglied" value={shareText({ name, link, rates: t.rates })} />
                <div className="member-actions">
                  <button type="button" className="btn btn-primary" onClick={copy}>Kopieren</button>
                  <button type="button" className="btn btn-plain destructive" onClick={withdraw}>Zurückziehen</button>
                  {t.isDemo && <button type="button" className="btn btn-secondary" onClick={() => dispatch({ type: 'simulateTakeoverSetUp', contractId })}>Zahlungsmittel hinterlegt (Demo)</button>}
                </div>
                <div role="status" className="confirm-line">{copied ? 'Kopiert' : ''}</div>
            </div>
          )}

          {!open && t && status === 'plan_changed' && (
            <ListRow key="changed" title="Der Stand hat sich geändert, bevor das Zahlungsmittel hinterlegt wurde."
              subtitle="Das Zahlungsmittel bleibt gespeichert, es braucht einen neuen Plan."
              accessory={<button type="button" className="btn btn-primary btn-small" onClick={prepare}>Neu freigeben</button>} />
          )}

          {!open && t && (status === 'set_up' || status === 'active') && (
            <ListRow key="running-stripe" title="Raten laufen über Stripe" subtitle={t.scheduleId ? `Zeitplan ${t.scheduleId}` : undefined}
              value={t.setUpAt ? formatIsoDe(t.setUpAt.slice(0, 10)) : undefined} />
          )}

          {!open && status === 'aborted' && (
            <ListRow key="aborted" title="Abo vorzeitig beendet, zurück auf Überweisung"
              accessory={<button type="button" className="btn btn-primary btn-small" onClick={prepare} disabled={!!blockReason}>Auf Stripe umstellen</button>} />
          )}
          {!open && status === 'withdrawn' && (
            <ListRow key="withdrawn" title="Zurückgezogen, der Link ist ungültig."
              accessory={<button type="button" className="btn btn-secondary btn-small" onClick={prepare} disabled={!!blockReason}>Auf Stripe umstellen</button>} />
          )}
        </ListGroup>
      )}
    </section>
  );
}
