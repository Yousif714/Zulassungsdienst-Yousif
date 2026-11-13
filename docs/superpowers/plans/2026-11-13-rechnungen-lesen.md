# Rechnungen lesen (Claude) – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Claude liest offene NEXUS-Rechnungen einmal, erkennt Ratenvereinbarungen und legt daraus sofort einen markierten Ratenvertrag an (sicher + Summe passt) oder einen Vorschlag unter „Verträge zum Bestätigen“. Offen, Ampel, Überfällig-Hinweis und Zahlungszuordnung rechnen danach pro Rate über die vorhandene Vertragslogik.

**Architecture:** Alle Entscheidungen und Beträge rechnet die reine Domain (`src/domain/import/invoice-reading.ts`, `src/domain/ledger/contracts.ts`); Claude liefert nur eine strukturierte Lesung. Ein Server-Schritt `readInvoices` (nach dem Lexware-NEXUS-Import in `syncConnections`) ruft den `InvoiceReader` (Port in `ai-port.ts`, echte Umsetzung mit `@anthropic-ai/sdk`, Demo-Umsetzung regelbasiert) und speichert die Lesungen über ein neues Ereignis `invoicesRead`. Der Reducer in `src/data/engine.ts` bewertet jede Lesung auf dem aktuellen Stand neu (`planFromReading`) und legt Verträge an; Vorschläge werden wie bisher in `deriveProposals` abgeleitet, nicht gespeichert. Eine Rechnung, aus der ein Vertrag entstand, ist über `origin` = `invoice:<externalId>` abgedeckt und zählt nie doppelt.

**Tech Stack:** Next.js 16.4 (App Router, Client-Seiten; vor UI-Arbeit `node_modules/next/dist/docs/` überfliegen), TypeScript, Vitest, Playwright, Supabase (SQL-Migration), neu: `@anthropic-ai/sdk@^1.8.0`.

**Spec:** `docs/superpowers/specs/2026-11-13-rechnungen-lesen-design.md` (inkl. 9 und 9a, verbindlich). Basis: `docs/superpowers/specs/2026-11-12-nexus-assistent-design.md` Abschnitt 4a.

## Global Constraints

- `src/domain/` bleibt rein (prüft `tests/unit/architecture.test.ts`): kein `fetch`, kein SDK, kein React, keine Importe aus `src/ai`, `src/data`, `src/app`, `src/components`, `src/server`.
- Geld nur als Cent-Ganzzahl, gerechnet nur in Domain/Ledger. Kosten als ganze **Mikrocent** (1 Cent = 1 000 000 Mikrocent). Kalendertage/Monate Europe/Berlin über `src/domain/clock.ts` (`berlinParts`, `daysBetween`, `todayBerlin(new Date(iso))`), nie `new Date()` ohne Argument in `src/domain`.
- Nur Rechnungen mit `connectionId = 'lexware_nexus'`. Keine ABs, keine Zulassung, kein Stripe.
- Grenzen (Konstante `READ_LIMITS` in `invoice-reading.ts`): höchstens **5** Rechnungen und **15 000 ms** pro Lauf, **2–36** Raten, Fälligkeitstag **1–31**, erste Fälligkeit **−60 bis +365** Tage zum Rechnungsdatum, höchstens **3** Fehlversuche je `sourceUpdatedAt`.
- Summenregel ohne Toleranz außer Rundungsrest: letzte Rate = `totalCents − rate × (n − 1)`, gültig nur wenn `|letzte Rate − rate| < n` und letzte Rate > 0. Ziel ist `totalCents` (nicht `openCents`).
- Monatslimit `MONTHLY_LIMIT_MICRO_CENTS = 10_000_000_000` (100 €) je Kalendermonat Europe/Berlin, nicht in der UI änderbar. Preise als Konstante mit Quelle (Task 2).
- Modell `claude-opus-5-5`, `output_config: { effort: 'low', format: { type: 'json_schema', schema } }`, kein `thinking`-Parameter (Opus 5.5 denkt adaptiv; `disabled` wäre ein 400), kein `tool_choice` any/tool. `maxRetries: 0` (Wiederholung macht der nächste Lauf).
- An Claude geht nur: Rechnungstext, Rechnungsnummer, Gesamtbetrag, Rechnungsdatum, Lexware-Fälligkeit. Kein Kontaktname, keine E-Mail extra.
- `ANTHROPIC_API_KEY` optional über `readEnv` (`anthropicApiKey`); fehlt er, wird `readInvoices` übersprungen und `claude_invoices` bleibt `missing`. Schlüssel nur in `src/server/**` bzw. Dateien mit `import 'server-only'`; nie in AppState, Audit, `lastError`, Logs.
- Neue Verbindung `claude_invoices` (company `nexus`, Label „Claude (Rechnungen lesen)“), entsteht über `ensureCatalogConnections` automatisch.
- Vertragsarten: `kind` fehlt = Mitgliedschaft. Anzeige exakt „Mitgliedschaft“, „Ticket-Raten“, „Ratenzahlung“.
- UI-Texte Deutsch, exakt: Quelle „Lexware (Claude)“, Plakette „Von Claude gelesen“, Knöpfe „Passt“, „Korrigieren“, „Löschen“; Heute-Hinweis „N Ratenpläne von Claude gelesen – kurz prüfen“ (N = 1: „1 Ratenplan von Claude gelesen – kurz prüfen“); „Rechnung RE-… storniert – Ratenvertrag prüfen“ bzw. „Rechnung RE-… als bezahlt markiert – Ratenvertrag prüfen“.
- Fixtures nur erfunden (`@example.de`, erfundene Namen/Nummern). Tests rufen nie die echte API.
- Vor jedem Commit: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`; bei UI-Änderungen zusätzlich die betroffene Spec: `fuser -k 3100/tcp; npm run e2e -- <spec> 2>&1 | tail -15`. Branch `claude/cool-hopper-hcnb9d`, nach jedem Commit `git push`. Commit-Nachrichten Deutsch (`feat:`/`fix:`/`test:`), jede endet mit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0118JMve5yL1H6x8wUGJiZmL
  ```
- **Mergen erst, nachdem der Inhaber die Migration aus Task 5 im Supabase-SQL-Editor ausgeführt hat.**

## Review Focus

1. **Dieselbe Mitgliedsrechnung wird von der Textsuche und von Claude erkannt:** Es erscheint genau ein Vorschlag (der Textsuche-Vorschlag); entsteht aus der Lesung ein Vertrag, verschwindet der Textsuche-Vorschlag desselben Kontakts. Tests in Task 3.
2. **Zwei Läufe überlappen (Cron und „Jetzt abgleichen“) und lesen dieselbe Rechnung:** Ein `invoicesRead` mit zwei Lesungen derselben Rechnung, oder zwei Ereignisse nacheinander, legt höchstens einen Vertrag an. Test in Task 4.
3. **Zahlung war schon der Rechnung zugeordnet:** Nach automatischer Anlage hängt sie am Vertrag (auf die Raten verrechnet), nichts ist doppelt offen; „Löschen“ gibt sie der Rechnung zurück. Tests in Task 4.
4. **Monatswechsel Europe/Berlin und Limit mitten im Lauf:** Eine Lesung um `2026-10-31T23:30:00Z` zählt zum November; ist das Limit nach der 2. Rechnung erreicht, wird die 3. nicht mehr gelesen. Tests in Task 2 und Task 7.
5. **Claude liefert Unsinn** (0 Raten, negative Rate, Tag 40, Datum `2026-13-45`, `hasPlan` mit lauter `null`): kein Absturz, kein Vertrag, Vorschlag „bitte ergänzen“. Test in Task 2.

---

## Dateistruktur

```
src/domain/
  types.ts                    ContractKind, MemberContract.kind/readBy, InvoiceReadResult, InvoiceReading,
                              AppState.invoiceReadings, ConnectionId +'claude_invoices', InsightType +2
  connections.ts              Katalog + HOW_TO für claude_invoices
  ledger/contracts.ts (neu)   contractKindLabel, isMembershipContract, contractsOfContact, membershipContractOf,
                              invoiceRef, sourceInvoiceOf, contractOnHold, retargetAllocations
  import/invoice-reading.ts   READ_LIMITS, READ_PRICE, Kosten, invoicesToRead, planFromReading,
     (neu)                    readingProposalId, readingProposals, readerSummary
  import/proposals.ts         ContractProposal.reading, sourceLabel 'Lexware (Claude)', deriveProposals + Lesungen
  ledger/receivables.ts       coveringContract (Rechnungs-origin, Mitgliedschaft nur kind membership), Label, onHold
  detectors/reading.ts (neu)  detectReadContracts, detectReadInvoiceChanged
  detectors/members.ts        onHold raus, Sammelhinweis zählt Kontakte
  detectors/index.ts          neue Detektoren
  portal.ts, assistant.ts     Mitgliedschafts-Vertrag statt „irgendein Vertrag“
  events.ts                   invoicesRead, confirmReadContract, correctContract, deleteReadContract
  ai-port.ts                  InvoiceReader, InvoiceReadInput, InvoiceReadOutput, InvoiceReadError
src/ai/
  demo-invoice-reader.ts (neu)    regelbasiert
  claude-invoice-reader.ts (neu)  server-only, @anthropic-ai/sdk
src/data/
  engine.ts                   Reducer der neuen Ereignisse, confirmProposal für Lesungen, createPortalContract
  empty-state.ts, seed.ts     invoiceReadings: []
  selectors.ts                memberRows.kind/onHold, overdueMembers je Kontakt
src/server/
  env.ts                      anthropicApiKey
  read-invoices.ts (neu)      readInvoices
  sync.ts                     SyncDeps.reader, Schritt nach lexware_nexus, Ausgabe claude_invoices
  registry.ts                 Claude-Reader aus env
  db/tables.ts, db/supabase.ts  invoice_readings
  state-service.ts            CLIENT_EVENTS/SHAPE
src/app/
  api/test/import/route.ts    `claude: true` → Demo-Reader
  nexus/mitglieder/[id]/page.tsx  Plakette, Passt/Korrigieren/Löschen, graue Ampel
  nexus/offen/page.tsx        Label über Receivable.label (schon da)
  nachrichten/[threadId]/page.tsx  Mitgliedschafts-Vertrag
src/components/
  ProposalCard.tsx            Zitat, Rechenweg, Unsicherheit, confirmLabel
  TrafficDot.tsx              'grey'
  connection-labels.ts        Claude-Zeile mit Kosten/Limit
supabase/migrations/20261117000000_rechnungen_lesen.sql (neu)
tests/unit/ledger/contracts.test.ts, import/invoice-reading.test.ts, import/reading-fixtures.ts,
  import/reading-events.test.ts, ai/demo-invoice-reader.test.ts, ai/claude-invoice-reader.test.ts,
  read-invoices.test.ts, multi-contracts.test.ts, detectors-reading.test.ts (neu) + bestehende
tests/fixtures/lexware/invoice-RE-1200.json, invoice-RE-1201.json (neu), tests/fixtures/index.ts
tests/e2e/auth.spec.ts
```

---

### Task 1: Typen, neue Verbindung, Vertrags-Helfer

**Files:**
- Modify: `src/domain/types.ts`, `src/domain/connections.ts`, `src/data/empty-state.ts`, `src/data/seed.ts` (nur `invoiceReadings: []` in Zeile ~239), `tests/unit/helpers.ts` (`stateWith`: `invoiceReadings: []`), `tests/unit/empty-state.test.ts`, `tests/e2e/auth.spec.ts` (Einrichtungs-Liste 12 → 13)
- Create: `src/domain/ledger/contracts.ts`
- Test: `tests/unit/ledger/contracts.test.ts`

**Interfaces:**
- Produces (types.ts):
  ```ts
  export type ContractKind = 'membership' | 'ticket' | 'other';
  // MemberContract zusätzlich:
  kind?: ContractKind;
  readBy?: { invoiceId: string; invoiceNumber: string; quote: string; confirmed: boolean };
  export interface InvoiceReadResult {
    hasPlan: boolean; kind: ContractKind; installments: number | null; installmentCents: number | null;
    firstDueDate: IsoDate | null; dueDay: number | null; quote: string; certain: boolean; note: string | null;
  }
  export interface InvoiceReading {
    id: string; invoiceId: string; sourceUpdatedAt: string; readAt: string; model: string;
    result: InvoiceReadResult | null; outcome: 'applied' | 'proposal' | 'none' | 'error'; error?: string;
    contractId?: string; inputTokens: number; outputTokens: number; costMicroCents: number;
  }
  // AppState zusätzlich: invoiceReadings: InvoiceReading[]
  // ConnectionId zusätzlich: 'claude_invoices'
  // InsightType zusätzlich: 'contract_read_review' | 'read_invoice_changed'
  ```
- Produces (`ledger/contracts.ts`):
  ```ts
  export const CONTRACT_KIND_LABEL: Record<ContractKind, 'Mitgliedschaft' | 'Ticket-Raten' | 'Ratenzahlung'>;
  export function contractKindLabel(kind: ContractKind | undefined): string;      // undefined → 'Mitgliedschaft'
  export function isMembershipContract(c: MemberContract): boolean;               // kind undefined | 'membership'
  export function contractsOfContact(s: AppState, contactId: string): MemberContract[];
  export function membershipContractOf(s: AppState, contactId: string): MemberContract | undefined;
  export function invoiceRef(inv: Pick<Invoice, 'externalId'>): ExternalRef;      // { connectionId: 'lexware_nexus', externalId: `invoice:${externalId}` }
  export function sourceInvoiceOf(s: AppState, c: MemberContract): Invoice | undefined; // über origin 'invoice:<externalId>'
  export function contractOnHold(s: AppState, c: MemberContract): boolean;        // Quellrechnung status 'void'
  export function retargetAllocations(allocs: Allocation[], from: { invoiceId: string } | { contractId: string }, to: { invoiceId: string } | { contractId: string }): Allocation[];
  ```

- [ ] **Step 1: Failing tests** in `tests/unit/ledger/contracts.test.ts` (Fixtures über `stateWith`, `base`, `inv` aus `../helpers`):

```ts
test('Label: fehlt = Mitgliedschaft, ticket = Ticket-Raten, other = Ratenzahlung', () => {
  expect(contractKindLabel(undefined)).toBe('Mitgliedschaft');
  expect(contractKindLabel('ticket')).toBe('Ticket-Raten');
  expect(contractKindLabel('other')).toBe('Ratenzahlung');
});
test('membershipContractOf überspringt Ticket-Verträge desselben Kontakts', () => {
  const s = stateWith({ contracts: [{ ...base, id: 't1', contactId: 'm1', kind: 'ticket' }, { ...base, id: 'c1', contactId: 'm1' }] });
  expect(membershipContractOf(s, 'm1')?.id).toBe('c1');
  expect(contractsOfContact(s, 'm1').map((c) => c.id)).toEqual(['t1', 'c1']);
});
test('invoiceRef und sourceInvoiceOf', () => {
  const i = inv('i-r1', 60000, { company: 'nexus', connectionId: 'lexware_nexus', externalId: 'lex-r1' });
  expect(invoiceRef(i)).toEqual({ connectionId: 'lexware_nexus', externalId: 'invoice:lex-r1' });
  const c = { ...base, origin: [invoiceRef(i)] };
  expect(sourceInvoiceOf(stateWith({ invoices: [i], contracts: [c] }), c)?.id).toBe('i-r1');
});
test('contractOnHold nur bei stornierter Quellrechnung', () => {
  const i = inv('i-r1', 60000, { company: 'nexus', connectionId: 'lexware_nexus', externalId: 'lex-r1', status: 'void' });
  const c = { ...base, origin: [invoiceRef(i)] };
  expect(contractOnHold(stateWith({ invoices: [i], contracts: [c] }), c)).toBe(true);
  expect(contractOnHold(stateWith({ invoices: [{ ...i, status: 'paid' }], contracts: [c] }), c)).toBe(false);
  expect(contractOnHold(stateWith({ contracts: [base] }), base)).toBe(false);
});
test('retargetAllocations hängt nur Zuordnungen der Rechnung um, Methode bleibt', () => {
  const a = [{ paymentId: 'p1', invoiceId: 'i-r1', amountCents: 10000, method: 'confirmed' as const }, { paymentId: 'p2', invoiceId: 'i-x', amountCents: 5000, method: 'auto' as const }];
  expect(retargetAllocations(a, { invoiceId: 'i-r1' }, { contractId: 'k1' })).toEqual([
    { paymentId: 'p1', contractId: 'k1', amountCents: 10000, method: 'confirmed' }, a[1]]);
});
```
Plus in `tests/unit/empty-state.test.ts`: `expect(e.invoiceReadings).toEqual([])` und `expect(e.connections.find((c) => c.id === 'claude_invoices')).toMatchObject({ status: 'missing', company: 'nexus', label: 'Claude (Rechnungen lesen)' })` (falls `createEmptyState` die Verbindungen aus dem Katalog baut; sonst über `ensureCatalogConnections`).

- [ ] **Step 2: Run** `npx vitest run tests/unit/ledger/contracts.test.ts tests/unit/empty-state.test.ts` → FAIL (Modul fehlt).
- [ ] **Step 3: Implement** Typen, Katalog-Eintrag `{ id: 'claude_invoices', company: 'nexus', label: 'Claude (Rechnungen lesen)' }`, `HOW_TO.claude_invoices = 'Schlüssel als Vercel-Variable ANTHROPIC_API_KEY hinterlegen. Claude liest dann offene NEXUS-Rechnungen auf Ratenvereinbarungen (Monatslimit 100 €).'`, `contracts.ts`. `tsc` zeigt alle Stellen, die `AppState` vollständig bauen: dort `invoiceReadings: []`.
- [ ] **Step 4: Run** `npx vitest run tests/unit/ledger/contracts.test.ts tests/unit/empty-state.test.ts`, dann `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`. In `tests/e2e/auth.spec.ts` den Test „Einrichtungs-Liste mit 12 offenen Einträgen“ auf 13 umbenennen/umstellen, dann `fuser -k 3100/tcp; npm run e2e -- auth.spec.ts 2>&1 | tail -15`. Erwartet: grün.
- [ ] **Step 5: Commit**
```bash
git add src/domain/types.ts src/domain/connections.ts src/domain/ledger/contracts.ts src/data/empty-state.ts src/data/seed.ts tests/unit/helpers.ts tests/unit/empty-state.test.ts tests/unit/ledger/contracts.test.ts tests/e2e/auth.spec.ts
git commit -m "feat: Vertragsarten, Lesungs-Typen und Verbindung Claude (Rechnungen lesen)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_0118JMve5yL1H6x8wUGJiZmL" && git push
```

---

### Task 2: Domain – Auswahl, Prüfung, Kosten (`invoice-reading.ts`)

**Files:**
- Create: `src/domain/import/invoice-reading.ts`, `tests/unit/import/reading-fixtures.ts`
- Test: `tests/unit/import/invoice-reading.test.ts`

**Interfaces:**
- Consumes: Task 1 (`InvoiceReadResult`, `InvoiceReading`, `invoiceRef`, `membershipContractOf`), `proposalId`, `MONTH_END`, `ProposalValues` aus `proposals.ts`, `coveringContract` aus `ledger/receivables.ts` (Task 3 erweitert es; hier reicht die Origin-Prüfung über `invoiceRef`, siehe Step 3), `validateContractDraft`, `daysBetween`, `berlinParts`, `formatEuro`, `formatIsoDe`.
- Produces:
  ```ts
  export const READ_LIMITS = { maxPerRun: 5, budgetMs: 15_000, minInstallments: 2, maxInstallments: 36, daysBefore: 60, daysAfter: 365, maxAttempts: 3 } as const;
  /** Quelle: claude-api-Skill, Modelltabelle Stand 2026-11-03 (Claude Opus 5.5: 4 $ / 20 $ je 1 Mio. Token). */
  export const READ_PRICE = { model: 'claude-opus-5-5', inputMicroCentsPerToken: 400, outputMicroCentsPerToken: 2000, currency: 'USD' } as const;
  export const MONTHLY_LIMIT_MICRO_CENTS = 10_000_000_000;
  export const READ_HINT: { notCertain: string; sumMismatch: string; schema: string; noContact: string; hasMembership: string; lexwarePartial: string; incomplete: string };
  export function costMicroCents(u: { inputTokens: number; outputTokens: number }): number;
  export function monthCostMicroCents(s: AppState, at: Date): number;
  export function limitReached(s: AppState, at: Date, extraMicroCents?: number): boolean;
  export function readingProposalId(inv: Pick<Invoice, 'externalId'>): string;   // proposalId([invoiceRef(inv)])
  export function readingsOf(s: AppState, invoiceId: string): InvoiceReading[];   // nach readAt aufsteigend
  export function invoicesToRead(s: AppState, max?: number): Invoice[];
  export interface ReadingPlan { decision: 'apply' | 'proposal' | 'none'; kind: ContractKind; values: ProposalValues; steps: string[]; hints: string[] }
  export function planFromReading(s: AppState, inv: Invoice, r: InvoiceReadResult): ReadingPlan;
  export function readerSummary(s: AppState, at: Date): { lastReadAt: string | null; monthCostMicroCents: number; monthCostCents: number; limitMicroCents: number; limitReached: boolean; lastError: string | null }; // monthCostCents aufgerundet
  ```
  Exakte Hinweistexte (`READ_HINT`): `notCertain` = „Claude ist unsicher“ (mit `note`: „Claude ist unsicher: <note>“), `sumMismatch` = „Raten ergeben nicht die Rechnungssumme“, `schema` = „Plan passt nicht ins Monatsraten-Schema“, `noContact` = „Rechnung hat keinen NEXUS-Kontakt“, `hasMembership` = „Kontakt hat schon einen Mitgliedsvertrag“, `lexwarePartial` = „Teilzahlung nur in Lexware ausgeglichen – bitte prüfen“, `incomplete` = „Angaben unvollständig – bitte ergänzen“.

- [ ] **Step 1: Fixtures** `tests/unit/import/reading-fixtures.ts` (erfunden):

```ts
export const readInv = (p: Partial<Invoice> = {}): Invoice => inv('i-r1', 60000, {
  company: 'nexus', connectionId: 'lexware_nexus', externalId: 'lex-r1', contactId: 'm-x', contactExternalId: 'c-77',
  number: 'RE-9001', issuedOn: '2026-10-01', dueDate: '2026-10-15', status: 'open',
  text: 'Ticket NEXUS Summit, zahlbar in 6 Monatsraten à 100,00 €', sourceUpdatedAt: '2026-10-01T08:00:00Z', ...p });
export const okResult = (p: Partial<InvoiceReadResult> = {}): InvoiceReadResult => ({
  hasPlan: true, kind: 'ticket', installments: 6, installmentCents: 10000, firstDueDate: '2026-10-15', dueDay: 15,
  quote: 'zahlbar in 6 Monatsraten à 100,00 €', certain: true, note: null, ...p });
export const reading = (p: Partial<InvoiceReading> = {}): InvoiceReading => ({
  id: 'r1', invoiceId: 'i-r1', sourceUpdatedAt: '2026-10-01T08:00:00Z', readAt: '2026-11-12T09:00:00Z', model: 'claude-opus-5-5',
  result: okResult(), outcome: 'none', inputTokens: 1000, outputTokens: 500, costMicroCents: 1_400_000, ...p });
```

- [ ] **Step 2: Failing tests** `tests/unit/import/invoice-reading.test.ts`:

```ts
describe('planFromReading', () => {
  const s0 = stateWith({ invoices: [readInv()] });
  test('sicher und Summe passt → apply mit Werten', () => {
    const p = planFromReading(s0, readInv(), okResult());
    expect(p.decision).toBe('apply');
    expect(p.kind).toBe('ticket');
    expect(p.values).toEqual({ totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 15, startDate: '2026-10-15' });
    expect(p.steps.join(' ')).toContain('6 Raten × 100,00 €');
  });
  test('Rundungsrest: 1.000 € in 6 Raten à 166,67 € → apply', () => {
    const i = readInv({ totalCents: 100000, openCents: 100000 });
    expect(planFromReading(s0, i, okResult({ installmentCents: 16667 })).decision).toBe('apply');
    expect(planFromReading(s0, i, okResult({ installmentCents: 16666 })).decision).toBe('apply');
  });
  test('Summe passt nicht → proposal mit Hinweis', () => {
    const p = planFromReading(s0, readInv({ totalCents: 100000, openCents: 100000 }), okResult({ installmentCents: 16000 }));
    expect(p.decision).toBe('proposal');
    expect(p.hints).toContain('Raten ergeben nicht die Rechnungssumme');
  });
  test('unsicher → proposal mit Grund', () => {
    const p = planFromReading(s0, readInv(), okResult({ certain: false, note: 'Anzahl unklar' }));
    expect(p.decision).toBe('proposal');
    expect(p.hints).toContain('Claude ist unsicher: Anzahl unklar');
  });
  test('hasPlan=false → none', () => expect(planFromReading(s0, readInv(), okResult({ hasPlan: false })).decision).toBe('none'));
  test('ohne Tag und ohne erste Fälligkeit: Monatsende, Start Rechnungsdatum', () => {
    expect(planFromReading(s0, readInv(), okResult({ dueDay: null, firstDueDate: null })).values).toMatchObject({ dueDay: 31, startDate: '2026-10-01' });
  });
  test('ohne Tag, mit erster Fälligkeit: Tag aus dem Datum', () => {
    expect(planFromReading(s0, readInv(), okResult({ dueDay: null, firstDueDate: '2026-10-20' })).values).toMatchObject({ dueDay: 20, startDate: '2026-10-20' });
  });
  test('Grenzen 2 und 36 gelten, 1 und 37 nicht', () => {
    expect(planFromReading(s0, readInv({ totalCents: 20000, openCents: 20000 }), okResult({ installments: 2 })).decision).toBe('apply');
    expect(planFromReading(s0, readInv({ totalCents: 360000, openCents: 360000 }), okResult({ installments: 36 })).decision).toBe('apply');
    expect(planFromReading(s0, readInv({ totalCents: 10000, openCents: 10000 }), okResult({ installments: 1 })).hints).toContain('Plan passt nicht ins Monatsraten-Schema');
    expect(planFromReading(s0, readInv({ totalCents: 370000, openCents: 370000 }), okResult({ installments: 37 })).decision).toBe('proposal');
  });
  test('erste Fälligkeit −60 / +365 Tage gilt, −61 / +366 nicht', () => {
    for (const [d, want] of [['2026-08-02', 'apply'], ['2026-08-01', 'proposal'], ['2027-10-01', 'apply'], ['2027-10-02', 'proposal']] as const)
      expect(planFromReading(s0, readInv(), okResult({ firstDueDate: d, dueDay: null })).decision).toBe(want);
  });
  test('ohne NEXUS-Kontakt → proposal', () => {
    expect(planFromReading(s0, readInv({ contactId: null }), okResult()).hints).toContain('Rechnung hat keinen NEXUS-Kontakt');
  });
  test('Mitgliedschaft bei vorhandenem Mitgliedsvertrag → proposal; Ticket daneben → apply', () => {
    const s = stateWith({ invoices: [readInv()], contracts: [{ ...base, id: 'k0', contactId: 'm-x' }] });
    expect(planFromReading(s, readInv(), okResult({ kind: 'membership' })).hints).toContain('Kontakt hat schon einen Mitgliedsvertrag');
    expect(planFromReading(s, readInv(), okResult({ kind: 'ticket' })).decision).toBe('apply');
  });
  test('9a: Teilzahlung nur in Lexware → proposal; in der App zugeordnet → apply', () => {
    const i = readInv({ openCents: 40000 });
    expect(planFromReading(stateWith({ invoices: [i] }), i, okResult()).hints).toContain('Teilzahlung nur in Lexware ausgeglichen – bitte prüfen');
    const s = stateWith({ invoices: [i], allocations: [{ paymentId: 'p1', invoiceId: 'i-r1', amountCents: 20000, method: 'confirmed' }] });
    expect(planFromReading(s, i, okResult()).decision).toBe('apply');
  });
  test('Review 5: Unsinn → proposal mit null-Werten, kein Wurf', () => {
    const p = planFromReading(s0, readInv(), okResult({ installments: 0, installmentCents: -5, dueDay: 40, firstDueDate: '2026-13-45' }));
    expect(p.decision).toBe('proposal');
    expect(p.values).toMatchObject({ installments: null, installmentCents: null, dueDay: null });
    expect(p.hints).toContain('Angaben unvollständig – bitte ergänzen');
  });
});

describe('invoicesToRead', () => {
  test('nur offene NEXUS-Rechnungen mit Text und offenem Betrag, älteste zuerst, höchstens 5', () => {
    const list = [
      readInv({ id: 'a', externalId: 'a', issuedOn: '2026-10-03' }), readInv({ id: 'b', externalId: 'b', issuedOn: '2026-10-02' }),
      readInv({ id: 'paid', externalId: 'p', status: 'paid' }), readInv({ id: 'void', externalId: 'v', status: 'void' }),
      readInv({ id: 'zero', externalId: 'z', openCents: 0 }), readInv({ id: 'notext', externalId: 'n', text: undefined }),
      readInv({ id: 'zul', externalId: 'zl', connectionId: 'lexware_zulassung', company: 'zulassung' }),
    ];
    expect(invoicesToRead(stateWith({ invoices: list })).map((i) => i.id)).toEqual(['b', 'a']);
    const many = Array.from({ length: 7 }, (_, k) => readInv({ id: `m${k}`, externalId: `m${k}`, issuedOn: `2026-10-0${k + 1}` }));
    expect(invoicesToRead(stateWith({ invoices: many }))).toHaveLength(5);
  });
  test('vom Vertrag abgedeckt, schon gelesen, verworfen → raus; neue Fassung → wieder rein', () => {
    const i = readInv();
    expect(invoicesToRead(stateWith({ invoices: [i], contracts: [{ ...base, origin: [invoiceRef(i)] }] }))).toEqual([]);
    expect(invoicesToRead(stateWith({ invoices: [i], invoiceReadings: [reading({ outcome: 'proposal' })] }))).toEqual([]);
    expect(invoicesToRead(stateWith({ invoices: [i], dismissedProposals: [readingProposalId(i)] }))).toEqual([]);
    expect(invoicesToRead(stateWith({ invoices: [{ ...i, sourceUpdatedAt: '2026-11-01T08:00:00Z' }], invoiceReadings: [reading({ outcome: 'proposal' })] }))).toHaveLength(1);
  });
  test('Fehlversuche: nach 2 Fehlern erneut, eine none-Lesung (3. Fehler) beendet', () => {
    const i = readInv();
    const err = (id: string) => reading({ id, outcome: 'error', result: null, error: 'Zeitüberschreitung' });
    expect(invoicesToRead(stateWith({ invoices: [i], invoiceReadings: [err('e1'), err('e2')] }))).toHaveLength(1);
    expect(invoicesToRead(stateWith({ invoices: [i], invoiceReadings: [err('e1'), err('e2'), reading({ id: 'e3', outcome: 'none', result: null, error: '3 Versuche fehlgeschlagen' })] }))).toEqual([]);
  });
});

describe('Kosten', () => {
  test('1.000 Eingabe- und 500 Ausgabe-Token = 1,4 Cent', () => expect(costMicroCents({ inputTokens: 1000, outputTokens: 500 })).toBe(1_400_000));
  test('Review 4: Monat Europe/Berlin', () => {
    const at = new Date('2026-11-12T10:00:00Z');
    const s = stateWith({ invoiceReadings: [reading({ id: 'a', readAt: '2026-10-31T23:30:00Z' }), reading({ id: 'b', readAt: '2026-10-31T22:30:00Z' })] });
    expect(monthCostMicroCents(s, at)).toBe(1_400_000);
  });
  test('Limit 100 €', () => {
    const at = new Date('2026-11-12T10:00:00Z');
    const s = stateWith({ invoiceReadings: [reading({ costMicroCents: 9_999_999_999 })] });
    expect(limitReached(s, at)).toBe(false);
    expect(limitReached(s, at, 1)).toBe(true);
  });
});
```

- [ ] **Step 3: Run** `npx vitest run tests/unit/import/invoice-reading.test.ts` → FAIL.
- [ ] **Step 4: Implement** `invoice-reading.ts`. Vorgaben, die Tests offenlassen:
  - Werte säubern vor jeder Regel: `installments`/`installmentCents` nur ganze Zahlen > 0, `dueDay` ganze Zahl 1–31, `firstDueDate` nur gültiges ISO-Datum (gleiche Prüfung wie `validDate` in `contract-draft.ts`; dafür `validDate` dort exportieren und wiederverwenden). Ungültig → `null`.
  - Abbildung 9a: `startDate = firstDueDate ?? inv.issuedOn`; `dueDay = gelesener Tag ?? Tag von firstDueDate ?? MONTH_END`.
  - `apply` nur, wenn: `hasPlan && certain`, alle Werte vorhanden, `validateContractDraft` leer, Raten 2–36, Datumsfenster, Summenregel, `contactId !== null`, keine Mitgliedschafts-Kollision (`kind === 'membership' && membershipContractOf(s, inv.contactId)`), und `inv.totalCents − inv.openCents ≤ Σ allocations(invoiceId)`. Sonst `proposal` (bei `hasPlan`), sonst `none`.
  - `invoicesToRead`: Ausschluss „abgedeckt“ = ein Vertrag hat `invoiceRef(inv)` in `origin` (nach Task 3 zusätzlich `coveringContract`), „schon gelesen“ = es gibt eine Lesung mit gleichem `sourceUpdatedAt` (`inv.sourceUpdatedAt ?? ''`) und `outcome !== 'error'`. Sortierung `issuedOn`, dann `number`.
  - `readerSummary.lastError` = `error` der jüngsten Lesung mit Fehler, falls sie jünger ist als die jüngste erfolgreiche.
- [ ] **Step 5: Run** `npx vitest run tests/unit/import/invoice-reading.test.ts`, dann volle Tests + `npx tsc --noEmit`. Erwartet: grün.
- [ ] **Step 6: Commit** `feat: Rechnungen lesen – Auswahl, Prüfung und Kosten in der Domain` (Dateien: `src/domain/import/invoice-reading.ts`, `src/domain/import/contract-draft.ts`, `tests/unit/import/reading-fixtures.ts`, `tests/unit/import/invoice-reading.test.ts`; Trailer wie oben), `git push`.

---

### Task 3: Abdeckung, Forderungen, Vorschläge aus Lesungen

**Files:**
- Modify: `src/domain/ledger/receivables.ts`, `src/domain/import/proposals.ts`, `src/domain/import/invoice-reading.ts` (`readingProposals`)
- Test: `tests/unit/ledger/receivables.test.ts`, `tests/unit/import/proposals.test.ts`

**Interfaces:**
- Consumes: Task 1, Task 2 (`planFromReading`, `readingsOf`, `readingProposalId`).
- Produces:
  ```ts
  // proposals.ts
  sourceLabel: ... | 'Lexware (Claude)';
  reading?: { invoiceId: string; invoiceNumber: string; kind: ContractKind; quote: string; note: string | null };
  // invoice-reading.ts
  export function readingProposals(s: AppState): ContractProposal[];
  // receivables.ts: Receivable.label = contractKindLabel(c.kind) bei kind 'contract'
  ```

- [ ] **Step 1: Failing tests**

`receivables.test.ts`:
```ts
test('Rechnung mit Vertrag aus der Lesung (origin invoice:) zählt nicht doppelt', () => {
  const i = readInv();
  const s = stateWith({ invoices: [i], contracts: [{ ...base, id: 'k1', contactId: 'm-x', kind: 'ticket', origin: [invoiceRef(i)] }] });
  expect(coveringContract(s, i)).toBe('k1');
  expect(invoiceOpenCents(s, i)).toBe(0);
});
test('Ticket-Vertrag desselben Kontakts deckt die Mitgliedsrechnung nicht ab', () => {
  const m = member('i-m1');
  const s = stateWith({ invoices: [m], contracts: [{ ...base, id: 't1', kind: 'ticket', origin: [{ connectionId: 'lexware_nexus', externalId: 'c-77' }] }] });
  expect(coveringContract(s, m)).toBeNull();
});
test('Offen: Label „Ticket-Raten“ und Rate statt Gesamtsumme', () => {
  const i = readInv();
  const k = { ...base, id: 'k1', contactId: 'm-x', kind: 'ticket' as const, totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 15, startDate: '2026-10-15', origin: [invoiceRef(i)] };
  const s = stateWith({ invoices: [i], contracts: [k], connections: [conn({ id: 'bank_qonto', status: 'connected' })] });
  const r = nexusReceivables(s, '2026-11-12');
  expect(r.items.map((x) => [x.label, x.amountCents])).toEqual([['Ticket-Raten', 10000]]);
});
test('9a: Vertrag aus stornierter Rechnung ist nicht in Offen', () => {
  const i = readInv({ status: 'void' });
  const k = { ...base, id: 'k1', contactId: 'm-x', kind: 'ticket' as const, origin: [invoiceRef(i)] };
  expect(nexusReceivables(stateWith({ invoices: [i], contracts: [k], connections: [conn({ id: 'bank_qonto', status: 'connected' })] }), '2026-11-12').items).toEqual([]);
});
```
(`conn` aus `../helpers`; falls `stateWith` schon eine verbundene `bank_qonto` liefert, den Parameter weglassen.)

`proposals.test.ts`:
```ts
test('Lesung mit outcome proposal → Vorschlag „Lexware (Claude)“ mit Zitat und Rechenweg', () => {
  const i = readInv();
  const s = withLexContact(stateWith({ invoices: [i], invoiceReadings: [reading({ outcome: 'proposal', result: okResult({ certain: false, note: 'Anzahl unklar' }) })] }));
  const p = deriveProposals(s).find((x) => x.id === readingProposalId(i))!;
  expect(p).toMatchObject({ sourceLabel: 'Lexware (Claude)', references: ['Rechnung RE-9001'], billing: 'legacy',
    reading: { invoiceId: 'i-r1', invoiceNumber: 'RE-9001', kind: 'ticket', quote: 'zahlbar in 6 Monatsraten à 100,00 €', note: 'Anzahl unklar' } });
  expect(p.steps).toContain('Claude ist unsicher: Anzahl unklar');
});
test('verworfen bleibt verworfen; none- und applied-Lesungen erzeugen keinen Vorschlag', () => { /* dismissedProposals: [readingProposalId(i)] → kein Vorschlag; outcome 'none' → keiner */ });
test('Review 1: Mitgliedsrechnung, die schon im Textsuche-Vorschlag steht → nur der Textsuche-Vorschlag', () => {
  const m = { ...member('i-m1'), externalId: 'lex-m1' };
  const s = withLexContact(stateWith({ invoices: [m], invoiceReadings: [reading({ invoiceId: 'i-m1', outcome: 'proposal', result: okResult({ kind: 'membership' }) })] }));
  expect(deriveProposals(s).map((p) => p.sourceLabel)).toEqual(['Lexware']);
});
```
(`withLexContact` = kleiner lokaler Helfer, der Kontakt `m-x` mit Ref `lexware_nexus:c-77` ergänzt; vorhandene Helfer aus `tests/unit/import/helpers.ts` bevorzugen.)

- [ ] **Step 2: Run** `npx vitest run tests/unit/ledger/receivables.test.ts tests/unit/import/proposals.test.ts` → FAIL.
- [ ] **Step 3: Implement**
  - `coveringContract`: zuerst Vertrag mit `invoiceRef(inv)` in `origin` (vor allen Text-Prüfungen, auch ohne Mitgliedschaftstext); der bisherige Kontakt-Weg nur noch für Verträge mit `isMembershipContract`.
  - `nexusReceivables`: Verträge mit `contractOnHold` überspringen; `label: contractKindLabel(c.kind)`.
  - `readingProposals`: je Rechnung die jüngste Lesung mit `outcome === 'proposal'` und `sourceUpdatedAt` = aktuellem; Rechnung nicht `void`/`paid`, nicht abgedeckt; Werte/Schritte aus `planFromReading` (`steps` = `plan.steps` + `plan.hints`); `complete` = alle Werte gesetzt und `validateContractDraft` leer; `contactRefs` = Lexware-Kontakt-Ref der Rechnung; Name/E-Mail vom Kontakt (`inv.contactId`), sonst `Rechnung <nr>`/`null`.
  - `deriveProposals`: `readingProposals(s)` anhängen, außer für Rechnungen, die in `byContact` (Textsuche) stecken; danach wie bisher Verworfene filtern, sortieren. Keine Zusammenführung mit Stripe-Vorschlägen.
- [ ] **Step 4: Run** Tests der Step-2-Dateien, dann volle Tests + `npx tsc --noEmit`. Grün.
- [ ] **Step 5: Commit** `feat: Rechnungs-Abdeckung durch Ratenvertrag und Vorschläge aus Claude-Lesungen` (+ Trailer), `git push`.

---

### Task 4: Ereignisse und Reducer

**Files:**
- Modify: `src/domain/events.ts`, `src/data/engine.ts`, `src/server/state-service.ts`
- Test: `tests/unit/import/reading-events.test.ts`, `tests/unit/state-service.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`planFromReading`, `coveringContract`, `readingProposalId`, `invoiceRef`, `retargetAllocations`, `limitReached`, `validateContractDraft`).
- Produces (`events.ts`):
  ```ts
  export type NewInvoiceReading = Omit<InvoiceReading, 'outcome' | 'contractId'>; // error gesetzt = Fehlversuch
  | { type: 'invoicesRead'; readings: NewInvoiceReading[]; warning?: string; error?: string }
  | { type: 'confirmReadContract'; contractId: string }
  | { type: 'correctContract'; contractId: string; draft: ContractDraft }
  | { type: 'deleteReadContract'; contractId: string }
  ```
  Client-Ereignisse (CLIENT_EVENTS + SHAPE): `confirmReadContract` (`isStr(contractId)`), `correctContract` (`isStr(contractId) && isContractDraft(draft)`), `deleteReadContract` (`isStr(contractId)`). `invoicesRead` ist **kein** Client-Ereignis.

Reducer-Regeln:
- `invoicesRead`, je Lesung in Reihenfolge auf dem laufenden Stand: Fehler → `outcome 'error'`; ist es der 3. Fehler für `invoiceId`+`sourceUpdatedAt`, stattdessen `outcome 'none'` mit `error: 'Nach 3 Versuchen aufgegeben: <Fehler>'`. Rechnung fehlt, abgedeckt (`coveringContract`) oder `readingProposalId` verworfen → `'none'`. Sonst `planFromReading`: `apply` → Vertrag anlegen, `'applied'` + `contractId`; `proposal`/`none` entsprechend.
- Vertrag aus `apply`: `{ id: newId(), contactId: inv.contactId, ...values, billing: 'legacy', catchUpMode: 'first_rate', kind, readBy: { invoiceId, invoiceNumber, quote, confirmed: false }, origin: [invoiceRef(inv), ...(kind === 'membership' && inv.contactExternalId ? [{ connectionId: 'lexware_nexus', externalId: inv.contactExternalId }] : [])] }`; Zuordnungen per `retargetAllocations(…, { invoiceId }, { contractId })`.
- Verbindung `claude_invoices`: `error` → `status 'error'`, `lastError`; sonst `connected`, `lastSuccessAt = at`, `lastError = warning` (oder „Monatslimit erreicht“, wenn `limitReached(state, at)`), sonst gelöscht. Audit nur bei ≥ 1 Lesung: `Claude: N Rechnungen gelesen, A Ratenverträge angelegt, P Vorschläge` (actor `system`).
- `confirmProposal` mit `p.reading`: Vertrag zusätzlich mit `kind`, `readBy: { …, confirmed: true }`, Kontakt-Ref in `origin` nur bei Mitgliedschaft, Zuordnungen umhängen.
- `confirmReadContract`: `readBy.confirmed = true`. `correctContract`: nur Verträge mit `readBy`; `validateContractDraft`, Werte übernehmen, `confirmed = true`. `deleteReadContract`: nur mit `readBy`; Vertrag und `exceptions[id]` entfernen, Zuordnungen zurück auf `readBy.invoiceId`, `readingProposalId` der Quellrechnung in `dismissedProposals`. Ohne `readBy` jeweils unverändert mit Audit „Nur für von Claude gelesene Verträge“.

- [ ] **Step 1: Failing tests** `tests/unit/import/reading-events.test.ts` (Kontext wie in `confirm.test.ts`: `ctx()` mit `seq()`):

```ts
const lesung = (p: Partial<NewInvoiceReading> = {}): NewInvoiceReading => { const { outcome, contractId, ...r } = reading(); return { ...r, ...p }; };
const s0 = () => withLexContact(stateWith({ invoices: [readInv()] }));

test('legt bei apply den Vertrag an, markiert, Rechnung nicht mehr offen', () => {
  const { state, created } = applyEvent(s0(), { type: 'invoicesRead', readings: [lesung()] }, ctx());
  const k = state.contracts.find((c) => c.id === created[0])!;
  expect(k).toMatchObject({ contactId: 'm-x', kind: 'ticket', totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 15, startDate: '2026-10-15',
    billing: 'legacy', catchUpMode: 'first_rate', readBy: { invoiceId: 'i-r1', invoiceNumber: 'RE-9001', confirmed: false }, origin: [{ connectionId: 'lexware_nexus', externalId: 'invoice:lex-r1' }] });
  expect(state.invoiceReadings.at(-1)).toMatchObject({ outcome: 'applied', contractId: k.id });
  expect(invoiceOpenCents(state, state.invoices[0])).toBe(0);
  expect(state.connections.find((c) => c.id === 'claude_invoices')?.status).toBe('connected');
});
test('Review 2: zwei Lesungen derselben Rechnung → ein Vertrag', () => {
  const { state } = applyEvent(s0(), { type: 'invoicesRead', readings: [lesung({ id: 'a' }), lesung({ id: 'b' })] }, ctx());
  expect(state.contracts.filter((c) => c.readBy?.invoiceId === 'i-r1')).toHaveLength(1);
  expect(state.invoiceReadings.map((r) => r.outcome)).toEqual(['applied', 'none']);
});
test('Review 3: zugeordnete Zahlung wandert auf den Vertrag und bei Löschen zurück', () => {
  const s = { ...s0(), payments: [tx({ id: 'p1', amountCents: 10000, bookedOn: '2026-10-16' })], allocations: [{ paymentId: 'p1', invoiceId: 'i-r1', amountCents: 10000, method: 'confirmed' as const }] };
  const a = applyEvent(s, { type: 'invoicesRead', readings: [lesung()] }, ctx());
  const id = a.created[0];
  expect(a.state.allocations).toEqual([{ paymentId: 'p1', contractId: id, amountCents: 10000, method: 'confirmed' }]);
  expect(memberView(a.state, id, '2026-11-12').states[0].paidCents).toBe(10000);
  const d = applyEvent(a.state, { type: 'deleteReadContract', contractId: id }, ctx());
  expect(d.state.contracts.some((c) => c.id === id)).toBe(false);
  expect(d.state.allocations).toEqual([{ paymentId: 'p1', invoiceId: 'i-r1', amountCents: 10000, method: 'confirmed' }]);
  expect(d.state.dismissedProposals).toContain(readingProposalId(readInv()));
});
test('verworfen bleibt verworfen: nach Löschen legt eine neue Lesung keinen Vertrag an', () => { /* nach deleteReadContract erneut invoicesRead mit neuer sourceUpdatedAt → outcome 'none', kein Vertrag */ });
test('Fehler zählen; 3. Fehler → none mit Hinweis', () => {
  const err = (id: string) => lesung({ id, result: null, error: 'Zeitüberschreitung', inputTokens: 0, outputTokens: 0, costMicroCents: 0 });
  const { state } = applyEvent(s0(), { type: 'invoicesRead', readings: [err('e1'), err('e2'), err('e3')] }, ctx());
  expect(state.invoiceReadings.map((r) => r.outcome)).toEqual(['error', 'error', 'none']);
  expect(state.invoiceReadings[2].error).toBe('Nach 3 Versuchen aufgegeben: Zeitüberschreitung');
});
test('unsicher → kein Vertrag, Vorschlag; Übernehmen setzt kind und readBy bestätigt', () => {
  const r = applyEvent(s0(), { type: 'invoicesRead', readings: [lesung({ result: okResult({ certain: false, note: 'x' }) })] }, ctx());
  expect(r.state.contracts).toHaveLength(0);
  const p = deriveProposals(r.state).find((x) => x.sourceLabel === 'Lexware (Claude)')!;
  const c = applyEvent(r.state, { type: 'confirmProposal', proposalId: p.id, draft: { totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 15, startDate: '2026-10-15', catchUpMode: 'first_rate' }, contactId: null }, ctx());
  expect(c.state.contracts[0]).toMatchObject({ kind: 'ticket', readBy: { confirmed: true }, origin: [{ connectionId: 'lexware_nexus', externalId: 'invoice:lex-r1' }] });
});
test('Passt und Korrigieren setzen confirmed; Korrigieren übernimmt Werte', () => { /* confirmReadContract → readBy.confirmed true; correctContract mit installments 5 / 12000 → Werte gesetzt, confirmed true; ungültiger Entwurf → unverändert */ });
test('error im Ereignis → Verbindung Störung mit Text', () => {
  const { state } = applyEvent(s0(), { type: 'invoicesRead', readings: [], error: 'Schlüssel ungültig' }, ctx());
  expect(state.connections.find((c) => c.id === 'claude_invoices')).toMatchObject({ status: 'error', lastError: 'Schlüssel ungültig' });
});
```
`state-service.test.ts`: `isClientEvent({ type: 'invoicesRead', readings: [] })` → `false`; `isClientEvent({ type: 'confirmReadContract', contractId: 'k1' })` → `true`; `correctContract` mit kaputtem Entwurf → `false`.

- [ ] **Step 2: Run** `npx vitest run tests/unit/import/reading-events.test.ts tests/unit/state-service.test.ts` → FAIL.
- [ ] **Step 3: Implement** nach den Regeln oben; die Vertragsanlage aus `apply` und aus `confirmProposal` teilen sich einen Helfer `contractFromReading(...)` in `engine.ts` (kein Duplikat).
- [ ] **Step 4: Run** Step-2-Tests, volle Tests, `npx tsc --noEmit`. Grün.
- [ ] **Step 5: Commit** `feat: Ereignis invoicesRead legt Ratenverträge an; Passt, Korrigieren, Löschen` (+ Trailer), `git push`.

---

### Task 5: Persistenz und Migration `invoice_readings`

**Files:**
- Create: `supabase/migrations/20261117000000_rechnungen_lesen.sql`
- Modify: `src/server/db/tables.ts`, `src/server/db/supabase.ts` (`OPTIONAL_TABLES` + `'invoice_readings'`)
- Test: `tests/unit/migration.test.ts`, `tests/unit/db-tables.test.ts`

**Interfaces:**
- Produces: `TABLES.invoiceReadings = 'invoice_readings'`, `invoiceReadings` in `ArrayKey`/`SIMPLE` (Zeilen `{ id, ord, data }`, keine Schlüsselspalten). `fromRows({}).invoiceReadings` = `[]`.

- [ ] **Step 1: Failing tests**

```ts
// migration.test.ts
describe('Migration Rechnungen lesen', () => {
  it('idempotent, RLS, apply_changes kennt invoice_readings', () => {
    const p = read(`${DIR}/20261117000000_rechnungen_lesen.sql`);
    expect(p).toContain('create table if not exists invoice_readings (');
    expect(p).toContain('alter table invoice_readings enable row level security;');
    expect(p).toMatch(/v_allowed constant text\[\] := array\[[^\]]*'order_confirmations', 'invoice_readings'/);
    expect(p).toMatch(/v_external constant text\[\] := array\['payments', 'invoices', 'messages', 'events', 'subscriptions', 'portal_members', 'order_confirmations'\]/);
    expect(p).not.toMatch(/drop table|truncate|alter table \w+ drop/);
  });
});
// db-tables.test.ts
test('invoiceReadings: Tabelle invoice_readings, Rundreise, fehlt = []', () => {
  const r = reading();
  const rows = toRows({ ...createEmptyState(), invoiceReadings: [r] });
  expect(TABLES.invoiceReadings).toBe('invoice_readings');
  expect(rows.invoice_readings[0]).toMatchObject({ id: 'r1', ord: 0 });
  expect(fromRows(rows).invoiceReadings).toEqual([r]);
  expect(fromRows({}).invoiceReadings).toEqual([]);
});
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/migration.test.ts tests/unit/db-tables.test.ts` → FAIL.
- [ ] **Step 3: SQL schreiben** nach dem Muster `20261116000000_auftragsbestaetigungen.sql`: `create table if not exists invoice_readings (id text primary key, ord int not null, data jsonb not null, updated_at timestamptz not null default now());`, RLS an, Rechte wie dort, `apply_changes` vollständig neu definieren (Kopie der jüngsten Fassung, `v_allowed` um `'invoice_readings'` am Ende ergänzt, `v_external` unverändert). Kopfkommentar: „Claude-Lesungen von NEXUS-Rechnungen. Idempotent. Vom Inhaber im SQL-Editor auszuführen, erst danach mergen.“ Danach `tables.ts`/`supabase.ts`.
- [ ] **Step 4: Run** Step-2-Tests, volle Tests, `npx tsc --noEmit`. Grün.
- [ ] **Step 5: Commit** `feat: Tabelle invoice_readings (Migration, Persistenz)` (+ Trailer), `git push`.
- [ ] **Step 6: Inhaber informieren:** Die Datei `supabase/migrations/20261117000000_rechnungen_lesen.sql` muss der Inhaber im Supabase-SQL-Editor ausführen. **Erst danach wird der Branch gemergt.** (Bis dahin lädt der Server dank `OPTIONAL_TABLES` weiter; Speichern von Lesungen schlüge fehl, deshalb nicht vorher mergen.)

---

### Task 6: Reader-Port, Demo-Reader, Claude-Reader

**Files:**
- Modify: `src/domain/ai-port.ts`, `src/server/env.ts`, `package.json`/`package-lock.json` (`npm install @anthropic-ai/sdk@^1.8.0`), `.env.example` (`ANTHROPIC_API_KEY=`, Kommentar „optional, Rechnungen lesen“)
- Create: `src/ai/demo-invoice-reader.ts`, `src/ai/claude-invoice-reader.ts`
- Test: `tests/unit/ai/demo-invoice-reader.test.ts`, `tests/unit/ai/claude-invoice-reader.test.ts`, `tests/unit/env.test.ts`

**Interfaces:**
- Produces (`ai-port.ts`, rein):
  ```ts
  export interface InvoiceReadInput { number: string; totalCents: number; issuedOn: IsoDate; dueDate: IsoDate; text: string }
  export interface InvoiceReadOutput { result: InvoiceReadResult; model: string; inputTokens: number; outputTokens: number }
  export class InvoiceReadError extends Error { constructor(message: string, readonly fatal: boolean) }  // fatal = Schlüssel/Rechte (401/403)
  export interface InvoiceReader { readonly model: string; read(i: InvoiceReadInput, o: { timeoutMs: number }): Promise<InvoiceReadOutput> }
  ```
- Produces: `export const demoInvoiceReader: InvoiceReader` (model `'demo'`); `export function createClaudeInvoiceReader(o: { apiKey: string; client?: { messages: { create: Anthropic['messages']['create'] } } }): InvoiceReader` (model `READ_PRICE.model`); `ServerEnv.anthropicApiKey?: string` aus `ANTHROPIC_API_KEY`.

Demo-Regeln (exakt): `/in (\d+) (?:Monats)?raten/i` oder `/(\d+) Monatsraten/i` → `installments = N`, `installmentCents = Math.floor(totalCents / N)`, `certain: true`; nur `/\bRaten\b/i` ohne Zahl → `hasPlan: true`, alle Zahlen `null`, `certain: false`, `note: 'Anzahl der Raten fehlt'`; sonst `hasPlan: false`. `kind`: `/ticket/i` → `'ticket'`, `/mitglied/i` → `'membership'`, sonst `'other'`. `quote` = der Satz (bis `.`/Zeilenende), der den Treffer enthält, sonst `''`. `firstDueDate`/`dueDay` immer `null`. Tokens 0.

Claude-Aufruf (Umsetzung `read`):
```ts
const res = await client.messages.create({
  model: 'claude-opus-5-5', max_tokens: 4000,
  output_config: { effort: 'low', format: { type: 'json_schema', schema: READ_SCHEMA } },
  system: READ_SYSTEM_PROMPT,
  messages: [{ role: 'user', content: userText(i) }],   // nur Felder aus InvoiceReadInput
}, { timeout: o.timeoutMs });
```
`new Anthropic({ apiKey, maxRetries: 0 })`. `READ_SCHEMA`: Objekt mit allen Feldern aus `InvoiceReadResult`, `additionalProperties: false`, alle `required`, Nullbares als `anyOf: [{ type: 'integer' }, { type: 'null' }]` bzw. `string`/`null`, `kind` als `enum`, keine `minimum`/`maximum` (prüft die Domain). Prompt (Wortlaut frei, Spec 10) muss sagen: `hasPlan` nur, wenn die **Summe dieser Rechnung** in Raten gezahlt wird; ist die Rechnung selbst eine Monatsrate („Rate 3 von 12“, Monatsbeitrag) → `false`; `quote` wörtlich aus dem Text; nichts raten, unsicher → `certain: false` mit kurzer `note`; `dueDay` 31 = Monatsende; Beträge in Cent. Auswertung: `stop_reason === 'refusal'` → Ergebnis `hasPlan: false, certain: false, note: 'Claude hat die Lesung abgelehnt'`; `stop_reason === 'max_tokens'` oder kein Text/JSON nicht parsebar → `InvoiceReadError('Antwort unvollständig', false)`; sonst ersten `text`-Block `JSON.parse`. Fehler: `Anthropic.AuthenticationError`/`PermissionDeniedError` → `InvoiceReadError('Claude-Schlüssel ungültig oder ohne Rechte', true)`; `RateLimitError` → `('Claude ausgelastet (429)', false)`; `APIConnectionTimeoutError` → `('Zeitüberschreitung', false)`; `APIError` mit `status >= 500` → `('Claude-Störung (<status>)', false)`; alles andere → `('Unbekannter Fehler', false)`. Fehlertexte enthalten nie den Schlüssel. Tokens: `usage.input_tokens`, `usage.output_tokens`. Bewusst **keine** `fallbacks` (Preis des Ersatzmodells wäre in der Kostenrechnung unbekannt; eine Ablehnung wird `none`).

- [ ] **Step 1: Failing tests**

```ts
// demo-invoice-reader.test.ts
test('„zahlbar in 6 Monatsraten“ → 6 Raten, sicher, Ticket', async () => {
  const o = await demoInvoiceReader.read({ number: 'RE-9001', totalCents: 60000, issuedOn: '2026-10-01', dueDate: '2026-10-15', text: 'Ticket NEXUS Summit. Zahlbar in 6 Monatsraten.' }, { timeoutMs: 1000 });
  expect(o.result).toMatchObject({ hasPlan: true, kind: 'ticket', installments: 6, installmentCents: 10000, certain: true, quote: 'Zahlbar in 6 Monatsraten.' });
});
test('„Raten nach Absprache“ → unsicher ohne Zahlen', async () => { /* hasPlan true, installments null, certain false, note 'Anzahl der Raten fehlt' */ });
test('„Rate 3 von 6“ und „Workshop“ → kein Plan', async () => { /* hasPlan false */ });

// claude-invoice-reader.test.ts (client gestubbt, nie Netz)
const stub = (impl: (body: any, opts: any) => any) => { const calls: any[] = []; return { calls, client: { messages: { create: async (b: any, o: any) => { calls.push([b, o]); return impl(b, o); } } } }; };
const msg = (json: object, p = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(json) }], usage: { input_tokens: 1000, output_tokens: 500 }, ...p });
test('sendet nur die erlaubten Felder, Modell und JSON-Schema, low effort, Zeitlimit', async () => {
  const s = stub(() => msg(okResult()));
  const r = createClaudeInvoiceReader({ apiKey: 'sk-test-geheim-123456', client: s.client });
  const o = await r.read({ number: 'RE-9001', totalCents: 60000, issuedOn: '2026-10-01', dueDate: '2026-10-15', text: 'zahlbar in 6 Monatsraten' }, { timeoutMs: 12000 });
  const [body, opts] = s.calls[0];
  expect(body).toMatchObject({ model: 'claude-opus-5-5', output_config: { effort: 'low', format: { type: 'json_schema' } } });
  expect(body.thinking).toBeUndefined();
  expect(JSON.stringify(body.messages)).toContain('RE-9001');
  expect(JSON.stringify(body.messages)).not.toMatch(/@|Kontakt/);
  expect(opts).toMatchObject({ timeout: 12000 });
  expect(o).toEqual({ result: okResult(), model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 500 });
});
test('Ablehnung → kein Plan; max_tokens → Fehler', async () => { /* refusal → result.hasPlan false, note 'Claude hat die Lesung abgelehnt'; max_tokens → rejects InvoiceReadError 'Antwort unvollständig' */ });
test('429, 5xx, Zeitüberschreitung → nicht fatal; 401 → fatal; Text ohne Schlüssel', async () => {
  /* create wirft new Anthropic.RateLimitError(...) usw. (Konstruktor laut SDK; notfalls Objekt mit passender Klasse über Object.create(Anthropic.RateLimitError.prototype));
     expect(err).toBeInstanceOf(InvoiceReadError); expect(err.fatal).toBe(...); expect(err.message).not.toContain('sk-test-geheim-123456') */
});
// env.test.ts
test('ANTHROPIC_API_KEY optional', () => { /* ohne → anthropicApiKey undefined, readEnv wirft nicht; mit → gesetzt */ });
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/ai tests/unit/env.test.ts` → FAIL.
- [ ] **Step 3: Implement** (`npm install @anthropic-ai/sdk@^1.8.0`; `claude-invoice-reader.ts` beginnt mit `import 'server-only'`). Wenn `output_config.format` im installierten SDK-Typ fehlt, Typfehler mit dem SDK-Typ `Anthropic.MessageCreateParams` lösen, nicht mit `any` am Aufruf.
- [ ] **Step 4: Run** Step-2-Tests, volle Tests, `npx tsc --noEmit`. Grün.
- [ ] **Step 5: Commit** `feat: InvoiceReader – Demo-Regeln und Claude (Opus 5.5, JSON-Schema)` inkl. `package.json`, `package-lock.json`, `.env.example` (+ Trailer), `git push`.

---

### Task 7: Sync-Schritt `readInvoices`

**Files:**
- Create: `src/server/read-invoices.ts`
- Modify: `src/server/sync.ts`, `src/server/registry.ts`, `src/app/api/test/import/route.ts`
- Test: `tests/unit/read-invoices.test.ts`, `tests/unit/sync.test.ts`

**Interfaces:**
- Consumes: Task 2 (`invoicesToRead`, `READ_LIMITS`, `costMicroCents`, `limitReached`), Task 4 (`invoicesRead`), Task 6 (`InvoiceReader`, `InvoiceReadError`).
- Produces:
  ```ts
  // sync.ts
  export interface SyncDeps { /* … */ reader?: InvoiceReader }
  // Ausgabe von syncConnections zusätzlich: claude_invoices: SyncOutcome
  // read-invoices.ts
  export async function readInvoices(repos: Repos, deps: { at: () => Date; now: () => number; deadline: number; reader: InvoiceReader; provider: ActionProvider; newId?: () => string }): Promise<SyncOutcome>;
  ```

Regeln: läuft in `syncConnections` direkt nach `lexware_nexus` (nur wenn dessen Ergebnis `ok` oder `partial` war); ohne `deps.reader` → `claude_invoices: 'skipped'`; `deadline = min(now + READ_LIMITS.budgetMs, gemeinsame deadline)`. Stand laden, `invoicesToRead(state)` (höchstens 5); je Rechnung vor dem Aufruf prüfen: Restzeit > 0 und `!limitReached(state, at, Summe der Kosten dieses Laufs)`, sonst Schleife beenden (Limit → `warning: 'Monatslimit erreicht'`). `read(input, { timeoutMs: deadline − now })`; Erfolg → Lesung mit Tokens und `costMicroCents`; `InvoiceReadError` nicht fatal → Lesung mit `error`, weiter; fatal → Schleife beenden, Ereignis mit `error`. Am Ende **ein** `dispatchEvents([{ type: 'invoicesRead', … }])` (auch mit 0 Lesungen, damit `lastSuccessAt` frisch bleibt). Ergebnis: fatal → `'error'`, Rest übrig (Limit/Zeit) → `'partial'`, sonst `'ok'`. Unerwartete Ausnahme → `'error'` und `invoicesRead` mit `error: 'Unbekannter Fehler'`, andere Verbindungen laufen weiter. `registry.getSyncDeps`: `reader: env.anthropicApiKey ? createClaudeInvoiceReader({ apiKey: env.anthropicApiKey }) : undefined`; `syncSecrets` erhält den Schlüssel zusätzlich zum Maskieren. Test-Route: Body `claude?: boolean` → `reader: demoInvoiceReader`.

- [ ] **Step 1: Failing tests** `tests/unit/read-invoices.test.ts` (Memory-Repos, Stand mit `readInv`-Rechnungen und Kontakt per `repos.state` vorbereiten; Fake-Reader):

```ts
const fakeReader = (p: { cost?: number; fail?: InvoiceReadError; delayMs?: number } = {}, clock?: { t: number }): InvoiceReader & { calls: string[] } => {
  const calls: string[] = [];
  return { model: 'fake', calls, read: async (i) => { calls.push(i.number); if (clock && p.delayMs) clock.t += p.delayMs; if (p.fail) throw p.fail;
    return { result: okResult(), model: 'fake', inputTokens: 1000, outputTokens: 500 }; } };
};
test('liest höchstens 5 Rechnungen pro Lauf, Rest im nächsten', async () => { /* 7 Rechnungen → calls 5, 2. Lauf → 2, Ergebnis 'partial' dann 'ok' */ });
test('Zeitbudget 15 s: ab Fristablauf kein weiterer Aufruf, timeoutMs = Restzeit', async () => { /* clock.t, delayMs 8000 → 2 Aufrufe; zweiter mit timeoutMs 7000 */ });
test('Review 4: Limit mitten im Lauf → kein weiterer Aufruf, Hinweis', async () => {
  /* Stand mit Lesung costMicroCents 9_998_600_000 in diesem Monat; jeder Aufruf kostet 1_400_000 → nach 1. Aufruf erreicht → calls 1; Verbindung lastError 'Monatslimit erreicht' */
});
test('nicht fataler Fehler → Lesung error, nächste Rechnung wird gelesen; fataler → Abbruch, Verbindung Störung', async () => { /* … */ });
test('Rechnung nach Vertragsanlage geändert (neue sourceUpdatedAt) → nicht neu gelesen', async () => { /* 1. Lauf apply; Rechnung mit neuer sourceUpdatedAt speichern; 2. Lauf calls [] */ });
```
`sync.test.ts`:
```ts
test('ohne Reader: claude_invoices skipped, Verbindung bleibt missing', async () => {
  const r = await syncConnections(repos, deps({ keys: {} }));
  expect(r).toEqual({ stripe_nexus: 'skipped', lexware_nexus: 'skipped', bank_qonto: 'skipped', lexware_zulassung: 'skipped', claude_invoices: 'skipped' });
});
test('mit Demo-Reader nach Lexware: Lesungen gespeichert, Verbindung verbunden', async () => {
  await syncConnections(repos, deps({ reader: demoInvoiceReader }));
  const s = (await repos.state.load()).state;
  expect(s.connections.find((c) => c.id === 'claude_invoices')?.status).toBe('connected');
  expect(s.invoiceReadings.length).toBeGreaterThan(0);
});
```
(Der bestehende Test „ohne Schlüssel …“ wird durch den ersten ersetzt.)
- [ ] **Step 2: Run** `npx vitest run tests/unit/read-invoices.test.ts tests/unit/sync.test.ts tests/unit/api-sync.test.ts` → FAIL.
- [ ] **Step 3: Implement** nach den Regeln oben.
- [ ] **Step 4: Run** Step-2-Tests, volle Tests, `npx tsc --noEmit`. Grün.
- [ ] **Step 5: Commit** `feat: Abgleich liest nach Lexware bis zu 5 Rechnungen mit Claude (15 s, Monatslimit)` (+ Trailer), `git push`.

---

### Task 8: Mehrere Verträge pro Kontakt (9a)

**Files:**
- Modify: `src/domain/portal.ts:48`, `src/domain/assistant.ts:90`, `src/app/nachrichten/[threadId]/page.tsx:23`, `src/data/engine.ts` (`createPortalContract`, Zeile ~428), `src/data/selectors.ts` (`memberRows`, `overdueMembers`), `src/domain/detectors/members.ts` (Sammelhinweis)
- Test: `tests/unit/multi-contracts.test.ts`

Stand der Grep-Liste (`grep -rn "contracts.find\|contracts.some" src`), die der Bauende vor Step 3 neu erzeugt und hier abhakt: `portal.ts:48` (Kontakt → Vertrag), `assistant.ts:90` (Kontakt → Vertrag), `nachrichten/[threadId]/page.tsx:23` (Kontakt → Vertrag), `engine.ts:428` (`some` je Kontakt). Alle übrigen Treffer suchen per Vertrags-ID und bleiben. `matching/payments.ts` behandelt jeden Vertrag schon als eigenen Kandidaten (nur Test).

**Interfaces:**
- Consumes: Task 1 (`membershipContractOf`, `contractsOfContact`, `contractKindLabel`, `contractOnHold`).
- Produces: `MemberRow` zusätzlich `kindLabel: string; onHold: boolean`. `overdueMembers` liefert **je Kontakt** einen Eintrag: `arrearsCents` = Summe über alle verbundenen, nicht ruhenden Verträge des Kontakts, `contractId` = Vertrag mit dem höchsten Rückstand, `traffic` = schlechteste Ampel.

Regeln: Portal-Status und Portal-Vertrag nur über `membershipContractOf` (bzw. Portal-`origin`). `editHref` für `send_reminder`: Vertrags-ID aus `insightKey` (`overdue:<contractId>`), sonst `membershipContractOf`. Nachrichten-Link: `membershipContractOf ?? contractsOfContact[0]`. `createPortalContract`: „hat schon einen Vertrag“ nur bei Mitgliedschafts-Vertrag. Sammelhinweis „N Mitglieder überfällig“: N = Anzahl verschiedener Kontakte. Ruhende Verträge (`contractOnHold`) nicht in `overdueMembers`, nicht im Sammelhinweis, kein Einzelhinweis.

- [ ] **Step 1: Failing tests** `tests/unit/multi-contracts.test.ts` (Kontakt `m-x` mit Mitgliedschaft `k-m` und Ticket `k-t`, beide im Rückstand, Qonto verbunden):

```ts
test('Portal: Status „contract“ und contractId über den Mitgliedsvertrag', () => { /* portalViews(...)[0].contractId === 'k-m' auch wenn 'k-t' zuerst im Array steht */ });
test('Assistent: Entwurf öffnen zeigt den Vertrag der Erinnerung', () => {
  /* Aktion send_reminder mit insightKey 'overdue:k-t' → draftLink(s, id).href === '/nexus/mitglieder/k-t' */
});
test('overdueMembers summiert je Kontakt', () => {
  const r = overdueMembers(s, '2026-11-12');
  expect(r).toHaveLength(1);
  expect(r[0].arrearsCents).toBe(arrearsM + arrearsT);
});
test('Sammelhinweis zählt Kontakte, nicht Verträge', () => { /* zweiter Kontakt im Rückstand → Titel beginnt mit '2 Mitglieder überfällig' */ });
test('Portal-Vertrag anlegen trotz Ticket-Vertrag des Kontakts', () => { /* createPortalContract für Kontakt mit nur 'k-t' legt Mitgliedsvertrag an */ });
test('Zahlung über eine Rate: zwei Verträge desselben Kontakts → Vorschlag mit Auswahl, nie automatisch', () => {
  /* matchBankPayment mit IBAN-Link auf m-x, Betrag passt zu beiden Raten → confidence !== 'high' oder candidates.length 2 */
});
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/multi-contracts.test.ts` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** Step-2-Test, volle Tests (`portal.test.ts`, `assistant.test.ts`, `detectors.test.ts`, `selectors.test.ts` müssen unverändert grün bleiben), `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat: mehrere Verträge je Kontakt – Mitgliedschaft für Portal, Summe für Rückstand` (+ Trailer), `git push`.

---

### Task 9: Detektoren für gelesene Verträge

**Files:**
- Create: `src/domain/detectors/reading.ts`
- Modify: `src/domain/detectors/index.ts`
- Test: `tests/unit/detectors-reading.test.ts`

**Interfaces:**
- Consumes: Task 1 (`sourceInvoiceOf`), `memberRef` aus `detectors/refs.ts`.
- Produces:
  ```ts
  export function detectReadContracts(s: AppState): Insight[];       // type 'contract_read_review'
  export function detectReadInvoiceChanged(s: AppState): Insight[];  // type 'read_invoice_changed'
  ```
  `detectReadContracts`: bei ≥ 1 Vertrag mit `readBy && !readBy.confirmed` genau ein Insight: `dedupeKey: 'read-review'`, `company: 'nexus'`, `priority: 'today'`, Titel siehe Global Constraints, `body: 'Claude hat Ratenpläne aus Rechnungen angelegt. Kurz ansehen und „Passt“ tippen oder korrigieren.'`, `refs`: `memberRef(c.id, Kontaktname)` je Vertrag, `nextStep: 'Kurz prüfen'`, `needsSources: ['lexware_nexus']`. `detectReadInvoiceChanged`: je Vertrag mit `readBy`, dessen Quellrechnung `void` oder `paid` ist: `dedupeKey: \`read-inv:${invoiceId}:${status}\``, `priority: 'today'`, Titel „Rechnung RE-… storniert – Ratenvertrag prüfen“ bzw. „… als bezahlt markiert – …“, `refs: [memberRef(...)]`, `nextStep: 'Vertrag prüfen'`, `needsSources: ['lexware_nexus']`.

- [ ] **Step 1: Failing tests**

```ts
test('ein unbestätigter gelesener Vertrag → „1 Ratenplan von Claude gelesen – kurz prüfen“ mit Link', () => {
  const [i] = detectReadContracts(stateWith({ contracts: [{ ...base, id: 'k1', readBy: { invoiceId: 'i-r1', invoiceNumber: 'RE-9001', quote: 'q', confirmed: false } }] }));
  expect(i).toMatchObject({ type: 'contract_read_review', dedupeKey: 'read-review', title: '1 Ratenplan von Claude gelesen – kurz prüfen' });
  expect(i.refs[0].href).toBe('/nexus/mitglieder/k1');
});
test('zwei → „2 Ratenpläne …“; bestätigt → kein Hinweis', () => { /* … */ });
test('Quellrechnung storniert / bezahlt → Hinweis mit Rechnungsnummer', () => {
  /* void → title 'Rechnung RE-9001 storniert – Ratenvertrag prüfen'; paid → 'Rechnung RE-9001 als bezahlt markiert – Ratenvertrag prüfen'; open → [] */
});
test('9a: stornierte Quellrechnung → Vertrag nicht als überfällig', () => {
  /* runDetectors(...) enthält keinen 'member_overdue' für diesen Vertrag */
});
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/detectors-reading.test.ts` → FAIL.
- [ ] **Step 3: Implement**, beide in `runDetectors` aufnehmen (der Ruhe-Ausschluss in `detectMemberOverdue` kam in Task 8).
- [ ] **Step 4: Run** Step-2-Test, volle Tests (`seed.test.ts` bleibt gleich: der Seed hat keine gelesenen Verträge), `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat: Hinweise „Ratenpläne von Claude gelesen“ und „Rechnung storniert – Ratenvertrag prüfen“` (+ Trailer), `git push`.

---

### Task 10: Oberfläche

**Files:**
- Modify: `src/app/nexus/mitglieder/[id]/page.tsx`, `src/components/ProposalCard.tsx`, `src/components/TrafficDot.tsx`, `src/components/connection-labels.ts`, `src/domain/money.ts` (`formatUsdCents`), `src/components/SetupChecklist.tsx` (State-Zugriff für die Claude-Zeile), `src/app/nexus/mitglieder/page.tsx` (Art-Label je Zeile)
- Test: `tests/unit/proposal-card.test.ts`, `tests/unit/connection-labels.test.ts`, `tests/e2e/nexus.spec.ts` (Demo-Modus, falls dort Mitgliederseite geprüft wird)

**Interfaces:**
- Consumes: Task 2 (`readerSummary`), Task 4 (Ereignisse), Task 8 (`MemberRow.kindLabel/onHold`).
- Produces:
  ```ts
  // ProposalCard: zusätzliche Props
  confirmLabel?: string;            // Standard 'Übernehmen'
  // TrafficDot: traffic: MemberStatus['traffic'] | 'grey'  (Farbe var(--gray), Label 'Ruht – Rechnung storniert')
  // connection-labels.ts
  export function connectionSubtitle(c: Connection, at: Date, reader?: ReturnType<typeof readerSummary>): string;
  ```

UI-Regeln:
- **Mitglied-Detail** (`readBy && !confirmed`): Plakette oberhalb der Kennzahlen, `data-testid="read-badge"`, Text „Von Claude gelesen“ + Chip mit `contractKindLabel`, Zitat in `<blockquote>` (`data-testid="read-quote"`), Quelle „Rechnung <nr>“, Rechenweg aus `planFromReading` der jüngsten angewandten Lesung (Fallback: `status.steps`). Knöpfe „Passt“ (`confirmReadContract`), „Korrigieren“ (öffnet `ProposalCard` mit einem aus dem Vertrag gebauten `ContractProposal`, `confirmLabel="Speichern"`, `dismissLabel="Abbrechen"`; Speichern → `correctContract`), „Löschen“ (Bestätigung per `confirm('Ratenvertrag löschen? Claude legt ihn nicht wieder an.')`, dann `deleteReadContract`, Router → `/nexus/mitglieder`). Nach „Passt“ ist die Plakette weg; „Korrigieren“ bleibt für `readBy`-Verträge auch nach Bestätigung erreichbar (kleiner Sekundärknopf).
- `contractOnHold`: Untertitel mit `TrafficDot traffic="grey"`, Hinweis `note-card` „Rechnung <nr> storniert: Dieser Vertrag zählt bis zu Ihrer Entscheidung nicht als überfällig.“
- **ProposalCard** bei `p.reading`: Zitat (`data-testid="proposal-<id>-quote"`), Rechenweg `p.steps` als `<ol className="steps">`, Chip „Ticket-Raten“/„Ratenzahlung“/„Mitgliedschaft“. Der vorhandene Chip `p.sourceLabel` zeigt „Lexware (Claude)“.
- **Verbindungen/Einrichtung:** Zeile `claude_invoices`: `missing` → HOW_TO (= „nicht eingerichtet“); sonst Basis wie bisher plus „Kosten diesen Monat: 0,42 $ von 100 € (1 $ als 1 € gerechnet)“. Den Dollarbetrag formatiert eine neue Funktion `formatUsdCents(cents: number): string` in `src/domain/money.ts` („0,42 $“); die Umrechnung Mikrocent → Cent (aufgerundet) liefert `readerSummary` als zusätzliches Feld `monthCostCents`. Bei Limit „ · Limit erreicht“, zuletzt gelesen über `ageText`.
- **Mitgliederliste:** Untertitel je Zeile mit `kindLabel` (nur wenn nicht „Mitgliedschaft“), ruhende Zeilen mit grauem Punkt.
- Keine Geldrechnung in Komponenten: alle Beträge kommen aus Domain-Funktionen.

- [ ] **Step 1: Failing tests**
```ts
// connection-labels.test.ts
test('Claude-Zeile zeigt Kosten und Limit', () => {
  const c = conn({ id: 'claude_invoices', status: 'connected', lastSuccessAt: '2026-11-12T09:00:00Z' });
  expect(connectionSubtitle(c, new Date('2026-11-12T10:00:00Z'), { lastReadAt: '2026-11-12T09:00:00Z', monthCostMicroCents: 42_000_000, monthCostCents: 42, limitMicroCents: 10_000_000_000, limitReached: false, lastError: null }))
    .toContain('Kosten diesen Monat: 0,42 $ von 100 €');
});
test('Limit erreicht wird genannt', () => { /* limitReached true → enthält 'Limit erreicht' */ });
// proposal-card.test.ts (Muster der bestehenden Datei)
test('Lesungs-Vorschlag zeigt Zitat und Rechenweg; confirmLabel ersetzt „Übernehmen“', () => { /* … */ });
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/connection-labels.test.ts tests/unit/proposal-card.test.ts` → FAIL.
- [ ] **Step 3: Implement** (vorher `node_modules/next/dist/docs/` zu Client-Komponenten/`useRouter` überfliegen; Bausteine `ListGroup`, `ListRow`, `PageHeader`, `TrafficDot`, `ProposalCard` wiederverwenden).
- [ ] **Step 4: Run** Step-2-Tests, volle Tests, `npx tsc --noEmit`, `fuser -k 3100/tcp; npm run e2e -- nexus.spec.ts heute.spec.ts 2>&1 | tail -15`. Grün.
- [ ] **Step 5: Commit** `feat: Plakette „Von Claude gelesen“ mit Passt/Korrigieren/Löschen, Lesungs-Vorschläge, Claude-Zeile in Verbindungen` (+ Trailer), `git push`.

---

### Task 11: E2E im Echtmodus

**Files:**
- Create: `tests/fixtures/lexware/invoice-RE-1200.json`, `tests/fixtures/lexware/invoice-RE-1201.json`
- Modify: `tests/fixtures/index.ts` (`lexwareRoutesRaten`), `tests/e2e/auth.spec.ts`

Fixtures (erfunden): **RE-1200** `id: "inv-RE-1200"`, Kontakt `c-85`, `voucherDate: "2026-10-01T00:00:00.000+02:00"`, `dueDate` `2026-10-15`, `voucherStatus: "open"`, `totalGrossAmount: 600.0`, Position „Ticket NEXUS Summit 2027“, `remark: "Zahlbar in 6 Monatsraten."`. **RE-1201** Kontakt `c-84`, 450,00 €, Position „Ticket NEXUS Summit 2027“, `remark: "Zahlung in Raten nach Absprache."`. Vorher prüfen, dass `c-84`/`c-85` in den früheren Tests von `auth.spec.ts` keinen Vertrag bekommen; sonst andere erfundene Kontakte in `contacts-nexus.json` ergänzen (`@example.de`). `lexwareRoutesRaten` = `lexwareRoutes` + beide Details + `/v1/voucherlist` mit den zwei zusätzlichen Einträgen (`openAmount` = Gesamtbetrag). Die bestehenden `lexwareRoutes` bleiben unverändert.

- [ ] **Step 1: Failing E2E** am Ende von `tests/e2e/auth.spec.ts` (nach dem Qonto-Test, damit `bank_qonto` verbunden ist):

```ts
test('Echtmodus: Claude liest „6 Monatsraten“ → Ratenvertrag mit Plakette, Offen zeigt Rate; „Passt“ entfernt die Plakette; unsicher → Vorschlag', async () => {
  const r = await page.request.post('/api/test/import', { data: { qonto: true, claude: true, routes: { ...stripeRoutes, ...lexwareRoutesRaten, ...qontoRoutes } } });
  expect((await r.json()).claude_invoices).toBe('ok');
  await page.goto('/nexus/offen');
  const row = page.locator('[data-testid^="receivable-contract:"]').filter({ hasText: 'Ticket-Raten' });
  await expect(row).toBeVisible();
  await expect(row).not.toContainText('600,00 €');
  await row.click();
  await expect(page.getByTestId('read-badge')).toContainText('Von Claude gelesen');
  await expect(page.getByTestId('read-quote')).toContainText('Zahlbar in 6 Monatsraten.');
  await page.getByRole('button', { name: 'Passt' }).click();
  await expect(page.getByTestId('read-badge')).toHaveCount(0);
  await page.goto('/nexus/mitglieder/vorschlaege');
  const card = page.locator('article', { hasText: 'Lexware (Claude)' });
  await expect(card).toContainText('Rechnung RE-1201');
  await expect(card).toContainText('Anzahl der Raten fehlt');
  await expect(card).toContainText('bitte ergänzen');
});
test('Echtmodus: Verbindungen zeigt Claude (Rechnungen lesen) verbunden mit Kosten', async () => {
  await page.goto('/verbindungen');
  await expect(page.getByTestId('setup-claude_invoices')).toContainText('Kosten diesen Monat');
});
```
(Offen-Zeilen tragen `testId={`receivable-${r.key}`}`, Vertragszeilen also `receivable-contract:<id>` und verlinken auf das Mitglied.)
- [ ] **Step 2: Run** `fuser -k 3100/tcp; npm run e2e -- auth.spec.ts 2>&1 | tail -15` → FAIL nur, wenn frühere Tasks Lücken haben; sonst direkt grün (dann kurz prüfen, dass der Test greift, z. B. `toContainText('600,00 €')` erzwingen und zurücknehmen).
- [ ] **Step 3:** Lücken in der zuständigen Task-Datei schließen (nicht im Test).
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `fuser -k 3100/tcp; npm run e2e 2>&1 | tail -15`. Alles grün.
- [ ] **Step 5: Commit** `test: E2E Rechnungen lesen im Echtmodus (Demo-Reader)` (+ Trailer), `git push`.
- [ ] **Step 6:** `docs/phase2-backlog.md` um offene Punkte ergänzen (Limit in der UI änderbar, Wechselkurs statt 1 $ = 1 €, Demo-Seed mit gelesenem Vertrag, Löschen/Korrigieren für alle Verträge) und mit `docs:`-Commit pushen. Erinnerung an den Inhaber: Migration aus Task 5 ausführen, `ANTHROPIC_API_KEY` ist laut Projektstand schon gesetzt; erst danach mergen.

---

## Self-Review (erledigt)

- **Spec-Abdeckung:** 4.1 Auslöser/Budget → T7; 4.2 Auswahl → T2; 4.3 Lesen/Schema → T6; 4.4 Prüfen → T2; 4.5 Anwenden → T4; 5 Datenmodell/Migration → T1, T5; Abdeckung → T3; Vorschlags-ID/Verwerfen → T2–T4; 6 UI → T10, Heute-Hinweise → T9; 7 Anbindung/Kosten/Fehler/Limit → T2, T6, T7; 8 Tests → je Task; 9a Mehrere Verträge → T8, Summe/Teilzahlung → T2, void/paid → T3/T8/T9/T10, Start/Tag → T2, Rundungsrest → T2, Kosten Monat Berlin → T2.
- **Typen:** `InvoiceReadResult`, `InvoiceReading`, `NewInvoiceReading`, `ReadingPlan`, `readingProposalId`, `invoiceRef`, `contractKindLabel`, `membershipContractOf` werden überall gleich benannt.
- **Bewusste Entscheidungen des Plans** (nicht in der Spec): eine Lesung je Aufruf, append-only (Kostenhistorie); Reducer bewertet jede Lesung neu; Claude-Status als Verbindung `claude_invoices`; Kosten in US-Dollar-Mikrocent, Limit 1 $ = 1 € (vorsichtig); keine Server-Fallbacks; Korrigieren/Löschen nur für von Claude gelesene Verträge (es gibt heute kein allgemeines Vertragsformular, Korrigieren nutzt `ProposalCard`); Lesungs-Vorschlag tritt hinter einen Textsuche-Vorschlag derselben Rechnung zurück.
