# Sparkasse-Upload mit automatischer Zuordnung (2b-2b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Inhaber lädt einen Sparkassen-Kontoauszug (CAMT.053 als XML/ZIP oder CSV-CAMT V2) im Browser hoch. Die App übernimmt Eingänge und Rückbuchungen als Zahlungen des Zulassungsdienstes, ordnet sie Lexware-Zulassungsrechnungen zu (auch Sammelzahlungen) und zeigt überall den wirklich offenen Betrag.

**Architecture:** Ansatz A der Spec. Die Datei wird nur im Browser gelesen: Die Seite entpackt ZIPs mit dem vorhandenen Leser (`unzip` aus `src/data/xlsx.ts`, jetzt exportiert), die reine Domain-Funktion `parseSparkasse` (`src/domain/import/sparkasse.ts`) macht daraus `ImportedPayment[]` mit Hash-Schlüssel. Das neue Client-Event `importBankStatement` führt sie über `mergeBatch` zusammen. Die Zuordnung wird firmenabhängig (`buildMatchContext(s, at, company)`); `matchBankPayment` bekommt das Ziel `invoices` (Sammelzahlung), verteilt wird über eine reine Ledger-Funktion (älteste Rechnung zuerst). Offene Beträge kommen überall aus `invoiceOpenCents`.

**Tech Stack:** Next.js 16 (App Router, Client-Seiten), TypeScript, Vitest, Playwright. Keine neuen npm-Abhängigkeiten, keine Migration.

**Spec:** `docs/superpowers/specs/2026-11-13-sparkasse-upload-design.md` (freigegeben, Ansatz A, inkl. 4.7). Basis-Regeln: `docs/superpowers/specs/2026-11-12-nexus-assistent-design.md` Abschnitt 4a.

## Global Constraints

- Regeln 4a: Beträge nur als Cent-Ganzzahlen, keine Floats beim Parsen. Kalendertage Europe/Berlin über `src/domain/clock.ts` (`todayBerlin`, `addDaysIso`, `daysBetween`, `formatIsoDe`), nie `new Date()` direkt in `src/domain`. In Komponenten wird nicht gerechnet: Summen, Reste, Verteilungen kommen aus `src/domain/ledger` oder Selektoren, die diese aufrufen.
- `src/domain/` bleibt rein (prüft `tests/unit/architecture.test.ts`): keine Importe aus `src/data`, `src/app`, `src/components`, `src/server`, `src/ai`. Deshalb entpackt die Seite (Data-Schicht), die Domain bekommt fertige Dateibytes.
- Eine Zahlung wird nur Rechnungen und Kontakten **derselben Firma** zugeordnet. NEXUS-Verhalten bleibt unverändert (bestehende Tests grün, `tests/e2e/nexus.spec.ts` grün).
- Zahlung der Sparkasse: `company: 'zulassung'`, `source: 'bank'`, `connectionId: 'bank_sparkasse'`, `kind: 'incoming'` (Rückbuchung mit negativem Betrag, wie Qonto), IBAN über `normalizeIban`, nur ab `IMPORT_SINCE` (`'2026-06-01'`, `src/domain/import/batch.ts`).
- `externalId` = `spk-` + FNV-1a-64-Hex (16 Zeichen) über `Buchungsdatum | Betrag in Cent | normalisierte IBAN | normalisierter Verwendungszweck | laufende Nummer`. CSV und CAMT derselben Buchung ergeben denselben Schlüssel. `AcctSvcrRef` wird nicht verwendet.
- Automatisch nur bei Toleranz 0 Cent und genau einem Ziel. Sammelzahlung automatisch nur bei exakter Summe; keine Skonto-Toleranz. Sonst Vorschlag.
- Rohdatei verlässt den Browser nie. Max. 5 MB je Datei; entpackt höchstens `MAX_UNZIPPED_BYTES` (20 MB).
- Unsichere Feldnamen, Codes und Buchungstexte stehen als Konstanten oben in `src/domain/import/sparkasse.ts` mit Kommentar `// gegen echte Datei prüfen`.
- Fixtures nur erfunden: Fantasie-IBANs `DE00…`, Namen wie „Max Mustermann“, Adressen `@example.de`. Keine echten Kontoauszüge im Repo.
- UI-Texte Deutsch, exakte Texte: Fehler `Das ist kein Sparkassen-Auszug (CAMT oder CSV).`, Knopf `Auszug hochladen`, `Übernehmen`, `Keine Kundenzahlung`, Verbindungszeile `Noch kein Auszug` bzw. `Auszug bis 11.11. · hochgeladen heute`.
- Design-Bausteine aus `src/components` wiederverwenden (`ListGroup`, `ListRow`, `PageHeader`, `BackLink`). Vor der neuen Seite `node_modules/next/dist/docs/` zum App Router überfliegen (AGENTS.md).
- Vor jedem Commit: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`; bei UI-Änderungen `fuser -k 3100/tcp; npm run e2e -- <spec> 2>&1 | tail -15`. Branch `claude/cool-hopper-hcnb9d`, Commit-Nachrichten Deutsch (`feat:`/`fix:`/`docs:`), Pushen macht der Controller nach jedem Task.

## Review Focus

1. **CSV hochladen, danach CAMT desselben Zeitraums (oder umgekehrt):** Keine einzige Zahlung doppelt, die Vorschau zeigt „schon vorhanden“. Test in Task 4 (`CSV und CAMT derselben Buchungen → gleiche externalIds`) und Task 5 (`CSV, dann CAMT → keine neue Zahlung`).
2. **Zwei gleiche Buchungen am selben Tag** (gleicher Kunde, Betrag, Zweck) in einer Datei und danach in einem überlappenden Export: Es bleiben genau zwei Zahlungen. Test in Task 3 (`gleiche Zeilen → laufende Nummer 0 und 1`) und Task 5 (`überlappender Export mit Doppelzeile → 2 Zahlungen`).
3. **Lexware meldet später „bezahlt“** für eine per Sparkasse zugeordnete Rechnung: Offen 0, nie negativ, Briefing zählt nichts doppelt. Test in Task 6.
4. **Rückbuchung einer Sammelzahlung:** Beide Rechnungen werden anteilig wieder offen, jüngste zuerst; nie mehr als zugeordnet. Test in Task 2.
5. **IBAN gehört schon einem NEXUS-Mitglied** (Inhaber zahlt privat) oder eine Nummer kommt in beiden Firmen vor: Keine Zuordnung über Firmengrenzen. Test in Task 1.

---

## Dateistruktur

```
src/domain/
  connections.ts           LEXWARE_OF (neu)
  events.ts                confirmPaymentMatch + invoiceIds; importBankStatement (neu)
  matching/payments.ts     MatchContext.company, MatchInvoice (+dueDate, totalCents, paidInLexware), Ziel 'invoices',
                           Sammelzahlung, Lexware-bezahlt per Nummer, bankReturnAllocations auf mehrere Allocations
  detectors/payments.ts    buildMatchContext(s, at, company), detectUnmatchedPayments für beide Firmen
  detectors/refs.ts        paymentRef(…, company)
  detectors/sources.ts     Text für bank_sparkasse
  ledger/distribute.ts     distributeInOrder, distributeOldestFirst (neu)
  ledger/receivables.ts    invoiceAllocatableCents, splitPaymentOverInvoices, invoicePaidCents, paymentRestCents, customerOpenInvoices
  import/xml.ts            decodeXml (aus xlsx.ts verschoben), stripNamespaces, elements, childText, attrOf (neu)
  import/sparkasse.ts      Konstanten, fnv1a64, statementKey, Parser CSV/CAMT, parseSparkasse (neu)
  import/statement.ts      maskIban, shortDateDe, previewStatement/previewText, statementSummary/summaryText (neu)
  import/portal-list.ts    splitCsv exportieren
  import/merge.ts          isBank: bank_qonto | bank_sparkasse
  freshness.ts             bank_sparkasse: 7 Tage
  briefing.ts              Zulassung offen über invoiceOpenCents
src/data/
  xlsx.ts                  unzip exportiert, Fehlertexte neutral, decodeXml aus domain
  engine.ts                autoAllocate beide Firmen + Sammelzahlung, confirmPaymentMatch (Firma, invoiceIds, Lexware-bezahlt), importBankStatement
  selectors.ts             unallocatedBankPayments/matchOptions(company), partlyAllocatedPayments, customerPayments, customerInvoiceRows
src/server/state-service.ts  CLIENT_EVENTS + SHAPE
src/ai/tools.ts            month_money über invoiceOpenCents
src/components/
  PaymentCard.tsx          (aus nexus/zuordnen herausgelöst, firmenfähig)
  StatementUpload.tsx      Upload-Baustein mit Vorschau und Zusammenfassung (neu)
  connection-labels.ts     statementStandText
  SetupChecklist.tsx       Knopf „Auszug hochladen“ an bank_sparkasse
src/app/
  nexus/zuordnen/page.tsx  nutzt PaymentCard
  zulassung/zuordnen/page.tsx (neu)
  zulassung/page.tsx       Zeile „Zahlungen zuordnen“
  zulassung/kunden/[id]/page.tsx  offene Beträge, Teilzahlung, „Zahlungen“
  verbindungen/page.tsx    Sparkasse-Zeile (Demo)
tests/fixtures/sparkasse/umsaetze-beispiel.csv, auszug-beispiel.xml (neu)
tests/unit/matching/zulassung.test.ts, ledger/distribute.test.ts, import/sparkasse.test.ts, import/statement.test.ts,
  sparkasse-import.test.ts, zip.ts (neu) + bestehende
tests/e2e/zulassung.spec.ts
docs/phase2-backlog.md, docs/PROJEKT-STAND.md
```

---

### Task 1: Zuordnung firmenabhängig (keine Firmenvermischung)

**Files:**
- Modify: `src/domain/connections.ts`, `src/domain/matching/payments.ts:91-93` (Typen), `src/domain/detectors/payments.ts:10-54`, `src/domain/detectors/refs.ts:7`, `src/data/engine.ts:31-60` (`autoAllocate`), `src/data/engine.ts:127-160` (`confirmPaymentMatch`), `src/data/selectors.ts:89-103`, `tests/unit/helpers.ts`
- Create: `tests/unit/matching/zulassung.test.ts`
- Test (Literale anpassen): `grep -rn "contractId: null" tests/unit/matching tests/unit/multi-contracts.test.ts tests/unit/detectors.test.ts` für `MatchInvoice`-Literale

**Interfaces:**
- Produces:
  ```ts
  // connections.ts
  export const LEXWARE_OF: Record<Company, 'lexware_nexus' | 'lexware_zulassung'> = { nexus: 'lexware_nexus', zulassung: 'lexware_zulassung' };
  // matching/payments.ts
  export interface MatchInvoice { id: string; number: string; contactId: string | null; openCents: number; contractId: string | null; dueDate: IsoDate; totalCents: number; paidInLexware?: true }
  export interface MatchContext { company: Company; contacts: Contact[]; ibanLinks: IbanLink[]; expected: Expected; invoices: MatchInvoice[] }
  // detectors/payments.ts
  export const PAID_LOOKBACK_DAYS = 180;
  export function buildMatchContext(s: AppState, now: Date, company: Company = 'nexus'): MatchContext;
  // detectors/refs.ts
  export const paymentRef = (paymentId: string, label: string, company: Company = 'nexus'): Ref; // zulassung → '/zulassung/zuordnen'
  // data/selectors.ts
  export const unallocatedBankPayments = (s: AppState, company: Company = 'nexus'): Payment[];
  export function matchOptions(s: AppState, company: Company = 'nexus'): { value: string; label: string }[];
  ```
- `tests/unit/helpers.ts`: `ctx` bekommt `company: 'nexus'`; neu `export const IBAN_MUELLER = 'DE00100000000000000001'` und `export function sptx(p: Partial<Payment> = {}): Payment` = `tx({ company: 'zulassung', connectionId: 'bank_sparkasse', id: 'sp1', externalId: 'spk-0000000000000001', ...p })`.

`buildMatchContext` je Firma: `contacts` nur `c.company === company`; `ibanLinks` nur Links, deren Kontakt zur Firma gehört; `expected` nur Verträge von Kontakten der Firma (Zulassung: leer); `invoices` = `LEXWARE_OF[company]`, Status nicht `void`, `invoiceOpenCents > 0` → `{ …, openCents: invoiceOpenCents, contractId: coveringContract, dueDate, totalCents }`. Nur Zulassung zusätzlich: Status `paid`, `issuedOn >= addDaysIso(today, -PAID_LOOKBACK_DAYS)`, noch keine Allocation auf die Rechnung → `{ openCents: 0, paidInLexware: true, … }` (Treffer daraus folgt in Task 2).

`autoAllocate`, `detectUnmatchedPayments`: Sperre `p.company !== 'nexus'` entfällt; Kontext je `p.company` (Map, nach jeder neuen Zuordnung dieser Firma neu). Zulassung-Hinweis: `company: 'zulassung'`, `refs: [paymentRef(p.id, who, 'zulassung')]`, `needsSources: ['lexware_zulassung']` (nicht `bank_sparkasse`: der 7-Tage-Frist-Zustand würde offene Fälle sonst ausblenden). NEXUS: `needsSources: ['bank_qonto']` wie bisher.

`confirmPaymentMatch`: Vertrag nur, wenn der Vertragskontakt zur Firma der Zahlung gehört; Rechnung nur, wenn `inv.company === p.company && inv.connectionId === LEXWARE_OF[p.company]`.

`matchOptions(s, 'zulassung')`: keine Verträge, nur Rechnungen von `LEXWARE_OF.zulassung` mit `invoiceOpenCents > 0`, Label wie heute.

- [ ] **Step 1: Grep-Inventar festhalten**

Run: `grep -rn "company !== 'nexus'\|company === 'nexus'\|'lexware_nexus'\|'bank_qonto'" src/domain/matching src/domain/detectors src/data/engine.ts src/data/selectors.ts src/ai src/domain/briefing.ts`
Expected (zu ändern in diesem Task): `detectors/payments.ts:25,35,50`, `engine.ts:36,141`, `selectors.ts:91,100`. Bleiben (fachlich NEXUS): `detectors/reading.ts`, `detectors/portal.ts`, `detectors/invoices.ts:25`, `engine.ts:273` (`simulateTransfer`), `engine.ts:527`, `briefing.ts:21`. Weicht die Liste ab, jede neue Fundstelle im Commit-Text begründen.

- [ ] **Step 2: Failing tests schreiben** (`tests/unit/matching/zulassung.test.ts`)

```ts
const z1 = inv('i-z1', 39000, { number: 'RE-Z-2026-290', dueDate: '2026-10-20' });
const muellerLink = { iban: IBAN_MUELLER, contactId: 'd-mueller', confirmedAt: 'x' };
test('Kontext Zulassung: nur Zulassung-Kontakte, keine Verträge, nur lexware_zulassung', () => {
  const c = buildMatchContext(stateWith({ invoices: [z1, workshop], contracts: [{ ...base, contactId: 'm-kaya' }] }), NOW_0930, 'zulassung');
  expect(c.company).toBe('zulassung');
  expect(c.contacts.map((x) => x.id).sort()).toEqual(['d-mueller', 'd-schmidt']);
  expect(c.expected.size).toBe(0);
  expect(c.invoices.map((i) => i.id)).toEqual(['i-z1']);
});
test('Kontext NEXUS enthält keine Zulassung-Kontakte', () =>
  expect(buildMatchContext(stateWith(), NOW_0930).contacts.every((c) => c.company === 'nexus')).toBe(true));
test('bestätigte IBAN + Betrag → automatisch auf Zulassung-Rechnung', () => {
  const r = refresh(stateWith({ invoices: [z1], ibanLinks: [muellerLink], payments: [sptx({ iban: IBAN_MUELLER, amountCents: 39000 })] }), NOW_0930);
  expect(r.allocations).toEqual([{ paymentId: 'sp1', invoiceId: 'i-z1', amountCents: 39000, method: 'auto' }]);
});
test('IBAN eines NEXUS-Mitglieds ordnet keine Zulassung-Zahlung zu', () => {
  const r = refresh(stateWith({ contracts: [{ ...base, id: 'k-kaya', contactId: 'm-kaya' }], ibanLinks, payments: [sptx({ iban: IBAN_KAYA, amountCents: 30000 })] }), NOW_0930);
  expect(r.allocations).toEqual([]);
});
test('NEXUS-Rechnungsnummer im Zweck einer Sparkasse-Zahlung → kein Treffer', () =>
  expect(matchBankPayment(sptx({ reference: 'RE-1101', amountCents: 14900 }), buildMatchContext(stateWith({ invoices: [workshop] }), NOW_0930, 'zulassung')).confidence).toBe('low'));
test('Zulassung-Nummer im Zweck einer Qonto-Zahlung → kein Treffer', () =>
  expect(matchBankPayment(tx({ reference: 'RE-Z-2026-290', amountCents: 39000 }), buildMatchContext(stateWith({ invoices: [z1] }), NOW_0930)).confidence).toBe('low'));
test('confirmPaymentMatch: Zulassung-Zahlung auf NEXUS-Rechnung oder Vertrag → abgelehnt', () => {
  const s = stateWith({ invoices: [workshop], contracts: [{ ...base, id: 'k-kaya', contactId: 'm-kaya' }], payments: [sptx({ amountCents: 14900 })] });
  expect(apply(s, { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceId: 'i-ws' }).allocations).toEqual([]);
  expect(apply(s, { type: 'confirmPaymentMatch', paymentId: 'sp1', contractId: 'k-kaya' }).allocations).toEqual([]);
});
test('confirmPaymentMatch Zulassung: Rechnung zugeordnet, IBAN gelernt', () => {
  const r = apply(stateWith({ invoices: [z1], payments: [sptx({ iban: 'de00 1000 0000 0000 0000 01', amountCents: 39000 })] }), { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceId: 'i-z1' });
  expect(r.allocations).toEqual([{ paymentId: 'sp1', invoiceId: 'i-z1', amountCents: 39000, method: 'confirmed' }]);
  expect(r.ibanLinks).toContainEqual(expect.objectContaining({ iban: IBAN_MUELLER, contactId: 'd-mueller' }));
});
test('Selektoren je Firma', () => {
  const s = stateWith({ invoices: [z1, workshop], payments: [tx(), sptx()] });
  expect(unallocatedBankPayments(s, 'zulassung').map((p) => p.id)).toEqual(['sp1']);
  expect(unallocatedBankPayments(s).map((p) => p.id)).toEqual(['p1']);
  expect(matchOptions(s, 'zulassung').map((o) => o.value)).toEqual(['invoice:i-z1']);
});
test('Hinweis für Zulassung: Link /zulassung/zuordnen, Quelle lexware_zulassung', () => {
  const i = detectUnmatchedPayments(stateWith({ payments: [sptx({ payerName: 'Max Mustermann', amountCents: 5000 })] }), NOW_0930)[0];
  expect(i).toMatchObject({ dedupeKey: 'unmatched:sp1', company: 'zulassung', needsSources: ['lexware_zulassung'] });
  expect(i.refs[0].href).toBe('/zulassung/zuordnen');
});
```
(`apply(s, e)` = lokaler Helfer: `applyEvent(s, e, { at: NOW_0930, isDemo: true, newId: () => 'n1' }).state`.)

- [ ] **Step 3: Tests laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/matching/zulassung.test.ts`
Expected: FAIL (`company` fehlt im Kontext, Zulassung-Zahlungen werden übersprungen).

- [ ] **Step 4: Implementieren** wie im Interfaces-Block; bestehende `MatchInvoice`-Literale in Tests um `dueDate`, `totalCents` ergänzen; `src/app/nexus/page.tsx` und `src/app/nexus/zuordnen/page.tsx` laufen über die Default-Parameter weiter.

- [ ] **Step 5: Gesamte Suite + Typen**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"; npx tsc --noEmit`
Expected: alle grün, keine Typfehler.

- [ ] **Step 6: Commit**

```bash
git add src/domain src/data tests/unit
git commit -m "feat: Zahlungszuordnung je Firma, Zulassung-Zahlungen nur auf Zulassung-Rechnungen"
```

---

### Task 2: Sammelzahlung, mehrere Allocations, Lexware-bezahlte Rechnungen, Rückbuchung auf mehrere

**Files:**
- Create: `src/domain/ledger/distribute.ts`, `tests/unit/ledger/distribute.test.ts`
- Modify: `src/domain/ledger/receivables.ts`, `src/domain/matching/payments.ts` (`matchBankPayment`, `bankReturnAllocations`), `src/domain/events.ts:15`, `src/data/engine.ts` (`autoAllocate`, `confirmPaymentMatch`, `allocateBankReturns`), `src/server/state-service.ts:70`, `tests/unit/matching/zulassung.test.ts`, `tests/unit/state-service.test.ts:132`

**Interfaces:**
- Consumes: `MatchContext.company`, `MatchInvoice.dueDate/totalCents/paidInLexware`, `LEXWARE_OF` (Task 1).
- Produces:
  ```ts
  // ledger/distribute.ts
  export interface Share { id: string; amountCents: number }
  export function distributeInOrder(amountCents: number, items: { id: string; capCents: number }[]): { shares: Share[]; restCents: number };
  export function distributeOldestFirst(amountCents: number, invoices: { id: string; dueDate: IsoDate; number: string; openCents: number }[]): { shares: Share[]; restCents: number };
  // ledger/receivables.ts
  export function invoiceAllocatableCents(s: AppState, inv: Invoice): number; // offen → invoiceOpenCents; Zulassung + paid → max(0, totalCents − Summe Allocations); sonst 0
  export function splitPaymentOverInvoices(s: AppState, amountCents: number, invoiceIds: string[]): { shares: { invoiceId: string; amountCents: number }[]; restCents: number };
  // matching/payments.ts
  export type MatchTarget = … | { kind: 'invoices'; id: string /* invoiceIds.join(',') */; contactId: string; invoiceIds: string[] };
  // events.ts
  | { type: 'confirmPaymentMatch'; paymentId: string; contractId?: string; invoiceId?: string; invoiceIds?: string[] }
  ```
- `distributeInOrder`: der Reihe nach je Ziel `min(Rest, capCents)`, nur Anteile > 0, Rest = Überzahlung. `distributeOldestFirst` sortiert nach `dueDate`, dann `number` (`localeCompare 'de'`), und ruft `distributeInOrder`. Bei Unterzahlung bleibt der Rest so automatisch an der jüngsten Rechnung offen.
- `splitPaymentOverInvoices` nimmt nur Rechnungen mit `invoiceOpenCents > 0` und verteilt mit `distributeOldestFirst`.

`matchBankPayment`, nur wenn `ctx.company === 'zulassung'` (NEXUS bleibt unverändert; Backlog-Eintrag in Task 9):
1. **Nummer, mehrere Treffer:** Alle Treffer mit `openCents > 0` gehören demselben Kontakt (nicht null), keiner hat `contractId`, mindestens 2 → Ziel `invoices` mit diesen IDs. Summe der `openCents` = Betrag → `high`, Grund `Mehrere Rechnungsnummern im Verwendungszweck, Summe passt.`; sonst `medium`, Grund `Mehrere Rechnungsnummern, Summe weicht ab – Verteilung prüfen.` Treffer über mehrere Kontakte: wie heute `medium` mit Auswahl.
2. **Nummer, genau ein Treffer mit `paidInLexware`:** `fits` = `totalCents === amountCents` → `high`, Grund `Rechnungsnummer im Verwendungszweck, in Lexware schon bezahlt.`; sonst `medium` (wie Teilzahlung).
3. **Bestätigte IBAN eines Kontakts, kein Einzeltreffer** (`fitting.length === 0`) und mindestens 2 offene Rechnungen: Ziel `invoices` mit allen offenen Rechnungen; Summe = Betrag → `high` (`Bestätigte IBAN, Summe aller offenen Rechnungen passt.`), sonst `medium` (`Bestätigte IBAN, Betrag auf offene Rechnungen verteilt – bitte prüfen.`).

Engine:
- `autoAllocate`, Ziel `invoices`: `splitPaymentOverInvoices`; nur wenn `restCents === 0`, dann je Anteil eine Allocation `method: 'auto'`; Audit `Automatisch aufgeteilt: Rechnungen RE-…, RE-…`. Ziel `invoice` mit `paidInLexware`: Allocation über den Zahlungsbetrag, Audit `Automatisch zugeordnet: Rechnung RE-… (in Lexware schon bezahlt)`.
- `confirmPaymentMatch`: genau eines von `contractId`, `invoiceId`, `invoiceIds` (1–50 eindeutige IDs). Rechnung: Betrag `min(p.amountCents, invoiceAllocatableCents)` (> 0 nötig). `invoiceIds`: alle Rechnungen der Firma der Zahlung, ein gemeinsamer Kontakt (nicht null), `splitPaymentOverInvoices` liefert mindestens einen Anteil; je Anteil `method: 'confirmed'`; Text `Zahlung über 640,00 € aufgeteilt: RE-Z-2026-290 (390,00 €), RE-Z-2026-295 (250,00 €)`; IBAN wird für den Kontakt gelernt. Vorhandene Allocations der Zahlung werden wie heute ersetzt.
- `SHAPE.confirmPaymentMatch`: genau eines von `isStr(contractId)`, `isStr(invoiceId)`, `invoiceIds` (Array 1–50, alle `isStr`, eindeutig).

`bankReturnAllocations` (Algorithmus, nicht aus Signatur ableitbar):
```ts
// Original kann mehrere Allocations haben (Sammelzahlung). Rückbuchung wird jüngste Rechnung zuerst gegengebucht.
const originals = s.allocations.filter((x) => x.paymentId === original.id && x.amountCents > 0);
const due = (a: Allocation) => (a.invoiceId ? s.invoices.find((i) => i.id === a.invoiceId)?.dueDate ?? '' : '');
const ordered = [...originals].sort((a, b) => due(b).localeCompare(due(a)));
const { shares } = distributeInOrder(-p.amountCents, ordered.map((a, i) => ({ id: String(i), capCents: a.amountCents })));
for (const sh of shares) { const a = ordered[Number(sh.id)]; out.push(a.invoiceId
  ? { paymentId: p.id, invoiceId: a.invoiceId, amountCents: -sh.amountCents, method: 'auto' }
  : { paymentId: p.id, contractId: a.contractId!, amountCents: -sh.amountCents, method: 'auto' }); }
```
(Höchstens die zugeordnete Summe wird gegengebucht; ersetzt das bisherige `Math.max(p.amountCents, -a.amountCents)`.)

- [ ] **Step 1: Failing tests schreiben**

```ts
// tests/unit/ledger/distribute.test.ts – Referenz 4a: 1.200 € = 4 × 300 €, 450 € gezahlt
const four = [1, 2, 3, 4].map((n) => ({ id: `r${n}`, number: `R-${n}`, dueDate: `2026-0${n + 7}-01`, openCents: 30000 }));
test('älteste zuerst: 450 € auf 4 × 300 € → 300 + 150, Rest 0', () =>
  expect(distributeOldestFirst(45000, [...four].reverse())).toEqual({ shares: [{ id: 'r1', amountCents: 30000 }, { id: 'r2', amountCents: 15000 }], restCents: 0 }));
test('Überzahlung: Rest bleibt', () => expect(distributeOldestFirst(130000, four).restCents).toBe(10000));
test('gleiche Fälligkeit → nach Nummer', () =>
  expect(distributeOldestFirst(100, [{ id: 'b', number: 'R-2', dueDate: '2026-11-01', openCents: 100 }, { id: 'a', number: 'R-1', dueDate: '2026-11-01', openCents: 100 }]).shares).toEqual([{ id: 'a', amountCents: 100 }]));
test('0 € → keine Anteile', () => expect(distributeInOrder(0, [{ id: 'x', capCents: 5 }])).toEqual({ shares: [], restCents: 0 }));
```
```ts
// tests/unit/matching/zulassung.test.ts (Ergänzung)
const z290 = inv('i-z-290', 39000, { number: 'RE-Z-2026-290', dueDate: '2026-10-20' });
const z295 = inv('i-z-295', 25000, { number: 'RE-Z-2026-295', dueDate: '2026-10-28' });
const z301 = inv('i-z-301', 9900, { number: 'RE-Z-2026-301', contactId: 'd-schmidt', status: 'paid', openCents: 0, issuedOn: '2026-11-03' });
test('Sammelzahlung: zwei Nummern, Summe exakt → automatisch auf beide', () => {
  const r = refresh(stateWith({ invoices: [z290, z295], payments: [sptx({ amountCents: 64000, reference: 'RE-Z-2026-290 RE-Z-2026-295' })] }), NOW_0930);
  expect(r.allocations).toEqual([
    { paymentId: 'sp1', invoiceId: 'i-z-290', amountCents: 39000, method: 'auto' },
    { paymentId: 'sp1', invoiceId: 'i-z-295', amountCents: 25000, method: 'auto' }]);
});
test('Sammelzahlung mit Abweichung (Skonto) → Vorschlag, nicht automatisch', () => {
  const s = stateWith({ invoices: [z290, z295], payments: [sptx({ amountCents: 63000, reference: 'RE-Z-2026-290 RE-Z-2026-295' })] });
  expect(refresh(s, NOW_0930).allocations).toEqual([]);
  expect(matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930, 'zulassung'))).toMatchObject({ confidence: 'medium', target: { kind: 'invoices', invoiceIds: ['i-z-290', 'i-z-295'] } });
});
test('Bestätigte IBAN, Summe aller offenen Rechnungen → automatisch', () =>
  expect(refresh(stateWith({ invoices: [z290, z295], ibanLinks: [muellerLink], payments: [sptx({ iban: IBAN_MUELLER, amountCents: 64000 })] }), NOW_0930).allocations).toHaveLength(2));
test('Bestätigen der Verteilung bei Unterzahlung: Rest bleibt an jüngster Rechnung offen', () => {
  const r = apply(stateWith({ invoices: [z290, z295], payments: [sptx({ amountCents: 50000 })] }), { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceIds: ['i-z-295', 'i-z-290'] });
  expect(r.allocations.map((a) => [a.invoiceId, a.amountCents])).toEqual([['i-z-290', 39000], ['i-z-295', 11000]]);
  expect(invoiceOpenCents(r, z295)).toBe(14000);
});
test('Überzahlung beim Bestätigen: Rest bleibt nicht zugeordnet', () => {
  const r = apply(stateWith({ invoices: [z290], payments: [sptx({ amountCents: 40000 })] }), { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceId: 'i-z-290' });
  expect(paymentRestCents(r, r.payments[0])).toBe(1000);
});
test('Teilzahlung: Nummer gefunden, Betrag kleiner → Vorschlag; nach Bestätigung 180 € offen', () => {
  const s = stateWith({ invoices: [z290], payments: [sptx({ amountCents: 21000, reference: 'RE-Z-2026-290' })] });
  expect(matchBankPayment(s.payments[0], buildMatchContext(s, NOW_0930, 'zulassung')).confidence).toBe('medium');
  expect(invoiceOpenCents(apply(s, { type: 'confirmPaymentMatch', paymentId: 'sp1', invoiceId: 'i-z-290' }), z290)).toBe(18000);
});
test('Lexware schon bezahlt: Nummer + Gesamtbetrag → automatisch, offen bleibt 0', () => {
  const r = refresh(stateWith({ invoices: [z301], payments: [sptx({ amountCents: 9900, reference: 'Rechnung RE-Z-2026-301' })] }), NOW_0930);
  expect(r.allocations).toEqual([{ paymentId: 'sp1', invoiceId: 'i-z-301', amountCents: 9900, method: 'auto' }]);
  expect(invoiceOpenCents(r, z301)).toBe(0);
  expect(r.audit.at(-1)?.text).toContain('in Lexware schon bezahlt');
});
test('Lexware bezahlt, älter als 180 Tage → kein Treffer', () =>
  expect(buildMatchContext(stateWith({ invoices: [{ ...z301, issuedOn: '2026-05-01' }] }), NOW_0930, 'zulassung').invoices).toEqual([]));
test('Rückbuchung einer Sammelzahlung: anteilig, jüngste Rechnung zuerst', () => {
  const s = stateWith({ invoices: [z290, z295],
    payments: [sptx({ amountCents: 64000, reference: 'RE-Z-2026-290 RE-Z-2026-295', iban: IBAN_MUELLER }),
               sptx({ id: 'sp2', externalId: 'spk-0000000000000002', amountCents: -30000, iban: IBAN_MUELLER, refundOf: 'spk-0000000000000001', bookedOn: '2026-11-12' })] });
  const r = refresh(s, NOW_0930);
  expect(r.allocations.filter((a) => a.paymentId === 'sp2').map((a) => [a.invoiceId, a.amountCents])).toEqual([['i-z-295', -25000], ['i-z-290', -5000]]);
  expect(invoiceOpenCents(r, z295)).toBe(25000);
  expect(invoiceOpenCents(r, z290)).toBe(5000);
});
```
State-Service: `it.each` um `[{ paymentId: 'p', invoiceIds: ['a', 'b'] }, true]`, `[{ paymentId: 'p', invoiceIds: [] }, false]`, `[{ paymentId: 'p', invoiceIds: ['a', 'a'] }, false]`, `[{ paymentId: 'p', invoiceId: 'a', invoiceIds: ['b'] }, false]` ergänzen.

- [ ] **Step 2: Tests laufen lassen, Fehlschlag prüfen**

Run: `npx vitest run tests/unit/ledger/distribute.test.ts tests/unit/matching/zulassung.test.ts tests/unit/state-service.test.ts`
Expected: FAIL (`distributeOldestFirst` nicht definiert, Ziel `invoices` unbekannt).

- [ ] **Step 3: Implementieren** wie im Interfaces-Block. `paymentRestCents` gehört zu Task 6, wird hier schon gebraucht: `export function paymentRestCents(s: AppState, p: Payment): number` = `max(0, p.amountCents − Summe Allocations der Zahlung)` in `ledger/receivables.ts`.

- [ ] **Step 4: Tests laufen lassen**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"; npx tsc --noEmit`
Expected: alle grün (bestehende Qonto-Rückbuchungstests unverändert grün).

- [ ] **Step 5: Commit**

```bash
git add src/domain src/data src/server tests/unit
git commit -m "feat: Sammelzahlungen aufteilen, Lexware-bezahlte Rechnungen erkennen, Rückbuchung auf mehrere Zuordnungen"
```

---

### Task 3: Parser Sparkassen-CSV (CSV-CAMT V2) mit Hash-Schlüssel

**Files:**
- Create: `src/domain/import/sparkasse.ts`, `tests/unit/import/sparkasse.test.ts`, `tests/fixtures/sparkasse/umsaetze-beispiel.csv`
- Modify: `src/domain/import/portal-list.ts:285` (`splitCsv` exportieren)

**Interfaces:**
- Consumes: `normalizeIban` (`matching/payments.ts`), `IMPORT_SINCE`, `ImportedPayment` (`import/batch.ts`), `decodeListFile`, `splitCsv` (`import/portal-list.ts`).
- Produces:
  ```ts
  export type SkipReason = 'expense' | 'pending' | 'currency' | 'before_since' | 'unreadable';
  export interface SparkasseResult { format: 'csv' | 'camt'; payments: ImportedPayment[]; skipped: { reason: SkipReason; count: number }[]; from: IsoDate | null; to: IsoDate | null; account: string | null }
  export type SparkasseParse = ({ ok: true } & SparkasseResult) | { ok: false; error: string };
  export const NOT_SPARKASSE = 'Das ist kein Sparkassen-Auszug (CAMT oder CSV).';
  export const RETURN_TEXTS: readonly string[];        // gegen echte Datei prüfen
  export const RETURN_BANK_CODES: readonly string[];   // gegen echte Datei prüfen (Task 4)
  export const CSV_COLUMNS: { account: string; booked: string; text: string; reference: string; name: string; iban: string; amount: string; currency: string; info: string };
  export function fnv1a64(text: string): string;                         // 16 Hex-Zeichen
  export function normalizeReference(s: string): string;                 // klein, aller Leerraum entfernt
  export function statementKey(b: { bookedOn: IsoDate; amountCents: number; iban: string; reference: string }, seq: number): string; // 'spk-' + fnv1a64
  export function parseDeAmountCents(s: string): number | null;          // '1.234,56' → 123456, '-12,00' → -1200
  export function parseDeDate(s: string): IsoDate | null;                // 'TT.MM.JJ' (20JJ) und 'TT.MM.JJJJ'
  export function parseSparkasseCsv(text: string): SparkasseResult | null; // null = Kopfzeile nicht erkannt
  ```
- Konstanten: `CSV_COLUMNS = { account: 'Auftragskonto', booked: 'Buchungstag', text: 'Buchungstext', reference: 'Verwendungszweck', name: 'Beguenstigter/Zahlungspflichtiger', iban: 'Kontonummer/IBAN', amount: 'Betrag', currency: 'Waehrung', info: 'Info' }` (Kopfzeile ohne Groß/Klein und Anführungszeichen vergleichen; Pflicht: `booked`, `reference`, `name`, `iban`, `amount`). `RETURN_TEXTS = ['retoure', 'rücklastschrift', 'ruecklastschrift', 'rückbuchung', 'rueckbuchung', 'rückgabe', 'rueckgabe']` (Teilstring im kleingeschriebenen Buchungstext).
- Regeln je Zeile: `Info` enthält „vorgemerkt“ → `pending`; Währung nicht leer und ≠ `EUR` → `currency`; Datum/Betrag unlesbar → `unreadable`; Betrag < 0 ohne Rückbuchungstext → `expense`; `bookedOn < IMPORT_SINCE` → `before_since`. `from`/`to` = kleinstes/größtes lesbares Buchungsdatum aller Zeilen (auch übersprungener). `account` = `normalizeIban(Auftragskonto)` der ersten Zeile. `skipped` nur Gründe mit `count > 0`, Reihenfolge wie im Typ.
- Laufende Nummer: je Datei, je gleicher Basis (`bookedOn|amountCents|iban|normalizeReference`), in Dateireihenfolge ab 0. Kommentar im Code: „Annahme: Exporte enthalten immer ganze Buchungstage (Spec 4.7); Abnahme prüft das.“

Hash (Ziel ES2017, daher `BigInt(...)` statt `0n`-Literalen):
```ts
const FNV_OFFSET = BigInt('0xcbf29ce484222325'), FNV_PRIME = BigInt('0x100000001b3'), MASK = BigInt('0xffffffffffffffff');
export function fnv1a64(text: string): string {
  let h = FNV_OFFSET;
  for (const b of new TextEncoder().encode(text)) h = ((h ^ BigInt(b)) * FNV_PRIME) & MASK;
  return h.toString(16).padStart(16, '0');
}
// statementKey: fnv1a64([bookedOn, amountCents, normalizeIban(iban), normalizeReference(reference), seq].join('|'))
```

Fixture `tests/fixtures/sparkasse/umsaetze-beispiel.csv` (UTF-8, `;`, alle Felder in `"…"`; Kopfzeile in Sparkassen-Reihenfolge: `Auftragskonto;Buchungstag;Valutadatum;Buchungstext;Verwendungszweck;Glaeubiger ID;Mandatsreferenz;Kundenreferenz (End-to-End);Sammlerreferenz;Lastschrift Ursprungsbetrag;Auslagenersatz Ruecklastschrift;Beguenstigter/Zahlungspflichtiger;Kontonummer/IBAN;BIC (SWIFT-Code);Betrag;Waehrung;Info`; Auftragskonto überall `DE00360501050000009999`, BIC `XXXXDEXXXXX`, Info `Umsatz gebucht`):

| Buchungstag | Buchungstext | Verwendungszweck | Name | IBAN | Betrag |
|---|---|---|---|---|---|
| 03.11.26 | GUTSCHR. UEBERWEISUNG | RE-Z-2026-290 RE-Z-2026-295 | Autohaus Mueller GmbH | DE00100000000000000001 | 640,00 |
| 05.11.26 | GUTSCHR. UEBERWEISUNG | Rechnung RE-Z-2026-301 | Autohaus Krause | DE00100000000000000002 | 99,00 |
| 10.11.26 | GUTSCHR. UEBERWEISUNG | Umschreibung BOT-MK 456 | AUTOHAUS MUELLER GMBH | DE00100000000000000001 | 89,00 |
| 11.11.26 | BARGELDEINZAHLUNG | Einzahlung | Max Mustermann | DE00100000000000000003 | 50,00 |
| 11.11.26 | ONLINE-UEBERWEISUNG | Gebuehren Zulassungsstelle | Stadt Musterstadt | DE00100000000000000004 | -45,00 |

- [ ] **Step 1: Failing tests schreiben**

```ts
const csv = readFileSync('tests/fixtures/sparkasse/umsaetze-beispiel.csv', 'utf8');
test('FNV-1a 64 Testvektoren', () => { expect(fnv1a64('')).toBe('cbf29ce484222325'); expect(fnv1a64('a')).toBe('af63dc4c8601ec8c'); });
test.each([['1.234,56', 123456], ['-12,00', -1200], ['0,5', 50], ['99', 9900], ['1,234', null], ['abc', null]])('Betrag %s → %s', (s, c) => expect(parseDeAmountCents(s)).toBe(c));
test.each([['03.11.26', '2026-11-03'], ['03.11.2026', '2026-11-03'], ['31.02.26', null]])('Datum %s → %s', (s, d) => expect(parseDeDate(s)).toBe(d));
test('Beispieldatei: 4 Eingänge, 1 Ausgabe übersprungen, Zeitraum, Konto', () => {
  const r = parseSparkasseCsv(csv)!;
  expect(r.payments.map((p) => p.amountCents)).toEqual([64000, 9900, 8900, 5000]);
  expect(r.payments[0]).toMatchObject({ company: 'zulassung', source: 'bank', connectionId: 'bank_sparkasse', kind: 'incoming', bookedOn: '2026-11-03',
    payerName: 'Autohaus Mueller GmbH', iban: 'DE00100000000000000001', reference: 'RE-Z-2026-290 RE-Z-2026-295' });
  expect(r.payments[0].externalId).toMatch(/^spk-[0-9a-f]{16}$/);
  expect(r.skipped).toEqual([{ reason: 'expense', count: 1 }]);
  expect([r.from, r.to, r.account]).toEqual(['2026-11-03', '2026-11-11', 'DE00360501050000009999']);
});
test('Rückbuchung (Buchungstext RETOURE) wird negativ übernommen', () => { /* Zeile mit -640,00 und Buchungstext "RETOURE" → amountCents -64000, kind 'incoming' */ });
test('vorgemerkt, Fremdwährung, vor Importbeginn werden gezählt, nicht übernommen', () => { /* je eine Zeile → skipped pending/currency/before_since je 1 */ });
test('Windows-1252: Umlaute im Namen bleiben erhalten', () => {
  const bytes = new Uint8Array([...new TextEncoder().encode(csv.split('\n')[0] + '\n'), /* Zeile mit "Autohaus M\xfcller" als 1252-Bytes */]);
  expect(parseSparkasseCsv(decodeListFile(bytes))!.payments[0].payerName).toBe('Autohaus Müller');
});
test('gleiche Zeilen → laufende Nummer 0 und 1, verschiedene Schlüssel, stabil', () => {
  const a = parseSparkasseCsv(header + row + row)!.payments, b = parseSparkasseCsv(header + row + row + otherDayRow)!.payments;
  expect(new Set(a.map((p) => p.externalId)).size).toBe(2);
  expect(b.slice(0, 2).map((p) => p.externalId)).toEqual(a.map((p) => p.externalId));
});
test('Zweck mit anderem Leerraum/Großschreibung → gleicher Schlüssel', () =>
  expect(statementKey({ bookedOn: '2026-11-03', amountCents: 100, iban: 'de00 1000', reference: 'RE-Z 1' }, 0))
    .toBe(statementKey({ bookedOn: '2026-11-03', amountCents: 100, iban: 'DE001000', reference: 're-z1' }, 0)));
test('unbekannte Kopfzeile → null', () => expect(parseSparkasseCsv('Datum;Betrag\n01.11.26;5,00')).toBeNull());
```
(`header`, `row`, `otherDayRow` als kleine Konstanten im Test; Kommentare in `/* */` oben werden als echte Zeilen ausgeschrieben.)

- [ ] **Step 2: Fehlschlag prüfen** — Run: `npx vitest run tests/unit/import/sparkasse.test.ts` · Expected: FAIL (Modul fehlt).

- [ ] **Step 3: Implementieren** wie im Interfaces-Block; `splitCsv` aus `portal-list.ts` exportieren und nutzen (nicht kopieren).

- [ ] **Step 4: Tests laufen lassen** — Run: `npx vitest run tests/unit/import/sparkasse.test.ts tests/unit/import/portal-list.test.ts` · Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/import tests/unit/import/sparkasse.test.ts tests/fixtures/sparkasse
git commit -m "feat: Sparkassen-CSV lesen, Importschlüssel als FNV-1a-Hash"
```

---

### Task 4: Parser CAMT.053 (XML und ZIP), gleicher Schlüssel wie CSV

**Files:**
- Create: `src/domain/import/xml.ts`, `tests/fixtures/sparkasse/auszug-beispiel.xml`, `tests/unit/zip.ts`
- Modify: `src/domain/import/sparkasse.ts`, `src/data/xlsx.ts:10-20,42-86` (`unzip` exportieren, `decodeXml` aus `domain/import/xml.ts` importieren, Fehlertexte neutral), `tests/unit/data/xlsx.test.ts` (ZIP-Builder nach `tests/unit/zip.ts`), `tests/unit/import/sparkasse.test.ts`

**Interfaces:**
- Consumes: alles aus Task 3.
- Produces:
  ```ts
  // import/xml.ts
  export function decodeXml(s: string): string;                 // aus xlsx.ts verschoben, unverändert
  export function stripNamespaces(xml: string): string;         // '<ns:Ntry>' → '<Ntry>'
  export function elements(xml: string, tag: string): string[]; // Inhalt aller <tag …>…</tag> (nicht verschachtelt gleichnamig)
  export function childText(xml: string, path: string[]): string | undefined; // erstes Element entlang des Pfads, Tags entfernt, decodeXml, getrimmt
  export function attrOf(xml: string, tag: string, name: string): string | undefined;
  // import/sparkasse.ts
  export function parseDotAmountCents(s: string): number | null; // '640.00' → 64000, '0.5' → 50
  export function parseCamt053(xml: string): SparkasseResult | null; // null = kein camt.053 (Document/BkToCstmrStmt fehlt)
  export function parseSparkasse(files: { name: string; bytes: Uint8Array }[]): SparkasseParse;
  // data/xlsx.ts
  export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>>;
  ```
- `xlsx.ts`-Texte: `'Keine gültige ZIP-Datei (Verzeichnis fehlt).'`, `TOO_BIG = 'Die Datei ist entpackt zu groß (über 20 MB).'` (Mitglieder-Seite prüft weiter `/zu groß/`).
- CAMT je `Stmt`: `account` = `Acct/Id/IBAN`. Je `Ntry`: `Sts` (Text oder `Sts/Cd`) muss `BOOK` sein, sonst `pending`; `Amt@Ccy` ≠ `EUR` → `currency`; Datum `BookgDt/Dt` (oder erste 10 Zeichen von `BookgDt/DtTm`), sonst `ValDt/Dt`. Rückbuchung = `RvslInd` = `true` oder `BkTxCd/Domn/Fmly/SubFmlyCd` bzw. `BkTxCd/Prtry/Cd` (Ziffern nach `+`) in `RETURN_BANK_CODES = ['RRTN', 'UPDD', 'RPCR', 'ARET', '109', '159']` (gegen echte Datei prüfen). `DBIT` ohne Rückbuchung → `expense`. Je `NtryDtls/TxDtls` eine Zahlung: Betrag `TxDtls/Amt`, sonst `Ntry/Amt` wenn genau ein `TxDtls`, sonst `unreadable`. Gegenpartei: `CRDT` → `RltdPties/Dbtr` (Name über `Nm` oder `Pty/Nm`) + `DbtrAcct/Id/IBAN`; `DBIT` → `Cdtr`/`CdtrAcct`. Zweck: alle `RmtInf/Ustrd` mit Leerzeichen verbunden. Schlüssel und laufende Nummer exakt wie Task 3 (eine Datei = eine Nummerierung).
- `parseSparkasse`: jede Datei mit `decodeListFile` dekodieren; beginnt sie (nach Leerraum) mit `<` → `parseCamt053`, sonst `parseSparkasseCsv`. Irgendeine Datei `null` oder keine Datei → `{ ok: false, error: NOT_SPARKASSE }`. Mehrere Dateien (ZIP): Zahlungen aneinanderhängen, `skipped` summieren, `from`/`to` über alle, `account` der ersten, `format` der ersten.
- Fixture `auszug-beispiel.xml`: camt.053.001.08 (`xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"`), ein `Stmt` mit `Acct/Id/IBAN` `DE00360501050000009999` und dieselben 5 Buchungen wie die CSV, Zweck der ersten Buchung als zwei `Ustrd`-Zeilen `RE-Z-2026-290` und `RE-Z-2026-295`, die zweite mit Präfix `ns:` an allen Tags (Namespace-Test).

- [ ] **Step 1: Failing tests schreiben**

```ts
const xml = readFileSync('tests/fixtures/sparkasse/auszug-beispiel.xml', 'utf8');
test('CSV und CAMT derselben Buchungen → gleiche externalIds', () =>
  expect(parseCamt053(xml)!.payments.map((p) => p.externalId)).toEqual(parseSparkasseCsv(csv)!.payments.map((p) => p.externalId)));
test('CAMT: Beträge, Ausgabe übersprungen, Konto', () => {
  const r = parseCamt053(xml)!;
  expect(r.payments.map((p) => p.amountCents)).toEqual([64000, 9900, 8900, 5000]);
  expect(r.skipped).toEqual([{ reason: 'expense', count: 1 }]);
  expect(r.account).toBe('DE00360501050000009999');
});
test('Sammelbuchung: ein Ntry mit zwei TxDtls → zwei Zahlungen mit TxDtls-Beträgen', () => { /* Ntry 150.00, TxDtls 100.00 + 50.00 → [10000, 5000] */ });
test('RvslInd=true auf DBIT → Rückbuchung negativ, Gegenpartei = Cdtr', () => { /* → amountCents -64000, iban DE00100000000000000001 */ });
test('Sts PDNG → pending gezählt', () => { /* skipped [{ reason: 'pending', count: 1 }] */ });
test('ZIP mit zwei XMLs → zusammengeführt', async () => {
  const files = [...(await unzip(zip({ 'a.xml': xml, 'b.xml': otherDayXml })))].map(([name, bytes]) => ({ name, bytes }));
  const r = parseSparkasse(files);
  expect(r.ok && r.payments.length).toBe(5);
});
test('falsche Datei → verständlicher Fehler', () =>
  expect(parseSparkasse([{ name: 'x.pdf', bytes: new TextEncoder().encode('%PDF-1.4') }])).toEqual({ ok: false, error: 'Das ist kein Sparkassen-Auszug (CAMT oder CSV).' }));
test('xml-Helfer: Namespaces, Entities', () => {
  expect(childText(stripNamespaces('<a:X><a:Y>A &amp; B</a:Y></a:X>'), ['X', 'Y'])).toBe('A & B');
});
```
(`zip()` aus `tests/unit/zip.ts`; die Kommentar-Fälle als kleine Inline-XML-Strings ausschreiben.)

- [ ] **Step 2: Fehlschlag prüfen** — Run: `npx vitest run tests/unit/import/sparkasse.test.ts tests/unit/data/xlsx.test.ts` · Expected: FAIL (`parseCamt053`, `unzip`-Export fehlen).

- [ ] **Step 3: Implementieren**; `decodeXml` nur verschieben (eine Quelle), `xlsx.ts` importiert es aus `@/domain/import/xml`.

- [ ] **Step 4: Tests + Typen** — Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"; npx tsc --noEmit` · Expected: grün (auch `xlsx.test.ts` und Architekturtest).

- [ ] **Step 5: Commit**

```bash
git add src/domain/import src/data/xlsx.ts tests/unit tests/fixtures/sparkasse
git commit -m "feat: CAMT.053 und ZIP lesen, gleicher Schlüssel wie CSV"
```

---

### Task 5: Übernahme per Client-Event `importBankStatement`, Vorschau und Zusammenfassung

**Files:**
- Create: `src/domain/import/statement.ts`, `tests/unit/import/statement.test.ts`, `tests/unit/sparkasse-import.test.ts`
- Modify: `src/domain/events.ts`, `src/domain/import/merge.ts:69-73`, `src/data/engine.ts` (neuer `case` neben `importPortalList`), `src/server/state-service.ts:15-19,95`, `tests/unit/state-service.test.ts`, `tests/unit/import/merge.test.ts`

**Interfaces:**
- Consumes: `parseSparkasse`, `SparkasseResult` (Task 3/4), `buildMatchContext(…, 'zulassung')`, `matchBankPayment` (Task 1/2).
- Produces:
  ```ts
  // events.ts
  | { type: 'importBankStatement'; connectionId: 'bank_sparkasse'; payments: ImportedPayment[] }
  // import/statement.ts
  export function maskIban(iban: string): string;                 // 'DE00360501050000009999' → 'DE00 … 9999'
  export function shortDateDe(d: IsoDate): string;                // '2026-11-03' → '03.11.'
  export interface StatementPreview { bookings: number; fresh: number; existing: number; skipped: { reason: SkipReason; count: number }[]; from: IsoDate | null; to: IsoDate | null; account: string | null }
  export function previewStatement(r: SparkasseResult, existing: Payment[]): StatementPreview;
  export function previewText(p: StatementPreview): string[];     // Zeilen, siehe Test
  export interface StatementSummary { fresh: number; auto: number; toConfirm: number; noMatch: number }
  export function statementSummary(s: AppState, newPaymentIds: string[], at: Date): StatementSummary;
  export function summaryText(x: StatementSummary): string;       // '4 neu · 2 automatisch zugeordnet · 1 zum Bestätigen · 1 ohne Treffer'
  ```
- `previewStatement`: Zahlungen nach `externalId` entdoppelt; `existing` = Schlüssel `bank_sparkasse:externalId` schon im Bestand. Skip-Texte (Einzahl/Mehrzahl): `expense` Ausgabe/Ausgaben, `pending` vorgemerkte Buchung/-en, `currency` Fremdwährung/-en, `before_since` Buchung/-en vor Importbeginn, `unreadable` unlesbare Zeile/-n.
- `statementSummary`: nur neue Zahlungen mit Betrag > 0 werden eingeteilt: mit Allocation → `auto`; sonst `matchBankPayment(…).confidence === 'medium'` → `toConfirm`; sonst `noMatch`. `fresh` = alle neuen IDs.
- `mergeBatch`: `isBank = (p) => p.connectionId === 'bank_qonto' || p.connectionId === 'bank_sparkasse'`.
- Engine `importBankStatement`: Zahlungen nur aus den Feldern `externalId, amountCents, bookedOn, payerName, iban, reference` neu gebaut (feste Werte `company: 'zulassung'`, `source: 'bank'`, `connectionId: 'bank_sparkasse'`, `kind: 'incoming'`), dann `mergeBatch(s, { ...emptyBatch(), payments }, ctx.newId)`. Verbindung: `status: 'connected'`, `lastSuccessAt: at.toISOString()`, `lastError` entfernt, `sync: { cursor: <größtes bookedOn aller bank_sparkasse-Zahlungen nach dem Merge>, complete: true, failures: 0 }`. Audit (Inhaber): `Sparkasse-Auszug übernommen: ${added} neu, ${payments.length - added} schon vorhanden`.
- `SHAPE.importBankStatement`: `connectionId === 'bank_sparkasse'`, `payments` Array 1–5000, je Eintrag: `company === 'zulassung'`, `source === 'bank'`, `connectionId === 'bank_sparkasse'`, `kind === 'incoming'`, `externalId` passt `/^spk-[0-9a-f]{16}$/`, `amountCents` Ganzzahl ≠ 0 und `|x| ≤ 100_000_000_00`, `bookedOn` passt `/^\d{4}-\d{2}-\d{2}$/`, `payerName` ≤ 200, `iban` ≤ 34, `reference` ≤ 500 Zeichen (optional, wenn vorhanden String). Event in `CLIENT_EVENTS`.

- [ ] **Step 1: Migrationen prüfen (keine Migration nötig)**

Run: `grep -rn "check\|bank_sparkasse\|zulassung" supabase/migrations/*.sql | grep -iv "^.*--"`
Expected: kein Check-Constraint auf `connection_id` oder `company`; `payments` nur mit Unique-Index `(connection_id, external_id)`. Sonst anhalten und dem Controller melden.

- [ ] **Step 2: Failing tests schreiben**

```ts
// tests/unit/import/statement.test.ts
test('Vorschau Beispieldatei, leerer Bestand', () => {
  const p = previewStatement(parseSparkasseCsv(csv)!, []);
  expect(previewText(p)).toEqual(['4 Buchungen · 4 neu · 0 schon vorhanden', 'Zeitraum 03.11.–11.11. · Konto DE00 … 9999', 'übersprungen: 1 Ausgabe']);
});
test('Vorschau nach Übernahme: 0 neu · 4 schon vorhanden', () => { /* existing = übernommene Zahlungen */ });
test('Zusammenfassungstext', () => expect(summaryText({ fresh: 31, auto: 24, toConfirm: 5, noMatch: 2 })).toBe('31 neu · 24 automatisch zugeordnet · 5 zum Bestätigen · 2 ohne Treffer'));
// tests/unit/sparkasse-import.test.ts (Demo-Seed + Beispieldatei)
const demo = () => createDemoState(); const ev = (r: SparkasseResult) => ({ type: 'importBankStatement', connectionId: 'bank_sparkasse', payments: r.payments }) as const;
test('Beispieldatei in den Demo-Stand: 2 automatisch, 1 Vorschlag, 1 ohne Treffer', () => {
  const s0 = demo(); const s = applyEvent(s0, ev(parseSparkasseCsv(csv)!), ctx).state;
  const ids = s.payments.filter((p) => p.connectionId === 'bank_sparkasse').map((p) => p.id);
  expect(statementSummary(s, ids, NOW_0930)).toEqual({ fresh: 4, auto: 2, toConfirm: 1, noMatch: 1 });
  expect(s.connections.find((c) => c.id === 'bank_sparkasse')).toMatchObject({ status: 'connected', sync: { cursor: '2026-11-11', complete: true, failures: 0 } });
  expect(s.audit.some((a) => a.text === 'Sparkasse-Auszug übernommen: 4 neu, 0 schon vorhanden')).toBe(true);
});
test('zweimal derselbe Auszug → keine neue Zahlung, Zuordnungen unverändert', () => { /* Länge payments/allocations gleich */ });
test('CSV, dann CAMT → keine neue Zahlung', () => { /* erst parseSparkasseCsv, dann parseCamt053 */ });
test('überlappender Export mit Doppelzeile → 2 Zahlungen', () => { /* Datei A: Tag 1 doppelt; Datei B: Tag 1 doppelt + Tag 2 → 3 Zahlungen insgesamt, Tag 1 genau 2 */ });
test('Rückbuchung ohne Original wird verworfen, mit Original verknüpft', () => { /* bank_sparkasse in mergeBatch: refundOf gesetzt */ });
test('fremde Felder (refundOf, ignoredAt, company) aus dem Event werden nicht übernommen', () => { /* payload mit refundOf:'x' → gespeicherte Zahlung ohne refundOf (außer durch linkBankReturns) */ });
// tests/unit/state-service.test.ts
test.each([
  [{}, true], [{ company: 'nexus' }, false], [{ amountCents: 0 }, false], [{ amountCents: 1.5 }, false],
  [{ bookedOn: '12.11.2026' }, false], [{ externalId: 'abc' }, false], [{ reference: 'x'.repeat(501) }, false], [{ connectionId: 'bank_qonto' }, false],
])('importBankStatement Zahlung %j erlaubt: %s', (patch, ok) =>
  expect(isClientEvent({ type: 'importBankStatement', connectionId: 'bank_sparkasse', payments: [{ ...validSpk, ...patch }] })).toBe(ok));
test('importBankStatement: 0 oder 5001 Zahlungen abgelehnt', () => { /* beide false */ });
```
(`ctx` = `{ at: NOW_0930, isDemo: true, newId: () => crypto.randomUUID() }`; `validSpk` = erste Zahlung der Beispieldatei.)

- [ ] **Step 3: Fehlschlag prüfen** — Run: `npx vitest run tests/unit/import/statement.test.ts tests/unit/sparkasse-import.test.ts tests/unit/state-service.test.ts` · Expected: FAIL.

- [ ] **Step 4: Implementieren** wie im Interfaces-Block.

- [ ] **Step 5: Tests + Typen** — Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"; npx tsc --noEmit` · Expected: grün.

- [ ] **Step 6: Commit**

```bash
git add src/domain src/data/engine.ts src/server/state-service.ts tests/unit
git commit -m "feat: Sparkasse-Auszug übernehmen (Event importBankStatement), Vorschau und Zusammenfassung"
```

---

### Task 6: Offene Beträge der Zulassung überall über `invoiceOpenCents`, Kundenseite mit Zahlungen

**Files:**
- Modify: `src/domain/ledger/receivables.ts`, `src/domain/briefing.ts:36-38`, `src/ai/tools.ts:38-46`, `src/data/selectors.ts`, `src/app/zulassung/kunden/[id]/page.tsx:31-72`, `tests/unit/briefing.test.ts`, `tests/unit/ai-tools.test.ts`, `tests/unit/selectors.test.ts`, `tests/unit/ledger/receivables.test.ts`

**Interfaces:**
- Consumes: `paymentRestCents` (Task 2).
- Produces:
  ```ts
  // ledger/receivables.ts
  export function invoicePaidCents(s: AppState, inv: Invoice): number; // offen/überfällig: totalCents − invoiceOpenCents; bezahlt: totalCents; void: 0
  export function customerOpenInvoices(s: AppState, contactId: string): { invoiceIds: string[]; openCents: number }; // Zulassung, invoiceOpenCents > 0, älteste Fälligkeit zuerst
  // data/selectors.ts
  export function customerInvoiceRows(s: AppState, contactId: string): { invoice: Invoice; openCents: number; paidCents: number }[]; // nur openCents > 0, nach dueDate
  export function customerPayments(s: AppState, contactId: string): { key: string; bookedOn: IsoDate; amountCents: number; invoiceNumber: string; paidInLexware: boolean; isReturn: boolean }[]; // neueste zuerst
  export function partlyAllocatedPayments(s: AppState, company: Company): { payment: Payment; restCents: number }[]; // zugeordnet, Rest > 0, nicht ausgeblendet
  ```
- `customerPayments`: je Allocation auf eine Zulassung-Rechnung des Kontakts; `key` = `${paymentId}:${invoiceId}`; `paidInLexware` = Rechnung `status === 'paid'` und Betrag > 0; `isReturn` = Betrag < 0.
- Briefing Zulassung: `zOpen` = Summe `invoiceOpenCents` aller Zulassung-Rechnungen, `zOverdue` = davon `dueDate < today`. `MONEY_SOURCES` bleibt `{ nexus: ['bank_qonto', 'stripe_nexus'], zulassung: ['lexware_zulassung'] }`.
- `month_money`: Zulassung-Rechnungen mit `invoiceOpenCents > 0` und Fälligkeit im Monat; Summe über `invoiceOpenCents`.
- Kundenseite: „Offene Rechnungen“ aus `customerInvoiceRows`; Wert = `openCents`; Untertitel ergänzt bei `paidCents > 0` um ` · 420,00 € von 600,00 € bezahlt` (beide über `formatEuro`). Neue Gruppe „Zahlungen“ (`testId="customer-payments"`), Zeilen `testId={`payment-row-${key}`}`, Titel Rechnungsnummer, Untertitel `formatIsoDe(bookedOn)` plus ` · in Lexware schon bezahlt` bzw. ` · Rückbuchung`, Wert Betrag; leer: „Keine Zahlungen.“

- [ ] **Step 1: Failing tests schreiben**

```ts
const z600 = inv('i-z6', 60000, { dueDate: '2026-10-01', status: 'overdue' });
const alloc42 = { paymentId: 'sp1', invoiceId: 'i-z6', amountCents: 42000, method: 'confirmed' as const };
test('Briefing Zulassung: offen 180 € statt 600 €', () => {
  const b = buildBriefing(stateWith({ invoices: [z600], payments: [sptx({ amountCents: 42000 })], allocations: [alloc42] }), 'morning', NOW_0930);
  expect(b.money.find((m) => m.company === 'zulassung')).toMatchObject({ openCents: 18000, overdueCents: 18000 });
});
test('Lexware setzt danach bezahlt → offen 0, nicht negativ, keine Doppelzählung', () => {
  const s = stateWith({ invoices: [{ ...z600, status: 'paid', openCents: 0 }], payments: [sptx({ amountCents: 60000 })], allocations: [{ ...alloc42, amountCents: 60000 }] });
  expect(buildBriefing(s, 'morning', NOW_0930).money.find((m) => m.company === 'zulassung')!.openCents).toBe(0);
  expect(invoicePaidCents(s, s.invoices[0])).toBe(60000);
});
test('Assistent month_money: Zulassung offen über invoiceOpenCents', () => { /* Fälligkeit im Monat 2026-11 → zulassungOpenCents 18000 */ });
test('Kundenzeilen: Teilzahlung 420 € von 600 €', () =>
  expect(customerInvoiceRows(stateWith({ invoices: [z600], allocations: [alloc42], payments: [sptx({ amountCents: 42000 })] }), 'd-mueller')[0]).toMatchObject({ openCents: 18000, paidCents: 42000 }));
test('Kundenzahlungen: Lexware-bezahlt markiert, Rückbuchung markiert', () => { /* paidInLexware true bzw. isReturn true */ });
test('partlyAllocatedPayments: Überzahlung 10 € Rest', () => { /* Zahlung 40000 auf Rechnung 39000 → restCents 1000 */ });
test('MONEY_SOURCES.zulassung bleibt nur Lexware', () => expect(MONEY_SOURCES.zulassung).toEqual(['lexware_zulassung']));
```

- [ ] **Step 2: Fehlschlag prüfen** — Run: `npx vitest run tests/unit/briefing.test.ts tests/unit/ai-tools.test.ts tests/unit/selectors.test.ts tests/unit/ledger/receivables.test.ts` · Expected: FAIL.

- [ ] **Step 3: Implementieren** (Domain, Selektoren, Assistent, dann Kundenseite).

- [ ] **Step 4: Tests, Typen, E2E Zulassung**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"; npx tsc --noEmit; fuser -k 3100/tcp; npm run e2e -- tests/e2e/zulassung.spec.ts 2>&1 | tail -15`
Expected: grün (Seed hat keine Allocations auf Zulassung-Rechnungen, Anzeige unverändert).

- [ ] **Step 5: Commit**

```bash
git add src tests/unit
git commit -m "feat: Zulassung-Beträge berücksichtigen Zuordnungen, Kundenseite mit Zahlungen und Teilzahlung"
```

---

### Task 7: Oberfläche – Upload-Baustein, `/zulassung/zuordnen`, gemeinsame Zahlungskarte, Verbindungen

**Files:**
- Create: `src/components/PaymentCard.tsx`, `src/components/StatementUpload.tsx`, `src/app/zulassung/zuordnen/page.tsx`
- Modify: `src/app/nexus/zuordnen/page.tsx:16-88` (Karte entfernen, Komponente nutzen), `src/app/zulassung/page.tsx`, `src/components/connection-labels.ts`, `src/components/SetupChecklist.tsx`, `src/app/verbindungen/page.tsx:20-40`, `tests/unit/connection-labels.test.ts`, `tests/e2e/zulassung.spec.ts`

**Interfaces:**
- Consumes: `unzip` (Task 4), `parseSparkasse` (Task 4), `previewStatement`, `previewText`, `statementSummary`, `summaryText`, `maskIban` (Task 5), `matchOptions`, `unallocatedBankPayments` (Task 1), `splitPaymentOverInvoices`, `customerOpenInvoices` (Task 2/6), `partlyAllocatedPayments` (Task 6).
- Produces:
  ```ts
  // components/PaymentCard.tsx
  export function PaymentCard(props: { payment: Payment; match: MatchResult; company: Company }): JSX.Element;
  // components/StatementUpload.tsx
  export function StatementUpload(): JSX.Element;
  export const MAX_STATEMENT_BYTES = 5 * 1024 * 1024;
  // components/connection-labels.ts
  export function statementStandText(c: Connection, at: Date): string; // 'Noch kein Auszug' | 'Auszug bis 11.11. · hochgeladen heute|gestern|vor 2 Tagen'
  ```
- `PaymentCard` = bisherige Karte (Aria-Labels und Texte für NEXUS unverändert), plus: Optionen aus `matchOptions(state, company)`; Zulassung ergänzt je Kunde mit ≥ 2 offenen Rechnungen eine Option `invoices:<id>,<id>` mit Label `Kunde ${name} · alle offenen Rechnungen (${n}) · ${formatEuro(openCents)}` (Werte aus `customerOpenInvoices`). Ziel `invoices`: Vorschlagszeile `Aufteilen: RE-… 390,00 € · RE-… 250,00 €` aus `splitPaymentOverInvoices`, Hinweis bei `restCents > 0` `Rest ${formatEuro} bleibt nicht zugeordnet`, Knopf `Ja, so aufteilen` → `confirmPaymentMatch` mit `invoiceIds`. Ausblende-Knopf: NEXUS `Keine Mitgliedszahlung`, Zulassung `Keine Kundenzahlung` (Aria-Label `… (Zahlung von ${payer})`). Auswahl-Platzhalter Zulassung `Rechnung oder Kunde wählen …`.
- `StatementUpload` (`data-testid="statement-upload"`): `<input type="file" accept=".xml,.zip,.csv,.txt">` mit Label `Kontoauszug-Datei`. Ablauf: Größe > `MAX_STATEMENT_BYTES` → `Die Datei ist zu groß (über 5 MB).`; `.zip` → `unzip`, nur `.xml`-Einträge; Fehler beim Entpacken: Meldung mit `/zu groß/` übernehmen, sonst `NOT_SPARKASSE`; `parseSparkasse`; Fehler → `role="alert"` mit dem Fehlertext. Vorschau `data-testid="statement-preview"` mit den Zeilen aus `previewText`, Knopf `Übernehmen` (deaktiviert bei 0 neu). Vor dem Dispatch die IDs aller Zahlungen merken; danach `data-testid="statement-summary"` mit `summaryText(statementSummary(state, neueIds, now()))`, neue IDs = `bank_sparkasse`-Zahlungen nicht in der gemerkten Menge (nicht aus `created` ableiten).
- Seite `/zulassung/zuordnen`: `PageHeader` „Zahlungen zuordnen“, `BackLink` `/zulassung`; `StatementUpload`; Karten für `unallocatedBankPayments(state, 'zulassung')` (neueste zuerst) mit `matchBankPayment(p, buildMatchContext(state, at, 'zulassung'))`; leer: „Keine offenen Zahlungen.“; Gruppe „Nicht zugeordnete Reste“ aus `partlyAllocatedPayments(state, 'zulassung')` (nur Anzeige: Name, Datum, `Rest X`).
- `/zulassung`: `ListRow` `href="/zulassung/zuordnen"`, `testId="zulassung-match-row"`, Titel „Zahlungen zuordnen“, Wert = Anzahl `unallocatedBankPayments(state, 'zulassung')`.
- Verbindungen: `bank_sparkasse` zeigt als Untertitel (Demo `SourceList` und `connectionSubtitle` im Echtmodus) `${Firma} · ${statementStandText}` bzw. im Echtmodus nur `statementStandText`; statt Simulationsknöpfen bzw. als `accessory` in `SetupChecklist` ein Link-Knopf `Auszug hochladen` → `/zulassung/zuordnen`. `statementStandText`: Datum aus `sync.cursor` (`shortDateDe`), Tage über `daysBetween(todayBerlin(new Date(lastSuccessAt)), todayBerlin(at))`.

- [ ] **Step 1: Failing tests schreiben**

```ts
// tests/unit/connection-labels.test.ts
const spk = (p: Partial<Connection>) => conn({ id: 'bank_sparkasse', status: 'connected', ...p });
test('Sparkasse: noch kein Auszug', () => expect(statementStandText(spk({ status: 'missing', lastSuccessAt: null }), NOW_0930)).toBe('Noch kein Auszug'));
test('Sparkasse: Auszug bis, hochgeladen vor 2 Tagen', () =>
  expect(statementStandText(spk({ lastSuccessAt: '2026-11-10T09:00:00Z', sync: { cursor: '2026-11-09', complete: true, failures: 0 } }), NOW_0930)).toBe('Auszug bis 09.11. · hochgeladen vor 2 Tagen'));
test('Sparkasse im Echtmodus statt Anleitung', () => expect(connectionSubtitle(spk({ status: 'missing', lastSuccessAt: null }), NOW_0930)).toBe('Noch kein Auszug'));
```
```ts
// tests/e2e/zulassung.spec.ts
test('Sparkasse: Auszug hochladen → Zusammenfassung → Vorschlag bestätigen → Kundenseite bezahlt', async ({ page }) => {
  await page.goto('/zulassung/zuordnen?reset=1');
  await page.getByLabel('Kontoauszug-Datei').setInputFiles('tests/fixtures/sparkasse/umsaetze-beispiel.csv');
  const preview = page.getByTestId('statement-preview');
  await expect(preview).toContainText('4 Buchungen · 4 neu · 0 schon vorhanden');
  await expect(preview).toContainText('Zeitraum 03.11.–11.11. · Konto DE00 … 9999');
  await expect(preview).toContainText('übersprungen: 1 Ausgabe');
  await page.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByTestId('statement-summary')).toHaveText('4 neu · 2 automatisch zugeordnet · 1 zum Bestätigen · 1 ohne Treffer');
  await page.getByRole('button', { name: 'Ja, gehört zu Rechnung RE-Z-2026-311 (Zahlung von AUTOHAUS MUELLER GMBH)' }).click();
  await page.goto('/zulassung/kunden/d-mueller');
  await expect(page.getByTestId('customer-invoices')).toContainText('Keine offenen Rechnungen.');
  await expect(page.getByTestId('customer-payments')).toContainText('RE-Z-2026-311');
  await expect(page.getByTestId('customer-payments')).toContainText('RE-Z-2026-290');
  await page.goto('/zulassung/kunden/d-krause');
  await expect(page.getByTestId('customer-payments')).toContainText('in Lexware schon bezahlt');
});
test('Sparkasse: gleicher Auszug als CAMT → nichts neu; falsche Datei → Fehler', async ({ page }) => {
  /* CSV übernehmen, dann auszug-beispiel.xml wählen → Vorschau '0 neu · 4 schon vorhanden', Übernehmen deaktiviert;
     setInputFiles({ name: 'x.pdf', buffer: Buffer.from('%PDF') }) → Alert 'Das ist kein Sparkassen-Auszug (CAMT oder CSV).' */
});
test('Verbindungen: Sparkasse zeigt Auszugsstand und Upload-Knopf', async ({ page }) => {
  /* /verbindungen?reset=1: conn-bank_sparkasse enthält 'Noch kein Auszug' und Link 'Auszug hochladen';
     nach Upload auf /zulassung/zuordnen: 'Auszug bis 11.11. · hochgeladen heute' */
});
```

- [ ] **Step 2: Fehlschlag prüfen** — Run: `npx vitest run tests/unit/connection-labels.test.ts; fuser -k 3100/tcp; npm run e2e -- tests/e2e/zulassung.spec.ts 2>&1 | tail -15` · Expected: FAIL.

- [ ] **Step 3: `node_modules/next/dist/docs/` zum App Router (Client-Seite, `Link`) überfliegen, dann implementieren.** Zuerst `PaymentCard` herauslösen und `tests/e2e/nexus.spec.ts` laufen lassen (unverändert grün), dann Zulassung-Seite, Upload, Verbindungen.

- [ ] **Step 4: Tests, Typen, E2E**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"; npx tsc --noEmit; npm run lint 2>&1 | tail -5; fuser -k 3100/tcp; npm run e2e -- tests/e2e/zulassung.spec.ts tests/e2e/nexus.spec.ts tests/e2e/auth.spec.ts 2>&1 | tail -15`
Expected: alle grün.

- [ ] **Step 5: Commit**

```bash
git add src tests/unit tests/e2e/zulassung.spec.ts
git commit -m "feat: Sparkasse-Upload in Zulassung › Zuordnen, gemeinsame Zahlungskarte, Verbindungszeile"
```

---

### Task 8: Hinweise und Frische für den Sparkasse-Auszug

**Files:**
- Modify: `src/domain/freshness.ts:7`, `src/domain/detectors/sources.ts:12-20`, `tests/unit/freshness.test.ts`, `tests/unit/detectors.test.ts`

**Interfaces:**
- Produces: `STALE_AFTER_MINUTES_BY_CONNECTION = { portal_nexus: 30 * 24 * 60, bank_sparkasse: 7 * 24 * 60 }`.
- `detectStaleSources` für `bank_sparkasse`, Zustand `stale`: Titel `Sparkasse-Auszug ist älter als 7 Tage – neuen hochladen`, Text `Letzter Auszug bis ${shortDateDe(cursor)}. Neuen Export (CAMT oder CSV) hochladen.` (ohne Cursor: `Neuen Export (CAMT oder CSV) hochladen.`), `priority: 'info'`, `company: 'zulassung'`, Ref `connectionRef`, `needsSources: []`. Andere Verbindungen unverändert. Kein Hinweis, solange nie hochgeladen (`missing`).

- [ ] **Step 1: Failing tests schreiben**

```ts
test('Sparkasse gilt 7 Tage als frisch', () => {
  expect(staleAfterMinutes('bank_sparkasse')).toBe(10080);
  expect(sourceFreshness(conn({ id: 'bank_sparkasse', lastSuccessAt: '2026-11-06T09:00:00Z' }), NOW_0930)).toBe('fresh');
  expect(sourceFreshness(conn({ id: 'bank_sparkasse', lastSuccessAt: '2026-11-04T09:00:00Z' }), NOW_0930)).toBe('stale');
});
test('Auszug älter als 7 Tage → Info-Hinweis mit Auszugsdatum', () => {
  const s = stateWith({ connections: [conn({ id: 'bank_sparkasse', lastSuccessAt: '2026-11-04T09:00:00Z', sync: { cursor: '2026-11-03', complete: true, failures: 0 } })] });
  expect(detectStaleSources(s, NOW_0930)[0]).toMatchObject({ title: 'Sparkasse-Auszug ist älter als 7 Tage – neuen hochladen', body: 'Letzter Auszug bis 03.11. Neuen Export (CAMT oder CSV) hochladen.', priority: 'info', company: 'zulassung' });
});
test('nie hochgeladen → kein Hinweis', () => expect(detectStaleSources(stateWith({ connections: [conn({ id: 'bank_sparkasse', status: 'missing', lastSuccessAt: null })] }), NOW_0930)).toEqual([]));
test('alter Auszug blendet Zulassung-Geldkarte nicht aus', () => { /* buildBriefing: money zulassung stale false bei altem Sparkasse-Stand */ });
```

- [ ] **Step 2: Fehlschlag prüfen** — Run: `npx vitest run tests/unit/freshness.test.ts tests/unit/detectors.test.ts` · Expected: FAIL.

- [ ] **Step 3: Implementieren.**

- [ ] **Step 4: Tests + Typen** — Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"; npx tsc --noEmit` · Expected: grün.

- [ ] **Step 5: Commit**

```bash
git add src/domain tests/unit
git commit -m "feat: Hinweis bei Sparkasse-Auszug älter als 7 Tage"
```

---

### Task 9: Abschluss – Gesamtlauf, Backlog, Projektstand

**Files:**
- Modify: `docs/phase2-backlog.md`, `docs/PROJEKT-STAND.md` (Abschnitt „Stand & nächste Schritte“, Dokumente-Tabelle), ggf. `tests/e2e/screenshots.spec.ts` (Seite `/zulassung/zuordnen` ergänzen, falls dort alle Seiten gelistet sind)

- [ ] **Step 1: Gesamtlauf**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"; npx tsc --noEmit; npm run lint 2>&1 | tail -5; npm run contrast 2>&1 | tail -3; fuser -k 3100/tcp; npm run e2e 2>&1 | tail -15`
Expected: alles grün.

- [ ] **Step 2: Backlog ergänzen** (`docs/phase2-backlog.md`, Abschnitt Sparkasse):
  - Abnahme nach Merge: Inhaber lädt je einen echten CSV- und CAMT-Export hoch, prüft Vorschau und Schlüsselgleichheit (`RETURN_TEXTS`, `RETURN_BANK_CODES`, `CSV_COLUMNS`, Annahme „ganze Buchungstage“).
  - CSV-MT940 nicht umgesetzt (eigenes Format, kein Mehrwert ohne echte Datei).
  - Sammelzahlung/Lexware-bezahlt nur Zulassung; NEXUS bei Bedarf nachziehen.
  - Überzahlungs-Rest nur Anzeige, kein Ausblenden.
- [ ] **Step 3: `docs/PROJEKT-STAND.md`** – „Sparkasse-Upload“ als gebaut, Plan in Dokumente-Tabelle, nächster Schritt Abnahme mit echten Dateien.

- [ ] **Step 4: Commit**

```bash
git add docs tests/e2e
git commit -m "docs: Sparkasse-Upload – Backlog und Projektstand"
```

---

## Self-Review

- **Spec-Abdeckung:** 4.1 → Task 3/4; 4.2 → Task 5 (inkl. Migrations-Grep); 4.3 → Task 1/2 (Stufen, Sammelzahlung, Teil-/Überzahlung, „Keine Kundenzahlung“ in Task 7); 4.4 → Task 6; 4.5 → Task 7 (UI), Task 1 (Hinweis unmatched), Task 8 (7-Tage-Hinweis, Frische, `MONEY_SOURCES` unverändert); 4.6 → Fixtures Task 3/4, Demo-Upload Task 7; 4.7 → Task 2 (Lexware-bezahlt, Abweichung, Rückbuchung mehrfach), Task 3 (laufende Nummer), Task 1 (Grep-Inventar), Task 5 (DB-Check), Task 9 (Abnahme echte Dateien); Abschnitt 5 Tests → in den Tasks.
- **Typen:** `MatchTarget` `invoices` (Task 2) wird in Task 7 (`PaymentCard`) und Engine genutzt; `invoiceIds` gleich benannt in Event, Shape und Karte; `paymentRestCents` in Task 2 eingeführt, in Task 6 genutzt; `shortDateDe` aus Task 5 in Task 7/8.
- **Review Focus:** alle fünf Zeilen haben einen benannten Test im zuständigen Task.
