# Nexus-Assistent Paket 2b-1 (Verträge aus Stripe und Lexware) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stripe NEXUS, Lexware NEXUS und Lexware Zulassung werden lesend und regelmäßig abgeglichen. Aus Stripe-Abos und Lexware-Mitgliedschaftsrechnungen entstehen Vertragsvorschläge, die der Inhaber bestätigt. Stripe-Zahlungen landen im Ledger und werden ihrem bestätigten Abo-Vertrag sicher zugeordnet.

**Architecture:** Server-Connectors (`src/server/connectors/`) holen API-JSON seitenweise, mit Zeitbudget und gespeichertem Cursor. Reine Mapper (`src/domain/import/`) machen daraus einen `ImportBatch`. Das Server-Ereignis `importBatch` führt ihn über `mergeBatch` in den Zustand (Schlüssel = Verbindung + externe ID). `refresh()` ordnet Stripe-Zahlungen zu und erzeugt Hinweise. Vorschläge werden nie gespeichert, sondern rein aus `subscriptions`, `invoices` und `contacts` abgeleitet (`deriveProposals`). Gespeichert werden nur die Entscheidungen: `confirmProposal` legt Vertrag und Kontakt mit `origin` an, `dismissProposal` merkt die Vorschlags-ID. Der Cron-Sync-Slot und der Stripe-Webhook rufen denselben `syncConnections` auf.

**Tech Stack:** Next.js 16.4 (Route Handlers, `cacheComponents`), TypeScript, `node:crypto` (HMAC-SHA256 für die Stripe-Signatur, kein Stripe-SDK), globales `fetch`, Supabase (Migration), Vitest, Playwright. Keine neuen npm-Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-11-12-phase2b-design.md`, Abschnitte 1–10 und 11a. Abschnitte 11 (2b-2) und 11b (2b-3) gehören nicht dazu. Basis-Regeln: `docs/superpowers/specs/2026-11-12-nexus-assistent-design.md` Abschnitt 4a.

## Global Constraints

- Regeln 4a gelten unverändert: Cent-Ganzzahlen, Kalendertage Europe/Berlin über `src/domain/clock.ts` (Unix-Zeit → `todayBerlin(new Date(sec * 1000))`), Geld nur über Ledger- und Domain-Funktionen. Gutschriften nur aus Zahlungen. Eine Stripe-Auszahlung wird nie gutgeschrieben, eine bezahlte Lexware-Rechnung ist keine Gutschrift.
- `src/domain/` bleibt rein: kein `fetch`, kein React, keine Importe aus `src/data`, `src/app`, `src/components`, `src/ai`, `src/server` (prüft `tests/unit/architecture.test.ts`).
- Kein Vertrag entsteht ohne `confirmProposal` des Inhabers. Ein bestätigter Vertrag (`origin` gesetzt) wird von keinem Sync verändert.
- Neue Umgebungsvariablen, nur Production, alle optional: `STRIPE_RESTRICTED_KEY`, `STRIPE_WEBHOOK_SECRET`, `LEXWARE_NEXUS_API_KEY`, `LEXWARE_ZULASSUNG_API_KEY`. Fehlen sie, bleibt `readEnv()` grün und die Verbindung `missing`. Keine `NEXT_PUBLIC_`-Variable.
- Geheimnisse nur in `src/server/**` mit `import 'server-only'`. Nie in AppState, Audit, `lastError`, Antworttexten oder Logs.
- Erstimport ab `IMPORT_SINCE = '2026-08-01'`, danach inkrementell. Ein Lauf hält ein Zeitbudget ein und setzt im nächsten Slot am gespeicherten Cursor fort.
- Lexware: Basis `https://api.lexware.io`, Endpunkte `/v1/voucherlist?voucherType=invoice`, `/v1/invoices/{id}`, `/v1/contacts`. Höchstens 2 Anfragen/s (≥ 500 ms Abstand), bei 429 einmal warten und wiederholen. **Feldnamen, Filter- und Blätterparameter vor dem Bau gegen die aktuelle Lexware-Doku prüfen (Spec 12).**
- Stripe: Basis `https://api.stripe.com`, `Authorization: Bearer <Restricted Key>`, Blättern über `has_more` + `starting_after`. Die API-Version wird als Konstante `STRIPE_API_VERSION` im Header `Stripe-Version` festgelegt. **Feldnamen (u. a. Abo-Bezug einer Rechnung, Rechnung zu einer Erstattung) gegen genau diese Version in der aktuellen Doku prüfen (Spec 12).**
- Mitgliedschafts-Erkennung: Text enthält „Mitgliedschaft“ (ohne Groß-/Kleinschreibung, Bindestriche entfernt). Laufzeit „N Monate“ ergibt die Anzahl der Raten. Gilt für Lexware-Rechnungstext und Positionen sowie für Stripe-Produkt- und Positionsnamen.
- Vorschlags-ID = sortierte Quellschlüssel `connection:external_id`, mit `+` verbunden. Lexware-Quelle ist der Lexware-Kontakt, Stripe-Quelle das Abo.
- Tests rufen keine echte API auf. `fetch` wird über `fixtureFetch` gefälscht, Fixture-JSON liegt in `tests/fixtures/`.
- Next 16: Route Handlers ohne `export const runtime`, GET-Handler erst dynamisch machen (`await connection()`), kein `middleware.ts`. Rohtext der Webhook-Anfrage über `await req.text()`.
- UI-Texte Deutsch, Design-Bausteine aus `src/components` wiederverwenden, keine neue Optik.
- Vor jedem Commit: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Bei UI-Änderungen die betroffene E2E-Spec mit `fuser -k 3100/tcp; npm run e2e -- <spec> 2>&1 | tail -15`. Branch `claude/cool-hopper-hcnb9d`. Commit-Nachrichten Deutsch (`feat:`/`fix:`/`docs:`). Pushen macht der Controller.

## Review Focus

1. **Doppeltes „Übernehmen“** (zwei Taps, zwei Geräte, Wiederholung nach 409): Es entsteht genau ein Vertrag. Der zweite Aufruf findet den Vorschlag nicht mehr und ändert nichts. Test in Task 10.
2. **Abo ändert sich nach der Bestätigung** (Kündigung, Preis, `past_due`, erneuter Import): `contractId` bleibt, der Vertrag bleibt unverändert, es kommt nur ein Hinweis. Tests in Task 4 und Task 6.
3. **Erstimport bricht am Zeitlimit ab:** Der nächste Lauf setzt fort, ohne doppelte Zahlungen oder Rechnungen. Schon importierte Daten bleiben erhalten. Tests in Task 7 und Task 8.
4. **Fehlertext enthält den Schlüssel** (Netzfehler mit Header-Echo, 401 mit Antworttext): `lastError` und Audit enthalten nie den Schlüssel. Tests in Task 7 und Task 8.
5. **Neue Lexware-Ratenrechnung nach der Bestätigung:** Es kommt kein neuer Vorschlag für dasselbe Mitglied. Test in Task 5.

---

## Dateistruktur

```
src/domain/
  types.ts                 + ExternalRef, Subscription, Felder an Contact/MemberContract/Payment/Invoice/Connection, AppState.subscriptions/dismissedProposals, InsightType 'subscription_changed'
  connections.ts           + contractSources(), HOW_TO-Texte Stripe/Lexware
  events.ts                + importBatch, syncFailed (nur Server), confirmProposal, dismissProposal
  matching/imports.ts      + upsertImported()
  matching/payments.ts     nameMatches exportieren
  matching/stripe.ts       stripeAllocations()
  ledger/allocate.ts       Beträge < 0 und = 0
  ledger/schedule.ts       monthDate exportieren
  import/batch.ts          ImportBatch, emptyBatch, IMPORT_SINCE
  import/membership.ts     parseMembership()
  import/stripe.ts         StripeRaw, mapStripe(), billingPeriods()
  import/lexware.ts        mapLexwareContacts(), mapLexwareInvoice()
  import/merge.ts          mergeBatch()
  import/proposals.ts      ContractProposal, proposalId, deriveProposals, findContactFor
  import/contract-draft.ts ContractDraft, validateContractDraft
  detectors/members.ts     needsSources je Vertrag
  detectors/sources.ts     Fehler-Hinweis erst ab 3 Fehlversuchen
  detectors/subscriptions.ts detectSubscriptionChanges
src/data/
  engine.ts                Stripe-Zuordnung in refresh, neue Ereignisse
  empty-state.ts, seed.ts  neue Felder
  store.tsx                loadInitial füllt fehlende Felder
  selectors.ts             memberRows.notConnected, waitingStripePayments
src/server/
  env.ts                   optionale Schlüssel
  connectors/types.ts      PullContext, PullResult, ConnectorError
  connectors/http.ts       createApiClient (Drosselung, 429, sichere Fehler)
  connectors/fixture-fetch.ts fixtureFetch (Tests, Test-Route)
  connectors/stripe.ts     pullStripe, STRIPE_API_VERSION
  connectors/lexware.ts    pullLexware
  connectors/stripe-signature.ts verifyStripeSignature
  sync.ts                  syncConnections, sanitizeError
  cron.ts                  ruft den Sync einmal je Takt
  registry.ts              getSyncDeps
  db/tables.ts, db/supabase.ts  subscriptions, dismissed_proposals
  state-service.ts         CLIENT_EVENTS + SHAPE
src/app/
  api/webhooks/stripe/route.ts   api/test/import/route.ts   api/cron/tick/route.ts
  nexus/page.tsx  nexus/mitglieder/vorschlaege/page.tsx  nexus/mitglieder/[id]/page.tsx  nexus/mitglieder/[id]/uebernahme/page.tsx
  zulassung/auftraege/[id]/page.tsx  verbindungen/page.tsx (über SetupChecklist)
src/components/ProposalCard.tsx  SetupChecklist.tsx  connection-labels.ts
supabase/migrations/20261113000000_vertraege.sql
tests/fixtures/{stripe,lexware}/*.json  tests/fixtures/index.ts
tests/unit/import/*.test.ts  tests/unit/connectors/*.test.ts  tests/unit/sync.test.ts  tests/unit/webhook-stripe.test.ts
tests/e2e/auth.spec.ts (Echtmodus-Ablauf)  docs/setup-phase2b.md  .env.example
```

---

### Task 1: Datenmodell, Tabellen und Migration

**Files:**
- Modify: `src/domain/types.ts`, `src/domain/matching/imports.ts`, `src/data/empty-state.ts`, `src/data/seed.ts` (nur das Rückgabeobjekt von `createDemoState`, grep nach `assistantChat: []`), `src/data/store.tsx` (`loadInitial`), `src/server/db/tables.ts`, `src/server/db/supabase.ts`, `tests/unit/migration.test.ts`
- Create: `supabase/migrations/20261113000000_vertraege.sql`, `src/domain/import/batch.ts`
- Test: `tests/unit/db-tables.test.ts`, `tests/unit/migration.test.ts`, `tests/unit/matching/payments.test.ts`, `tests/unit/store.test.ts`

**Interfaces:**
- Produces (in `types.ts`):
  ```ts
  export interface ExternalRef { connectionId: ConnectionId; externalId: string }
  // Contact + externalRefs?: ExternalRef[]
  // MemberContract + origin?: ExternalRef[]
  // Payment + subscriptionExternalId?: string; refundOf?: string   // refundOf = Stripe-Rechnungs-ID der erstatteten Zahlung
  // Invoice + contactExternalId?: string; sourceUpdatedAt?: string
  // Connection + sync?: { cursor: string | null; complete: boolean; failures: number }
  export interface Subscription {
    id: string; connectionId: 'stripe_nexus'; externalId: string;            // sub_…
    stripeCustomerId: string; customerName: string; customerEmail: string | null;
    productName: string; amountCents: number | null;                          // amount_paid der jüngsten bezahlten Abo-Rechnung
    priceCents: number | null; currency: string; interval: 'month' | 'other';
    startDate: IsoDate; anchorDay: number; cancelAt: IsoDate | null; endDate: IsoDate | null; // endDate = cancelAt ?? Schedule-Ende
    installments: number | null;
    status: 'active' | 'past_due' | 'unpaid' | 'canceled' | 'incomplete' | 'trialing' | 'other';
    disputes: string[];
    contractId: string | null; confirmedPriceCents: number | null; confirmedEndDate: IsoDate | null;
  }
  // AppState + subscriptions: Subscription[]; dismissedProposals: string[]
  // InsightType + 'subscription_changed'
  ```
- Produces (in `import/batch.ts`):
  ```ts
  export const IMPORT_SINCE: IsoDate = '2026-08-01';
  export type ImportedContact = Omit<Contact, 'id' | 'externalRefs'> & { externalRefs: ExternalRef[] };
  export type ImportedInvoice = Omit<Invoice, 'id' | 'contactId'>;
  export type ImportedPayment = Omit<Payment, 'id'>;
  export type ImportedSubscription = Omit<Subscription, 'id' | 'contractId' | 'confirmedPriceCents' | 'confirmedEndDate' | 'disputes'>;
  export interface ImportedDispute { externalId: string; invoiceExternalId: string | null }
  export interface ImportBatch { contacts: ImportedContact[]; invoices: ImportedInvoice[]; payments: ImportedPayment[]; subscriptions: ImportedSubscription[]; disputes: ImportedDispute[] }
  export const emptyBatch = (): ImportBatch;
  ```
- Produces (in `matching/imports.ts`): `upsertImported<T extends Importable & { id: string }, I extends Importable>(existing: T[], incoming: I[], build: (next: I, old: T | null) => Omit<T, 'id'>, newId: () => string): { items: T[]; added: number }`. Bei bekanntem Schlüssel `{ ...build(next, old), id: old.id }` an derselben Position, bei unbekanntem `{ ...build(next, null), id: newId() }` hinten an.
- Produces (in `tables.ts`): `TABLES.subscriptions = 'subscriptions'`, `TABLES.dismissedProposals = 'dismissed_proposals'`, exportiertes `WITH_EXTERNAL_TABLES: ReadonlySet<TableName>` (payments, invoices, messages, events, subscriptions), das `supabase.ts` statt seiner eigenen Kopie nutzt.

- [ ] **Step 1: Failing tests schreiben**

```ts
// tests/unit/db-tables.test.ts (ergänzen)
it('subscriptions mit Schlüsselspalten, dismissedProposals als eigene Zeilen', () => {
  const s = { ...createEmptyState(), subscriptions: [SUB], dismissedProposals: ['stripe_nexus:sub_X'] };
  const r = toRows(s);
  expect(r.subscriptions[0]).toMatchObject({ id: SUB.id, connection_id: 'stripe_nexus', external_id: 'sub_A' });
  expect(r.dismissed_proposals).toEqual([{ id: 'stripe_nexus:sub_X', ord: 0, data: 'stripe_nexus:sub_X' }]);
  expect(fromRows(r)).toEqual(s);
});
it('fehlende neue Tabellen → leere Listen', () => {
  const s = fromRows({});
  expect(s.subscriptions).toEqual([]);
  expect(s.dismissedProposals).toEqual([]);
});

// tests/unit/migration.test.ts: alle Dateien in supabase/migrations in Namensreihenfolge zusammen lesen
it('Migration Verträge: Tabellen, RLS, Unique-Index, apply_changes kennt die neuen Tabellen', () => {
  const v = read('supabase/migrations/20261113000000_vertraege.sql');
  for (const t of ['subscriptions', 'dismissed_proposals']) {
    expect(v).toContain(`create table ${t} (`);
    expect(v).toContain(`alter table ${t} enable row level security;`);
  }
  expect(v).toMatch(/unique index [a-z_]+ on subscriptions \(connection_id, external_id\)/);
  expect(v).toContain('create or replace function apply_changes(');
  expect(v).toMatch(/v_external constant text\[\] := array\[[^\]]*'subscriptions'/);
  expect(v).toMatch(/revoke execute on function apply_changes\(int, jsonb\) from public, anon, authenticated;/);
});

// tests/unit/matching/payments.test.ts
test('upsertImported: bekannter Schlüssel wird gemischt, neuer bekommt ID', () => {
  const ids = ['n1'];
  const r = upsertImported([{ id: 's1', connectionId: 'stripe_nexus', externalId: 'sub_A', v: 1, keep: 'x' }],
    [{ connectionId: 'stripe_nexus', externalId: 'sub_A', v: 2 }, { connectionId: 'stripe_nexus', externalId: 'sub_B', v: 1 }],
    (next, old) => ({ ...next, keep: old?.keep ?? null }), () => ids.shift()!);
  expect(r.items).toEqual([{ id: 's1', connectionId: 'stripe_nexus', externalId: 'sub_A', v: 2, keep: 'x' }, { id: 'n1', connectionId: 'stripe_nexus', externalId: 'sub_B', v: 1, keep: null }]);
  expect(r.added).toBe(1);
});

// tests/unit/store.test.ts
test('loadInitial ergänzt fehlende neue Felder eines alten Demo-Stands', () => {
  const old = { ...createDemoState() } as Partial<AppState>;
  delete old.subscriptions; delete old.dismissedProposals;
  const { state } = loadInitial(fakeStorage(JSON.stringify(old)), '', NOW);
  expect(state.subscriptions).toEqual([]);
  expect(state.dismissedProposals).toEqual([]);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/db-tables.test.ts tests/unit/migration.test.ts tests/unit/matching/payments.test.ts tests/unit/store.test.ts`. Erwartet: FAIL (Typfehler bzw. fehlende Tabelle/Datei).
- [ ] **Step 3: Implementieren.** Typen wie oben. `createEmptyState` und `createDemoState` bekommen `subscriptions: []`, `dismissedProposals: []`. `loadInitial` mischt den geparsten Stand über `createEmptyState()` (`{ ...createEmptyState(), ...parsed }`). `tables.ts`: `subscriptions` in `SIMPLE` und mit externen Schlüsseln, `dismissed_proposals` mit `id = data = proposalId`. Die Migration legt beide Tabellen wie in `20261112000000_fundament.sql` an (`id text primary key, ord int not null, data jsonb not null, …`, bei `subscriptions` zusätzlich `connection_id`, `external_id`), aktiviert RLS, entzieht `anon`/`authenticated` die Rechte und ersetzt `apply_changes` vollständig: `v_allowed` um beide Tabellen erweitert, `v_external` um `subscriptions`. `revoke`/`grant execute` werden wiederholt. `migration.test.ts` liest alle Migrationsdateien sortiert und verkettet, damit die bestehenden Prüfungen „jede Tabelle aus TABLES“ weiter greifen.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: alles grün.
- [ ] **Step 5: Commit** `feat: Datenmodell für Abos, Herkunft und verworfene Vorschläge`

---

### Task 2: Mitgliedschafts-Erkennung und Stripe-Mapper

**Files:**
- Create: `src/domain/import/membership.ts`, `src/domain/import/stripe.ts`, `tests/fixtures/stripe/{subscriptions,products,invoices,refunds,disputes}.json`, `tests/fixtures/index.ts`, `tests/unit/import/membership.test.ts`, `tests/unit/import/stripe.test.ts`
- Modify: `src/domain/ledger/schedule.ts` (`makeDate` als `monthDate` exportieren)

**Interfaces:**
- Consumes: `ImportBatch`, `ImportedSubscription`, `ImportedPayment`, `ImportedDispute` (Task 1); `todayBerlin` aus `clock.ts`; `monthDate(year, month0, day)` aus `ledger/schedule.ts`.
- Produces:
  ```ts
  // membership.ts
  export function isMembership(text: string): boolean;
  export function parseMembership(text: string): { months: number | null; dueDay: number | null } | null; // null = keine Mitgliedschaft
  // stripe.ts
  export interface StripeRaw {
    subscriptions: unknown[];           // /v1/subscriptions?status=all, customer und schedule expandiert
    products: unknown[];                // /v1/products
    invoices: unknown[];                // /v1/invoices?status=paid
    refunds: (unknown & { invoiceId: string | null })[]; // Connector löst die Rechnung auf
    disputes: (unknown & { invoiceId: string | null })[];
  }
  export function billingPeriods(start: IsoDate, end: IsoDate): number;
  export function mapStripe(raw: StripeRaw): ImportBatch; // contacts und invoices bleiben leer (Spec 11a)
  ```
- `tests/fixtures/index.ts` exportiert `stripeRoutes: Record<string, unknown>` und `lexwareRoutes: Record<string, unknown>` (Pfad + Query → Antwort-JSON). Unit-Tests, Test-Route und E2E nutzen dieselben Daten.

**Fixture-Inhalt (alle Beträge EUR, monatlich, sofern nicht anders genannt):**
- `sub_A` Ayşe Öztürk, `ayse@example.de`, `cus_A`, Produkt „NEXUS-Mitgliedschaft 4 Monate“, Preis 30000, Start 2026-09-01, Anker Tag 1, `cancel_at` 2027-01-01. Bezahlte Rechnungen `in_A1`/`in_A2`/`in_A3` am 01.09./01.10./01.11.2026 über je 30000.
- `sub_B` Jonas Weber, `cus_B`, „NEXUS Mitgliedschaft“, Preis 27500, gezahlt 25000 (Rabatt), Start 2026-09-15, kein `cancel_at`, Schedule-Ende 2027-02-15. Rechnung `in_B1` am 15.09.2026. Erstattung `re_B1` über 5000 auf `in_B1` am 20.09.2026.
- `sub_C` Lea Braun, „NEXUS-Mitgliedschaft 6 Monate“, Status `canceled`.
- `sub_D` „Coaching Einzelstunde“, Rechnung `in_D1` über 9900.
- `sub_E` Tim Roth, „NEXUS-Mitgliedschaft“, ohne Enddatum und ohne Schedule.
- `sub_F` Ole Lang, „NEXUS-Mitgliedschaft 3 Monate“, Währung USD.
- Streitfall `dp_1` zu `in_A3`.

- [ ] **Step 1: Failing tests schreiben**

```ts
// membership.test.ts
test.each([
  ['NEXUS-Mitgliedschaft 6 Monate', { months: 6, dueDay: null }],
  ['Nexus Mitgliedschaft – 12 Monate, fällig jeweils zum 15. des Monats', { months: 12, dueDay: 15 }],
  ['MITGLIED-SCHAFT NEXUS', { months: null, dueDay: null }],
  ['12-Monats-Mitgliedschaft', { months: 12, dueDay: null }],
])('%s', (text, want) => expect(parseMembership(text)).toEqual(want));
test('ohne Mitgliedschaft → null', () => expect(parseMembership('Workshop 6 Monate')).toBeNull());

// stripe.test.ts
const b = mapStripe(stripeRaw); // aus tests/fixtures
const sub = (id: string) => b.subscriptions.find((s) => s.externalId === id)!;
test('billingPeriods', () => {
  expect(billingPeriods('2026-09-01', '2027-01-01')).toBe(4);
  expect(billingPeriods('2026-09-15', '2027-02-15')).toBe(5);
  expect(billingPeriods('2026-01-31', '2026-05-31')).toBe(4);
});
test('Abo mit cancel_at', () => expect(sub('sub_A')).toMatchObject({ amountCents: 30000, installments: 4, anchorDay: 1, startDate: '2026-09-01', cancelAt: '2027-01-01', endDate: '2027-01-01', interval: 'month', currency: 'eur', customerEmail: 'ayse@example.de', productName: 'NEXUS-Mitgliedschaft 4 Monate' }));
test('Abo mit Schedule, Rate = amount_paid', () => expect(sub('sub_B')).toMatchObject({ amountCents: 25000, priceCents: 27500, installments: 5, cancelAt: null, endDate: '2027-02-15' }));
test('gekündigtes Abo', () => expect(sub('sub_C').status).toBe('canceled'));
test('ohne Enddatum: Anzahl aus dem Produktnamen, sonst null', () => {
  expect(sub('sub_E').installments).toBeNull();
  expect(sub('sub_C').installments).toBe(6);
});
test('bezahlte Abo-Rechnung → Zahlung', () => expect(b.payments.find((p) => p.externalId === 'in_A2')).toEqual({
  company: 'nexus', source: 'stripe', connectionId: 'stripe_nexus', externalId: 'in_A2', amountCents: 30000, bookedOn: '2026-10-01',
  payerName: 'Ayşe Öztürk', reference: expect.any(String), kind: 'incoming', subscriptionExternalId: 'sub_A' }));
test('Erstattung → negative Zahlung mit refundOf', () => expect(b.payments.find((p) => p.externalId === 're_B1')).toMatchObject({ amountCents: -5000, refundOf: 'in_B1', bookedOn: '2026-09-20' }));
test('Streitfall', () => expect(b.disputes).toEqual([{ externalId: 'dp_1', invoiceExternalId: 'in_A3' }]));
test('Abo-fremde Rechnung wird trotzdem Zahlung', () => expect(b.payments.some((p) => p.externalId === 'in_D1')).toBe(true));
test('keine Rechnungen und Kontakte aus Stripe', () => { expect(b.invoices).toEqual([]); expect(b.contacts).toEqual([]); });
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/import`. Erwartet: FAIL („Cannot find module“).
- [ ] **Step 3: Implementieren.** `isMembership`: Text kleinschreiben, `-` und Leerraum entfernen, enthält `mitgliedschaft`. Monate: `/(\d{1,2})\s*-?\s*monat/i`. Fälligkeitstag: `/(?:am|zum)\s+(\d{1,2})\.\s*(?:eines|jedes|des)\s+monats/i`, nur 1–31. `billingPeriods` zählt k ≥ 0 mit `monthDate(start + k Monate, Starttag) < end`. `mapStripe`: Unix-Zeiten über `todayBerlin(new Date(sec * 1000))`. Für `endDate` gilt `cancel_at` vor `schedule.phases.at(-1).end_date`. `installments` = `billingPeriods(startDate, endDate)`, sonst `parseMembership(productName)?.months`, sonst `null`. `amountCents` = `amount_paid` der jüngsten bezahlten Rechnung des Abos. `interval` = `'month'` nur bei `interval === 'month' && interval_count === 1`. Der Abo-Bezug einer Rechnung wird je nach API-Version gelesen (`STRIPE_API_VERSION` beachten, Doku prüfen). Auszahlungen (`payout`) werden nicht gelesen.
- [ ] **Step 4: Run** `npx vitest run tests/unit/import`, dann `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Stripe-Mapper und Mitgliedschafts-Erkennung`

---

### Task 3: Lexware-Mapper

**Files:**
- Create: `src/domain/import/lexware.ts`, `tests/fixtures/lexware/{voucherlist-nexus,voucherlist-zulassung,contacts-nexus,contacts-zulassung}.json`, `tests/fixtures/lexware/invoice-*.json`, `tests/unit/import/lexware.test.ts`
- Modify: `tests/fixtures/index.ts` (`lexwareRoutes`)

**Interfaces:**
- Consumes: `ImportedContact`, `ImportedInvoice` (Task 1).
- Produces:
  ```ts
  export type LexwareConnection = 'lexware_nexus' | 'lexware_zulassung';
  export function mapLexwareContacts(json: unknown[], conn: LexwareConnection): ImportedContact[];
  export function mapLexwareInvoice(detail: unknown, conn: LexwareConnection): ImportedInvoice;
  export const lexwareCompany: Record<LexwareConnection, Company>; // nexus | zulassung
  ```

**Fixture-Inhalt (Lexware NEXUS):** Kontakt `c-77` Murat Demir `murat@example.de`, Rechnungen `RE-1043`/`RE-1051`/`RE-1060` vom 01.09./01.10./01.11.2026, fällig am selben Tag, je 300,00 € brutto, Text „NEXUS-Mitgliedschaft 6 Monate, Rate n“. Kontakt `c-81` Sven Krüger, Gesamtrechnung `RE-1100` vom 10.09.2026 über 1.200,00 €, Text „NEXUS-Mitgliedschaft 12 Monate, fällig jeweils zum 15. des Monats“. `RE-1101` „Workshop“ an `c-81`. `RE-1102` storniert (`voided`), Mitgliedschaft, an `c-82`. Kontakt `c-83` Nina Hahn, Gesamtrechnung `RE-1110` vom 05.10.2026 über 600,00 €, Text „NEXUS-Mitgliedschaft 6 Monate“ (ohne Tag → „bitte ergänzen“, für E2E). **Lexware Zulassung:** Firma `c-200` Autohaus Kern, Rechnung `RZ-500` offen 119,00 €.

- [ ] **Step 1: Failing tests schreiben**

```ts
const inv = (n: string) => mapLexwareInvoice(lexDetail(n), 'lexware_nexus');
test('Ratenrechnung', () => expect(inv('RE-1043')).toMatchObject({
  company: 'nexus', source: 'lexware', connectionId: 'lexware_nexus', externalId: expect.any(String), number: 'RE-1043',
  totalCents: 30000, issuedOn: '2026-09-01', dueDate: '2026-09-01', contactExternalId: 'c-77', text: expect.stringContaining('NEXUS-Mitgliedschaft 6 Monate') }));
test('Gesamtrechnung: Text aus Titel, Einleitung und Positionen', () => expect(inv('RE-1100').text).toContain('zum 15. des Monats'));
test('Storno → void', () => expect(inv('RE-1102').status).toBe('void'));
test('Cent ohne Rundungsfehler', () => expect(mapLexwareInvoice(withTotal(lexDetail('RE-1043'), 0.1 + 0.2), 'lexware_nexus').totalCents).toBe(30));
test('Status: bezahlt → paid, openCents 0', () => expect(mapLexwareInvoice(withStatus(lexDetail('RE-1043'), 'paid'), 'lexware_nexus')).toMatchObject({ status: 'paid', openCents: 0 }));
test('Kontakte mit externalRefs, Firma → dealer', () => {
  expect(mapLexwareContacts(lexContacts('nexus'), 'lexware_nexus')[0]).toEqual({ company: 'nexus', kind: 'member', name: 'Murat Demir', phones: [], emails: ['murat@example.de'], externalRefs: [{ connectionId: 'lexware_nexus', externalId: 'c-77' }] });
  expect(mapLexwareContacts(lexContacts('zulassung'), 'lexware_zulassung')[0]).toMatchObject({ company: 'zulassung', kind: 'dealer', name: 'Autohaus Kern' });
});
test('sourceUpdatedAt aus updatedDate', () => expect(inv('RE-1043').sourceUpdatedAt).toBe(lexDetail('RE-1043').updatedDate));
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/import/lexware.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.** Eurobeträge → Cent mit `Math.round(x * 100)`. Statuszuordnung `draft` wird übersprungen (der Connector filtert), `open` → `open`, `overdue` → `overdue`, `paid`/`paidoff` → `paid`, `voided` → `void`. `text` = Titel, Einleitung, Positionsnamen und -beschreibungen, Bemerkung, mit Zeilenumbruch verbunden. E-Mail kleingeschrieben. Kontakt mit Firma → `dealer`, Person → `private` (NEXUS immer `member`). Feldnamen (`voucherNumber`, `voucherDate`, `dueDate`, `totalPrice.totalGrossAmount`, `address.contactId`, `lineItems[].name`, `roles`, `emailAddresses`) gegen die aktuelle Doku prüfen.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Lexware-Mapper für Rechnungen und Kontakte`

---

### Task 4: Import zusammenführen, Ereignisse `importBatch` und `syncFailed`

**Files:**
- Create: `src/domain/import/merge.ts`, `tests/unit/import/merge.test.ts`
- Modify: `src/domain/events.ts`, `src/data/engine.ts`, `src/domain/detectors/sources.ts`, `tests/unit/engine.test.ts`, `tests/unit/detectors.test.ts`, `tests/unit/state-service.test.ts`

**Interfaces:**
- Consumes: `ImportBatch` (Task 1), `upsertImported`, `mergeImported` aus `matching/imports.ts`.
- Produces:
  ```ts
  export function mergeBatch(s: AppState, b: ImportBatch, newId: () => string): { state: AppState; added: { contacts: number; invoices: number; payments: number; subscriptions: number } };
  // events.ts (nur Server, NICHT in CLIENT_EVENTS):
  | { type: 'importBatch'; connectionId: ConnectionId; batch: ImportBatch; cursor: string | null; complete: boolean }
  | { type: 'syncFailed'; connectionId: ConnectionId; error: string }
  ```

**Regeln für `mergeBatch`:**
- Kontakte: Gibt es schon einen Kontakt mit einem gleichen `externalRef`, bleibt er unverändert. Sonst kommt er neu dazu.
- Rechnungen: `upsertImported`. Neue Felder übernehmen. `id` und `settledByPaymentId` bleiben. `contactId` über `contactExternalId` → Kontakt mit passendem Ref auflösen, auch für ältere Rechnungen mit `contactId: null`.
- Zahlungen: `mergeImported` (bestehende gewinnen).
- Abos: `upsertImported`. `id`, `contractId`, `confirmedPriceCents`, `confirmedEndDate` und `disputes` bleiben.
- Streitfälle: Über die Zahlung mit `externalId === invoiceExternalId` das Abo finden und die ID einmalig an `disputes` anhängen.

- [ ] **Step 1: Failing tests schreiben**

```ts
// merge.test.ts
test('erneuter Import ist idempotent', () => {
  const once = mergeBatch(empty, stripeBatch, seq()).state;
  const twice = mergeBatch(once, stripeBatch, seq());
  expect(twice.state).toEqual(once);
  expect(twice.added).toEqual({ contacts: 0, invoices: 0, payments: 0, subscriptions: 0 });
});
test('geändertes Abo: Felder neu, contractId und Bestätigungswerte bleiben', () => {
  const s = withConfirmed(mergeBatch(empty, stripeBatch, seq()).state, 'sub_A', 'k1'); // contractId 'k1', confirmedPriceCents 30000
  const r = mergeBatch(s, changed(stripeBatch, 'sub_A', { status: 'canceled', priceCents: 35000 }), seq()).state;
  expect(r.subscriptions.find((x) => x.externalId === 'sub_A')).toMatchObject({ status: 'canceled', priceCents: 35000, contractId: 'k1', confirmedPriceCents: 30000 });
  expect(r.contracts).toEqual(s.contracts);
});
test('Rechnung vor Kontakt: contactId wird beim späteren Kontakt-Import nachgezogen', () => {
  const a = mergeBatch(empty, { ...emptyBatch(), invoices: lexInvoices }, seq()).state;
  expect(a.invoices.every((i) => i.contactId === null)).toBe(true);
  const b = mergeBatch(a, { ...emptyBatch(), contacts: lexContactsNexus }, seq()).state;
  expect(b.invoices.find((i) => i.number === 'RE-1043')!.contactId).toBe(b.contacts.find((c) => c.name === 'Murat Demir')!.id);
});
test('Streitfall landet am Abo', () => expect(mergeBatch(empty, stripeBatch, seq()).state.subscriptions.find((x) => x.externalId === 'sub_A')!.disputes).toEqual(['dp_1']));

// engine.test.ts
test('importBatch: verbunden, Stand jetzt, Cursor gespeichert, Audit nur bei Neuem', () => {
  const r = applyEvent(empty, { type: 'importBatch', connectionId: 'stripe_nexus', batch: stripeBatch, cursor: 'c1', complete: false }, ctx({ isDemo: false })).state;
  expect(r.connections.find((c) => c.id === 'stripe_nexus')).toMatchObject({ status: 'connected', lastSuccessAt: NOW.toISOString(), sync: { cursor: 'c1', complete: false, failures: 0 } });
  expect(r.audit.at(-1)!.text).toMatch(/^Abgleich Stripe NEXUS: /);
  const again = applyEvent(r, { type: 'importBatch', connectionId: 'stripe_nexus', batch: stripeBatch, cursor: 'c1', complete: true }, ctx({ isDemo: false })).state;
  expect(again.audit.length).toBe(r.audit.length);
});
test('syncFailed: Fehler + Zähler, Daten bleiben', () => {
  const s = applyEvent(empty, { type: 'importBatch', connectionId: 'stripe_nexus', batch: stripeBatch, cursor: null, complete: true }, ctx()).state;
  const r = applyEvent(s, { type: 'syncFailed', connectionId: 'stripe_nexus', error: 'Stripe: HTTP 500' }, ctx()).state;
  expect(r.connections.find((c) => c.id === 'stripe_nexus')).toMatchObject({ status: 'error', lastError: 'Stripe: HTTP 500', lastSuccessAt: s.connections.find((c) => c.id === 'stripe_nexus')!.lastSuccessAt, sync: { failures: 1 } });
  expect(r.payments).toEqual(s.payments);
  expect(r.subscriptions).toEqual(s.subscriptions);
});

// detectors.test.ts
test('Fehler-Hinweis erst ab 3 Fehlversuchen, Demo-Störung (ohne sync) sofort', () => {
  const conn = (failures?: number) => ({ id: 'stripe_nexus', company: 'nexus', label: 'Stripe NEXUS', status: 'error', lastSuccessAt: null, lastError: 'x', ...(failures === undefined ? {} : { sync: { cursor: null, complete: true, failures } }) });
  expect(detectStaleSources(withConn(conn(2)), NOW)).toHaveLength(0);
  expect(detectStaleSources(withConn(conn(3)), NOW)).toHaveLength(1);
  expect(detectStaleSources(withConn(conn()), NOW)).toHaveLength(1);
});

// state-service.test.ts
test.each(['importBatch', 'syncFailed'])('%s ist kein Client-Ereignis', (type) => expect(isClientEvent({ type, connectionId: 'stripe_nexus', batch: emptyBatch(), error: 'x', cursor: null, complete: true })).toBe(false));
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/import/merge.test.ts tests/unit/engine.test.ts tests/unit/detectors.test.ts tests/unit/state-service.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.** `mergeBatch` nach den Regeln oben. In `engine.ts` zwei neue `case`-Zweige. Beide setzen den Verbindungsstatus wie `setConnectionStatus` (`connected` entfernt `lastError`). Das Audit hat den Akteur `system`, Text `Abgleich <Label>: n neue Zahlungen, n Rechnungen, n Abos` (nur bei `added` > 0). `syncFailed` schreibt das Audit nur beim Wechsel zu `error`. `detectStaleSources` meldet `error` nur bei `sync === undefined || sync.failures >= 3`. Veraltet (`stale`) bleibt unverändert.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Importe zusammenführen, Abgleich-Ereignisse mit Status und Fehlerzähler`

---

### Task 5: Vertragsvorschläge (rein abgeleitet)

**Files:**
- Create: `src/domain/import/proposals.ts`, `tests/unit/import/proposals.test.ts`
- Modify: `src/domain/matching/payments.ts` (`nameMatches` exportieren)

**Interfaces:**
- Consumes: `parseMembership` (Task 2), `normalizeName`/`nameMatches` aus `matching/payments.ts`, `AppState` mit `subscriptions`/`dismissedProposals` (Task 1), `formatEuro`, `formatIsoDe`.
- Produces:
  ```ts
  export interface ProposalValues { totalCents: number | null; installments: number | null; installmentCents: number | null; dueDay: number | null; startDate: IsoDate | null }
  export interface ContractProposal extends ProposalValues {
    id: string; name: string; email: string | null; billing: 'stripe' | 'legacy';
    sources: ExternalRef[];        // Abo bzw. Lexware-Kontakt → Vorschlags-ID und später MemberContract.origin
    contactRefs: ExternalRef[];    // stripe_nexus:cus_…, lexware_nexus:c-…
    sourceLabel: 'Stripe' | 'Lexware' | 'Stripe + Lexware';
    references: string[];          // 'Abo sub_A', 'Rechnung RE-1043'
    complete: boolean;             // vollständig / bitte ergänzen
    steps: string[];               // Rechenweg
    possibleMatch: { id: string; name: string } | null; // „gehört evtl. zu …“
  }
  export function proposalId(sources: ExternalRef[]): string; // sortiert, 'a:b+c:d'
  export function deriveProposals(s: AppState): ContractProposal[];
  export function findContactFor(p: ContractProposal, contacts: Contact[]): { match: 'ref' | 'email' | 'name' | 'none'; contactId: string | null; name: string | null };
  ```

**Regeln:**
- Quelle ist schon „verbraucht“, wenn ihr Schlüssel in irgendeinem `contract.origin` steht oder das Abo eine `contractId` hat. Verbrauchte Quellen fallen vor dem Gruppieren weg.
- **Stripe:** Abos mit `isMembership(productName)` und Status ≠ `incomplete`. Werte: Rate = `amountCents`, Anzahl = `installments`, Fälligkeitstag = `anchorDay`, Start = `startDate`, Gesamt = Rate × Anzahl, `billing: 'stripe'`. Vollständig nur bei `currency === 'eur'`, `interval === 'month'`, Status ≠ `canceled` und ohne `null`-Wert.
- **Lexware NEXUS:** Nur `connectionId === 'lexware_nexus'`, Status ≠ `void`, `parseMembership(text) !== null` und `contactExternalId` gesetzt. Gruppiert wird je `contactExternalId`, die Quelle ist `{ lexware_nexus, contactExternalId }`.
  - ≥ 2 Rechnungen mit gleichem `totalCents` und 25–35 Tagen Abstand zwischen aufeinanderfolgenden `issuedOn` ergeben ein Ratenmuster. Dann gilt: Rate = Betrag, Anzahl = größte `months` aus den Texten, sonst `null`. Start = `dueDate` der ersten Rechnung, Fälligkeitstag = Tag dieses Datums.
  - Genau 1 Rechnung ist eine Gesamtrechnung. Dann gilt: Gesamt = Betrag, Anzahl = `months`, Rate = `Math.floor(Gesamt / Anzahl)`, Fälligkeitstag = Tag aus dem Text, sonst `null`. Start = erster Fälligkeitstag ab `issuedOn` (gleicher Monat, wenn der Tag noch kommt, sonst Folgemonat).
  - Sonst (kein Muster) sind alle Werte `null`, mit dem Schritt „Rechnungen passen zu keinem Ratenmuster“.
  - Immer `billing: 'legacy'`. Vollständig, wenn kein Wert `null` ist. Name und E-Mail kommen vom Kontakt mit passendem Ref.
- **Zusammenführen:** Gleiche E-Mail (kleingeschrieben, exakt) oder gleiches `normalizeName` ergibt einen Vorschlag mit beiden Quellen. Die Werte kommen von Stripe, `billing: 'stripe'`, `sourceLabel: 'Stripe + Lexware'`. Bei `nameMatches` ohne Gleichheit bleiben es zwei Vorschläge, beide mit `possibleMatch` auf den anderen.
- Vorschläge mit ID in `dismissedProposals` fallen weg. `lexware_zulassung` erzeugt nie einen Vorschlag.
- `findContactFor`: erst Kontakt mit einem der `contactRefs`, dann exakte E-Mail (`emails` kleingeschrieben), dann `normalizeName` gleich bei `company === 'nexus'` → `'name'`, sonst `'none'`.

- [ ] **Step 1: Failing tests schreiben** (Zustand jeweils aus `mergeBatch` mit den Fixtures aus Task 2/3)

```ts
const P = (s: AppState, id: string) => deriveProposals(s).find((p) => p.id === id);
test('Stripe-Abo mit Enddatum, vollständig', () => expect(P(stripeState, 'stripe_nexus:sub_A')).toMatchObject({
  name: 'Ayşe Öztürk', totalCents: 120000, installments: 4, installmentCents: 30000, dueDay: 1, startDate: '2026-09-01',
  billing: 'stripe', sourceLabel: 'Stripe', complete: true, references: ['Abo sub_A'], contactRefs: [{ connectionId: 'stripe_nexus', externalId: 'cus_A' }] }));
test('Abo ohne Enddatum, USD oder gekündigt → bitte ergänzen', () => {
  expect(P(stripeState, 'stripe_nexus:sub_E')).toMatchObject({ installments: null, totalCents: null, complete: false });
  expect(P(stripeState, 'stripe_nexus:sub_F')!.complete).toBe(false);
  expect(P(stripeState, 'stripe_nexus:sub_C')!.complete).toBe(false);
});
test('kein Vorschlag ohne Mitgliedschaft', () => expect(P(stripeState, 'stripe_nexus:sub_D')).toBeUndefined());
test('Lexware-Ratenrechnungen', () => expect(P(lexState, 'lexware_nexus:c-77')).toMatchObject({
  installmentCents: 30000, installments: 6, totalCents: 180000, startDate: '2026-09-01', dueDay: 1, billing: 'legacy', complete: true,
  references: ['Rechnung RE-1043', 'Rechnung RE-1051', 'Rechnung RE-1060'] }));
test('Lexware-Gesamtrechnung mit Tag im Text', () => expect(P(lexState, 'lexware_nexus:c-81')).toMatchObject({ totalCents: 120000, installments: 12, installmentCents: 10000, dueDay: 15, startDate: '2026-09-15', complete: true }));
test('Gesamtrechnung ohne Tag → bitte ergänzen', () => expect(P(withText(lexState, 'RE-1100', 'NEXUS-Mitgliedschaft 12 Monate'), 'lexware_nexus:c-81')).toMatchObject({ dueDay: null, complete: false }));
test('Storno und Workshop zählen nicht', () => {
  expect(P(lexState, 'lexware_nexus:c-82')).toBeUndefined();
  expect(P(lexState, 'lexware_nexus:c-81')!.references).toEqual(['Rechnung RE-1100']);
});
test('Lexware Zulassung erzeugt nie Vorschläge', () => expect(deriveProposals(zulassungState)).toEqual([]));
test('gleiche E-Mail → ein Vorschlag mit beiden Quellen', () => {
  const s = mergedWithLexContact(stripeState, { id: 'c-90', name: 'Ayse Oeztuerk', email: 'AYSE@example.de' }); // Mitgliedschaftsrechnung an c-90
  const p = deriveProposals(s).filter((x) => x.sources.some((r) => r.externalId === 'sub_A'));
  expect(p).toHaveLength(1);
  expect(p[0]).toMatchObject({ id: 'lexware_nexus:c-90+stripe_nexus:sub_A', sourceLabel: 'Stripe + Lexware', billing: 'stripe', installmentCents: 30000 });
});
test('unsicherer Namenstreffer → zwei Vorschläge mit Hinweis', () => {
  const s = mergedWithLexContact(stripeState, { id: 'c-91', name: 'A. Öztürk', email: null });
  expect(P(s, 'lexware_nexus:c-91')!.possibleMatch).toEqual({ id: 'stripe_nexus:sub_A', name: 'Ayşe Öztürk' });
  expect(P(s, 'stripe_nexus:sub_A')!.possibleMatch).toEqual({ id: 'lexware_nexus:c-91', name: 'A. Öztürk' });
});
test('verworfen bleibt verworfen, neue Quelle ergibt neue ID', () => {
  const s = { ...lexState, dismissedProposals: ['lexware_nexus:c-77'] };
  expect(P(s, 'lexware_nexus:c-77')).toBeUndefined();
  const withSub = mergedWithStripeSub(s, { externalId: 'sub_M', customerEmail: 'murat@example.de' });
  expect(P(withSub, 'lexware_nexus:c-77+stripe_nexus:sub_M')).toBeDefined();
});
test('bestätigt: keine erneuten Vorschläge, auch nicht nach neuer Ratenrechnung', () => {
  const s = withContract(lexState, { origin: [{ connectionId: 'lexware_nexus', externalId: 'c-77' }] });
  const next = mergeBatch(s, { ...emptyBatch(), invoices: [rateInvoice('RE-1070', 'c-77', '2026-12-01')] }, seq()).state;
  expect(deriveProposals(next).some((p) => p.sources.some((r) => r.externalId === 'c-77'))).toBe(false);
});
test('Rechenweg nennt Quelle und Rechnung', () => expect(P(lexState, 'lexware_nexus:c-77')!.steps.join(' ')).toMatch(/3 Rechnungen.*300,00 €.*6 Monate/));
test('findContactFor: Ref vor E-Mail vor Name', () => {
  const p = P(stripeState, 'stripe_nexus:sub_A')!;
  expect(findContactFor(p, [{ ...mk('x', 'Ayşe Öztürk'), externalRefs: [{ connectionId: 'stripe_nexus', externalId: 'cus_A' }] }, { ...mk('y', 'Andere'), emails: ['ayse@example.de'] }])).toEqual({ match: 'ref', contactId: 'x', name: 'Ayşe Öztürk' });
  expect(findContactFor(p, [{ ...mk('y', 'Andere'), emails: ['ayse@example.de'] }]).match).toBe('email');
  expect(findContactFor(p, [mk('z', 'Ayşe Öztürk')]).match).toBe('name');
  expect(findContactFor(p, []).match).toBe('none');
});
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/import/proposals.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: `deriveProposals` und `findContactFor` nach den Regeln oben implementieren.** Die Reihenfolge des Ergebnisses ist nach Name sortiert (`localeCompare(…, 'de')`).
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Vertragsvorschläge aus Stripe-Abos und Lexware-Rechnungen ableiten`

---

### Task 6: Ledger – Erstattungen, Stripe-Zuordnung, Quellen je Vertrag, Abo-Hinweise

**Files:**
- Create: `src/domain/matching/stripe.ts`, `src/domain/detectors/subscriptions.ts`, `tests/unit/matching/stripe.test.ts`, `tests/unit/detectors-subscriptions.test.ts`
- Modify: `src/domain/ledger/allocate.ts`, `src/domain/connections.ts`, `src/domain/detectors/members.ts`, `src/domain/detectors/index.ts`, `src/data/engine.ts` (`refresh`), `src/data/selectors.ts`, `tests/unit/ledger/status.test.ts`, `tests/unit/detectors.test.ts`, `tests/unit/selectors.test.ts`, `tests/unit/engine.test.ts`

**Interfaces:**
- Consumes: `Subscription`, `Payment.subscriptionExternalId`/`refundOf` (Task 1).
- Produces:
  ```ts
  // matching/stripe.ts
  export function stripeAllocations(s: AppState): Allocation[]; // neue Zuordnungen, method 'auto', Betrag = Zahlungsbetrag (auch < 0)
  // connections.ts
  export function contractSources(c: MemberContract): ConnectionId[]; // legacy → ['bank'], stripe → ['stripe_nexus']
  // detectors/subscriptions.ts
  export function detectSubscriptionChanges(s: AppState): Insight[]; // type 'subscription_changed'
  // selectors.ts: MemberRow + notConnected: boolean; export const waitingStripePayments = (s: AppState): Payment[]
  ```

- [ ] **Step 1: Failing tests schreiben**

```ts
// ledger/status.test.ts (Plan 4 × 300 ab 01.10.2026, wie `base`)
test('Erstattung nimmt von der jüngsten bezahlten Rate', () => {
  const r = allocate(s, [{ bookedOn: '2026-10-01', amountCents: 60000 }, { bookedOn: '2026-10-15', amountCents: -30000 }]);
  expect(r.states.map((x) => [x.paidCents, x.paidOn])).toEqual([[30000, '2026-10-01'], [0, null], [0, null], [0, null]]);
});
test('Erstattung zuerst gegen Überzahlung', () => {
  const r = allocate(s, [{ bookedOn: '2026-10-01', amountCents: 130000 }, { bookedOn: '2026-10-02', amountCents: -10000 }]);
  expect(r.overpaidCents).toBe(0);
  expect(r.states.every((x) => x.paidCents === 30000)).toBe(true);
});
test('Betrag 0 ändert nichts', () => expect(allocate(s, [{ bookedOn: '2026-10-01', amountCents: 0 }]).states.every((x) => x.paidCents === 0)).toBe(true));
test('Erstattung größer als Gezahltes → nie negativ', () => expect(allocate(s, [{ bookedOn: '2026-10-01', amountCents: 10000 }, { bookedOn: '2026-10-02', amountCents: -50000 }]).states.every((x) => x.paidCents >= 0)).toBe(true));
test('gleicher Tag: Zahlung vor Erstattung', () => expect(allocate(s, [{ bookedOn: '2026-10-01', amountCents: -30000 }, { bookedOn: '2026-10-01', amountCents: 30000 }]).states[0].paidCents).toBe(0));

// matching/stripe.test.ts
test('Zahlungen bestätigter Abos werden auto zugeordnet, auch rückwirkend und Erstattungen', () => {
  const s = confirmedSub(stripeState, 'sub_B', 'k-weber');
  expect(stripeAllocations(s)).toEqual([
    { paymentId: pid(s, 'in_B1'), contractId: 'k-weber', amountCents: 25000, method: 'auto' },
    { paymentId: pid(s, 're_B1'), contractId: 'k-weber', amountCents: -5000, method: 'auto' },
  ]);
});
test('unbestätigtes Abo, Auszahlung, schon zugeordnet → nichts', () => expect(stripeAllocations(stripeState)).toEqual([]));

// engine.test.ts
test('refresh ordnet Stripe-Zahlungen zu; unbestätigte erzeugen keinen unmatched-Hinweis', () => {
  const r = refresh(stripeState, NOW, false);
  expect(r.allocations).toEqual([]);
  expect(r.insights.some((i) => i.type === 'unmatched_payment')).toBe(false);
  expect(refresh(confirmedSub(stripeState, 'sub_A', 'k-ayse'), NOW, false).allocations.filter((a) => a.contractId === 'k-ayse')).toHaveLength(3);
});

// detectors.test.ts
test('Rückstand-Hinweis braucht nur die Quelle des Vertrags', () => {
  const st = stripeContractOverdue({ bank: 'missing', stripe_nexus: 'connected' });
  expect(runDetectors(st, NOW).some((i) => i.type === 'member_overdue')).toBe(true);
  expect(detectMemberOverdue(st, NOW)[0].needsSources).toEqual(['stripe_nexus']);
});

// selectors.test.ts
test('Legacy-Vertrag ohne Bank: notConnected', () => expect(memberRows(legacyNoBank, '2026-11-12')[0].notConnected).toBe(true));
test('wartende Stripe-Zahlungen', () => expect(waitingStripePayments(stripeState).map((p) => p.externalId)).toContain('in_A1'));

// detectors-subscriptions.test.ts
test.each([
  ['Kündigung', { status: 'canceled' }, 'sub:sub_A:canceled'],
  ['Enddatum geändert', { cancelAt: '2027-03-01', endDate: '2027-03-01' }, 'sub:sub_A:end'],
  ['Preisänderung', { priceCents: 35000 }, 'sub:sub_A:price'],
  ['past_due', { status: 'past_due' }, 'sub:sub_A:past_due'],
  ['Chargeback', { disputes: ['dp_1'] }, 'sub:sub_A:dispute'],
])('%s → Hinweis, Vertrag unverändert', (_, patch, key) => {
  const s = patchSub(confirmedSub(stripeState, 'sub_A', 'k-ayse'), 'sub_A', patch);
  const i = detectSubscriptionChanges(s).find((x) => x.dedupeKey === key)!;
  expect(i).toMatchObject({ type: 'subscription_changed', company: 'nexus', needsSources: ['stripe_nexus'], refs: [expect.objectContaining({ kind: 'member', id: 'k-ayse' })] });
  expect(refresh(s, NOW, false).contracts).toEqual(s.contracts);
});
test('Erstattung → Hinweis', () => expect(detectSubscriptionChanges(confirmedSub(stripeState, 'sub_B', 'k-weber')).some((i) => i.dedupeKey === 'sub:sub_B:refund:re_B1')).toBe(true));
test('unbestätigtes Abo → keine Hinweise', () => expect(detectSubscriptionChanges(stripeState)).toEqual([]));
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/ledger tests/unit/matching tests/unit/detectors.test.ts tests/unit/detectors-subscriptions.test.ts tests/unit/selectors.test.ts tests/unit/engine.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.**
  - `allocate`: Zahlungen nach `bookedOn` sortieren, bei gleichem Tag positive vor negativen. Betrag 0 überspringen. Negative Beträge mindern zuerst `overpaidCents`, dann rückwärts die jüngste Rate mit `paidCents > 0`. `paidOn` wird `null`, sobald die Rate nicht mehr voll ist. Ein Rest unter 0 verfällt.
  - `stripeAllocations`: Für Zahlungen mit `source 'stripe'`, `kind 'incoming'` und ohne Zuordnung das Abo über `subscriptionExternalId` suchen, bei `refundOf` über die erstattete Zahlung. Hat das Abo eine `contractId` und gibt es den Vertrag, entsteht eine Zuordnung.
  - `refresh` hängt die Zuordnungen vor `autoAllocate` an (ein Audit `Automatisch zugeordnet (Stripe): <Name>`).
  - `detectMemberOverdue`: `needsSources` = `contractSources(c)`, der Sammelhinweis nimmt die Vereinigung.
  - `detectSubscriptionChanges`: für Abos mit `contractId`. `canceled` → `:canceled`. `endDate !== confirmedEndDate` → `:end`. `priceCents !== confirmedPriceCents` → `:price`. `past_due`/`unpaid` → `:past_due`. Je Erstattungszahlung `:refund:<externalId>`, Streitfälle → `:dispute`. Priorität `today`, Folgeschritt „Vertrag prüfen“. In `runDetectors` eintragen.
  - `memberRows.notConnected` = `notConnected(contractSources(c), s.connections)`. `waitingStripePayments` = Stripe-Zahlungen ohne Zuordnung, deren Abo keine `contractId` hat.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün. Die Demo-Seed-Zahlen bleiben gleich, weil Seed-Zahlungen kein `subscriptionExternalId` haben.
- [ ] **Step 5: Commit** `feat: Erstattungen im Ledger, Stripe-Zahlungen über das Abo zuordnen, Abo-Hinweise`

---

### Task 7: Connectors mit Drosselung, Cursor und sicheren Fehlern

**Files:**
- Create: `src/server/connectors/types.ts`, `src/server/connectors/http.ts`, `src/server/connectors/fixture-fetch.ts`, `src/server/connectors/stripe.ts`, `src/server/connectors/lexware.ts`, `tests/unit/connectors/http.test.ts`, `tests/unit/connectors/stripe.test.ts`, `tests/unit/connectors/lexware.test.ts`
- Modify: `src/server/env.ts`, `tests/unit/env.test.ts`

**Interfaces:**
- Consumes: `mapStripe`, `StripeRaw` (Task 2), `mapLexwareContacts`, `mapLexwareInvoice` (Task 3), `ImportBatch`, `IMPORT_SINCE` (Task 1), `stripeRoutes`/`lexwareRoutes` (Fixtures).
- Produces:
  ```ts
  // types.ts
  export interface PullContext { fetch: typeof fetch; key: string; sleep: (ms: number) => Promise<void>; now: () => number; deadline: number; known: ReadonlyMap<string, string | undefined> } // known: externalId → sourceUpdatedAt
  export interface PullResult { batch: ImportBatch; cursor: string | null; complete: boolean }
  export class ConnectorError extends Error {} // Nachricht ist bereits sicher (ohne Schlüssel, ohne URL-Query)
  // http.ts
  export function createApiClient(o: { label: string; baseUrl: string; key: string; fetch: typeof fetch; sleep: PullContext['sleep']; now: () => number; minIntervalMs: number; headers?: Record<string, string> }): { getJson(pathAndQuery: string): Promise<unknown> };
  // fixture-fetch.ts
  export function fixtureFetch(routes: Record<string, unknown>, opts?: { status?: Record<string, number>; calls?: string[] }): typeof fetch; // Treffer: Pfad+Query exakt, sonst Pfad, sonst 404
  // stripe.ts
  export const STRIPE_API_VERSION: string;
  export function pullStripe(cursor: string | null, ctx: PullContext): Promise<PullResult>;
  // lexware.ts
  export function pullLexware(conn: LexwareConnection, cursor: string | null, ctx: PullContext): Promise<PullResult>;
  // env.ts: ServerEnv + stripeRestrictedKey?, stripeWebhookSecret?, lexwareNexusApiKey?, lexwareZulassungApiKey?
  ```
- Cursor (JSON-String, nur der Connector kennt die Form):
  - Stripe: `{ createdGte: number; phase: 'invoices' | 'refunds' | 'disputes'; startingAfter: string | null }`. Abos und Produkte werden jeden Lauf vollständig gelesen (wenige). Rechnungen, Erstattungen und Streitfälle mit `created[gte]` = Wasserzeichen − 35 Tage (Überlappung ist dank Schlüssel unschädlich), beim ersten Lauf `IMPORT_SINCE`. Das Wasserzeichen steigt erst, wenn `complete`.
  - Lexware: `{ phase: 'contacts' | 'invoices'; page: number }`. Die Voucherlist (`voucherDateFrom=IMPORT_SINCE`, Status ohne `draft`) wird geblättert. Details (`/v1/invoices/{id}`) werden nur für IDs geholt, deren `updatedDate` von `known` abweicht. So setzt ein abgebrochener Erstimport ohne Doppelarbeit fort.

- [ ] **Step 1: Failing tests schreiben**

```ts
// http.test.ts
test('Bearer-Schlüssel im Header, nie in der URL', async () => {
  const calls: Request[] = [];
  const api = createApiClient({ label: 'Lexware', baseUrl: 'https://api.lexware.io', key: 'SECRET', fetch: spyFetch(calls, { ok: 1 }), sleep: noSleep, now: clock(), minIntervalMs: 500 });
  await api.getJson('/v1/contacts?page=0');
  expect(calls[0].headers.get('authorization')).toBe('Bearer SECRET');
  expect(calls[0].url).not.toContain('SECRET');
});
test('Drosselung: mindestens 500 ms zwischen zwei Anfragen', async () => {
  const waits: number[] = [];
  const api = createApiClient({ ..., sleep: async (ms) => { waits.push(ms); }, now: () => 1000, minIntervalMs: 500 });
  await api.getJson('/a'); await api.getJson('/b');
  expect(waits.at(-1)).toBeGreaterThanOrEqual(500);
});
test('429 → einmal warten und wiederholen', async () => { /* Fake: erst 429 mit Retry-After 1, dann 200 → Ergebnis da, 2 Aufrufe */ });
test('Fehler ohne Schlüssel, ohne Query, ohne Antworttext', async () => {
  const f = fixtureFetch({}, { status: { '/v1/contacts': 401 } });
  const err = await createApiClient({ ..., key: 'SECRET', fetch: f }).getJson('/v1/contacts?token=SECRET').catch((e) => e);
  expect(err).toBeInstanceOf(ConnectorError);
  expect(err.message).toBe('Lexware: HTTP 401 bei /v1/contacts (Schlüssel prüfen)');
});
test('Netzfehler mit Schlüssel im Text → bereinigt', async () => {
  const err = await createApiClient({ ..., key: 'SECRET', fetch: async () => { throw new Error('connect failed Bearer SECRET'); } }).getJson('/x').catch((e) => e);
  expect(err.message).not.toContain('SECRET');
});

// stripe.test.ts
test('blättert über has_more/starting_after und liefert den gemappten Batch', async () => {
  const calls: string[] = [];
  const r = await pullStripe(null, ctx({ fetch: fixtureFetch(stripeRoutesPaged, { calls }) }));
  expect(calls.some((c) => c.includes('starting_after='))).toBe(true);
  expect(r.complete).toBe(true);
  expect(r.batch.payments.map((p) => p.externalId)).toEqual(expect.arrayContaining(['in_A1', 'in_A2', 'in_A3', 'in_B1', 're_B1']));
  expect(calls[0]).toContain(`created[gte]=${unix('2026-08-01')}`.replace('[', '%5B').replace(']', '%5D')); // Erstlauf ab IMPORT_SINCE
});
test('Zeitbudget erreicht → Teilergebnis, Cursor, complete false; Fortsetzung liefert den Rest', async () => {
  const first = await pullStripe(null, ctx({ deadline: afterNCalls(3) }));
  expect(first.complete).toBe(false);
  const second = await pullStripe(first.cursor, ctx());
  const ids = [...first.batch.payments, ...second.batch.payments].map((p) => p.externalId);
  expect(new Set(ids)).toEqual(new Set(['in_A1', 'in_A2', 'in_A3', 'in_B1', 'in_D1', 're_B1']));
});
test('Stripe-Version-Header gesetzt', async () => { /* calls[0].headers['stripe-version'] === STRIPE_API_VERSION */ });

// lexware.test.ts
test('Kontakte, dann Rechnungen; Details nur für Neues', async () => {
  const calls: string[] = [];
  const known = new Map([[idOf('RE-1043'), updatedOf('RE-1043')]]);
  const r = await pullLexware('lexware_nexus', null, ctx({ fetch: fixtureFetch(lexwareRoutes, { calls }), known }));
  expect(calls.filter((c) => c.startsWith('/v1/invoices/'))).not.toContain(`/v1/invoices/${idOf('RE-1043')}`);
  expect(r.batch.invoices.map((i) => i.number)).toEqual(expect.arrayContaining(['RE-1051', 'RE-1060', 'RE-1100', 'RE-1101', 'RE-1102']));
  expect(r.batch.contacts.map((c) => c.name)).toContain('Murat Demir');
  expect(r.complete).toBe(true);
});
test('blättert über page bis last', async () => { /* zwei Seiten Voucherlist → beide verarbeitet */ });
test('Abbruch am Budget, Fortsetzung über Cursor und known', async () => { /* wie Stripe */ });

// env.test.ts
test('Schlüssel sind optional', () => expect(readEnv(BASE).stripeRestrictedKey).toBeUndefined());
test('Schlüssel werden gelesen', () => expect(readEnv({ ...BASE, LEXWARE_NEXUS_API_KEY: 'lx' }).lexwareNexusApiKey).toBe('lx'));
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/connectors tests/unit/env.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.** Alle Dateien mit `import 'server-only'`, außer `fixture-fetch.ts` (reine Test-Naht ohne Geheimnisse). `createApiClient` merkt sich den Zeitpunkt der letzten Anfrage und wartet bis `minIntervalMs`: Lexware 500, Stripe 0. Fehlertexte werden nur aus `label`, Status und Pfad ohne Query gebaut. Netzfehler werden zu `ConnectorError('<label>: keine Verbindung')`. Vor jeder Anfrage prüft der Connector `now() < deadline`. Ist das Budget erreicht, gibt er das bisher Gesammelte mit Cursor und `complete: false` zurück. Erstattungen und Streitfälle bekommen vom Connector `invoiceId` angehängt (über die Charge bzw. die Rechnungszahlungen der festgelegten API-Version, Doku prüfen).
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Connectors für Stripe und Lexware mit Drosselung und fortsetzbarem Cursor`

---

### Task 8: Sync im Cron-Takt und Test-Import-Route

**Files:**
- Create: `src/server/sync.ts`, `src/app/api/test/import/route.ts`, `tests/unit/sync.test.ts`
- Modify: `src/server/cron.ts`, `src/server/registry.ts`, `src/app/api/cron/tick/route.ts`, `tests/unit/cron.test.ts`, `tests/unit/api-guard.test.ts` (`/^test\/import$/` in `EXEMPT`)

**Interfaces:**
- Consumes: `pullStripe`, `pullLexware`, `PullContext` (Task 7), `importBatch`/`syncFailed` (Task 4), `dispatchEvents`, `loadState` aus `state-service.ts`.
- Produces:
  ```ts
  export type ConnectorKeys = Partial<Record<'stripe_nexus' | 'lexware_nexus' | 'lexware_zulassung', string>>;
  export interface SyncDeps { at: () => Date; keys: ConnectorKeys; fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number; budgetMs: number; provider: ActionProvider; only?: ConnectionId[] }
  export type SyncOutcome = 'ok' | 'partial' | 'error' | 'skipped';
  export function sanitizeError(err: unknown, secrets: string[]): string; // ConnectorError-Text, sonst 'Unbekannter Fehler'; Geheimnisse → '***'
  export function syncConnections(repos: Repos, deps: SyncDeps): Promise<Partial<Record<ConnectionId, SyncOutcome>>>;
  // cron.ts: runTick(deps & { sync?: () => Promise<unknown> })
  // registry.ts: getSyncDeps(o?: { only?: ConnectionId[]; budgetMs?: number }): SyncDeps  // echte fetch/setTimeout, Schlüssel aus readEnv, budgetMs Standard 40_000
  ```

- [ ] **Step 1: Failing tests schreiben**

```ts
// sync.test.ts
const deps = (p: Partial<SyncDeps> = {}): SyncDeps => ({ at: () => NOW, keys: { stripe_nexus: 'SK', lexware_nexus: 'LK' }, fetch: fixtureFetch({ ...stripeRoutes, ...lexwareRoutes }), sleep: async () => {}, now: () => 0, budgetMs: 40_000, provider: new DemoProvider(), ...p });
test('ohne Schlüssel bleibt die Verbindung missing', async () => {
  const r = await syncConnections(repos, deps({ keys: {} }));
  expect(r).toEqual({ stripe_nexus: 'skipped', lexware_nexus: 'skipped', lexware_zulassung: 'skipped' });
  expect((await repos.state.load()).state.connections.find((c) => c.id === 'stripe_nexus')!.status).toBe('missing');
});
test('Erfolg: Daten im Zustand, verbunden, Vorschläge ableitbar', async () => {
  expect((await syncConnections(repos, deps())).stripe_nexus).toBe('ok');
  const s = (await repos.state.load()).state;
  expect(s.subscriptions.length).toBeGreaterThan(0);
  expect(deriveProposals(s).map((p) => p.id)).toEqual(expect.arrayContaining(['stripe_nexus:sub_A', 'lexware_nexus:c-77']));
});
test('zweiter Lauf erzeugt keine Doppelten', async () => {
  await syncConnections(repos, deps());
  const a = (await repos.state.load()).state;
  await syncConnections(repos, deps());
  const b = (await repos.state.load()).state;
  expect(b.payments.length).toBe(a.payments.length);
  expect(b.invoices.length).toBe(a.invoices.length);
});
test('Fehler: error + bereinigter Text, alte Daten bleiben', async () => {
  await syncConnections(repos, deps());
  const before = (await repos.state.load()).state;
  await syncConnections(repos, deps({ fetch: async () => { throw new Error('boom SK'); } }));
  const s = (await repos.state.load()).state;
  const c = s.connections.find((x) => x.id === 'stripe_nexus')!;
  expect(c.status).toBe('error');
  expect(c.lastError).not.toContain('SK');
  expect(JSON.stringify(s.audit)).not.toContain('SK');
  expect(s.payments).toEqual(before.payments);
});
test('Budget erschöpft → partial, nächster Lauf setzt fort', async () => {
  let t = 0;
  expect((await syncConnections(repos, deps({ now: () => (t += 10_000), budgetMs: 25_000 }))).lexware_nexus).toBe('partial');
  await syncConnections(repos, deps());
  expect((await repos.state.load()).state.connections.find((c) => c.id === 'lexware_nexus')!.sync!.complete).toBe(true);
});
test('only begrenzt auf eine Verbindung', async () => expect(Object.keys(await syncConnections(repos, deps({ only: ['stripe_nexus'] })))).toEqual(['stripe_nexus']));

// cron.test.ts
test('Sync läuft genau einmal je Takt, auch bei mehreren fälligen Sync-Slots', async () => {
  const sync = vi.fn(async () => {});
  await runTick({ repos, at: new Date('2026-11-12T06:05:00Z'), provider, sync });
  expect(sync).toHaveBeenCalledTimes(1);
});
test('kein Sync-Slot beansprucht → kein Sync', async () => {
  const sync = vi.fn(async () => {});
  const at = new Date('2026-11-12T06:05:00Z');
  await runTick({ repos, at, provider });
  await runTick({ repos, at, provider, sync });
  expect(sync).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/sync.test.ts tests/unit/cron.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.**
  - `syncConnections` arbeitet die Verbindungen nacheinander ab (Stripe, Lexware NEXUS, Lexware Zulassung). Je Verbindung: Zustand laden, `known` aus `invoices` der Verbindung bilden (`externalId → sourceUpdatedAt`), Cursor aus `connection.sync?.cursor` lesen, mit `deadline = now() + budgetMs` (geteilt über alle Verbindungen) ziehen. Danach `dispatchEvents(repos, [{ type: 'importBatch', … }], { at, provider })`. Ein Fehler führt zu `syncFailed` mit `sanitizeError(err, Object.values(keys))`.
  - `runTick` ruft `deps.sync?.()` einmal nach der Schleife, wenn mindestens ein `sync`-Lauf beansprucht wurde. Ein Fehler darin wird gefangen und bricht den Takt nicht ab.
  - Die Cron-Route übergibt `sync: () => syncConnections(getRepos(), getSyncDeps())`.
  - `POST /api/test/import`: nur bei `readEnv().testMemoryDb`, sonst 404. Der Body `{ routes: Record<string, unknown> }` geht an `fixtureFetch`, die Schlüssel sind `'test'` für alle drei Verbindungen. Danach läuft `syncConnections` mit `sleep` als No-op, die Antwort ist das Ergebnis als JSON.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Abgleich von Stripe und Lexware im 15-Minuten-Takt`

---

### Task 9: Stripe-Webhook mit Signaturprüfung

**Files:**
- Create: `src/server/connectors/stripe-signature.ts`, `src/app/api/webhooks/stripe/route.ts`, `tests/unit/webhook-stripe.test.ts`
- Modify: `tests/unit/api-guard.test.ts`

**Interfaces:**
- Consumes: `syncConnections`, `getSyncDeps` (Task 8), `repos.state.claimJobRun` (bestehend, atomar).
- Produces:
  ```ts
  export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, nowSec: number, toleranceSec?: number /* 300 */):
    { ok: true; event: { id: string; type: string } } | { ok: false; reason: 'missing' | 'format' | 'timestamp' | 'signature' };
  export const STRIPE_SYNC_EVENTS: ReadonlySet<string>; // customer.subscription.*, invoice.paid, invoice.payment_failed, charge.refunded, charge.dispute.created
  ```
- Route `POST /api/webhooks/stripe`: kein `requireSession` (vom Login ausgenommen, eigene Prüfung). Ablauf: Ohne `stripeWebhookSecret` → 503 `{ error: 'Nicht eingerichtet' }`. Dann `await req.text()` und `verifyStripeSignature` mit `realNow()`, bei Fehler 400 `{ error: 'Signatur ungültig' }`. `claimJobRun('stripe-event:' + id, at)` → bei `false` 200 `{ duplicate: true }`. Bei relevantem Typ `syncConnections(getRepos(), getSyncDeps({ only: ['stripe_nexus'], budgetMs: 8_000 }))`, dann 200 `{ received: true }`. Ein Sync-Fehler wird schon als `syncFailed` gespeichert. Die Route antwortet trotzdem 200, der 15-Min-Abgleich holt nach.

- [ ] **Step 1: Failing tests schreiben**

```ts
const SECRET = 'whsec_test';
const sign = (body: string, t: number, secret = SECRET) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
const BODY = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', data: { object: {} } });
test('gültige Signatur', () => expect(verifyStripeSignature(BODY, sign(BODY, 1000), SECRET, 1010)).toEqual({ ok: true, event: { id: 'evt_1', type: 'invoice.paid' } }));
test('falsches Geheimnis', () => expect(verifyStripeSignature(BODY, sign(BODY, 1000, 'other'), SECRET, 1010)).toEqual({ ok: false, reason: 'signature' }));
test('veränderter Body', () => expect(verifyStripeSignature(BODY + ' ', sign(BODY, 1000), SECRET, 1010).ok).toBe(false));
test('Zeit außerhalb der Toleranz', () => expect(verifyStripeSignature(BODY, sign(BODY, 1000), SECRET, 1000 + 301)).toEqual({ ok: false, reason: 'timestamp' }));
test('mehrere v1 (Schlüsselwechsel): eine passende reicht', () => expect(verifyStripeSignature(BODY, `t=1000,v1=${'0'.repeat(64)},${sign(BODY, 1000).split(',')[1]}`, SECRET, 1000).ok).toBe(true));
test('fehlender Header', () => expect(verifyStripeSignature(BODY, null, SECRET, 1000)).toEqual({ ok: false, reason: 'missing' }));

describe('Route', () => {
  // vi.mock('@/server/sync', …) → syncConnections als Spy; Env mit STRIPE_WEBHOOK_SECRET=SECRET, NEXUS_TEST_MEMORY_DB=1; setNowForTests nicht nötig, t = jetzt
  test('gültig → 200, Sync nur für Stripe', async () => {
    const res = await POST(req(BODY, sign(BODY, nowSec())));
    expect(res.status).toBe(200);
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(syncSpy.mock.calls[0][1].only).toEqual(['stripe_nexus']);
  });
  test('ungültig → 400, kein Sync', async () => { expect((await POST(req(BODY, 't=1,v1=00'))).status).toBe(400); expect(syncSpy).not.toHaveBeenCalled(); });
  test('doppeltes Event → zweites Mal duplicate, Sync einmal', async () => {
    await POST(req(BODY, sign(BODY, nowSec())));
    expect(await (await POST(req(BODY, sign(BODY, nowSec())))).json()).toEqual({ duplicate: true });
    expect(syncSpy).toHaveBeenCalledTimes(1);
  });
  test('ohne Geheimnis → 503', async () => { vi.stubEnv('STRIPE_WEBHOOK_SECRET', ''); expect((await POST(req(BODY, sign(BODY, nowSec())))).status).toBe(503); });
  test('Antwort enthält nie das Geheimnis', async () => expect(await (await POST(req(BODY, 'x'))).text()).not.toContain(SECRET));
});

// api-guard.test.ts: EXEMPT um /^webhooks\/stripe$/ erweitern, plus
it('Stripe-Webhook prüft die Signatur', () => expect(readFileSync(path.join(API, 'webhooks/stripe/route.ts'), 'utf8')).toContain('verifyStripeSignature('));
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/webhook-stripe.test.ts tests/unit/api-guard.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.** Header `t=…,v1=…[,v1=…]` zerlegen. HMAC-SHA256 über `` `${t}.${rawBody}` `` mit `createHmac`. Vergleich mit `timingSafeEqual` auf gleich langen Buffern (Länge vorher prüfen). Erst nach gültiger Signatur `JSON.parse`. Fehlen `id` oder `type` → `format`.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Stripe-Webhook mit Signaturprüfung und Event-Idempotenz`

---

### Task 10: Vorschlag übernehmen oder verwerfen

**Files:**
- Create: `src/domain/import/contract-draft.ts`, `tests/unit/import/confirm.test.ts`
- Modify: `src/domain/events.ts`, `src/data/engine.ts`, `src/server/state-service.ts`, `tests/unit/state-service.test.ts`

**Interfaces:**
- Consumes: `deriveProposals`, `findContactFor`, `ContractProposal` (Task 5); `buildSchedule` (Prüfung der letzten Rate).
- Produces:
  ```ts
  // contract-draft.ts
  export interface ContractDraft { totalCents: number; installments: number; installmentCents: number; dueDay: number; startDate: IsoDate; catchUpMode: MemberContract['catchUpMode'] }
  export function validateContractDraft(d: ContractDraft): string[]; // deutsche Fehlertexte, leer = gültig
  export function draftFromProposal(p: ContractProposal): Partial<ContractDraft>; // Vorbelegung für das Formular
  // events.ts (Client-Ereignisse)
  | { type: 'confirmProposal'; proposalId: string; draft: ContractDraft; contactId: string | null } // contactId: „Ja“ auf „Ist das … ?“
  | { type: 'dismissProposal'; proposalId: string }
  ```
- `confirmProposal` legt den Vertrag als **erste** neue ID an. `created[0]` ist also die Vertrags-ID, die UI leitet damit auf die Übernahme-Seite weiter.

**Regeln `confirmProposal`:** Der Vorschlag wird frisch aus dem Zustand abgeleitet. Fehlt er (schon übernommen oder verworfen), gibt es keine Änderung und das Audit „Vorschlag nicht mehr offen“. Bei ungültigem Entwurf gibt es keine Änderung und das Audit „Vertrag nicht angelegt: <Fehler>“.

Kontakt: Bei `findContactFor` = `ref` oder `email` wird der gefundene Kontakt genommen. Bei `name` nur, wenn `e.contactId` genau dieser Kontakt ist, sonst ein neuer. Ein neuer Kontakt bekommt `company 'nexus'`, `kind 'member'`, Name und E-Mail aus dem Vorschlag und `externalRefs = contactRefs`. Ein wiederverwendeter Kontakt bekommt fehlende Refs ergänzt.

Vertrag: `{ ...draft, id, contactId, billing: p.billing, origin: p.sources }`. Für Stripe-Quellen wird am Abo `contractId`, `confirmedPriceCents = priceCents` und `confirmedEndDate = endDate` gesetzt. Audit (owner): `Vertrag übernommen: <Name>, <n> × <Rate>`.

- [ ] **Step 1: Failing tests schreiben**

```ts
const draftA: ContractDraft = { totalCents: 120000, installments: 4, installmentCents: 30000, dueDay: 1, startDate: '2026-09-01', catchUpMode: 'first_rate' };
test('validateContractDraft', () => {
  expect(validateContractDraft(draftA)).toEqual([]);
  expect(validateContractDraft({ ...draftA, totalCents: 50000 })).toContain('Die letzte Rate wäre negativ.');
  expect(validateContractDraft({ ...draftA, dueDay: 32 })).toContain('Fälligkeitstag muss zwischen 1 und 31 liegen.');
  expect(validateContractDraft({ ...draftA, installments: 0 })).not.toEqual([]);
});
test('Übernehmen legt Vertrag mit origin an, ordnet rückwirkend zu, Rückstand aus dem Ledger', () => {
  const r = applyEvent(stripeState, { type: 'confirmProposal', proposalId: 'stripe_nexus:sub_A', draft: draftA, contactId: null }, ctx({ isDemo: false }));
  const k = r.state.contracts.find((c) => c.id === r.created[0])!;
  expect(k).toMatchObject({ billing: 'stripe', origin: [{ connectionId: 'stripe_nexus', externalId: 'sub_A' }], installments: 4 });
  expect(r.state.subscriptions.find((x) => x.externalId === 'sub_A')).toMatchObject({ contractId: k.id, confirmedPriceCents: 30000, confirmedEndDate: '2027-01-01' });
  expect(r.state.allocations.filter((a) => a.contractId === k.id).map((a) => a.amountCents)).toEqual([30000, 30000, 30000]);
  expect(memberView(r.state, k.id, '2026-11-12').status.arrearsCents).toBe(0);
  expect(r.state.contacts.find((c) => c.id === k.contactId)).toMatchObject({ name: 'Ayşe Öztürk', emails: ['ayse@example.de'], externalRefs: [{ connectionId: 'stripe_nexus', externalId: 'cus_A' }] });
});
test('zweimal übernehmen → genau ein Vertrag', () => {
  const e = { type: 'confirmProposal', proposalId: 'stripe_nexus:sub_A', draft: draftA, contactId: null } as const;
  const r = applyEvents(stripeState, [e, e], ctx());
  expect(r.state.contracts).toHaveLength(1);
  expect(r.state.audit.at(-1)!.text).toBe('Vorschlag nicht mehr offen');
});
test('Kontakt-Wiederverwendung: Ref, E-Mail; Name nur mit Ja', () => {
  const lex = applyEvent(lexState, { type: 'confirmProposal', proposalId: 'lexware_nexus:c-77', draft: draftMurat, contactId: null }, ctx()).state;
  expect(lex.contacts.filter((c) => c.name === 'Murat Demir')).toHaveLength(1); // importierter Lexware-Kontakt wiederverwendet
  const byName = withContact(stripeState, { id: 'old', name: 'Ayşe Öztürk', emails: [] });
  const nein = applyEvent(byName, { type: 'confirmProposal', proposalId: 'stripe_nexus:sub_A', draft: draftA, contactId: null }, ctx()).state;
  expect(nein.contracts[0].contactId).not.toBe('old');
  const ja = applyEvent(byName, { type: 'confirmProposal', proposalId: 'stripe_nexus:sub_A', draft: draftA, contactId: 'old' }, ctx()).state;
  expect(ja.contracts[0].contactId).toBe('old');
  expect(ja.contacts.find((c) => c.id === 'old')!.externalRefs).toEqual([{ connectionId: 'stripe_nexus', externalId: 'cus_A' }]);
});
test('fremde contactId wird ignoriert', () => {
  const r = applyEvent(withContact(stripeState, { id: 'x', name: 'Jemand', emails: [] }), { type: 'confirmProposal', proposalId: 'stripe_nexus:sub_A', draft: draftA, contactId: 'x' }, ctx()).state;
  expect(r.contracts[0].contactId).not.toBe('x');
});
test('ungültiger Entwurf → nichts angelegt', () => expect(applyEvent(stripeState, { type: 'confirmProposal', proposalId: 'stripe_nexus:sub_A', draft: { ...draftA, totalCents: 1 }, contactId: null }, ctx()).state.contracts).toEqual([]));
test('Verwerfen merkt die ID, Vorschlag weg', () => {
  const r = applyEvent(stripeState, { type: 'dismissProposal', proposalId: 'stripe_nexus:sub_A' }, ctx()).state;
  expect(r.dismissedProposals).toEqual(['stripe_nexus:sub_A']);
  expect(deriveProposals(r).some((p) => p.id === 'stripe_nexus:sub_A')).toBe(false);
});

// state-service.test.ts
test('confirmProposal/dismissProposal sind Client-Ereignisse mit Formprüfung', () => {
  expect(isClientEvent({ type: 'confirmProposal', proposalId: 'p', draft: draftA, contactId: null })).toBe(true);
  expect(isClientEvent({ type: 'confirmProposal', proposalId: 'p', draft: { ...draftA, installments: 1.5 }, contactId: null })).toBe(false);
  expect(isClientEvent({ type: 'confirmProposal', proposalId: 'p', draft: { ...draftA, startDate: '1.9.2026' }, contactId: null })).toBe(false);
  expect(isClientEvent({ type: 'dismissProposal', proposalId: 'p' })).toBe(true);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/import/confirm.test.ts tests/unit/state-service.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.**
  - `validateContractDraft`: Ganzzahlen, `installments` 1–120, `dueDay` 1–31, Beträge > 0, `startDate` im Format `YYYY-MM-DD`, letzte Rate (`totalCents − installmentCents × (installments − 1)`) > 0.
  - Engine-Zweige nach den Regeln oben, `dismissProposal` hängt die ID einmalig an.
  - `CLIENT_EVENTS` und `SHAPE` werden erweitert: Formprüfung des Entwurfs mit `oneOf` für `catchUpMode`, `contactId` ist `null` oder ein String.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Vertragsvorschlag übernehmen oder verwerfen, Kontakt wiederverwenden`

---

### Task 11: Oberfläche – Vorschläge, Verbindungsstatus, „Bank nicht verbunden“, Demo-Kopf

**Files:**
- Create: `src/app/nexus/mitglieder/vorschlaege/page.tsx`, `src/components/ProposalCard.tsx`, `src/components/connection-labels.ts`, `tests/unit/connection-labels.test.ts`, `tests/unit/proposal-card.test.ts`
- Modify: `src/app/nexus/page.tsx`, `src/app/nexus/mitglieder/[id]/page.tsx`, `src/app/nexus/mitglieder/[id]/uebernahme/page.tsx`, `src/app/zulassung/auftraege/[id]/page.tsx`, `src/components/SetupChecklist.tsx`, `src/app/verbindungen/page.tsx`, `src/domain/connections.ts` (`HOW_TO` für `stripe_nexus`, `lexware_nexus`, `lexware_zulassung`), `tests/e2e/nexus.spec.ts`

**Interfaces:**
- Consumes: `deriveProposals`, `findContactFor`, `draftFromProposal`, `validateContractDraft`, `confirmProposal`/`dismissProposal`, `memberRows().notConnected`, `waitingStripePayments`, `contractSources`, `notConnected`, `ageMinutes`.
- Produces:
  ```ts
  // connection-labels.ts
  export function connectionSubtitle(c: Connection, at: Date): string; // 'Verbunden · Stand vor 3 Min.' | 'Störung: <lastError> · Stand vor 50 Min.' | HOW_TO[c.id]
  // ProposalCard.tsx
  export function proposalSummary(p: ProposalValues): string; // '1.200,00 € · 4 × 300,00 € · am 1. · ab 01.09.2026', fehlende Teile als '?'
  export function ProposalCard(props: { proposal: ContractProposal; contacts: Contact[]; onConfirm(draft: ContractDraft, contactId: string | null): void; onDismiss(): void }): JSX.Element;
  ```

**Festgelegte Texte und Test-IDs:**
- Karte auf NEXUS über der Mitgliederliste, nur wenn Vorschläge offen sind: `ListRow` mit `href="/nexus/mitglieder/vorschlaege"`, `testId="proposals-card"`, Titel `12 Verträge zum Bestätigen` bzw. `1 Vertrag zum Bestätigen`.
- Seite `Vorschläge` (`PageHeader`, `BackLink` zu `/nexus`). Eine `ProposalCard` je Vorschlag (`testId="proposal-<id>"`), darin Name, `sourceLabel`, `proposalSummary`, `Quelle: <references mit „, “>`, Sicherheit `vollständig` oder `bitte ergänzen`. Bei `possibleMatch` steht `gehört evtl. zu <Name>`. Bei `findContactFor().match === 'name'` erscheint die Frage `Ist das <Name>?` mit den Knöpfen `Ja` und `Nein`. Knöpfe: `Bearbeiten`, `Verwerfen`, `Übernehmen`. „Übernehmen“ ist gesperrt, solange `validateContractDraft` Fehler meldet, und die Fehler stehen unter dem Formular. „Bearbeiten“ öffnet die Felder Gesamt, Raten, Rate, Fälligkeitstag, Start (Betragseingabe über `parseEuroInput`) und den Nachzahlungsmodus (`Segmented` mit den Optionen der Übernahme-Seite). Nach dem Übernehmen folgt `router.push('/nexus/mitglieder/' + created[0] + '/uebernahme')`. Fußzeile bei wartenden Stripe-Zahlungen: `<n> Stripe-Zahlungen warten auf einen Vorschlag`. Leerzustand: `Keine Vorschläge offen.`
- Mitgliederzeile mit `notConnected`: Untertitel `Überweisung · Bank nicht verbunden`, kein Rückstandsbetrag, keine Ampel. Mitglieds- und Übernahme-Seite zeigen bei `notConnected(contractSources(contract))` statt der Zahlen eine `note-card` mit `Bank nicht verbunden` (`testId="bank-missing"`).
- Übernahme- und Auftrags-Seite zeigen `<DemoBadge />` im `PageHeader` nur bei `mode === 'demo'`.
- Verbindungen im Echtmodus: `SetupChecklist` nutzt `connectionSubtitle`. `HOW_TO` nennt für Stripe und Lexware die Vercel-Variable (z. B. `Schlüssel als Vercel-Variable STRIPE_RESTRICTED_KEY hinterlegen (nur lesen: Kunden, Abos, Rechnungen, Zahlungen).`). Es gibt keine Eingabemaske.

- [ ] **Step 1: Failing tests schreiben**

```ts
// connection-labels.test.ts
const at = new Date('2026-11-12T10:00:00Z');
test('verbunden', () => expect(connectionSubtitle({ ...C, status: 'connected', lastSuccessAt: '2026-11-12T09:57:00Z' }, at)).toBe('Verbunden · Stand vor 3 Min.'));
test('Störung im Klartext', () => expect(connectionSubtitle({ ...C, status: 'error', lastSuccessAt: '2026-11-12T09:10:00Z', lastError: 'Stripe: HTTP 401 bei /v1/subscriptions (Schlüssel prüfen)' }, at)).toBe('Störung: Stripe: HTTP 401 bei /v1/subscriptions (Schlüssel prüfen) · Stand vor 50 Min.'));
test('fehlt → Anleitung', () => expect(connectionSubtitle({ ...C, status: 'missing', lastSuccessAt: null }, at)).toBe(HOW_TO.stripe_nexus));
// proposal-card.test.ts
test('Zusammenfassung', () => expect(proposalSummary({ totalCents: 120000, installments: 4, installmentCents: 30000, dueDay: 1, startDate: '2026-09-01' })).toBe('1.200,00 € · 4 × 300,00 € · am 1. · ab 01.09.2026'));
test('fehlende Werte', () => expect(proposalSummary({ totalCents: 120000, installments: null, installmentCents: null, dueDay: null, startDate: '2026-09-10' })).toBe('1.200,00 € · ? × ? · am ? · ab 10.09.2026'));
```

```ts
// tests/e2e/nexus.spec.ts (Demo): Demo-Suite bleibt grün, zusätzlich
test('Demo: keine Vorschlagskarte, Übernahme zeigt Demo-Etikett', async ({ page }) => {
  await page.goto('/nexus');
  await expect(page.getByTestId('proposals-card')).toHaveCount(0);
  await page.goto('/nexus/mitglieder/mc-schulz/uebernahme');
  await expect(page.getByTestId('demo-badge').first()).toBeVisible();
});
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/connection-labels.test.ts tests/unit/proposal-card.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.** Nur bestehende Bausteine (`ListGroup`, `ListRow`, `PageHeader`, `BackLink`, `Segmented`, `Figures`, `note-card`, `btn`-Klassen). Keine Geldrechnung in Komponenten: Vorbelegung über `draftFromProposal`, Prüfung über `validateContractDraft`, Texte über `formatEuro`/`formatIsoDe`.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `npm run lint`, dann `fuser -k 3100/tcp; npm run e2e -- tests/e2e/nexus.spec.ts tests/e2e/zulassung.spec.ts tests/e2e/shell.spec.ts 2>&1 | tail -15`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Vertragsvorschläge bestätigen, Verbindungsstatus und „Bank nicht verbunden“ anzeigen`

---

### Task 12: E2E im Echtmodus und Einrichtungsanleitung

**Files:**
- Modify: `tests/e2e/auth.spec.ts` (neue Tests **am Ende** der seriellen Datei, nach „zweite Einrichtung …“. Die früheren Tests erwarten „Noch nichts verbunden“, nach dem Import stimmt das nicht mehr. Die Sitzung ist nach „Abmelden und wieder anmelden“ aktiv.), `.env.example`, `docs/PROJEKT-STAND.md` (nur Dokumententabelle)
- Create: `docs/setup-phase2b.md`

**Interfaces:**
- Consumes: `POST /api/test/import` (Task 8), `stripeRoutes`/`lexwareRoutes` aus `tests/fixtures/index.ts`, Test-IDs aus Task 11.
- Hinweis: Die Memory-DB ist eine Instanz je Server. Andere Spec-Dateien laufen parallel. Deshalb kommen die Echtmodus-Tests in die bestehende serielle `auth.spec.ts` und nicht in eine neue Datei mit eigenem `reset`.

- [ ] **Step 1: Failing E2E schreiben**

```ts
test('Echtmodus: Import, Vorschläge, Übernehmen führt zur Übernahme ohne Demo-Kopf', async () => {
  const r = await page.request.post('/api/test/import', { data: { routes: { ...stripeRoutes, ...lexwareRoutes } } });
  expect(r.ok()).toBe(true);
  await page.goto('/verbindungen');
  await expect(page.getByTestId('setup-stripe_nexus')).toContainText('Verbunden · Stand vor 0 Min.');
  await page.goto('/nexus');
  await expect(page.getByTestId('proposals-card')).toContainText('Verträge zum Bestätigen');
  await page.getByTestId('proposals-card').click();
  const card = page.getByTestId('proposal-stripe_nexus:sub_A');
  await expect(card).toContainText('1.200,00 € · 4 × 300,00 € · am 1. · ab 01.09.2026');
  await expect(card).toContainText('vollständig');
  await card.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page).toHaveURL(/\/nexus\/mitglieder\/[^/]+\/uebernahme$/);
  await expect(page.getByTestId('demo-badge')).toHaveCount(0);
  await expect(page.getByTestId('previous-payments').locator('li')).toHaveCount(3);
});
test('Echtmodus: Verwerfen bleibt verworfen, Lexware-Vertrag zeigt „Bank nicht verbunden“', async () => {
  await page.goto('/nexus/mitglieder/vorschlaege');
  await page.getByTestId('proposal-stripe_nexus:sub_E').getByRole('button', { name: 'Verwerfen' }).click();
  await page.reload();
  await expect(page.getByTestId('proposal-stripe_nexus:sub_E')).toHaveCount(0);
  await page.getByTestId('proposal-lexware_nexus:c-77').getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page.getByTestId('bank-missing')).toHaveText(/Bank nicht verbunden/);
  await page.goto('/nexus');
  await expect(page.getByText('Überweisung · Bank nicht verbunden')).toBeVisible();
});
test('Echtmodus: unvollständiger Vorschlag lässt sich erst nach Ergänzen übernehmen', async () => {
  await page.goto('/nexus/mitglieder/vorschlaege');
  const card = page.getByTestId('proposal-lexware_nexus:c-83'); // Gesamtrechnung ohne Fälligkeitstag (Fixture aus Task 3)
  await expect(card).toContainText('bitte ergänzen');
  await expect(card.getByRole('button', { name: 'Übernehmen' })).toBeDisabled();
  await card.getByRole('button', { name: 'Bearbeiten' }).click();
  await card.getByLabel('Fälligkeitstag').fill('15');
  await expect(card.getByRole('button', { name: 'Übernehmen' })).toBeEnabled();
});
```

- [ ] **Step 2: Run** `fuser -k 3100/tcp; npm run e2e -- tests/e2e/auth.spec.ts 2>&1 | tail -15`. Erwartet: zuerst FAIL, nach der Umsetzung PASS. Danach die ganze Suite: `fuser -k 3100/tcp; npm run e2e 2>&1 | tail -15` → grün (Demo-Suite unverändert).
- [ ] **Step 3: Doku.** `docs/setup-phase2b.md` ist die Inhaber-Checkliste:
  1. Stripe: Restricted Key nur lesend für Customers, Subscriptions, Invoices, Charges/Refunds, Disputes, Products anlegen. Webhook-Endpunkt `<APP_ORIGIN>/api/webhooks/stripe` mit den Events aus `STRIPE_SYNC_EVENTS` anlegen und das Signing Secret notieren.
  2. Lexware: API-Schlüssel je Konto (NEXUS, Zulassung) erstellen.
  3. Vercel: die vier Variablen nur für Production setzen, neu deployen.
  4. Supabase: Migration `20261113000000_vertraege.sql` ausführen.
  5. Prüfen: Verbindungen zeigt „Verbunden · Stand vor …“, NEXUS zeigt die Vorschlagskarte.

  `.env.example` bekommt die vier Variablen mit deutschen Kommentaren (leer), `PROJEKT-STAND.md` einen Tabelleneintrag für die Checkliste und diesen Plan.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `npm run lint`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: E2E für Vertragsvorschläge im Echtmodus, Einrichtungsanleitung 2b`

---

## Self-Review (erledigt)

- **Spec-Abdeckung:**
  - Ziele 2: Abgleich in Task 7/8/9, Vorschläge in Task 5/10/11, Stripe-Zahlungen im Ledger in Task 6.
  - Anti-Ziele: kein Vertrag ohne Bestätigung (Task 10). Keine Doppelgutschrift (Task 4 und 8, Auszahlungen werden nicht gelesen). Ein Sync-Fehler überschreibt nichts (Task 4 und 8). Kein Geheimnis in Daten oder Texten (Task 7, 8, 9).
  - 4.2 Variablen und Abruf (Task 7–9), Rückblick (`IMPORT_SINCE`), Gesamt- und Ratenrechnung (Task 5), nur Lexware NEXUS erzeugt Vorschläge (Task 5).
  - 5 Statuswerte und Hinweis nach 3 Fehlern (Task 4). 6 Datenmodell (Task 1). 7 Vorschlag (Task 5). 8 Oberfläche (Task 11). 9 Sicherheit (Task 7 und 9). 10 Tests (Task 2–12).
  - 11a: rückwirkend (Task 6/10), Legacy ohne Bank (Task 6/11), `amount_paid`/EUR/Monat (Task 2/5), Abo ohne Ende (Task 5), Hinweise nach Bestätigung (Task 6), `allocate` < 0 (Task 6), Kontakt-Wiederverwendung (Task 5/10), keine Stripe-`Invoice` (Task 2), Cursor (Task 7/8), Vorschlags-ID (Task 5), Erkennung „Mitgliedschaft“ (Task 2).
- **Typen:** `ImportBatch`, `Subscription`, `ContractProposal`, `ContractDraft`, `PullContext`, `SyncDeps` sind je einmal definiert und unter gleichem Namen weiterverwendet. `created[0]` ist die Vertrags-ID (Task 10 → 11).
- **Proportion:** Signaturen, Regeln und Tests. Funktionskörper fehlen bewusst, außer kurzen Algorithmushinweisen (`allocate` < 0, Drosselung, Signatur).
