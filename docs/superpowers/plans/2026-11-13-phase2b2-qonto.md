# Nexus-Assistent Paket 2b-2 (Qonto, Zuordnung, alle NEXUS-Rechnungen als Forderungen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Das Qonto-Konto (NEXUS) wird lesend abgeglichen. Eingehende Überweisungen werden gehärtet Mitgliedsverträgen **oder** offenen Lexware-Rechnungen zugeordnet. Die erste Zahlung bestätigt der Inhaber, danach läuft die Zuordnung automatisch über die gelernte IBAN. Alle offenen NEXUS-Forderungen erscheinen auf „NEXUS → Offen“.

**Architecture:** Gleiches Muster wie 2b-1: Der Connector `pullQonto` (`src/server/connectors/qonto.ts`) holt Konten und Buchungen seitenweise, mit Drossel, Zeitbudget und JSON-Cursor. Der reine Mapper `mapQonto` (`src/domain/import/qonto.ts`) macht daraus einen `ImportBatch`. `mergeBatch` verknüpft Rückbuchungen und klassifiziert Stripe-Auszahlungen. `refresh()` ordnet über `matchBankPayment` zu. Das Ziel einer Zuordnung ist jetzt ein Vertrag **oder** eine Rechnung (`Allocation` als Union). Forderungen werden rein abgeleitet (`src/domain/ledger/receivables.ts`), nichts davon wird gespeichert. Die Umbenennung `bank` → `bank_qonto` läuft doppelt: SQL-Migration für die Datenbank und `migrateState()` beim Laden (Server und Demo-Speicher).

**Tech Stack:** Next.js 16.4 (App Router, Client-Seiten), TypeScript, globales `fetch`, Supabase (SQL-Migration), Vitest, Playwright. Keine neuen npm-Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-11-13-phase2b2-design.md` (inkl. 4a „Alle NEXUS-Rechnungen als Forderungen“). Basis-Regeln: `docs/superpowers/specs/2026-11-12-nexus-assistent-design.md` Abschnitt 4a. Hintergrund: `docs/superpowers/specs/2026-11-12-phase2b-design.md` Abschnitt 11. Sparkasse-Upload (2b-2b), Portal-Abgleich und „Rechnungen lesen“ gehören **nicht** dazu.

## Global Constraints

- Regeln 4a gelten unverändert: Cent-Ganzzahlen, Kalendertage Europe/Berlin über `src/domain/clock.ts` (Zeitstempel → `todayBerlin(new Date(iso))`), nie `new Date()` direkt in `src/domain`. Geld wird nur in Ledger- und Domain-Funktionen gerechnet, nicht in Komponenten.
- Gutschrift nur aus Zahlungen. Eine Stripe-Auszahlung wird nie gutgeschrieben. Lexware `paid` erledigt nur die **Rechnung** (offen 0), ist aber keine Gutschrift für Verträge.
- `src/domain/` bleibt rein (prüft `tests/unit/architecture.test.ts`): kein `fetch`, kein React, keine Importe aus `src/data`, `src/app`, `src/components`, `src/server`.
- Verbindungen: `bank` entfällt. Neu sind `bank_qonto` (company `nexus`, Label „Qonto (NEXUS)“) und `bank_sparkasse` (company `zulassung`, Label „Sparkasse (Zulassung)“, bleibt `missing`, Text „Kommt als Upload (CAMT- oder CSV-Export).“). `Payment.source: 'bank'` bleibt als Quellenart unverändert.
- Qonto: Basis `https://thirdparty.qonto.com/v2`, Header `Authorization: <QONTO_LOGIN>:<QONTO_SECRET_KEY>` (kein `Bearer`). Endpunkte `GET /organization` und `GET /transactions?bank_account_id=…&status[]=completed&settled_at_from=…&sort_by=settled_at:asc&per_page=100&current_page=N`. Drossel ≥ 500 ms, 429 wie Lexware (`RateLimited`). `external_id` = Qonto-`transaction_id`. **Alle Feldnamen sind „gegen Doku prüfen“ (Netz zur Doku in der Session gesperrt). Sie stehen gebündelt als Konstanten oben in `src/domain/import/qonto.ts` und `src/server/connectors/qonto.ts`, damit eine Korrektur eine Stelle betrifft.**
- Import ab `IMPORT_SINCE = '2026-08-01'` (Berliner Mitternacht = `2026-07-31T22:00:00.000Z`), danach inkrementell mit 3 Tagen Überlappung. Nur Eingänge (`side = credit`), nur `EUR`. Ausgänge nur als Rückbuchung (siehe Task 6).
- Neue Umgebungsvariablen, nur Production, optional: `QONTO_LOGIN`, `QONTO_SECRET_KEY`. Fehlt eine, bleibt `readEnv()` grün und `bank_qonto` `missing`. Keine `NEXT_PUBLIC_`-Variable. Geheimnisse nur in `src/server/**` mit `import 'server-only'`, nie in AppState, Audit, `lastError`, Antworten, Logs.
- Zuordnung: Toleranz 0 Cent. Automatisch (`high`) nur bei **genau einem** Ziel. Mehrdeutig → ein Vorschlag mit Auswahl, nie automatisch. Beträge ≤ 0 werden nie vorgeschlagen.
- Tests rufen keine echte API auf (`fixtureFetch`, Fixture-JSON in `tests/fixtures/qonto/`).
- UI-Texte Deutsch, Design-Bausteine aus `src/components` (`ListGroup`, `ListRow`, `PageHeader`, `BackLink`, `TrafficDot`, `MoneyCard`) wiederverwenden. Neue Seite `src/app/nexus/offen/page.tsx` als Client-Seite wie die Nachbarn; vorher `node_modules/next/dist/docs/` zum App Router überfliegen.
- Vor jedem Commit: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Bei UI-Änderungen die betroffene E2E-Spec: `fuser -k 3100/tcp; npm run e2e -- <spec> 2>&1 | tail -15`. Branch `claude/cool-hopper-hcnb9d`. Commit-Nachrichten Deutsch (`feat:`/`fix:`/`docs:`). Pushen macht der Controller.

## Review Focus

1. **Überlappendes Abrufen** (Cursor mit 3 Tagen Überlappung, Abbruch am Zeitbudget, zweiter Lauf): Dieselbe Qonto-Buchung entsteht nie zweimal, eine schon bestehende Zuordnung bleibt einfach. Test in Task 8 (`zweimal syncen → gleiche Zahlungen und Zuordnungen`).
2. **Rechnung per Qonto zugeordnet, danach meldet Lexware `paid`** (Inhaber hat in Lexware ausgeglichen): Offen ist 0, nicht negativ, keine Doppelminderung. Ebenso Lexware-Teilzahlung plus eigene Zuordnung. Test in Task 2.
3. **„Keine Mitgliedszahlung“ und dann erneuter Import derselben Buchung**: Sie bleibt ausgeblendet, kein Hinweis, keine Auto-Zuordnung. Tests in Task 4 und Task 6.
4. **IBAN unterschiedlich geschrieben** (gelernt aus `de89 3704 …`, zweite Zahlung `DE89370400…`, alte Links mit Leerzeichen in der Datenbank): Die zweite Zahlung wird automatisch zugeordnet. Tests in Task 1 (Migration) und Task 3.
5. **Rückbuchung kommt, bevor die Originalzahlung zugeordnet ist**: Keine negative Gutschrift auf irgendeinen Vertrag. Sobald das Original bestätigt ist, folgt die Rückbuchung demselben Ziel. Test in Task 4.

---

## Dateistruktur

```
src/domain/
  types.ts                 ConnectionId: −'bank' +'bank_qonto' +'bank_sparkasse'; Allocation-Union; Payment.ignoredAt; Contact.contactPersons
  connections.ts           Katalog, HOW_TO, contractSources → bank_qonto
  migrate.ts               migrateState() (neu)
  briefing.ts, coach.ts    'bank' → 'bank_qonto'
  ledger/status.ts         trafficFor() (aus memberStatus herausgelöst)
  ledger/receivables.ts    coveringContract, invoiceOpenCents, nexusReceivables (neu)
  matching/payments.ts     normalizeIban, normalizeName (Firmen-Zusätze), contactNameMatches, classifyBankTx (eng),
                           referenceHasNumber, amountFitsContract, matchBankPayment (Ziele), bankReturnAllocations, linkBankReturns
  detectors/payments.ts    buildMatchContext (ersetzt expectedAmounts), detectUnmatchedPayments
  detectors/invoices.ts    detectInvoiceOverdue: NEXUS-Sammelhinweis, abgedeckte Rechnungen raus
  detectors/refs.ts        receivableRef
  events.ts                confirmPaymentMatch mit invoiceId, dismissPayment
  import/qonto.ts          QONTO-Konstanten, mapQonto (neu)
  import/lexware.ts        contactPersons
  import/merge.ts          contactPersons nachziehen, Stripe-Auszahlung mit Mitglieds-IBAN, Rückbuchungen verknüpfen
src/data/
  engine.ts                autoAllocate auf Ziele, confirmPaymentMatch(Ziel), dismissPayment, Rückbuchungen, simulateTransfer
  seed.ts                  'bank' → 'bank_qonto', bank_sparkasse missing
  store.tsx                loadInitial → migrateState
  selectors.ts             unallocatedBankPayments (ohne ausgeblendete, ohne ≤ 0), matchOptions
src/server/
  env.ts                   qontoLogin, qontoSecretKey
  connectors/http.ts       Option authorization
  connectors/qonto.ts      pullQonto, qontoTransactionsQuery, QONTO_SINCE (neu)
  sync.ts                  SyncId + bank_qonto, syncSecrets
  registry.ts              Schlüssel bank_qonto
  db/tables.ts             fromRows → migrateState, Allocation-Zeilen-ID
  state-service.ts         CLIENT_EVENTS/SHAPE
src/app/
  api/test/import/route.ts, api/sync/route.ts
  nexus/zuordnen/page.tsx  Ziele, Auswahl, „Keine Mitgliedszahlung“
  nexus/offen/page.tsx     (neu) Übersicht Forderungen
  nexus/page.tsx           Zeile „Offen“
supabase/migrations/20261114000000_qonto.sql
tests/fixtures/qonto/{organization,transactions}.json, tests/fixtures/index.ts
tests/unit/migrate.test.ts, ledger/receivables.test.ts, import/qonto.test.ts, connectors/qonto.test.ts (+ bestehende)
tests/e2e/auth.spec.ts, assistant.spec.ts, nexus.spec.ts
docs/setup-phase2b2.md, .env.example
```

---

### Task 1: Verbindungen `bank_qonto`/`bank_sparkasse` und Migration ohne Datenverlust

**Files:**
- Modify: `src/domain/types.ts:3`, `src/domain/connections.ts`, `src/domain/briefing.ts:21`, `src/domain/coach.ts:73`, `src/domain/detectors/payments.ts:43`, `src/domain/matching/payments.ts` (nur `normalizeIban` neu), `src/data/seed.ts` (Zeilen 62, 70, 137; grep `connectionId: 'bank'`), `src/data/engine.ts` (`simulateTransfer`, grep `connectionId: 'bank'`), `src/data/store.tsx` (`loadInitial`), `src/server/db/tables.ts` (`fromRows`), `tests/unit/migration.test.ts`
- Create: `src/domain/migrate.ts`, `supabase/migrations/20261114000000_qonto.sql`, `tests/unit/migrate.test.ts`
- Test (nur `'bank'` → `'bank_qonto'` ersetzen, Payment-`source: 'bank'` bleibt): `tests/unit/helpers.ts` (`ALL_IDS` + `bank_sparkasse`, `conn` default id), `tests/unit/matching/payments.test.ts:8`, `tests/unit/ui-events.test.ts:60`, `tests/unit/empty-state.test.ts:36-38`, `tests/unit/freshness.test.ts:16-17`, `tests/unit/coach.test.ts:27`, `tests/unit/import/helpers.ts:57`, `tests/unit/detectors.test.ts` (109–162), `tests/e2e/nexus.spec.ts:135`, `tests/e2e/assistant.spec.ts:86-89` (`conn-bank_qonto`, Hilfe enthält `QONTO_LOGIN`), `tests/e2e/auth.spec.ts:42-46` (11 Einträge)

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export type ConnectionId = 'lexware_nexus'|'lexware_zulassung'|'stripe_nexus'|'bank_qonto'|'bank_sparkasse'|'gmail'|'icloud'|'info_mail'|'calendar'|'whatsapp_kunden'|'whatsapp_assistent';
  // matching/payments.ts
  export function normalizeIban(s: string): string; // Leerraum raus, Großbuchstaben
  // migrate.ts
  export function migrateState(s: AppState): AppState; // idempotent, gibt bei nichts zu tun dasselbe Objekt zurück
  ```
- Katalog-Reihenfolge: nach `stripe_nexus` folgen `bank_qonto`, `bank_sparkasse`.
- `HOW_TO.bank_qonto`: `'Qonto → Einstellungen → Integrationen → API-Schlüssel: Login und Secret Key als Vercel-Variablen QONTO_LOGIN und QONTO_SECRET_KEY hinterlegen (nur lesen).'`; `HOW_TO.bank_sparkasse`: `'Kommt als Upload (CAMT- oder CSV-Export).'`
- `contractSources(legacy)` = `['bank_qonto']`; `MONEY_SOURCES.nexus` = `['bank_qonto', 'stripe_nexus']` (Sparkasse nie in NEXUS-Quellen, sonst wäre der Bereich dauerhaft „veraltet“).
- Seed: alle Katalog-Verbindungen `connected`, außer `bank_sparkasse` → `missing`, `lastSuccessAt: null`.

`migrateState` (liest lose typisiert, weil `'bank'` nicht mehr im Typ ist):
1. Verbindung `id === 'bank'`: Gibt es schon `bank_qonto`, wird `bank` gelöscht. Sonst wird sie zu `bank_qonto` mit Katalog-Label und `company: 'nexus'`; `status`, `lastSuccessAt`, `lastError`, `sync` bleiben.
2. `payments[].connectionId === 'bank'` → `'bank_qonto'`. `payments[].iban` → `normalizeIban`.
3. `ibanLinks[].iban` → `normalizeIban`, Duplikate: der erste bleibt.
4. `insights[].needsSources`: `'bank'` → `'bank_qonto'`.
5. Fehlende Felder: `payments[].ignoredAt` bleibt wie es ist (optional).

SQL `20261114000000_qonto.sql` (Daten, kein Schema):
```sql
-- Paket 2b-2: Verbindung 'bank' heißt jetzt 'bank_qonto'. Idempotent, ohne Datenverlust.
insert into connections (id, ord, data, updated_at)
  select 'bank_qonto', ord, jsonb_set(jsonb_set(jsonb_set(data, '{id}', '"bank_qonto"'), '{label}', '"Qonto (NEXUS)"'), '{company}', '"nexus"'), now()
  from connections where id = 'bank' and not exists (select 1 from connections where id = 'bank_qonto');
delete from connections where id = 'bank';
update payments set connection_id = 'bank_qonto', data = jsonb_set(data, '{connectionId}', '"bank_qonto"') where connection_id = 'bank';
update insights set data = jsonb_set(data, '{needsSources}', (select coalesce(jsonb_agg(case when x = '"bank"'::jsonb then '"bank_qonto"'::jsonb else x end), '[]'::jsonb) from jsonb_array_elements(data -> 'needsSources') x))
  where data -> 'needsSources' ? 'bank';
```
(IBAN-Normalisierung macht `migrateState` beim Laden; `iban_links`-Zeilen-IDs ändern sich dadurch beim nächsten Speichern, `diffState` löscht und legt neu an.)

- [ ] **Step 1: Failing tests schreiben**

```ts
// tests/unit/migrate.test.ts
const legacy = (): AppState => {
  const s = stateWith({ payments: [tx({ connectionId: 'bank' as ConnectionId, iban: 'de89 3704 0044 0532 0130 00' })],
    ibanLinks: [{ iban: 'DE89 3704 0044 0532 0130 00', contactId: 'm-kaya', confirmedAt: 'x' }],
    insights: [{ ...ins('k1', { needsSources: ['bank' as ConnectionId, 'stripe_nexus'] }), status: 'open', createdAt: 'x' }] });
  return { ...s, connections: [...s.connections.filter((c) => c.id !== 'bank_qonto'), { id: 'bank' as ConnectionId, company: null, label: 'Bankkonto', status: 'error', lastSuccessAt: '2026-11-01T00:00:00Z', lastError: 'x' }] };
};
test('bank → bank_qonto, Status und Zeit bleiben', () => {
  const c = migrateState(legacy()).connections.find((x) => x.id === 'bank_qonto')!;
  expect(c).toMatchObject({ label: 'Qonto (NEXUS)', company: 'nexus', status: 'error', lastSuccessAt: '2026-11-01T00:00:00Z' });
  expect(migrateState(legacy()).connections.some((x) => (x.id as string) === 'bank')).toBe(false);
});
test('Zahlungen, IBAN-Links, Hinweise migriert, nichts verloren', () => {
  const m = migrateState(legacy());
  expect(m.payments).toHaveLength(1);
  expect(m.payments[0]).toMatchObject({ connectionId: 'bank_qonto', iban: IBAN_KAYA });
  expect(m.ibanLinks).toEqual([{ iban: IBAN_KAYA, contactId: 'm-kaya', confirmedAt: 'x' }]);
  expect(m.insights[0].needsSources).toEqual(['bank_qonto', 'stripe_nexus']);
});
test('idempotent', () => expect(migrateState(migrateState(legacy()))).toEqual(migrateState(legacy())));
test('nichts zu tun → dasselbe Objekt', () => { const s = stateWith(); expect(migrateState(s)).toBe(s); });
test('fromRows migriert', () => expect(fromRows(toRows(legacy())).connections.map((c) => c.id)).toContain('bank_qonto'));
test('loadInitial migriert gespeicherten Demo-Stand', () => {
  const st = memStorage({ [STORE_KEY]: JSON.stringify(legacy()) });
  expect(loadInitial(st, '', NOW_0930).state.payments[0].connectionId).toBe('bank_qonto');
});
test('Katalog: Qonto und Sparkasse', () => {
  expect(CONNECTION_CATALOG.find((c) => c.id === 'bank_sparkasse')).toMatchObject({ company: 'zulassung', label: 'Sparkasse (Zulassung)' });
  expect(HOW_TO.bank_sparkasse).toBe('Kommt als Upload (CAMT- oder CSV-Export).');
  expect(contractSources(base)).toEqual(['bank_qonto']);
});
test('normalizeIban', () => expect(normalizeIban(' de89 3704\t0044 0532 0130 00 ')).toBe(IBAN_KAYA));

// tests/unit/migration.test.ts (neuer describe)
it('2b-2: bank → bank_qonto in connections, payments, insights', () => {
  expect(sql).toContain("where connection_id = 'bank'");
  expect(sql).toContain("delete from connections where id = 'bank'");
  expect(sql).toContain("'\"bank_qonto\"'");
});
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/migrate.test.ts tests/unit/migration.test.ts`. Erwartet: FAIL (`migrateState` fehlt).
- [ ] **Step 3: Implementieren** wie oben. `fromRows` ruft am Ende `migrateState` (vor dem Auffüllen fehlender Katalog-Verbindungen, sonst entstünde `bank_qonto` doppelt). `loadInitial` ruft `migrateState` auf den geparsten Stand vor `refresh`. Alle übrigen `'bank'`-Stellen (Liste unter **Files**) auf `'bank_qonto'`. `grep -rn "'bank'" src tests | grep -v "source: 'bank'\|source !== 'bank'\|source === 'bank'"` muss danach nur noch `migrate.ts` und `migrate.test.ts` zeigen.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, dann `fuser -k 3100/tcp; npm run e2e -- assistant.spec.ts nexus.spec.ts auth.spec.ts 2>&1 | tail -15`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Verbindung Bank heißt Qonto (NEXUS), Sparkasse neu, Migration ohne Datenverlust`

---

### Task 2: Forderungen aus Lexware-Rechnungen, Zuordnung auf Rechnungen im Datenmodell

**Files:**
- Modify: `src/domain/types.ts` (`Allocation`, `Payment`, `Contact`), `src/domain/ledger/status.ts`, `src/server/db/tables.ts:48-53`, `tests/unit/db-tables.test.ts`, `tests/unit/ledger/status.test.ts`
- Create: `src/domain/ledger/receivables.ts`, `tests/unit/ledger/receivables.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  interface AllocationBase { paymentId: string; amountCents: number; method: 'auto'|'confirmed'|'manual' }
  export type Allocation = (AllocationBase & { contractId: string; invoiceId?: undefined }) | (AllocationBase & { invoiceId: string; contractId?: undefined });
  // Payment + ignoredAt?: string   („Keine Mitgliedszahlung“, ISO-Zeitpunkt)
  // Contact + contactPersons?: string[]   (Lexware-Kontaktpersonen einer Firma)
  // ledger/status.ts
  export function trafficFor(arrearsCents: number, daysOverdue: number): 'green'|'yellow'|'red'; // memberStatus nutzt sie
  // ledger/receivables.ts
  export function coveringContract(s: AppState, inv: Invoice): string | null;
  export function invoiceOpenCents(s: AppState, inv: Invoice): number;
  export interface Receivable {
    key: string;                     // 'contract:<id>' | 'invoice:<id>'
    kind: 'contract' | 'invoice';
    id: string;                      // Vertrags- bzw. Rechnungs-ID
    name: string; contactId: string | null;
    label: string;                   // 'Mitgliedschaft' | Rechnungsnummer
    source: 'Vertrag' | 'Lexware';
    amountCents: number; dueDate: IsoDate; daysOverdue: number; traffic: 'green'|'yellow'|'red';
  }
  export function nexusReceivables(s: AppState, today: IsoDate): { items: Receivable[]; totalCents: number; overdueCents: number };
  ```
- Regeln:
  - `coveringContract`: Rechnung ist `lexware_nexus`, nicht `void`, Text ist Mitgliedschaft (`parseMembership(text) !== null`) **und** ein Vertrag hat `origin` mit `{ connectionId: 'lexware_nexus', externalId: inv.contactExternalId }` **oder** `inv.contactId` hat einen Vertrag. Ergebnis: dessen Vertrags-ID, sonst `null`.
  - `invoiceOpenCents`: `0`, wenn `status` `paid` oder `void` oder `coveringContract` gesetzt. Sonst `max(0, min(inv.openCents, inv.totalCents − Σ Zuordnungen mit invoiceId))`. (Das `min` verhindert Doppelminderung, wenn Lexware dieselbe Zahlung schon kennt.)
  - `nexusReceivables`: je Vertrag mit Quelle verbunden (`!notConnected(contractSources(c), …)`) und `arrearsCents > 0` ein Eintrag (`amountCents` = Rückstand, `dueDate` = `oldestUnpaidDue`, Ampel aus `memberStatus`). Je NEXUS-Rechnung mit `invoiceOpenCents > 0` ein Eintrag (auch noch nicht fällige; `daysOverdue = max(0, daysBetween(dueDate, today))`, `traffic = trafficFor(dueDate < today ? open : 0, daysOverdue)`). Name: Kontaktname, sonst `'Unbekannter Kontakt'`. Sortierung: `daysOverdue` absteigend, dann Betrag absteigend, dann Name. `totalCents` = Summe, `overdueCents` = Summe mit `dueDate < today`.
  - `tables.ts`: Zeilen-ID einer Zuordnung `${paymentId}:${contractId ?? `inv:${invoiceId}`}:${n}` (bestehende IDs bleiben gleich).

- [ ] **Step 1: Failing tests schreiben**

```ts
// tests/unit/ledger/receivables.test.ts  (TODAY = '2026-11-12')
const workshop = inv('i-ws', 14900, { company: 'nexus', connectionId: 'lexware_nexus', contactId: 'm-kaya', number: 'RE-1101', dueDate: '2026-09-26', status: 'overdue', text: 'Workshop' });
const member = (id: string) => inv(id, 30000, { company: 'nexus', connectionId: 'lexware_nexus', contactId: 'm-x', contactExternalId: 'c-77', number: id, text: 'NEXUS-Mitgliedschaft 6 Monate, Rate 1' });
test('Rechnung ohne Vertrag ist Forderung', () => expect(invoiceOpenCents(stateWith({ invoices: [workshop] }), workshop)).toBe(14900));
test('Mitgliedsrechnung mit Vertrags-origin zählt nicht doppelt', () => {
  const s = stateWith({ invoices: [member('RE-1043')], contracts: [{ ...base, id: 'k77', contactId: 'm-other', origin: [{ connectionId: 'lexware_nexus', externalId: 'c-77' }] }] });
  expect(coveringContract(s, member('RE-1043'))).toBe('k77');
  expect(invoiceOpenCents(s, member('RE-1043'))).toBe(0);
});
test('Lexware paid → erledigt, ohne Gutschrift für Verträge', () => {
  const s = stateWith({ invoices: [{ ...workshop, status: 'paid', openCents: 0 }] });
  expect(invoiceOpenCents(s, s.invoices[0])).toBe(0);
  expect(memberView(s, s.contracts[0].id, TODAY).status).toEqual(memberView(stateWith(), s.contracts[0].id, TODAY).status);
});
test('Zuordnung mindert die Rechnung', () => {
  const s = stateWith({ invoices: [workshop], payments: [tx({ id: 'p', amountCents: 10000 })], allocations: [{ paymentId: 'p', invoiceId: 'i-ws', amountCents: 10000, method: 'confirmed' }] });
  expect(invoiceOpenCents(s, workshop)).toBe(4900);
});
test('Review 2: zugeordnet und danach in Lexware bezahlt → 0, nie negativ', () => {
  const alloc = { paymentId: 'p', invoiceId: 'i-ws', amountCents: 14900, method: 'confirmed' as const };
  const paid = stateWith({ invoices: [{ ...workshop, status: 'paid', openCents: 0 }], payments: [tx({ id: 'p', amountCents: 14900 })], allocations: [alloc] });
  expect(invoiceOpenCents(paid, paid.invoices[0])).toBe(0);
  const partLex = stateWith({ invoices: [{ ...workshop, openCents: 4900 }], payments: [tx({ id: 'p', amountCents: 10000 })], allocations: [{ ...alloc, amountCents: 10000 }] });
  expect(invoiceOpenCents(partLex, partLex.invoices[0])).toBe(4900);
});
test('Übersicht: Verträge im Rückstand plus offene Rechnungen, nach Überfälligkeit sortiert, Summe', () => {
  const r = nexusReceivables(stateWith({ invoices: [workshop] }), TODAY);
  expect(r.items[0]).toMatchObject({ key: 'invoice:i-ws', label: 'RE-1101', source: 'Lexware', amountCents: 14900, daysOverdue: 47, traffic: 'red' });
  expect(r.totalCents).toBe(r.items.reduce((n, i) => n + i.amountCents, 0));
  expect(r.items.map((i) => i.daysOverdue)).toEqual([...r.items.map((i) => i.daysOverdue)].sort((a, b) => b - a));
});
test('Verträge ohne verbundene Quelle fehlen', () => expect(nexusReceivables(legacyNoBank, TODAY).items.some((i) => i.kind === 'contract')).toBe(false));
test('nicht fällige Rechnung: grün, nicht in overdueCents', () => {
  const r = nexusReceivables(stateWith({ contracts: [], invoices: [{ ...workshop, dueDate: '2026-12-01', status: 'open' }] }), TODAY);
  expect(r.items[0].traffic).toBe('green');
  expect(r.overdueCents).toBe(0);
});

// status.test.ts
test.each([[0, 0, 'green'], [100, 7, 'yellow'], [100, 8, 'red']])('trafficFor(%i, %i) = %s', (a, d, t) => expect(trafficFor(a, d)).toBe(t));
// db-tables.test.ts
test('Zuordnung auf Rechnung: eigene Zeilen-ID, Rundreise', () => {
  const s = stateWith({ allocations: [{ paymentId: 'p', invoiceId: 'i1', amountCents: 1, method: 'auto' }] });
  expect(toRows(s).allocations[0].id).toBe('p:inv:i1:0');
  expect(fromRows(toRows(s)).allocations).toEqual(s.allocations);
});
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/ledger tests/unit/db-tables.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren** wie in **Interfaces**. Bestehende Stellen, die `a.contractId` vergleichen (`detectors/members.ts`, Mitglieder-Seiten, `zuordnen/page.tsx`), kompilieren unverändert, weil `contractId` bei Rechnungs-Zuordnungen `undefined` ist.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: offene NEXUS-Rechnungen als Forderungen, Zuordnung auch auf Rechnungen`

---

### Task 3: Zuordnung gehärtet (IBAN, Firmen, Vielfache, Rechnungsnummer, Mehrdeutigkeit, Stripe eng)

**Files:**
- Modify: `src/domain/matching/payments.ts`, `src/domain/detectors/payments.ts`, `tests/unit/helpers.ts` (`expected`, `ctx`), `tests/unit/matching/payments.test.ts`, `tests/unit/import/proposals.test.ts` (Firmen-Zusätze in `normalizeName`)

**Interfaces:**
- Consumes: `invoiceOpenCents`, `coveringContract` (Task 2), `normalizeIban` (Task 1).
- Produces:
  ```ts
  // matching/payments.ts
  export function classifyBankTx(t: { payerName?: string; reference?: string; iban?: string }, memberIbans?: ReadonlySet<string>): 'incoming' | 'stripe_payout';
  export function normalizeName(s: string): string;                // + Firmen-Zusätze raus
  export function contactNameMatches(c: Contact, payerName: string): boolean; // Name oder eine contactPersons
  export function referenceHasNumber(reference: string, number: string): boolean;
  export interface ExpectedContract { contactId: string; rateCents: number; nextRateCents: number; arrearsCents: number; openCents: number }
  export type Expected = Map<string, ExpectedContract>;            // Schlüssel: Vertrags-ID (vorher Kontakt-ID)
  export function amountFitsContract(amountCents: number, e: ExpectedContract): boolean;
  export interface MatchInvoice { id: string; number: string; contactId: string | null; openCents: number; contractId: string | null } // contractId = coveringContract
  export interface MatchContext { contacts: Contact[]; ibanLinks: IbanLink[]; expected: Expected; invoices: MatchInvoice[] }
  export type MatchTarget = { kind: 'contract'; id: string; contactId: string } | { kind: 'invoice'; id: string; contactId: string | null };
  export type MatchResult = { target: MatchTarget | null; candidates: MatchTarget[]; confidence: 'high' | 'medium' | 'low'; reason: string };
  export function matchBankPayment(p: Payment, ctx: MatchContext): MatchResult;
  // detectors/payments.ts (ersetzt expectedAmounts)
  export function buildMatchContext(s: AppState, now: Date): MatchContext;
  ```
- Regeln:
  - `normalizeName`: zusätzlich vor dem Satzzeichen-Schritt `e.K.`/`e. K.` entfernen, danach die Wörter `gmbh, mbh, ug, haftungsbeschraenkt, gbr, kg, ohg, ag, co, und, ek` (und `&` fällt schon als Satzzeichen weg). Bleiben weniger als 1 Wort, gilt die Form ohne Entfernen.
  - `classifyBankTx`: `stripe_payout` nur, wenn `normalizeName(payerName)` mit `stripe` beginnt und alle Wörter in `{stripe, payments, technologies, europe, ltd, limited, uk, ie}` liegen **und** `normalizeIban(iban)` nicht in `memberIbans`. Ein „Stripe“ nur im Verwendungszweck reicht nie.
  - `referenceHasNumber`: Vergleich ohne Groß-/Kleinschreibung, Bindestrich/Leerzeichen in der Nummer optional, links kein Buchstabe/keine Ziffer, rechts keine Ziffer (`RE-110` passt nicht in `RE-1101`).
  - `amountFitsContract(a, e)`: `a > 0` und (`a === e.nextRateCents` oder `a === e.rateCents` oder (`e.rateCents > 0 && a % e.rateCents === 0 && a <= e.openCents`) oder (`e.arrearsCents > 0 && a === e.arrearsCents`) oder (`e.openCents > 0 && a === e.openCents`)).
  - `buildMatchContext`: `expected` je Vertrag aus `memberView` (`rateCents = installmentCents`, `nextRateCents` wie bisher, `openCents = status.openCents`); `invoices` = alle NEXUS-Lexware-Rechnungen, die nicht `paid`/`void` sind, mit `openCents = invoiceOpenCents` und `contractId = coveringContract`.
  - `matchBankPayment` (Reihenfolge, erster Treffer gewinnt):
    1. `kind === 'stripe_payout'` → `low`, `'Stripe-Auszahlung wird keinem Mitglied zugeordnet.'`
    2. `amountCents <= 0` → `low`, `'Betrag ≤ 0 wird nie gutgeschrieben.'`
    3. **Rechnungsnummer** im Verwendungszweck: Treffer = Rechnungen mit `referenceHasNumber`. Abgedeckte Rechnung → Ziel ist ihr Vertrag (Betrag nach `amountFitsContract`). Offene Rechnung → Betrag passt, wenn `=== openCents`. Genau ein Treffer mit passendem Betrag → `high` (`'Rechnungsnummer im Verwendungszweck, Betrag passt.'`). Treffer mit abweichendem Betrag → `medium`, `'Rechnungsnummer gefunden, Betrag weicht ab (Teilzahlung?).'`.
    4. **IBAN-Link** (`normalizeIban` auf beiden Seiten): Ziele des Kontakts = seine Verträge + seine offenen, nicht abgedeckten Rechnungen. Genau ein passendes → `high`. Mehrere passende → `medium`, Kandidaten = passende, `'Mehrere Verträge oder Rechnungen passen, bitte auswählen.'`. Keins passend → `medium`, Kandidaten = alle Ziele des Kontakts, `'Bestätigte IBAN, aber der Betrag weicht ab.'`.
    5. **Name** (`contactNameMatches`): passende Ziele über alle passenden Kontakte. Eins → `medium` (`'Name und Betrag passen, IBAN ist noch nicht verknüpft.'`), mehrere → `medium` mit Auswahl, keins → weiter.
    6. sonst `low`, `'Kein sicherer Treffer, bitte manuell zuordnen.'`, keine Kandidaten.
    `target` = `candidates[0]`, wenn es genau einen Kandidaten gibt, sonst `null`. `high` nur mit genau einem Kandidaten.

- [ ] **Step 1: Failing tests schreiben** (`tests/unit/helpers.ts`: `expected` neu als `Map<contractId, ExpectedContract>` für `k-kaya` (Kontakt `m-kaya`, Rate 30000, nächste 30000, Rückstand 15000, offen 90000) und `k-yilmaz` (Rückstand 0, offen 120000); `ctx = { contacts, ibanLinks, expected, invoices: [] }`)

```ts
const target = (r: MatchResult) => r.target && `${r.target.kind}:${r.target.id}`;
describe('IBAN', () => {
  test.each(['DE89370400440532013000', 'de89 3704 0044 0532 0130 00', 'DE89 3704 0044 0532 0130 00 '])('%s → hoch', (iban) =>
    expect(matchBankPayment(tx({ iban, amountCents: 30000 }), ctx)).toMatchObject({ confidence: 'high', target: { kind: 'contract', id: 'k-kaya' } }));
  test('Link mit Leerzeichen gespeichert', () =>
    expect(matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 30000 }), { ...ctx, ibanLinks: [{ ...ibanLinks[0], iban: 'DE89 3704 0044 0532 0130 00' }] }).confidence).toBe('high'));
  test('gleiche IBAN, anderer Betrag → Vorschlag', () => expect(matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 12345 }), ctx)).toMatchObject({ confidence: 'medium', target: { id: 'k-kaya' } }));
});
describe('Betrag', () => {
  test.each([[30000, true], [60000, true], [90000, true], [15000, true], [120000, false], [45000, false], [29999, false]])('%i passt: %s', (a, ok) =>
    expect(amountFitsContract(a, expected.get('k-kaya')!)).toBe(ok));
  test.each([0, -30000])('Betrag %i → nie gutgeschrieben', (a) =>
    expect(matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: a }), ctx)).toMatchObject({ confidence: 'low', candidates: [] }));
});
describe('Namen', () => {
  test.each([['Kaya Bau GmbH', 'KAYA BAU'], ['Öztürk & Söhne e.K.', 'Oeztuerk Soehne'], ['Celik und Partner GbR', 'Celik Partner']])('%s ≈ %s', (c, p) =>
    expect(nameMatches(c, p)).toBe(true));
  test('Firma passt auch zum Ansprechpartner', () =>
    expect(contactNameMatches({ ...contacts[0], name: 'Kaya Bau GmbH', contactPersons: ['Mehmet Kaya'] }, 'M. Kaya')).toBe(true));
});
describe('Mehrdeutig', () => {
  test('zwei Verträge passen über Name → Auswahl, nie automatisch', () => {
    const r = matchBankPayment(tx({ iban: 'DE00X', payerName: 'Mehmet Kaya', amountCents: 30000 }), { ...ctx, contacts: [...contacts, { ...contacts[0], id: 'm-kaya2' }],
      expected: new Map([...expected, ['k-kaya2', { ...expected.get('k-kaya')!, contactId: 'm-kaya2' }]]) });
    expect(r).toMatchObject({ confidence: 'medium', target: null });
    expect(r.candidates.map((c) => c.id).sort()).toEqual(['k-kaya', 'k-kaya2']);
  });
  test('IBAN-Kontakt mit Vertrag und gleich hoher Rechnung → Auswahl', () => {
    const r = matchBankPayment(tx({ iban: IBAN_KAYA, amountCents: 30000 }), { ...ctx, invoices: [{ id: 'i1', number: 'RE-9', contactId: 'm-kaya', openCents: 30000, contractId: null }] });
    expect(r).toMatchObject({ confidence: 'medium', target: null });
    expect(r.candidates).toHaveLength(2);
  });
});
describe('Rechnungsnummer', () => {
  const ws = { id: 'i-ws', number: 'RE-1101', contactId: 'm-sven', openCents: 14900, contractId: null };
  test('Nummer + Betrag → automatisch auf die Rechnung', () =>
    expect(target(matchBankPayment(tx({ iban: 'DE00X', payerName: 'S. Krüger', reference: 'Rechnung re 1101 Workshop', amountCents: 14900 }), { ...ctx, invoices: [ws] }))).toBe('invoice:i-ws'));
  test('Teilzahlung → nur Vorschlag', () =>
    expect(matchBankPayment(tx({ reference: 'RE-1101', amountCents: 10000 }), { ...ctx, invoices: [ws] })).toMatchObject({ confidence: 'medium', target: { id: 'i-ws' } }));
  test.each([['RE-110', false], ['RE-11012', false], ['xRE-1101', false], ['RE1101', true]])('Verwendungszweck %s passt: %s', (ref, ok) =>
    expect(referenceHasNumber(ref, 'RE-1101')).toBe(ok));
});
describe('Stripe-Auszahlung eng', () => {
  test.each([['Stripe Technologies Europe Ltd', '', 'stripe_payout'], ['STRIPE PAYMENTS UK LTD', 'STRIPE PAYOUT', 'stripe_payout'],
    ['Mehmet Kaya', 'Stripe-Rate November', 'incoming'], ['', 'STRIPE PAYOUT po_1', 'incoming']])('%s / %s → %s', (payerName, reference, kind) =>
    expect(classifyBankTx({ payerName, reference })).toBe(kind));
  test('Name „Stripe“ mit Mitglieds-IBAN → incoming', () =>
    expect(classifyBankTx({ payerName: 'Stripe', iban: 'de89 3704 0044 0532 0130 00' }, new Set([IBAN_KAYA]))).toBe('incoming'));
});
// buildMatchContext (detectors.test.ts)
test('buildMatchContext: Schlüssel Vertrags-ID, abgedeckte Rechnungen mit contractId', () => { /* stateWith + Mitgliedsrechnung mit origin → invoices[0].contractId gesetzt, openCents 0; Workshop → openCents 14900 */ });
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/matching tests/unit/import/proposals.test.ts tests/unit/detectors.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren** wie in **Interfaces**. `nameMatches` bleibt (nutzt das neue `normalizeName`), `contactNameMatches` ruft es für Name und `contactPersons`. Aufrufer in `engine.ts` und `zuordnen/page.tsx` nur so weit anpassen, dass `tsc` grün ist (`buildMatchContext` statt `expectedAmounts`; Zuordnen-Seite nimmt vorläufig `match.target` mit `kind === 'contract'`). Das Verhalten der Engine ändert Task 4, die Seite Task 9.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Zahlungszuordnung gehärtet (IBAN, Firmen, Vielfache, Rechnungsnummer, Mehrdeutigkeit, Stripe eng)`

---

### Task 4: Engine – automatisch auf Vertrag oder Rechnung, Bestätigen, „Keine Mitgliedszahlung“, Rückbuchungen

**Files:**
- Modify: `src/domain/events.ts`, `src/domain/matching/payments.ts` (`bankReturnAllocations`), `src/domain/detectors/payments.ts` (`detectUnmatchedPayments`), `src/data/engine.ts` (`autoAllocate`, `confirmPaymentMatch`, `simulateTransfer`, neuer Fall `dismissPayment`, `refresh`), `src/data/selectors.ts`, `src/server/state-service.ts` (`CLIENT_EVENTS`, `SHAPE`), `tests/unit/engine.test.ts`, `tests/unit/detectors.test.ts`, `tests/unit/selectors.test.ts`, `tests/unit/state-service.test.ts`, `tests/unit/ui-events.test.ts`

**Interfaces:**
- Consumes: `matchBankPayment`, `buildMatchContext`, `MatchTarget` (Task 3), `Allocation`, `Payment.ignoredAt` (Task 2).
- Produces:
  ```ts
  // events.ts
  | { type: 'confirmPaymentMatch'; paymentId: string; contractId?: string; invoiceId?: string } // genau eins von beiden
  | { type: 'dismissPayment'; paymentId: string }
  // matching/payments.ts
  export function bankReturnAllocations(s: AppState): Allocation[]; // Rückbuchung (amount < 0, refundOf) folgt dem Ziel der Originalzahlung
  // selectors.ts
  export const unallocatedBankPayments: (s: AppState) => Payment[];   // + ohne ignoredAt, nur amountCents > 0
  export function matchOptions(s: AppState): { value: string; label: string }[]; // 'contract:<id>' | 'invoice:<id>', sortiert nach Label
  ```
- Regeln:
  - `autoAllocate`: für `source 'bank'`, `kind 'incoming'`, `company 'nexus'`, ohne `ignoredAt`, ohne Zuordnung. Bei `confidence 'high'` eine Zuordnung auf `target` (Vertrag → `contractId`, Rechnung → `invoiceId`). Kontext nach jeder neuen Zuordnung neu bauen (Rückstand ändert sich). Audit `Automatisch zugeordnet: <Name>` bzw. `Automatisch zugeordnet: Rechnung <Nummer>`.
  - `refresh`: `allocateStripe` → `allocateBankReturns` (wie `allocateStripe`, Audit `Rückbuchung verrechnet: <Name>`) → `autoAllocate` → `allocateBankReturns` erneut → `settleCommitments`.
  - `bankReturnAllocations`: Zahlung `source 'bank'`, `amountCents < 0`, `refundOf` gesetzt, noch ohne Zuordnung. Original = Zahlung gleicher Verbindung mit `externalId === refundOf`. Hat das Original eine Zuordnung, entsteht dieselbe Zielart mit dem negativen Betrag, `method 'auto'`. Sonst nichts.
  - `confirmPaymentMatch(s, paymentId, target, at)`: Vertrag wie bisher. Rechnung: Rechnung muss NEXUS und offen sein. Die IBAN wird **normalisiert** mit dem Kontakt verknüpft (Vertrag: `contract.contactId`; Rechnung: `invoice.contactId`, ohne Kontakt kein Link). Text: `Zahlung über X Rechnung <Nummer> zugeordnet`. `ignoredAt` wird dabei entfernt.
  - `dismissPayment`: setzt `ignoredAt = at.toISOString()`, entfernt keine Zuordnung (es gibt keine), Audit (owner) `Buchung ausgeblendet: <Name> <Betrag>`. Zweiter Aufruf ändert nichts.
  - `simulateTransfer`: `iban` über `normalizeIban`, `kind` über `classifyBankTx({ payerName, iban }, Mitglieds-IBANs)`.
  - `detectUnmatchedPayments`: ohne `ignoredAt`, ohne `amountCents <= 0`; `needsSources: ['bank_qonto']` (aus Task 1).
  - `SHAPE.confirmPaymentMatch`: `isStr(paymentId)` und genau eins von `isStr(contractId)`, `isStr(invoiceId)`. `SHAPE.dismissPayment`: `isStr(paymentId)`. `dismissPayment` in `CLIENT_EVENTS`.
  - Aktion `confirm_payment_match` bleibt nur für Verträge (Payload unverändert).

- [ ] **Step 1: Failing tests schreiben**

```ts
// engine.test.ts
test('Rechnungsnummer + Betrag → automatisch auf die Rechnung, Forderung 0', () => {
  const s = refresh(stateWith({ invoices: [workshop], payments: [tx({ id: 'q1', iban: 'DE00X', reference: 'RE-1101', amountCents: 14900 })] }), NOW_0930);
  expect(s.allocations).toContainEqual({ paymentId: 'q1', invoiceId: 'i-ws', amountCents: 14900, method: 'auto' });
  expect(invoiceOpenCents(s, s.invoices.find((i) => i.id === 'i-ws')!)).toBe(0);
});
test('Bestätigen auf Rechnung lernt die IBAN normalisiert; zweite Zahlung derselben IBAN mit passendem Betrag → automatisch', () => {
  let s = stateWith({ invoices: [{ ...workshop, contactId: 'm-yilmaz', totalCents: 29800, openCents: 29800 }],
    payments: [tx({ id: 'q1', iban: 'de12 3456', payerName: 'Firma XY', amountCents: 14900 })] });
  s = reducer(s, { type: 'confirmPaymentMatch', paymentId: 'q1', invoiceId: 'i-ws' });
  expect(s.ibanLinks).toContainEqual(expect.objectContaining({ iban: 'DE123456', contactId: 'm-yilmaz' }));
  s = refresh({ ...s, payments: [...s.payments, tx({ id: 'q2', externalId: 'q2', iban: 'DE12 3456', amountCents: 14900 })] }, NOW_0930);
  expect(s.allocations.find((a) => a.paymentId === 'q2')).toMatchObject({ invoiceId: 'i-ws', method: 'auto' });
});
test('mehrdeutig → keine Auto-Zuordnung, Hinweis bleibt', () => { /* zwei Verträge desselben Kontakts mit gleicher Rate, IBAN-Link → allocations leer, unmatched-Hinweis offen */ });
test('Keine Mitgliedszahlung: ausgeblendet, kein Hinweis, keine Auto-Zuordnung, idempotent', () => {
  let s = refresh(stateWith({ payments: [tx({ id: 'q1', iban: 'DE00X', payerName: 'Fremd', amountCents: 5000 })] }), NOW_0930);
  expect(isOpen(s, 'unmatched:q1')).toBe(true);
  s = reducer(s, { type: 'dismissPayment', paymentId: 'q1' });
  expect(s.payments[0].ignoredAt).toBeDefined();
  expect(unallocatedBankPayments(s)).toHaveLength(0);
  expect(isOpen(s, 'unmatched:q1')).toBe(false);
  expect(reducer(s, { type: 'dismissPayment', paymentId: 'q1' }).payments).toEqual(s.payments);
});
test('Review 5: Rückbuchung vor Zuordnung → keine Gutschrift; nach Bestätigung folgt sie dem Ziel', () => {
  let s = refresh(stateWith({ payments: [tx({ id: 'q1', externalId: 't1', iban: 'DE00X', payerName: 'Selin Yilmaz', amountCents: 30000 }),
    tx({ id: 'q2', externalId: 't2', iban: 'DE00X', amountCents: -30000, refundOf: 't1' })] }), NOW_0930);
  expect(s.allocations.filter((a) => a.paymentId === 'q2')).toEqual([]);
  expect(isOpen(s, 'unmatched:q2')).toBe(false);
  s = reducer(s, { type: 'confirmPaymentMatch', paymentId: 'q1', contractId: contractOf(s, 'm-yilmaz') });
  expect(s.allocations.find((a) => a.paymentId === 'q2')).toMatchObject({ contractId: contractOf(s, 'm-yilmaz'), amountCents: -30000 });
});
test('Stripe-Auszahlung nie gutgeschrieben', () => { /* tx kind stripe_payout mit passendem Betrag und IBAN-Link → keine Zuordnung, kein Hinweis */ });
// state-service.test.ts
test.each([[{ paymentId: 'p', contractId: 'c' }, true], [{ paymentId: 'p', invoiceId: 'i' }, true], [{ paymentId: 'p', contractId: 'c', invoiceId: 'i' }, false], [{ paymentId: 'p' }, false]])(
  'confirmPaymentMatch %j erlaubt: %s', (e, ok) => expect(isClientEvent({ type: 'confirmPaymentMatch', ...e })).toBe(ok));
test('dismissPayment erlaubt', () => expect(isClientEvent({ type: 'dismissPayment', paymentId: 'p' })).toBe(true));
// selectors.test.ts
test('matchOptions: Verträge und offene Rechnungen', () => expect(matchOptions(stateWith({ invoices: [workshop] })).map((o) => o.value)).toContain('invoice:i-ws'));
```
(`reducer`, `isClientEvent`: die in den jeweiligen Testdateien schon genutzten Helfer; Namen vor dem Schreiben per Grep prüfen.)

- [ ] **Step 2: Run** `npx vitest run tests/unit/engine.test.ts tests/unit/detectors.test.ts tests/unit/selectors.test.ts tests/unit/state-service.test.ts tests/unit/ui-events.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren** wie in **Interfaces**. `matchOptions`-Label: Vertrag `<Name>`, Rechnung `Rechnung <Nummer> · <Name> · <formatEuro(open)>`.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün. Demo-Seed-Zahlen prüfen (`seed.test.ts`); ändern sich Hinweise, die Ursache im Test benennen, nicht den Test anpassen, ohne sie zu verstehen.
- [ ] **Step 5: Commit** `feat: Zuordnung auf Vertrag oder Rechnung, Buchung ausblenden, Rückbuchungen folgen dem Original`

---

### Task 5: Hinweis „N Rechnungen überfällig“ für NEXUS über den bestehenden Detektor

**Files:**
- Modify: `src/domain/detectors/invoices.ts` (`detectInvoiceOverdue`), `src/domain/detectors/refs.ts`, `tests/unit/detectors.test.ts`

**Interfaces:**
- Consumes: `invoiceOpenCents` (Task 2).
- Produces:
  ```ts
  // refs.ts
  export const receivableRef: (invoiceId: string, label: string) => Ref; // { kind: 'invoice', id, href: '/nexus/offen', label }
  ```
- Regeln:
  - Offen-Betrag überall über `invoiceOpenCents` (Zulassung: unverändert, weil dort nie abgedeckt).
  - Zulassung: wie bisher je Kontakt (`inv-over:<contactId>`).
  - NEXUS: **ein** Sammelhinweis, sobald ≥ 1 überfällige Rechnung (`invoiceOpenCents > 0`, `dueDate < today`): `dedupeKey: 'inv-over:nexus:<today>'`, `priority: 'today'`, Titel `` `${n} ${n === 1 ? 'Rechnung' : 'Rechnungen'} überfällig, zusammen ${formatEuro(sum)}` ``, Text `Älteste Fälligkeit … (… Tage überfällig).` wie bisher, `refs` = `receivableRef` je Rechnung, `nextStep: 'Offene Forderungen ansehen'`, `needsSources: ['lexware_nexus']`. Abgedeckte Mitgliedsrechnungen zählen nie.

- [ ] **Step 1: Failing tests schreiben**

```ts
test('NEXUS: ein Sammelhinweis mit Anzahl und Summe', () => {
  const r = detectInvoiceOverdue(stateWith({ invoices: [workshop, { ...workshop, id: 'i-2', number: 'RE-1102', openCents: 60000, totalCents: 60000, text: 'Event-Ticket' }] }), NOW_0930)
    .filter((i) => i.company === 'nexus');
  expect(r).toHaveLength(1);
  expect(r[0]).toMatchObject({ dedupeKey: 'inv-over:nexus:2026-11-12', title: '2 Rechnungen überfällig, zusammen 749,00 €', priority: 'today', needsSources: ['lexware_nexus'] });
  expect(r[0].refs.every((x) => x.href === '/nexus/offen')).toBe(true);
});
test('NEXUS: abgedeckte Mitgliedsrechnung und Lexware-bezahlte zählen nicht', () => { /* member('RE-1043') mit Vertrags-origin + workshop paid → kein NEXUS-Hinweis */ });
test('Zulassung unverändert je Kontakt', () => { /* bestehender Test 'invoice_overdue fasst pro Kontakt zusammen' bleibt grün */ });
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/detectors.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün (Seed: `i-lex-118` ist offen und nicht abgedeckt, falls ihr Text keine Mitgliedschaft nennt; dann erscheint der Sammelhinweis in der Demo. Das ist gewollt).
- [ ] **Step 5: Commit** `feat: Heute-Hinweis „N Rechnungen überfällig“ für NEXUS ohne Doppelzählung`

---

### Task 6: Qonto-Mapper, Lexware-Kontaktpersonen, Merge (Stripe-Auszahlung, Rückbuchungen)

**Files:**
- Create: `src/domain/import/qonto.ts`, `tests/fixtures/qonto/organization.json`, `tests/fixtures/qonto/transactions.json`, `tests/unit/import/qonto.test.ts`
- Modify: `src/domain/import/lexware.ts` (`mapLexwareContacts`), `src/domain/import/merge.ts`, `src/domain/matching/payments.ts` (`linkBankReturns`), `tests/fixtures/index.ts`, `tests/fixtures/lexware/contacts-nexus.json` (eine Firma mit Kontaktperson ergänzen, ohne bestehende IDs zu ändern), `tests/unit/import/lexware.test.ts`, `tests/unit/import/merge.test.ts`

**Interfaces:**
- Consumes: `classifyBankTx`, `normalizeIban` (Task 1/3), `ImportBatch`, `emptyBatch`, `IMPORT_SINCE`.
- Produces:
  ```ts
  // import/qonto.ts
  /** Feldnamen gegen https://api-doc.qonto.com prüfen (Session ohne Netz). Eine Stelle für Korrekturen. */
  export const QF = {
    list: 'transactions', id: 'transaction_id', amountCents: 'amount_cents', side: 'side', currency: 'currency',
    label: 'label', reference: 'reference', settledAt: 'settled_at', emittedAt: 'emitted_at', operationType: 'operation_type',
    counterpartyIban: ['income.counterparty_account_number', 'transfer.counterparty_account_number'], // erster nicht leerer Pfad
  } as const;
  export const QONTO_RETURN_TYPES: readonly string[]; // operation_type einer Rückbuchung, z. B. 'direct_debit_collection', 'recall' (gegen Doku prüfen)
  export function mapQonto(transactions: unknown[]): ImportBatch; // nur payments gefüllt
  // matching/payments.ts
  export function linkBankReturns(payments: Payment[], incoming: ImportedPayment[]): ImportedPayment[]; // Rückbuchungen mit refundOf oder verworfen
  // Lexware: ImportedContact + contactPersons?: string[]
  ```
- `mapQonto` je Buchung:
  - `currency !== 'EUR'` → übersprungen. `bookedOn = todayBerlin(new Date(settled_at ?? emitted_at))`; `bookedOn < IMPORT_SINCE` → übersprungen.
  - `side === 'credit'`: Payment `{ company: 'nexus', source: 'bank', connectionId: 'bank_qonto', externalId: transaction_id, amountCents: amount_cents, bookedOn, payerName: label, iban: normalizeIban(...) | undefined, reference, kind: classifyBankTx({ payerName, reference, iban }) }`.
  - `side === 'debit'` und `operation_type ∈ QONTO_RETURN_TYPES`: Payment mit `amountCents = −amount_cents`, `kind: 'incoming'`, ohne `refundOf` (setzt `mergeBatch`). Andere Ausgänge → übersprungen.
- `linkBankReturns`: für jede eingehende Zahlung mit `amountCents < 0` das Original suchen (bestehende plus neue Zahlungen, gleiche Verbindung, `amountCents > 0`, `amountCents === −x`, gleiche normalisierte IBAN, `bookedOn ≤`, jüngstes zuerst, noch von keiner anderen Rückbuchung belegt). Gefunden → `refundOf = original.externalId`. Nicht gefunden → verworfen (Spec: sonst ignoriert).
- `mergeBatch`:
  - Kontakte mit bekanntem `externalRef`: nur `contactPersons` aus dem Batch übernehmen, wenn sie sich unterscheiden (sonst unverändert wie bisher).
  - Zahlungen der Verbindung `bank_qonto`: erst `linkBankReturns`, dann `kind = classifyBankTx(p, Mitglieds-IBANs aus s.ibanLinks)` für neue Zahlungen. Bestehende Zahlungen gewinnen weiter (dadurch bleiben `ignoredAt` und alte Klassifizierung).
- `mapLexwareContacts`: bei Firmen `contactPersons` aus `company.contactPersons[].firstName/lastName` (Lexware-Feld gegen Doku prüfen), leere weglassen; bei Personen kein Feld.
- Fixture `transactions.json` (`{ "transactions": [...], "meta": { "current_page": 1, "next_page": null, "per_page": 100, "total_pages": 1 } }`):
  - `t-demir-1`: credit 30000, label „Murat Demir“, IBAN `DE44 5001 0517 5407 3249 31`, reference „Mitgliedschaft“, settled 2026-10-02
  - `t-demir-2`: credit 30000, gleiche IBAN ohne Leerzeichen, reference „Nexus“, settled 2026-11-02
  - `t-krueger-ws`: credit 14900, label „Sven Krüger“, reference „Rechnung RE-1101“, settled 2026-10-05
  - `t-stripe`: credit 148000, label „Stripe Technologies Europe Ltd“, reference „STRIPE PAYOUT po_1“
  - `t-kaya-ref`: credit 30000, label „Mehmet Kaya“, reference „Stripe Rate“
  - `t-out`: debit 5000 (Miete, `operation_type: 'transfer'`)
  - `t-return`: debit 30000, `operation_type` aus `QONTO_RETURN_TYPES`, IBAN wie `t-demir-1`, settled 2026-10-09
  - `t-usd`: credit 10000, currency „USD“
  - `t-july`: credit 30000, settled `2026-07-31T21:00:00Z` (Berlin noch 31.07.)
- `tests/fixtures/index.ts`: `export const qontoOrganization`, `qontoTransactions`, `qontoRoutes` (Pfad → JSON: `/v2/organization`, `/v2/transactions`), `qontoRoutesPaged` (Task 7).

- [ ] **Step 1: Failing tests schreiben**

```ts
// import/qonto.test.ts
const b = mapQonto(qontoTransactions.transactions);
const ext = (id: string) => b.payments.find((p) => p.externalId === id);
test('Eingang', () => expect(ext('t-demir-1')).toMatchObject({ connectionId: 'bank_qonto', source: 'bank', company: 'nexus', amountCents: 30000, bookedOn: '2026-10-02', payerName: 'Murat Demir', iban: 'DE44500105175407324931', reference: 'Mitgliedschaft', kind: 'incoming' }));
test('Ausgang wird nicht importiert', () => expect(ext('t-out')).toBeUndefined());
test('Stripe-Auszahlung erkannt', () => expect(ext('t-stripe')?.kind).toBe('stripe_payout'));
test('„Stripe“ im Verwendungszweck eines Mitglieds → kein Payout', () => expect(ext('t-kaya-ref')?.kind).toBe('incoming'));
test('Rückbuchung als negative Zahlung', () => expect(ext('t-return')?.amountCents).toBe(-30000));
test('Fremdwährung übersprungen', () => expect(ext('t-usd')).toBeUndefined());
test('vor dem 01.08. (Berlin) übersprungen', () => expect(ext('t-july')).toBeUndefined());
test('nur Zahlungen im Batch', () => expect([b.contacts, b.invoices, b.subscriptions, b.disputes].every((x) => x.length === 0)).toBe(true));
// merge.test.ts
test('Rückbuchung mit Original → refundOf; ohne Original → verworfen', () => {
  const s = mergeBatch(emptyState(), b, seq()).state;
  expect(s.payments.find((p) => p.externalId === 't-return')?.refundOf).toBe('t-demir-1');
  const alone = mergeBatch(emptyState(), { ...emptyBatch(), payments: b.payments.filter((p) => p.externalId === 't-return') }, seq()).state;
  expect(alone.payments).toHaveLength(0);
});
test('Review 3: erneuter Import hält ignoredAt und erzeugt nichts doppelt', () => {
  const s1 = mergeBatch(emptyState(), b, seq()).state;
  const hidden = { ...s1, payments: s1.payments.map((p) => (p.externalId === 't-demir-1' ? { ...p, ignoredAt: 'x' } : p)) };
  const s2 = mergeBatch(hidden, b, seq()).state;
  expect(s2.payments).toHaveLength(s1.payments.length);
  expect(s2.payments.find((p) => p.externalId === 't-demir-1')?.ignoredAt).toBe('x');
});
test('Name „Stripe“ mit Mitglieds-IBAN → incoming', () => { /* ibanLinks enthält die IBAN; Batch mit label 'Stripe' → kind incoming */ });
test('Kontaktpersonen werden bei bekanntem Kontakt nachgezogen', () => { /* erst ohne, dann mit contactPersons → Kontakt hat contactPersons, ID gleich */ });
// lexware.test.ts
test('Firma: Kontaktpersonen', () => expect(mapLexwareContacts(lexContacts('nexus'), 'lexware_nexus').find((c) => c.name === '<Firma aus Fixture>')?.contactPersons).toEqual(['<Vorname Nachname>']));
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/import`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.** Pfade aus `QF` über eine kleine Lesefunktion `pick(obj, 'a.b')` auflösen. Keine Netzaufrufe.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün (Lexware-Fixture-Erweiterung darf bestehende Vorschlags-Tests nicht ändern; sonst die neue Firma ohne Mitgliedsrechnung anlegen).
- [ ] **Step 5: Commit** `feat: Qonto-Mapper, Rückbuchungen verknüpfen, Lexware-Kontaktpersonen`

---

### Task 7: Qonto-Connector mit Konten, Blättern, Cursor, 429 und sicheren Fehlern

**Files:**
- Create: `src/server/connectors/qonto.ts`, `tests/unit/connectors/qonto.test.ts`
- Modify: `src/server/connectors/http.ts` (Option `authorization`), `src/server/env.ts`, `tests/unit/connectors/http.test.ts`, `tests/unit/env.test.ts`, `tests/fixtures/index.ts` (`qontoRoutesPaged`), `tests/fixtures/qonto/organization.json`

**Interfaces:**
- Consumes: `mapQonto` (Task 6), `createApiClient`, `PullContext`, `PullResult`, `BudgetExceeded`, `RateLimited`, `ConnectorError`.
- Produces:
  ```ts
  // http.ts: createApiClient-Option
  authorization?: string; // vollständiger Header-Wert; Standard weiter `Bearer ${key}`
  // qonto.ts
  export const QONTO_BASE = 'https://thirdparty.qonto.com/v2';
  export const QONTO_SINCE = '2026-07-31T22:00:00.000Z'; // IMPORT_SINCE, Berliner Mitternacht
  export const QONTO_OVERLAP_MS = 3 * 86_400_000;
  export function qontoTransactionsQuery(accountId: string, settledFrom: string, page: number): string;
  // feste Reihenfolge: bank_account_id, status[]=completed, settled_at_from, sort_by=settled_at:asc, per_page=100, current_page
  export function pullQonto(cursor: string | null, ctx: PullContext): Promise<PullResult>; // ctx.key = '<login>:<secret>'
  // env.ts: ServerEnv + qontoLogin?: string; qontoSecretKey?: string
  ```
- Cursor (JSON, nur der Connector kennt die Form): `{ settledFrom: string; account: number; page: number; maxSettled: string | null }`. Ablauf: `/organization` jeden Lauf (Konten: `organization.bank_accounts[]` mit `id`, `currency === 'EUR'`, `status !== 'closed'`, gegen Doku prüfen; Reihenfolge nach `id`). Je Konto ab `account`/`page` blättern bis `meta.next_page == null`. `maxSettled` = größtes gesehenes `settled_at`. Am Ende `complete: true`, `cursor = { settledFrom: max(QONTO_SINCE, maxSettled − OVERLAP), account: 0, page: 1, maxSettled: null }`. Budget erreicht oder `RateLimited` → bisheriger Batch, Cursor an der Stelle, `complete: false`. Ungültiger Cursor → Neustart ab `QONTO_SINCE`.
- Drossel `minIntervalMs: 500`, Label `'Qonto'`, `authorization: ctx.key`. Fehlertexte wie Lexware (`Qonto: HTTP 401 bei /v2/transactions (Schlüssel prüfen)`).

- [ ] **Step 1: Failing tests schreiben**

```ts
// http.test.ts
test('eigener Authorization-Wert ohne Bearer', async () => {
  const calls: Request[] = [];
  await createApiClient({ label: 'Qonto', baseUrl: QONTO_BASE, key: 'LOGIN:SECRET', authorization: 'LOGIN:SECRET', fetch: spyFetch(calls, {}), sleep: noSleep, now: clock(), minIntervalMs: 0 }).getJson('/organization');
  expect(calls[0].headers.get('authorization')).toBe('LOGIN:SECRET');
});
// qonto.test.ts
test('Header ohne Bearer, Konten, dann Buchungen ab QONTO_SINCE', async () => {
  const calls: string[] = [];
  const r = await pullQonto(null, ctx({ key: 'LOGIN:SECRET', fetch: fixtureFetch(qontoRoutes, { calls }) }));
  expect(calls[0]).toBe('/v2/organization');
  expect(calls[1]).toBe(`/v2/transactions?${qontoTransactionsQuery('acc-main', QONTO_SINCE, 1)}`);
  expect(r.complete).toBe(true);
  expect(r.batch.payments.map((p) => p.externalId)).toContain('t-demir-1');
});
test('blättert über next_page und alle EUR-Konten', async () => { /* qontoRoutesPaged: Konto acc-main Seite 1 (next_page 2) + Seite 2, Konto acc-2 Seite 1 → alle Buchungen */ });
test('nach complete: Cursor mit Überlappung von 3 Tagen', async () => {
  const r = await pullQonto(null, ctx());
  expect(JSON.parse(r.cursor!)).toMatchObject({ settledFrom: '2026-11-02T…' /* max settled_at − 3 Tage, exakt aus der Fixture rechnen */, account: 0, page: 1 });
});
test('Zeitbudget → Teilergebnis, Fortsetzung liefert den Rest ohne Lücke', async () => { /* wie Stripe-Test in 2b-1: erste Hälfte + zweite Hälfte = alle IDs */ });
test('429 dreimal → Teilergebnis statt Fehler', async () => { /* status { '/v2/transactions': 429 } → complete false, kein throw */ });
test('401 → ConnectorError ohne Schlüssel', async () => {
  const err = await pullQonto(null, ctx({ key: 'LOGIN:SECRET', fetch: fixtureFetch(qontoRoutes, { status: { '/v2/organization': 401 } }) })).catch((e) => e);
  expect(err.message).toBe('Qonto: HTTP 401 bei /v2/organization (Schlüssel prüfen)');
  expect(err.message).not.toContain('SECRET');
});
// env.test.ts
test('Qonto-Schlüssel optional', () => expect(readEnv(BASE).qontoLogin).toBeUndefined());
test('Qonto-Schlüssel gelesen', () => expect(readEnv({ ...BASE, QONTO_LOGIN: 'l', QONTO_SECRET_KEY: 's' })).toMatchObject({ qontoLogin: 'l', qontoSecretKey: 's' }));
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/connectors tests/unit/env.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren** (`import 'server-only'`). `fixture-fetch.ts` bleibt unverändert.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Qonto-Connector mit Konten, Blättern und fortsetzbarem Cursor`

---

### Task 8: Sync, „Jetzt abgleichen“ und Test-Import mit Qonto

**Files:**
- Modify: `src/server/sync.ts`, `src/server/registry.ts:42-52`, `src/app/api/sync/route.ts:20-23`, `src/app/api/test/import/route.ts`, `.env.example`, `tests/unit/sync.test.ts`, `tests/unit/api-sync.test.ts`

**Interfaces:**
- Consumes: `pullQonto` (Task 7), `qontoRoutes` (Task 6).
- Produces:
  ```ts
  export type SyncId = 'stripe_nexus' | 'lexware_nexus' | 'bank_qonto' | 'lexware_zulassung'; // ORDER in dieser Reihenfolge (Rechnungen vor Zahlungen)
  export function syncSecrets(keys: ConnectorKeys): string[]; // jeder Schlüssel und jeder Teil von 'login:secret' mit ≥ 8 Zeichen
  ```
- `registry.getSyncDeps`: `bank_qonto: env.qontoLogin && env.qontoSecretKey ? `${env.qontoLogin}:${env.qontoSecretKey}` : undefined`.
- `syncConnections` und `api/sync/route.ts` nutzen `syncSecrets` für `sanitizeError`.
- Test-Route: `keys` + `bank_qonto: 'test:test'`.
- `.env.example`: `# Paket 2b-2 (optional, nur Production): Qonto-API, nur lesend` mit `QONTO_LOGIN=` und `QONTO_SECRET_KEY=`.

- [ ] **Step 1: Failing tests schreiben**

```ts
// sync.test.ts
test('Qonto ohne Schlüssel → skipped, Verbindung bleibt missing', async () => {
  const r = await syncConnections(repos, deps({ keys: { stripe_nexus: 'SK' } }));
  expect(r.bank_qonto).toBe('skipped');
});
test('Qonto-Import: Zahlungen da, Verbindung verbunden, Stripe-Auszahlung nicht zugeordnet', async () => {
  await syncConnections(repos, deps({ keys: { lexware_nexus: 'LK', bank_qonto: 'LOGIN:SECRETSECRET' }, fetch: fixtureFetch({ ...lexwareRoutes, ...qontoRoutes }) }));
  const s = (await repos.state.load()).state;
  expect(s.connections.find((c) => c.id === 'bank_qonto')?.status).toBe('connected');
  expect(s.payments.filter((p) => p.connectionId === 'bank_qonto').length).toBeGreaterThan(0);
  expect(s.allocations.some((a) => s.payments.find((p) => p.id === a.paymentId)?.kind === 'stripe_payout')).toBe(false);
});
test('Review 1: zweimal syncen → gleiche Zahlungen und Zuordnungen', async () => {
  const d = deps({ keys: { lexware_nexus: 'LK', bank_qonto: 'LOGIN:SECRETSECRET' }, fetch: fixtureFetch({ ...lexwareRoutes, ...qontoRoutes }) });
  await syncConnections(repos, d);
  const a = (await repos.state.load()).state;
  await syncConnections(repos, d);
  const b = (await repos.state.load()).state;
  expect(b.payments.map((p) => p.externalId).sort()).toEqual(a.payments.map((p) => p.externalId).sort());
  expect(b.allocations).toEqual(a.allocations);
});
test('Fehlertext enthält weder Login noch Secret', async () => {
  await syncConnections(repos, deps({ keys: { bank_qonto: 'LOGIN123:SECRETSECRET' }, fetch: fixtureFetch(qontoRoutes, { status: { '/v2/organization': 401 } }) }));
  const c = (await repos.state.load()).state.connections.find((x) => x.id === 'bank_qonto')!;
  expect(c.lastError).toBe('Qonto: HTTP 401 bei /v2/organization (Schlüssel prüfen)');
});
test('syncSecrets zerlegt login:secret', () => expect(syncSecrets({ bank_qonto: 'LOGIN123:SECRETSECRET' })).toEqual(expect.arrayContaining(['LOGIN123:SECRETSECRET', 'LOGIN123', 'SECRETSECRET'])));
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/sync.test.ts tests/unit/api-sync.test.ts`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.** In `syncConnections` ist `bank_qonto` der dritte Fall (`pullQonto(cursor, ctx)`); `known` bleibt für Qonto leer.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Qonto im Abgleich, Schlüssel aus QONTO_LOGIN und QONTO_SECRET_KEY`

---

### Task 9: Oberfläche „Zuordnen“ – Ja-Vorschlag, Auswahl, „Keine Mitgliedszahlung“

**Files:**
- Modify: `src/app/nexus/zuordnen/page.tsx`, `tests/e2e/nexus.spec.ts`

**Interfaces:**
- Consumes: `buildMatchContext`, `matchBankPayment`, `MatchResult`, `MatchTarget` (Task 3), `matchOptions`, `unallocatedBankPayments` (Task 4), Ereignisse `confirmPaymentMatch` (mit `contractId` oder `invoiceId`) und `dismissPayment` (Task 4).
- `PaymentCard`:
  - Ein Ziel (`match.target`): Text `Vorschlag: <Name>` (Vertrag) bzw. `Vorschlag: Rechnung <Nummer> · <Name>`, Chip Konfidenz, Grund. Primärknopf **„Ja, gehört zu <Name>“** (bei Rechnung „Ja, gehört zu Rechnung <Nummer>“).
  - Mehrere Kandidaten: `select` nur mit den Kandidaten (Label aus `matchOptions`), Knopf „Zuordnen“.
  - Kein Kandidat: `select` mit allen `matchOptions`, Knopf „Zuordnen“.
  - Immer: Sekundärknopf **„Keine Mitgliedszahlung“** → `dismissPayment`. `aria-label` jeweils mit Zahlername, wie bisher.
  - `data-testid` bleibt `match-<paymentId>`.
- Gruppenüberschrift „Offene Zahlungen“ bleibt; Leerzustand bleibt. Kein Rechnen in der Komponente (Labels kommen aus `matchOptions`, Beträge über `formatEuro`).

- [ ] **Step 1: Failing E2E schreiben** (`tests/e2e/nexus.spec.ts`, Demo-Daten)

```ts
test('Zuordnen: „Ja, gehört zu …“ ordnet zu und lernt die IBAN', async ({ page }) => {
  await page.goto('/nexus/zuordnen?reset=1');
  const card = page.getByTestId('match-p-yilmaz-1');
  await card.getByRole('button', { name: /Ja, gehört zu/ }).click();
  await expect(card).toHaveCount(0);
});
test('Zuordnen: „Keine Mitgliedszahlung“ blendet aus und bleibt nach Neuladen weg', async ({ page }) => {
  await page.goto('/nexus/zuordnen?reset=1');
  const first = page.locator('[data-testid^="match-"]').first();
  const id = await first.getAttribute('data-testid');
  await first.getByRole('button', { name: 'Keine Mitgliedszahlung' }).click();
  await page.reload();
  await expect(page.getByTestId(id!)).toHaveCount(0);
});
```
(Vorher prüfen, welche Seed-Zahlung einen Einzelvorschlag hat; `p-yilmaz-1` ist der Kandidat aus `seed.ts:92`.)

- [ ] **Step 2: Run** `fuser -k 3100/tcp; npm run e2e -- nexus.spec.ts 2>&1 | tail -15`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren** wie in **Interfaces**.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `fuser -k 3100/tcp; npm run e2e -- nexus.spec.ts 2>&1 | tail -15`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Zuordnen mit „Ja, gehört zu …“, Auswahl bei Mehrdeutigkeit und „Keine Mitgliedszahlung“`

---

### Task 10: Oberfläche „NEXUS → Offen“ und Einstieg auf der NEXUS-Seite

**Files:**
- Create: `src/app/nexus/offen/page.tsx`
- Modify: `src/app/nexus/page.tsx`, `tests/e2e/nexus.spec.ts`

**Interfaces:**
- Consumes: `nexusReceivables`, `Receivable` (Task 2), `areaStale`, `MONEY_SOURCES` (Task 1).
- Seite `/nexus/offen`:
  - `PageHeader` „Offen“, Untertitel „Alle offenen Forderungen“, `BackLink` „NEXUS“.
  - Oben Summe: `ListRow` mit `testId="receivables-total"`, Titel „Summe offen“, Wert `formatEuro(totalCents)`, Untertitel `davon überfällig <formatEuro(overdueCents)>`.
  - Liste (`ListGroup` „Forderungen“): je Eintrag `ListRow` mit `testId={`receivable-${key}`}`, `leading={<TrafficDot traffic=… />}`, Titel Name, Untertitel `` `${source} · ${label} · ${daysOverdue > 0 ? `fällig seit ${formatIsoDe(dueDate)}` : `fällig am ${formatIsoDe(dueDate)}`}` ``, Wert Betrag. Vertrag verlinkt auf `/nexus/mitglieder/<id>`, Rechnung ohne Link.
  - Leer: „Nichts offen.“ Ist `areaStale([...MONEY_SOURCES.nexus, 'lexware_nexus'], …)` nicht leer, stattdessen bzw. zusätzlich `note-card` „Datenstand zu alt, um das zu beurteilen.“ (Regel 4a: nie „Nichts offen“ bei veralteten Daten).
- NEXUS-Seite: in „Monatsvorschau“ zusätzlich `ListRow` `href="/nexus/offen"`, `testId="open-link"`, Titel `` `Offen (${formatEuro(totalCents)})` ``.

- [ ] **Step 1: Failing E2E schreiben**

```ts
test('NEXUS → Offen: Summe oben, sortiert nach Überfälligkeit', async ({ page }) => {
  await page.goto('/nexus?reset=1');
  await page.getByTestId('open-link').click();
  await expect(page).toHaveURL(/\/nexus\/offen$/);
  await expect(page.getByTestId('receivables-total')).toContainText('Summe offen');
  await expect(page.locator('[data-testid^="receivable-"]').first()).toBeVisible();
});
```

- [ ] **Step 2: Run** `fuser -k 3100/tcp; npm run e2e -- nexus.spec.ts 2>&1 | tail -15`. Erwartet: FAIL.
- [ ] **Step 3: Implementieren.**
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `fuser -k 3100/tcp; npm run e2e -- nexus.spec.ts 2>&1 | tail -15`. Erwartet: grün.
- [ ] **Step 5: Commit** `feat: Übersicht NEXUS → Offen mit allen offenen Forderungen`

---

### Task 11: E2E im Echtmodus und Einrichtungsanleitung

**Files:**
- Modify: `tests/e2e/auth.spec.ts`, `docs/PROJEKT-STAND.md` (Tabelle: Zeilen für Plan und Setup 2b-2)
- Create: `docs/setup-phase2b2.md`

**Interfaces:**
- Consumes: `qontoRoutes` (Task 6), Test-Route mit `bank_qonto` (Task 8), Seiten aus Task 9/10.
- Neuer Test **nach** „Verwerfen bleibt verworfen, Lexware-Vertrag zeigt ‚Bank nicht verbunden‘“ und **vor** „Jetzt abgleichen“ (seriell, Memory-DB; der Vertrag Murat Demir aus `c-77` ist dann bestätigt):

```ts
test('Echtmodus: Qonto-Import → Vorschlag → Ja → zweite Zahlung derselben IBAN automatisch; Offen ohne Doppelzählung', async () => {
  const r = await page.request.post('/api/test/import', { data: { routes: { ...stripeRoutes, ...lexwareRoutes, ...qontoRoutes } } });
  expect(r.ok()).toBe(true);
  await page.goto('/verbindungen');
  await expect(page.getByTestId('setup-bank_qonto')).toContainText(/Verbunden · Stand vor \d+ Min/);
  await expect(page.getByTestId('conn-bank_sparkasse')).toContainText('Kommt als Upload');
  await page.goto('/nexus/zuordnen');
  const cards = page.locator('[data-testid^="match-"]', { hasText: 'Murat Demir' });
  await expect(cards).toHaveCount(2);                                  // beide nur Name + Betrag → Vorschlag
  await expect(page.locator('[data-testid^="match-"]', { hasText: 'Stripe Technologies' })).toHaveCount(0);
  await cards.first().getByRole('button', { name: /Ja, gehört zu Murat Demir/ }).click();
  await expect(cards).toHaveCount(0);                                  // zweite Zahlung über die gelernte IBAN automatisch
  await page.goto('/nexus');
  await expect(page.getByText('Überweisung · Bank nicht verbunden')).toHaveCount(0);
  await page.getByTestId('open-link').click();
  await expect(page.locator('[data-testid^="receivable-"]', { hasText: 'RE-1101' })).toHaveCount(0); // per Rechnungsnummer bezahlt
  await expect(page.locator('[data-testid^="receivable-"]', { hasText: 'RE-1043' })).toHaveCount(0); // vom Vertrag abgedeckt
  await expect(page.locator('[data-testid^="receivable-"]', { hasText: 'RE-1102' })).toHaveCount(1); // ohne Vertrag offen
});
```
(Die Rechnungs-ID für RE-1101 ist im Echtmodus eine erzeugte ID; deshalb über `hasText: 'RE-1101'` und `toHaveCount(0)` prüfen.)

`docs/setup-phase2b2.md` (kurz, Deutsch, Inhaber-Checkliste, keine echten Werte):
1. Qonto: Web-App → Einstellungen → „Integrationen & Partner“ → „API-Schlüssel“: Login und Secret Key kopieren (nur Lesen; in den Passwort-Manager). Menüpfad beim Bau gegen die Qonto-Hilfe prüfen.
2. Vercel → Settings → Environment Variables, nur **Production**: `QONTO_LOGIN`, `QONTO_SECRET_KEY`. Danach Redeploy.
3. Supabase → SQL Editor → Inhalt von `supabase/migrations/20261114000000_qonto.sql` → „Run“ (benennt die Verbindung `bank` in `bank_qonto` um; ohne Datenverlust, beliebig oft ausführbar).
4. Prüfen: Verbindungen zeigt „Qonto (NEXUS)“ verbunden und „Sparkasse (Zulassung)“ mit „Kommt als Upload“. NEXUS → Zuordnen zeigt Eingänge ohne sicheren Treffer; je Mitglied einmal „Ja, gehört zu …“, danach geht es automatisch. NEXUS → Offen zeigt alle offenen Forderungen. Stripe-Auszahlungen erscheinen nirgends als Mitgliedszahlung.
5. Fehlerfall wie 2b-1: Daten bleiben stehen, nach drei Fehlern ein Hinweis; der Grund steht ohne Schlüssel bei der Verbindung.

- [ ] **Step 1: Test schreiben** wie oben.
- [ ] **Step 2: Run** `fuser -k 3100/tcp; npm run e2e -- auth.spec.ts 2>&1 | tail -15`. Erwartet: zunächst FAIL nur, falls ein vorheriger Task Lücken hat; sonst direkt grün (dann prüfen, dass der Test wirklich die Qonto-Zahlungen sieht, z. B. kurz `toHaveCount(3)` erzwingen und zurücknehmen).
- [ ] **Step 3: Doku schreiben**, `PROJEKT-STAND.md`-Tabelle ergänzen (`docs/setup-phase2b2.md`, dieser Plan).
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `fuser -k 3100/tcp; npm run e2e 2>&1 | tail -15`. Erwartet: alles grün.
- [ ] **Step 5: Commit** `test: Qonto-Ablauf im Echtmodus; docs: Einrichtung Paket 2b-2`

---

## Self-Review (erledigt)

- **Spec-Abdeckung:** Abruf 15 Min./„Jetzt abgleichen“ (Task 8, Cron unverändert über `syncConnections`), nur Eingänge/Rückbuchung/Fremdwährung (6), Stripe-Auszahlung eng (3, 6), Verbindungen + Migration (1), Schlüssel (7, 8, 11), 4a Forderungen/kein Doppelzählen/`paid`/Zuordnung auf Rechnung/Rechnungsnummer/Teilzahlung/Übersicht/Heute (2, 3, 4, 5, 10), Härtung IBAN/≤ 0/Firmen/Kontaktperson/Vielfache/Mehrdeutig/Lernen (3, 4, 6), Zuordnen-UI inkl. „Keine Mitgliedszahlung“ (9), Mitglieder zeigen echte Rückstände (1 `contractSources`, E2E 11), Tests aus Spec 7 (6, 7, 3, 1, 11). Nicht enthalten, weil Nicht-Ziel: Sparkasse-Upload, Portal, Rechnungstexte lesen, Telefon/E-Mail-Backlog.
- **Typen:** `MatchTarget`, `MatchContext`, `Expected` (Vertrags-ID), `Allocation`-Union, `confirmPaymentMatch` mit `contractId?`/`invoiceId?`, `dismissPayment`, `Payment.ignoredAt`, `Contact.contactPersons`, `SyncId` mit `bank_qonto` sind in genau einem Task definiert und später nur konsumiert.
- **Bewusste Festlegungen über die Spec hinaus:** Offen einer Rechnung = `min(Lexware-Offen, Gesamt − eigene Zuordnungen)`; NEXUS-Sammelhinweis ersetzt die NEXUS-Einzelhinweise je Kontakt; die NEXUS-Geldkarte (Briefing) bleibt mitgliederbasiert, die Rechnungs-Summe steht auf „Offen“.
