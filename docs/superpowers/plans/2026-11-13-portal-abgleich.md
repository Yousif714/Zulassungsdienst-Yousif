# Nexus-Assistent Portal-Abgleich (Mitgliederliste einfügen) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Inhaber fügt die Mitgliederliste des NEXUS-Portals in der App ein (kopierter Text oder CSV). Unter NEXUS → Portal-Mitglieder sieht er dann jedes Mitglied mit Status: Vertrag / Vorschlag offen / Rechnung ohne Mitgliedschaft / keine Rechnung. Für Mitglieder ohne Rechnung kann er einen Vertrag anlegen oder sie als „kein zahlendes Mitglied“ ausblenden.

**Architecture:**
- Der reine Parser `parsePortalList` (`src/domain/import/portal-list.ts`) erkennt E-Mails und Namen in Freitext oder CSV und liefert eine Vorschau.
- „Übernehmen“ schickt das Client-Event `importPortalList` mit den erkannten Einträgen. Die Engine normalisiert sie erneut und führt sie per E-Mail in `portalMembers` zusammen. Wer fehlt, wird nur als „nicht mehr in Liste“ markiert. Die Verbindung `portal_nexus` wird dabei „verbunden“.
- Zuordnung zum Kontakt und Status werden rein abgeleitet (`src/domain/portal.ts`) und nie gespeichert.
- „Vertrag anlegen“ nutzt die `ProposalCard` mit einem aus dem Mitglied gebauten `ContractProposal` und das Event `createPortalContract`.
- Frische: Für `portal_nexus` gilt eine Ausnahme von 30 Tagen statt 45 Minuten.

**Tech Stack:** Next.js 16 (App Router, Client-Seiten), TypeScript, Supabase (SQL-Migration), Vitest, Playwright. Keine neuen npm-Abhängigkeiten, keine neuen Umgebungsvariablen.

**Spec:** `docs/superpowers/specs/2026-11-13-portal-abgleich-design.md` (Weg B). Basis-Regeln: `docs/superpowers/specs/2026-11-12-nexus-assistent-design.md`, Abschnitt 4a.

## Global Constraints

- `src/domain/` bleibt rein (prüft `tests/unit/architecture.test.ts`): kein `fetch`, kein React, keine Importe aus `src/data`, `src/app`, `src/components`, `src/server`. Zeit kommt als Parameter (`at`). Kalendertage über `src/domain/clock.ts`.
- Geld nur in Cent und nur in Domain-Funktionen. Komponenten rechnen nicht.
- Neue Verbindung `portal_nexus`, company `nexus`, Label „NEXUS-Portal“. Sie wird nicht in `syncConnections` aufgenommen und hat keinen Connector und keine Vercel-Variable.
- `externalId` eines Portal-Mitglieds ist die E-Mail, getrimmt und kleingeschrieben.
- Zuordnung Portal → Kontakt in dieser Reihenfolge:
  1. Kontakt mit `externalRefs` `portal_nexus:<email>`
  2. sonst **alle** Kontakte der Firma nexus mit exakt gleicher E-Mail (Kleinschreibung)
  3. sonst nur ein Namensvorschlag (`normalizeNameStrict`), nie automatisch verknüpft
- Status-Vorrang: `contract` > `ignored` > `proposal` > `invoice_only` > `no_invoice`.
- Ein Import löscht nie. Fehlende Mitglieder behalten ihr `lastSeenInListAt` und gelten als „nicht mehr in Liste“. Eine leere Liste wird abgelehnt.
- Neue Verträge aus dem Portal: `billing: 'legacy'`, `origin: [{ connectionId: 'portal_nexus', externalId }]`, Prüfung mit `validateContractDraft`.
- Sammelhinweis: Key `portal-no-invoice`, ohne Datum. Er zählt nur Mitglieder der aktuellen Liste.
- UI-Texte auf Deutsch, Bausteine aus `src/components` (`PageHeader`, `BackLink`, `ListGroup`, `ListRow`, `Segmented`, `TrafficDot`, `ProposalCard`). aria-labels enthalten den sichtbaren Text. Vor der neuen Seite `node_modules/next/dist/docs/01-app/` zu Client-Seiten überfliegen.
- Vor jedem Commit diese drei Befehle, bei UI-Änderungen zusätzlich die betroffene E2E-Spec:
  - `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`
  - `npx tsc --noEmit`
  - `npx eslint <geänderte Pfade>`
  - E2E: `fuser -k 3100/tcp; npm run e2e -- <spec> 2>&1 | tail -15`
- Branch `claude/cool-hopper-hcnb9d`. Commit-Nachrichten auf Deutsch (`feat:`/`fix:`/`docs:`). Pushen macht der Controller.

## Review Focus

1. **Kopierte Admin-Seite mit Füllzeilen** (Überschrift, Tabellenkopf, „Bearbeiten“, Datumsspalten): Das Datum landet nicht im Namen, der Kopf nicht als Mitglied. Füllzeilen stehen nur unter „ohne E-Mail“. Test in Task 3 (`kopierte Admin-Seite`).
2. **Zweite, kürzere Liste** (z. B. nur eine Seite kopiert): Niemand verschwindet. Fehlende sind als „nicht mehr in Liste“ markiert und zählen nicht im Hinweis. Ein schon angelegter Vertrag bleibt. Tests in Task 4 und Task 7.
3. **Zwei Kontakte derselben Person** (Stripe- und Lexware-Kontakt mit gleicher E-Mail), Vertrag hängt am zweiten: Status ist „Vertrag“. Test in Task 5.
4. **CSV aus Excel in Windows-1252 mit Umlauten und BOM:** Die Namen kommen korrekt an (`Öztürk`). Test in Task 3 (`decodeListFile`).
5. **Manipuliertes oder übergroßes Event `importPortalList`** (ungültige E-Mail, 10 000 Einträge, fehlende Felder): Der Server lehnt es ab, nichts wird gespeichert. Test in Task 4 (`isClientEvent`).

---

## Dateistruktur

```
src/domain/
  types.ts                 ConnectionId +'portal_nexus'; PortalMember; AppState.portalMembers/ignoredPortalMembers; InsightType +'portal_no_invoice'
  connections.ts           Katalog + HOW_TO portal_nexus
  freshness.ts             staleAfterMinutes(id) (Ausnahme portal_nexus 30 Tage)
  detectors/sources.ts     Text mit der Grenze der Verbindung
  import/portal-list.ts    parsePortalList, normalizePortalEntries, decodeListFile, mergePortalList (neu)
  import/proposals.ts      sourceLabel +'Portal'
  portal.ts                linkPortalMember, portalViews, portalSummary, portalProposal (neu)
  detectors/portal.ts      detectPortalNoInvoice (neu); detectors/index.ts, detectors/refs.ts (portalRef)
  events.ts                importPortalList, createPortalContract, ignorePortalMember
src/data/
  empty-state.ts, seed.ts  portalMembers: [], ignoredPortalMembers: []
  engine.ts                importPortalList, createPortalContract, ignorePortalMember, Helfer attachContact
  selectors.ts             portalRows
src/server/
  db/tables.ts, state-service.ts
src/components/
  connection-labels.ts     ageText (Minuten bzw. Datum)
  ProposalCard.tsx         dismissLabel
src/app/
  verbindungen/page.tsx    ageText statt „Stand vor N Min.“
  nexus/mitglieder/page.tsx (neu), nexus/page.tsx (Link)
supabase/migrations/20261115000000_portal.sql
tests/fixtures/portal.ts, tests/fixtures/index.ts
tests/unit/import/portal-list.test.ts, import/portal-import.test.ts, portal.test.ts, import/portal-contract.test.ts (+ bestehende)
tests/e2e/auth.spec.ts, assistant.spec.ts
docs/setup-portal.md
```

---

### Task 1: Verbindung `portal_nexus`, State-Listen und Persistenz

**Files:**
- Modify: `src/domain/types.ts`, `src/domain/connections.ts`, `src/data/empty-state.ts`, `src/data/seed.ts` (AppState-Literal ~Zeile 239), `src/server/db/tables.ts`
- Create: `supabase/migrations/20261115000000_portal.sql`
- Test: `tests/unit/empty-state.test.ts`, `tests/unit/db-tables.test.ts`, `tests/unit/migration.test.ts`, `tests/unit/migrate.test.ts`, `tests/e2e/auth.spec.ts:42-46`, `tests/e2e/assistant.spec.ts:90`

**Interfaces:**
- Produces:
  - `ConnectionId` += `'portal_nexus'`
  - `interface PortalMember { id: string; connectionId: 'portal_nexus'; externalId: string; email: string; name: string; firstSeenAt: string; lastSeenInListAt: string }`
  - `AppState.portalMembers: PortalMember[]`, `AppState.ignoredPortalMembers: string[]` (externalIds)
  - `TABLES.portalMembers = 'portal_members'` (in `WITH_EXTERNAL_TABLES`), `TABLES.ignoredPortalMembers = 'ignored_portal_members'`
  - Katalog-Eintrag `{ id: 'portal_nexus', company: 'nexus', label: 'NEXUS-Portal' }` und HOW_TO: `'Mitgliederliste auf portal.nexusnetzwerk.de/mitglieder kopieren (oder als CSV speichern) und unter NEXUS → Portal-Mitglieder → „Mitgliederliste einfügen“ übernehmen.'`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/empty-state.test.ts – bestehende Zählung anpassen
expect(e.connections.length).toBe(12);
expect(e.connections.find((c) => c.id === 'portal_nexus')).toMatchObject({ company: 'nexus', label: 'NEXUS-Portal', status: 'missing' });
expect(e.portalMembers).toEqual([]);
expect(e.ignoredPortalMembers).toEqual([]);

// tests/unit/db-tables.test.ts
test('Portal-Mitglieder und Ausgeblendete überstehen toRows/fromRows', () => {
  const m: PortalMember = { id: 'pm1', connectionId: 'portal_nexus', externalId: 'a@b.de', email: 'a@b.de', name: 'A', firstSeenAt: '2026-11-12T08:30:00.000Z', lastSeenInListAt: '2026-11-12T08:30:00.000Z' };
  const s = { ...createEmptyState(), portalMembers: [m], ignoredPortalMembers: ['x@y.de'] };
  const rows = toRows(s);
  expect(rows.portal_members[0]).toMatchObject({ id: 'pm1', connection_id: 'portal_nexus', external_id: 'a@b.de' });
  expect(rows.ignored_portal_members[0]).toMatchObject({ id: 'x@y.de', data: 'x@y.de' });
  expect(fromRows(rows)).toMatchObject({ portalMembers: [m], ignoredPortalMembers: ['x@y.de'] });
});

// tests/unit/migrate.test.ts
test('alter Stand ohne Portal: Verbindung missing ergänzt, Listen leer', () => {
  const old = createDemoState() as Partial<AppState>;
  old.connections = old.connections!.filter((c) => c.id !== 'portal_nexus');
  delete old.portalMembers; delete old.ignoredPortalMembers;
  const s = loadInitial(memStorage({ [STORE_KEY]: JSON.stringify(old) }), '', NOW_0930).state;
  expect(s.connections.find((c) => c.id === 'portal_nexus')).toMatchObject({ status: 'missing', lastSuccessAt: null });
  expect(s.portalMembers).toEqual([]);
  expect(s.ignoredPortalMembers).toEqual([]);
});

// tests/unit/migration.test.ts – Muster für idempotente Dateien zulassen
expect(sql).toMatch(new RegExp(`create table (if not exists )?${t} \\(`));
// und in „jede Zustandstabelle hat eine ord-Spalte“: `create table (if not exists )?${t} \\([^;]*\\bord int not null`
test('Portal-Migration: idempotent, apply_changes kennt beide Tabellen', () => {
  const p = read(`${DIR}/20261115000000_portal.sql`);
  expect(p).toContain('create table if not exists portal_members (');
  expect(p).toContain('create table if not exists ignored_portal_members (');
  expect(p).toContain('create unique index if not exists portal_members_connection_external_key');
  expect(p).toMatch(/v_external constant text\[\] := array\[[^\]]*'portal_members'/);
});
```

Die E2E-Zählungen 11 → 12 anpassen: `auth.spec.ts` (Testname und `toHaveCount(12)`) und `assistant.spec.ts:90`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/empty-state.test.ts tests/unit/db-tables.test.ts tests/unit/migration.test.ts tests/unit/migrate.test.ts 2>&1 | tail -15`
Expected: FAIL (12 statt 11, `portal_members` fehlt)

- [ ] **Step 3: Implement**

- Erweitere Typen, Katalog, HOW_TO, `createEmptyState` und das Seed-Literal (leere Listen; die Demo verbindet `portal_nexus` automatisch über den Katalog).
- In `tables.ts`: `portalMembers` gehört in `ArrayKey`/`SIMPLE`. `ignoredPortalMembers` wird behandelt wie `dismissedProposals`.
- Die Migration enthält:
  - `create table if not exists` für beide Tabellen (Spalten wie `subscriptions` bzw. `dismissed_proposals`)
  - `create unique index if not exists portal_members_connection_external_key on portal_members (connection_id, external_id)`
  - beide RLS-Zeilen, `revoke`/`grant` wie in `20261113000000_vertraege.sql`
  - `create or replace function apply_changes`: die Funktion aus `20261113000000_vertraege.sql` wörtlich übernehmen. `v_allowed` bekommt `'portal_members', 'ignored_portal_members'` dazu, `v_external` bekommt `'portal_members'` dazu. Danach `revoke execute` und `grant execute` wiederholen.

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`
Expected: grün

- [ ] **Step 5: Commit**

```bash
git add src/domain/types.ts src/domain/connections.ts src/data/empty-state.ts src/data/seed.ts src/server/db/tables.ts supabase/migrations/20261115000000_portal.sql tests/unit tests/e2e/auth.spec.ts tests/e2e/assistant.spec.ts
git commit -m "feat: Verbindung NEXUS-Portal und Tabellen für Portal-Mitglieder"
```

---

### Task 2: Frische je Verbindung (Portal 30 Tage) und Altersanzeige

**Files:**
- Modify: `src/domain/freshness.ts`, `src/domain/detectors/sources.ts`, `src/components/connection-labels.ts`, `src/app/verbindungen/page.tsx:25-26`
- Test: `tests/unit/freshness.test.ts`, `tests/unit/detectors.test.ts`, `tests/unit/connection-labels.test.ts`

**Interfaces:**
- Produces:
  - `STALE_AFTER_MINUTES_BY_CONNECTION: Partial<Record<ConnectionId, number>> = { portal_nexus: 30 * 24 * 60 }`
  - `staleAfterMinutes(id: ConnectionId): number`, Standard `STALE_AFTER_MINUTES` (45). `sourceFreshness` nutzt diese Funktion.
  - `ageText(c: Connection, at: Date): string`:
    - `'Noch nie abgerufen'`, wenn ohne `lastSuccessAt`
    - unter 60 Min.: `'Stand vor N Min.'`
    - sonst `'Stand vom TT.MM.JJJJ, HH:mm Uhr'` (`formatBerlin`)
  - `connectionSubtitle` und die Verbindungen-Seite nutzen `ageText`.
  - Text im Stale-Hinweis: `'Der letzte erfolgreiche Abruf ist älter als 45 Minuten.'` bzw. für das Portal `'Die Mitgliederliste ist älter als 30 Tage. Bitte neu einfügen.'`

- [ ] **Step 1: Write the failing tests**

```ts
test('portal_nexus ist 29 Tage nach dem Import frisch, nach 31 Tagen veraltet; andere nach 46 Min. veraltet', () => {
  const at = new Date('2026-11-12T08:30:00Z');
  const c = conn({ id: 'portal_nexus', status: 'connected', lastSuccessAt: '2026-10-14T08:30:00Z' });
  expect(sourceFreshness(c, at)).toBe('fresh');
  expect(sourceFreshness({ ...c, lastSuccessAt: '2026-10-12T08:00:00Z' }, at)).toBe('stale');
  expect(sourceFreshness(conn({ id: 'lexware_nexus', status: 'connected', lastSuccessAt: '2026-11-12T07:44:00Z' }), at)).toBe('stale');
});
test('stale:portal_nexus hat eigenen Text', () => { /* detectStaleSources → body 'Die Mitgliederliste ist älter als 30 Tage. Bitte neu einfügen.' */ });
test('ageText: Minuten, dann Datum', () => {
  expect(ageText(conn({ lastSuccessAt: '2026-11-12T08:20:00Z' }), NOW_0930)).toBe('Stand vor 10 Min.');
  expect(ageText(conn({ lastSuccessAt: '2026-11-01T09:00:00Z' }), NOW_0930)).toBe('Stand vom 01.11.2026, 10:00 Uhr');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/freshness.test.ts tests/unit/detectors.test.ts tests/unit/connection-labels.test.ts 2>&1 | tail -15`
Expected: FAIL

- [ ] **Step 3: Implement** mit den Signaturen oben.

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, dann `fuser -k 3100/tcp; npm run e2e -- tests/e2e/assistant.spec.ts tests/e2e/auth.spec.ts 2>&1 | tail -15`
Expected: grün (bestehende „Stand vor 10 Min.“-Prüfungen bleiben gültig)

- [ ] **Step 5: Commit**

```bash
git add src/domain/freshness.ts src/domain/detectors/sources.ts src/components/connection-labels.ts src/app/verbindungen/page.tsx tests/unit
git commit -m "feat: Frische je Verbindung, Portal-Liste gilt 30 Tage"
```

---

### Task 3: Parser `parsePortalList` und `decodeListFile`

**Files:**
- Create: `src/domain/import/portal-list.ts`, `tests/fixtures/portal.ts`, `tests/unit/import/portal-list.test.ts`
- Modify: `tests/fixtures/index.ts` (Re-Export)

**Interfaces:**
- Produces:
  - `interface PortalListEntry { email: string; name: string }`. `name` ist `''`, wenn unbekannt.
  - `interface PortalListPreview { entries: PortalListEntry[]; duplicates: number; withoutEmail: string[] }`
  - `parsePortalList(text: string): PortalListPreview`
  - `normalizePortalEntries(raw: PortalListEntry[]): PortalListEntry[]`: trimmt, schreibt E-Mails klein, lässt ungültige E-Mails weg und führt Duplikate zusammen (der erste nicht leere Name gewinnt). Der Parser und die Engine nutzen sie beide.
  - `isPortalEmail(s: string): boolean`
  - `decodeListFile(bytes: Uint8Array): string`: entfernt das BOM, dekodiert UTF-8 strikt (`fatal: true`) und fällt sonst auf `windows-1252` zurück.
  - Fixtures `portalListText` (Freitext, unten) und `portalListCsv` (unten)

Regeln:
- **CSV-Modus** gilt nur, wenn die **erste nicht leere Zeile** eine Kopfzeile ist.
  - Trennzeichen ist das häufigste aus `;`, `,` und Tab.
  - Eine Spalte heißt (ohne Groß-/Kleinschreibung) `email`, `e-mail` oder `e-mail-adresse`.
  - Name aus `name` bzw. `vollständiger name`, sonst `vorname` + `nachname`.
  - Felder in `"…"` mit `""` als Anführungszeichen.
  - Zeilen ohne gültige E-Mail kommen nach `withoutEmail`.
- **Freitext-Modus:**
  - E-Mail-Regex `/[^\s<>()\[\],;:"']+@[^\s<>()\[\],;:"']+\.[a-z]{2,}/gi`.
  - Name ist der Text **vor** der ersten E-Mail in derselben Zeile, ohne Rand aus Leerraum, `<`, `>`, `-`, `|`, `,`, `;`, `:`, Tab.
  - Ist er leer, gilt die direkt vorangehende Zeile ohne E-Mail, sofern noch unbenutzt.
  - Nicht verbrauchte Zeilen ohne E-Mail kommen nach `withoutEmail`, Leerraum auf ein Leerzeichen zusammengezogen.
  - Text nach der E-Mail (Datum usw.) wird ignoriert.

`portalListText`:
```
Mitglieder
Name	E-Mail	Beigetreten
Ayşe Öztürk	AYSE@example.de	01.09.2026
Murat Demir	murat@example.de	15.08.2026
Nina Hahn
nina@example.de
Paula Neu <neu@example.de>
team@nexusnetzwerk.de
Murat Demir	Murat@Example.de	15.08.2026
Bearbeiten
```
`portalListCsv`:
```
Name;E-Mail
"Öztürk, Ayşe";ayse@example.de
Lena Neu;lena.neu@example.de
;ohne-name@example.de
Kein Mail;
```

- [ ] **Step 1: Write the failing tests**

```ts
test('kopierte Admin-Seite: Name in der Zeile, davor oder aus E-Mail; Duplikat zusammengeführt; Füllzeilen gelistet', () => {
  expect(parsePortalList(portalListText)).toEqual({
    entries: [
      { email: 'ayse@example.de', name: 'Ayşe Öztürk' }, { email: 'murat@example.de', name: 'Murat Demir' },
      { email: 'nina@example.de', name: 'Nina Hahn' }, { email: 'neu@example.de', name: 'Paula Neu' },
      { email: 'team@nexusnetzwerk.de', name: '' },
    ],
    duplicates: 1,
    withoutEmail: ['Mitglieder', 'Name E-Mail Beigetreten', 'Bearbeiten'],
  });
});
test('CSV mit ; und Anführungszeichen', () => {
  expect(parsePortalList(portalListCsv)).toEqual({
    entries: [{ email: 'ayse@example.de', name: 'Öztürk, Ayşe' }, { email: 'lena.neu@example.de', name: 'Lena Neu' }, { email: 'ohne-name@example.de', name: '' }],
    duplicates: 0, withoutEmail: ['Kein Mail'],
  });
});
test('CSV mit , und Vorname/Nachname', () => {
  expect(parsePortalList('Vorname,Nachname,email\nAnna,Beispiel,ANNA@x.de\n').entries).toEqual([{ email: 'anna@x.de', name: 'Anna Beispiel' }]);
});
test('leerer Text → nichts erkannt', () => expect(parsePortalList('  \n')).toEqual({ entries: [], duplicates: 0, withoutEmail: [] }));
test('normalizePortalEntries: ungültige raus, klein, Duplikate', () => {
  expect(normalizePortalEntries([{ email: ' A@B.de ', name: '' }, { email: 'a@b.de', name: 'A' }, { email: 'kaputt', name: 'X' }])).toEqual([{ email: 'a@b.de', name: 'A' }]);
});
test('decodeListFile: UTF-8 mit BOM und Windows-1252', () => {
  expect(decodeListFile(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('A');
  expect(decodeListFile(new Uint8Array([0xd6, 0x7a, 0x74, 0xfc, 0x72, 0x6b]))).toBe('Öztürk');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/import/portal-list.test.ts 2>&1 | tail -15`
Expected: FAIL (Modul fehlt)

- [ ] **Step 3: Implement** nach den Regeln oben.

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `npx eslint src/domain/import/portal-list.ts`
Expected: grün (inkl. `architecture.test.ts`)

- [ ] **Step 5: Commit**

```bash
git add src/domain/import/portal-list.ts tests/fixtures tests/unit/import/portal-list.test.ts
git commit -m "feat: Mitgliederliste aus Text oder CSV erkennen"
```

---

### Task 4: Event `importPortalList` (Zusammenführen, Verbindung, Server-Prüfung)

**Files:**
- Modify: `src/domain/import/portal-list.ts`, `src/domain/events.ts`, `src/data/engine.ts`, `src/server/state-service.ts`
- Test: `tests/unit/import/portal-import.test.ts` (neu), `tests/unit/state-service.test.ts`, `tests/unit/import/helpers.ts`

**Interfaces:**
- Consumes: `PortalListEntry`, `normalizePortalEntries`, `isPortalEmail` (Task 3)
- Produces:
  - `mergePortalList(existing: PortalMember[], entries: PortalListEntry[], at: string, newId: () => string): { items: PortalMember[]; added: number; missing: number }`
    - Upsert nach `externalId = email`; die ID bleibt.
    - Neue Mitglieder: `firstSeenAt` und `lastSeenInListAt` = `at`. Vorhandene: `lastSeenInListAt = at`.
    - `name = entry.name || old?.name || <Teil vor @>`.
    - Fehlende bleiben unverändert. `missing` zählt sie.
  - Event `{ type: 'importPortalList'; entries: PortalListEntry[] }`, in `CLIENT_EVENTS`
  - `SHAPE.importPortalList`: Array mit 1–2000 Einträgen. Jeder Eintrag hat `email` als String ≤ 254 mit `isPortalEmail` und `name` als String ≤ 200.
  - Engine:
    - Nach `normalizePortalEntries` leer → keine Änderung, Audit `Mitgliederliste leer, nichts übernommen`.
    - Sonst `portalMembers` zusammenführen und `portal_nexus` mit `status: 'connected'` und `lastSuccessAt: at` setzen (`lastError` weg).
    - Audit (actor owner): `Mitgliederliste übernommen: ${n} Mitglieder, ${added} neu, ${missing} nicht mehr in der Liste`.
  - Testhelfer `portalState`: Das ist `emptyState()` nach `importPortalList` mit `parsePortalList(portalListText).entries` um `NOW_0930`.

- [ ] **Step 1: Write the failing tests**

```ts
test('erster Import: 5 Mitglieder, Verbindung verbunden mit Stand', () => {
  const s = portalState;
  expect(s.portalMembers.map((m) => m.externalId)).toEqual(['ayse@example.de', 'murat@example.de', 'nina@example.de', 'neu@example.de', 'team@nexusnetzwerk.de']);
  expect(s.portalMembers.find((m) => m.externalId === 'team@nexusnetzwerk.de')!.name).toBe('team');
  expect(s.connections.find((c) => c.id === 'portal_nexus')).toMatchObject({ status: 'connected', lastSuccessAt: NOW_0930.toISOString() });
});
test('Review 2: kürzere zweite Liste löscht nichts, markiert Fehlende', () => {
  const later = new Date('2026-11-20T08:00:00Z');
  const r = applyEvent(portalState, { type: 'importPortalList', entries: [{ email: 'AYSE@example.de', name: '' }] }, ctx({ at: later })).state;
  expect(r.portalMembers).toHaveLength(5);
  const ayse = r.portalMembers.find((m) => m.externalId === 'ayse@example.de')!;
  expect(ayse).toMatchObject({ name: 'Ayşe Öztürk', lastSeenInListAt: later.toISOString(), firstSeenAt: NOW_0930.toISOString() });
  expect(ayse.id).toBe(portalState.portalMembers[0].id);
  expect(r.portalMembers.find((m) => m.externalId === 'murat@example.de')!.lastSeenInListAt).toBe(NOW_0930.toISOString());
  expect(r.audit.at(-1)!.text).toBe('Mitgliederliste übernommen: 1 Mitglieder, 0 neu, 4 nicht mehr in der Liste');
});
test('leere oder nur ungültige Liste → nichts geändert', () => {
  const r = applyEvent(portalState, { type: 'importPortalList', entries: [{ email: 'kaputt', name: 'X' }] }, ctx()).state;
  expect(r.portalMembers).toEqual(portalState.portalMembers);
  expect(r.audit.at(-1)!.text).toBe('Mitgliederliste leer, nichts übernommen');
});

// state-service.test.ts
test('Review 5: importPortalList nur mit gültiger Form', () => {
  expect(isClientEvent({ type: 'importPortalList', entries: [{ email: 'a@b.de', name: 'A' }] })).toBe(true);
  expect(isClientEvent({ type: 'importPortalList', entries: [] })).toBe(false);
  expect(isClientEvent({ type: 'importPortalList', entries: [{ email: 'kaputt', name: 'A' }] })).toBe(false);
  expect(isClientEvent({ type: 'importPortalList', entries: [{ email: 'a@b.de' }] })).toBe(false);
  expect(isClientEvent({ type: 'importPortalList', entries: Array.from({ length: 2001 }, (_, i) => ({ email: `u${i}@x.de`, name: '' })) })).toBe(false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/import/portal-import.test.ts tests/unit/state-service.test.ts 2>&1 | tail -15`
Expected: FAIL

- [ ] **Step 3: Implement** nach den Interfaces oben.

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `npx eslint src/domain src/data/engine.ts src/server/state-service.ts`
Expected: grün

- [ ] **Step 5: Commit**

```bash
git add src/domain src/data/engine.ts src/server/state-service.ts tests/unit
git commit -m "feat: Mitgliederliste übernehmen, Fehlende nur markieren"
```

---

### Task 5: Zuordnung und Status rein ableiten (`src/domain/portal.ts`)

**Files:**
- Create: `src/domain/portal.ts`, `tests/unit/portal.test.ts`
- Modify: `src/domain/import/proposals.ts` (`sourceLabel` += `'Portal'`)

**Interfaces:**
- Consumes: `deriveProposals`, `findContactFor`, `ContractProposal`, `normalizeNameStrict`, `parseMembership`
- Produces:
  - `type PortalStatus = 'contract' | 'proposal' | 'invoice_only' | 'no_invoice' | 'ignored'`
  - `linkPortalMember(m: PortalMember, contacts: Contact[]): { contactIds: string[]; nameMatch: { contactId: string; name: string } | null }`
  - `interface PortalView { member: PortalMember; status: PortalStatus; inLatestList: boolean; contactIds: string[]; nameMatch: { contactId: string; name: string } | null; contractId: string | null; proposalId: string | null; invoices: Invoice[] }`
    - `inLatestList`: `member.lastSeenInListAt` ist gleich dem größten `lastSeenInListAt` aller Mitglieder.
    - `invoices`: Lexware-NEXUS-Rechnungen der Kontakte ohne Mitgliedschaftstext, nicht storniert.
  - `portalViews(s: AppState): PortalView[]`, sortiert `no_invoice`, `invoice_only`, `proposal`, `contract`, `ignored`, dann Name (`localeCompare 'de'`)
  - `portalSummary(v: PortalView[]): { total: number; contract: number; proposal: number; invoiceOnly: number; noInvoice: number; ignored: number; notInList: number; listAt: string | null }`
    - `total` zählt alle außer `ignored`.
    - `notInList` zählt nicht ausgeblendete Mitglieder mit `inLatestList: false`.
    - `listAt` ist der größte `lastSeenInListAt`.
  - `portalProposal(v: PortalView): ContractProposal`:
    - id `portal_nexus:<externalId>`, `sourceLabel: 'Portal'`, `billing: 'legacy'`
    - `sources` und `contactRefs` = `[{ connectionId: 'portal_nexus', externalId }]`
    - bei `invoice_only`: Rate = `totalCents` der jüngsten Rechnung, Fälligkeitstag und Start aus dem `dueDate` der ältesten, Anzahl und Gesamt `null`
    - sonst alle Werte `null`
    - `references`: Rechnungsnummern bzw. `['Portal-Liste']`
    - `complete: false`

Regeln:
- `contract`: Es gibt einen Vertrag mit `contactId ∈ contactIds` oder mit `origin` `portal_nexus:<externalId>`.
- `proposal`: Es gibt einen Vorschlag aus `deriveProposals(s)`, für den gilt: `findContactFor(p, contacts)` ergibt `ref` oder `email` mit `contactId ∈ contactIds`, oder `p.email` ist kleingeschrieben gleich `member.email`.
- `invoice_only`: `invoices` ist nicht leer.

- [ ] **Step 1: Write the failing tests** (`pm(email, name, lastSeen?)` als lokaler Helfer, Zustände aus `stateWith`/`lexState`)

```ts
test('E-Mail-Treffer unabhängig von Groß-/Kleinschreibung, nur Firma nexus', () => {
  const contacts = [contact({ id: 'k1', company: 'nexus', name: 'Murat Demir', emails: ['Murat@Example.de'] }), contact({ id: 'k2', company: 'zulassung', name: 'X', emails: ['murat@example.de'] })];
  expect(linkPortalMember(pm('murat@example.de', 'Murat Demir'), contacts)).toEqual({ contactIds: ['k1'], nameMatch: null });
});
test('externalRef schlägt E-Mail', () => { /* k9 mit portal_nexus:a@b.de und anderer E-Mail → contactIds ['k9'] */ });
test('Namenstreffer nur als Vorschlag: keine Verknüpfung, Status no_invoice', () => {
  const s = { ...stateWith({ contacts: [contact({ id: 'k1', company: 'nexus', name: 'Paula Neu', emails: ['andere@x.de'] })] }), portalMembers: [pm('neu@example.de', 'Paula Neu')] };
  expect(portalViews(s)[0]).toMatchObject({ status: 'no_invoice', contactIds: [], nameMatch: { contactId: 'k1', name: 'Paula Neu' } });
});
test('alle fünf Status', () => {
  // contract: Vertrag am E-Mail-Kontakt (murat); proposal: offener Lexware-Vorschlag c-83 (nina@example.de);
  // invoice_only: Kontakt mit Workshop-Rechnung RE-1101 (sven@example.de), ohne Mitgliedsrechnung; no_invoice: neu@; ignored: team@
  expect(portalViews(s).map((v) => [v.member.externalId, v.status])).toEqual([
    ['neu@example.de', 'no_invoice'], ['sven@example.de', 'invoice_only'], ['nina@example.de', 'proposal'], ['murat@example.de', 'contract'], ['team@nexusnetzwerk.de', 'ignored'],
  ]);
  expect(portalViews(s).find((v) => v.status === 'invoice_only')!.invoices.map((i) => i.number)).toEqual(['RE-1101']);
  expect(portalSummary(portalViews(s))).toMatchObject({ total: 4, contract: 1, proposal: 1, invoiceOnly: 1, noInvoice: 1, ignored: 1, notInList: 0 });
});
test('Review 3: mehrere E-Mail-Kontakte, Vertrag an irgendeinem zählt', () => { /* k1 und k2 gleiche E-Mail, Vertrag an k2 → contract, contractId */ });
test('ausgeblendet bleibt ausgeblendet, Vertrag hat Vorrang', () => { /* ignored + Vertrag → contract; ignored ohne Vertrag → ignored */ });
test('Review 2: nicht mehr in Liste → inLatestList false, notInList zählt', () => { /* zwei Mitglieder, eines mit älterem lastSeenInListAt */ });
test('portalProposal: Rechnungswerte vorbelegt, unvollständig', () => {
  expect(portalProposal(invoiceOnlyView)).toMatchObject({ id: 'portal_nexus:sven@example.de', sourceLabel: 'Portal', billing: 'legacy', installmentCents: 14900, installments: null, totalCents: null, dueDay: 26, startDate: '2026-09-26', complete: false, references: ['Rechnung RE-1101'] });
});
```

Hinweis zu `invoice_only`: Sven (c-81) hat auch RE-1100 mit Mitgliedschaft. Im Test deshalb nur RE-1101 dem Kontakt zuordnen oder einen eigenen Kontakt mit `workshop` aus `tests/unit/helpers.ts` bauen. Die Erwartung oben gilt für diesen Zustand.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/portal.test.ts 2>&1 | tail -15`
Expected: FAIL (Modul fehlt)

- [ ] **Step 3: Implement** mit den Signaturen oben. `deriveProposals(s)` wird in `portalViews` nur einmal aufgerufen.

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `npx eslint src/domain`
Expected: grün

- [ ] **Step 5: Commit**

```bash
git add src/domain/portal.ts src/domain/import/proposals.ts tests/unit/portal.test.ts
git commit -m "feat: Status je Portal-Mitglied rein abgeleitet"
```

---

### Task 6: Events `createPortalContract` und `ignorePortalMember`

**Files:**
- Modify: `src/domain/events.ts`, `src/data/engine.ts`, `src/server/state-service.ts`
- Test: `tests/unit/import/portal-contract.test.ts` (neu), `tests/unit/state-service.test.ts`

**Interfaces:**
- Consumes: `portalViews`, `portalProposal` (Task 5), `validateContractDraft`, `findContactFor`, `portalState` (Task 4)
- Produces:
  - `{ type: 'createPortalContract'; externalId: string; draft: ContractDraft; contactId: string | null }`. `created[0]` ist die Vertrags-ID.
  - `{ type: 'ignorePortalMember'; externalId: string }`
  - Privater Helfer in `engine.ts`: `attachContact(s: AppState, p: ContractProposal, chosen: string | null, newId: () => string): { contacts: Contact[]; contactId: string }`. Er wird aus `confirmProposal` herausgelöst, mit gleichem Verhalten. `confirmProposal` nutzt ihn ebenfalls.
  - Beide Typen stehen in `CLIENT_EVENTS`. `SHAPE`: `createPortalContract` verlangt `isStr(externalId) && isContractDraft(draft) && (contactId === null || isStr(contactId))`, `ignorePortalMember` verlangt `isStr(externalId)`.

Regeln für `createPortalContract`:
- Mitglied fehlt → Audit `Portal-Mitglied nicht gefunden`.
- Status nicht `no_invoice` und nicht `invoice_only` → Audit `Vertrag nicht angelegt: Mitglied hat schon einen Vertrag oder Vorschlag.`
- Prüffehler → Audit `Vertrag nicht angelegt: <Fehler>`.
- Sonst wird ein Vertrag angelegt mit `{ ...draft, billing: 'legacy', origin: [portal-Ref] }` und dem Kontakt über `attachContact(portalProposal(view))`. Ein neuer Kontakt bekommt `company 'nexus'`, `kind 'member'`, Name und E-Mail aus der Liste und den Portal-Ref.
- Audit `Vertrag angelegt (Portal): <Name>, <n> × <Rate>`.

`ignorePortalMember` ist idempotent. Die Audit-Zeile `Kein zahlendes Mitglied: <Name>` gibt es nur beim ersten Mal.

- [ ] **Step 1: Write the failing tests**

```ts
const draft: ContractDraft = { totalCents: 60000, installments: 6, installmentCents: 10000, dueDay: 1, startDate: '2026-10-01', catchUpMode: 'first_rate' };
const e = { type: 'createPortalContract', externalId: 'neu@example.de', draft, contactId: null } as const;

test('legt Vertrag und Kontakt mit Portal-Ref an', () => {
  const r = applyEvent(portalState, e, ctx());
  const k = r.state.contracts.find((c) => c.id === r.created[0])!;
  expect(k).toMatchObject({ billing: 'legacy', origin: [{ connectionId: 'portal_nexus', externalId: 'neu@example.de' }], installments: 6 });
  expect(r.state.contacts.find((c) => c.id === k.contactId)).toMatchObject({ company: 'nexus', kind: 'member', name: 'Paula Neu', emails: ['neu@example.de'], externalRefs: [{ connectionId: 'portal_nexus', externalId: 'neu@example.de' }] });
  expect(portalViews(r.state).find((v) => v.member.externalId === 'neu@example.de')!.status).toBe('contract');
});
test('doppelter Tipp ergibt einen Vertrag', () => {
  const r = applyEvents(portalState, [e, e], ctx());
  expect(r.state.contracts).toHaveLength(1);
  expect(r.state.audit.at(-1)!.text).toBe('Vertrag nicht angelegt: Mitglied hat schon einen Vertrag oder Vorschlag.');
});
test('Validierung: kein Vertrag, Fehlertext', () => {
  const r = applyEvent(portalState, { ...e, draft: { ...draft, dueDay: 32 } }, ctx());
  expect(r.state.contracts).toHaveLength(0);
  expect(r.state.audit.at(-1)!.text).toContain('Fälligkeitstag muss zwischen 1 und 31 liegen.');
});
test('E-Mail-Kontakt wird genutzt und um Portal-Ref ergänzt', () => { /* Kontakt k1 mit 'NEU@example.de' → contactId k1, kein neuer Kontakt */ });
test('Namenstreffer nur mit Bestätigung wiederverwendet', () => { /* contactId null → neuer Kontakt; contactId 'k1' → k1 */ });
test('Zahlung danach zuordenbar', () => {
  const st = applyEvent({ ...portalState, payments: [tx({ id: 'p1', amountCents: 10000, payerName: 'Paula Neu', bookedOn: '2026-10-02' })] }, e, ctx()).state;
  const contractId = st.contracts[0].id;
  const r = applyEvent(st, { type: 'confirmPaymentMatch', paymentId: 'p1', contractId }, ctx()).state;
  expect(r.allocations).toContainEqual(expect.objectContaining({ paymentId: 'p1', contractId, amountCents: 10000 }));
});
test('Kein zahlendes Mitglied: idempotent, bleibt nach erneutem Import ausgeblendet', () => {
  const i = { type: 'ignorePortalMember', externalId: 'team@nexusnetzwerk.de' } as const;
  const a = applyEvents(portalState, [i, i], ctx()).state;
  expect(a.ignoredPortalMembers).toEqual(['team@nexusnetzwerk.de']);
  const b = applyEvent(a, { type: 'importPortalList', entries: parsePortalList(portalListText).entries }, ctx()).state;
  expect(portalViews(b).find((v) => v.member.externalId === 'team@nexusnetzwerk.de')!.status).toBe('ignored');
});

// state-service.test.ts
test('Portal-Events: Form geprüft', () => {
  expect(isClientEvent({ type: 'ignorePortalMember', externalId: 'a@b.de' })).toBe(true);
  expect(isClientEvent({ type: 'ignorePortalMember' })).toBe(false);
  expect(isClientEvent({ type: 'createPortalContract', externalId: 'a@b.de', draft, contactId: null })).toBe(true);
  expect(isClientEvent({ type: 'createPortalContract', externalId: 'a@b.de', draft: { ...draft, dueDay: 'x' }, contactId: null })).toBe(false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/import/portal-contract.test.ts tests/unit/state-service.test.ts 2>&1 | tail -15`
Expected: FAIL

- [ ] **Step 3: Implement** nach den Regeln oben. Die bestehenden `confirmProposal`-Tests (`tests/unit/import/confirm.test.ts`) müssen unverändert grün bleiben.

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `npx eslint src/data/engine.ts src/domain/events.ts src/server/state-service.ts`
Expected: grün

- [ ] **Step 5: Commit**

```bash
git add src/domain/events.ts src/data/engine.ts src/server/state-service.ts tests/unit
git commit -m "feat: Vertrag für Portal-Mitglied anlegen und Mitglied ausblenden"
```

---

### Task 7: Sammelhinweis „N Mitglieder ohne Rechnung“

**Files:**
- Create: `src/domain/detectors/portal.ts`
- Modify: `src/domain/types.ts` (`InsightType` += `'portal_no_invoice'`), `src/domain/detectors/index.ts`, `src/domain/detectors/refs.ts`
- Test: `tests/unit/detectors.test.ts`

**Interfaces:**
- Consumes: `portalViews` (Task 5)
- Produces:
  - `portalRef(label: string): Ref`, gibt `{ kind: 'member', id: 'portal', href: '/nexus/mitglieder', label }` zurück
  - `detectPortalNoInvoice(s: AppState): Insight[]` liefert bei mindestens einem Mitglied mit `no_invoice` **und** `inLatestList` genau einen Hinweis:
    - `dedupeKey: 'portal-no-invoice'`, `type: 'portal_no_invoice'`, `company: 'nexus'`, `priority: 'info'`
    - `title`: `'1 Mitglied ohne Rechnung'` bzw. `` `${n} Mitglieder ohne Rechnung` ``
    - `body`: die ersten drei Namen mit Komma, bei mehr `' und N weitere'`
    - `refs: [portalRef('Portal-Mitglieder')]`, `nextStep: 'Mitglieder ohne Rechnung ansehen'`
    - `needsSources: ['portal_nexus', 'lexware_nexus']`

- [ ] **Step 1: Write the failing tests**

```ts
test('portal-no-invoice: ein Sammelhinweis; ignorierte, Verträge und Nicht-mehr-in-Liste zählen nicht', () => {
  const [i] = detectPortalNoInvoice(s); // neu@, x@ ohne Rechnung in aktueller Liste; alt@ ohne Rechnung, nicht mehr in Liste; team@ ignoriert; murat@ Vertrag
  expect(i).toMatchObject({ dedupeKey: 'portal-no-invoice', title: '2 Mitglieder ohne Rechnung', priority: 'info', refs: [{ href: '/nexus/mitglieder' }] });
});
test('keiner ohne Rechnung → kein Hinweis; einer → Einzahl', () => { /* [] bzw. '1 Mitglied ohne Rechnung' */ });
test('runDetectors: Portal-Liste älter als 30 Tage → Hinweis unterdrückt', () => { /* portal_nexus lastSuccessAt vor 31 Tagen → kein 'portal-no-invoice' */ });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/detectors.test.ts 2>&1 | tail -15`
Expected: FAIL

- [ ] **Step 3: Implement** und in `runDetectors` einhängen.

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`
Expected: grün. Die Demo bleibt unverändert, weil sie keine Portal-Mitglieder hat.

- [ ] **Step 5: Commit**

```bash
git add src/domain tests/unit/detectors.test.ts
git commit -m "feat: Sammelhinweis Mitglieder ohne Rechnung"
```

---

### Task 8: Oberfläche (Liste einfügen, Portal-Mitglieder, NEXUS-Link), E2E und Setup-Doku

**Files:**
- Create: `src/app/nexus/mitglieder/page.tsx`, `docs/setup-portal.md`
- Modify: `src/data/selectors.ts`, `src/app/nexus/page.tsx`, `src/components/ProposalCard.tsx`
- Test: `tests/unit/selectors.test.ts`, `tests/unit/proposal-card.test.ts`, `tests/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: `parsePortalList`, `decodeListFile` (Task 3), `importPortalList` (Task 4), `portalViews`, `portalSummary`, `portalProposal` (Task 5), Events (Task 6), `memberRows`
- Produces:
  - `portalRows(s: AppState, today: IsoDate): (PortalView & { traffic: MemberRow['traffic'] | null; arrearsCents: number })[]`. Ampel und Rückstand kommen aus `memberRows` zur `contractId`, sonst `null` bzw. `0`.
  - `ProposalCard` bekommt die Prop `dismissLabel?: string`, Standard `'Verwerfen'`.

UI-Festlegungen:
- **Seite** „Portal-Mitglieder“ mit `BackLink` zu NEXUS.
- **Abschnitt „Mitgliederliste einfügen“** (`data-testid="portal-import"`). Er ist aufgeklappt, solange es keine Mitglieder gibt, sonst über den Knopf „Mitgliederliste einfügen“ erreichbar.
  - Textfeld mit Label „Mitgliederliste“ und Hinweis „Auf portal.nexusnetzwerk.de/mitglieder alles markieren, kopieren und hier einfügen – oder CSV wählen.“
  - Dateifeld mit Label „CSV-Datei“ (`accept=".csv,.txt,text/csv,text/plain"`). Es liest die Bytes und schreibt `decodeListFile(…)` ins Textfeld.
  - Vorschau `data-testid="portal-preview"`: `${n} Mitglieder erkannt · ${duplicates} doppelt · ${withoutEmail.length} Zeilen ohne E-Mail`. Darunter stehen aufklappbar die Zeilen ohne E-Mail (`<details>`).
  - Knopf `${n} Mitglieder übernehmen`, gesperrt bei `n === 0`. Er schickt `importPortalList` mit `entries`, leert danach das Feld und klappt zu.
- **Zusammenfassung** `data-testid="portal-summary"`: `{total} im Portal · {contract} mit Vertrag · {proposal} Vorschlag offen · {noInvoice} ohne Rechnung`. Es folgt ` · {invoiceOnly} Rechnung ohne Mitgliedschaft`, wenn > 0, und ` · {notInList} nicht mehr in Liste`, wenn > 0. Darunter steht `Liste vom TT.MM.JJJJ` (aus `listAt`).
- **Segmente** (`Segmented` mit Radios, legend „Portal-Mitglieder filtern“): Alle / Ohne Rechnung / Vorschlag / Vertrag. „Ohne Rechnung“ zeigt `no_invoice` und `invoice_only`. Ausgeblendete erscheinen nie.
- **Zeile** `data-testid="portal-row-<externalId>"`:
  - Titel: Name. Untertitel: E-Mail und Status-Text, bei `!inLatestList` zusätzlich ` · nicht mehr in Liste`.
  - Status-Texte: `Vertrag`, `Vorschlag offen`, `Rechnung ohne Mitgliedschaft: RE-…, RE-…`, `Keine Rechnung`.
  - `contract`: `TrafficDot` und Link auf `/nexus/mitglieder/<contractId>`. `proposal`: Link auf `/nexus/mitglieder/vorschlaege`.
- **Aktionen** bei `no_invoice` und `invoice_only` (Klasse `member-actions`):
  - „Vertrag anlegen“, aria-label `Vertrag anlegen für <Name>`: klappt darunter `ProposalCard` mit `portalProposal(view)` und `dismissLabel="Kein zahlendes Mitglied"` auf.
  - „Kein zahlendes Mitglied“, aria-label `Kein zahlendes Mitglied: <Name>`.
  - Übernehmen schickt `createPortalContract` (mit `contactId` aus „Ist das …? Ja“) und führt dann zu `/nexus/mitglieder/<created[0]>/uebernahme`.
- **/nexus**: In der Gruppe „Monatsvorschau“ steht nach „Offen“ immer die Zeile `ListRow` mit `testId="portal-link"`, `href="/nexus/mitglieder"` und Titel `Portal-Mitglieder (${total})`. Der Wert ist `${noInvoice} ohne Rechnung`, ohne Mitglieder `Liste einfügen`.
- **`docs/setup-portal.md`** ist eine Inhaber-Checkliste im Stil von `docs/setup-phase2b2.md`:
  1. **Vor Merge und Deploy** im SQL Editor der App-Supabase `supabase/migrations/20261115000000_portal.sql` ausführen. Grund: Ohne die Tabellen lädt die App nicht. Die Datei ist beliebig oft ausführbar.
  2. Auf `portal.nexusnetzwerk.de/mitglieder` die Liste markieren und kopieren (oder als CSV exportieren, falls angeboten).
  3. In der App NEXUS → Portal-Mitglieder → „Mitgliederliste einfügen“: einfügen, Vorschau prüfen, übernehmen.
  4. Was du dann siehst:
     - Verbindungen: „NEXUS-Portal · Verbunden“
     - Zusammenfassung und Status
     - Heute: „N Mitglieder ohne Rechnung“
  5. Liste spätestens alle 30 Tage neu einfügen. Wer fehlt, wird nur markiert und nie gelöscht. Keine Vercel-Variablen nötig.

- [ ] **Step 1: Write the failing tests**

```ts
// selectors.test.ts
test('portalRows: Ampel und Rückstand nur bei Vertrag', () => { /* contract-Zeile traffic aus memberRows, no_invoice traffic null, arrears 0 */ });
// proposal-card.test.ts (Render-Test wie die bestehenden)
test('dismissLabel ersetzt „Verwerfen“', () => { /* Knopf „Kein zahlendes Mitglied“, kein „Verwerfen“ */ });
```

```ts
// tests/e2e/auth.spec.ts – neuer Test nach „Gesamtrechnung ohne Tag …“, vor „Jetzt abgleichen“; portalListText/portalListCsv aus '../fixtures'
test('Echtmodus: Mitgliederliste einfügen, Status, Vertrag anlegen, Kein zahlendes Mitglied, CSV', async () => {
  await page.goto('/nexus');
  await expect(page.getByTestId('portal-link')).toContainText('Liste einfügen');
  await page.getByTestId('portal-link').click();
  await page.getByLabel('Mitgliederliste').fill(portalListText);
  await expect(page.getByTestId('portal-preview')).toHaveText(/5 Mitglieder erkannt · 1 doppelt · 3 Zeilen ohne E-Mail/);
  await page.getByRole('button', { name: '5 Mitglieder übernehmen' }).click();
  await expect(page.getByTestId('portal-summary')).toContainText('5 im Portal · 2 mit Vertrag · 1 Vorschlag offen · 2 ohne Rechnung');
  await expect(page.getByTestId('portal-row-ayse@example.de')).toContainText('Vertrag');   // AYSE@ → ayse@, Vertrag aus sub_A
  await expect(page.getByTestId('portal-row-murat@example.de')).toContainText('Vertrag');  // Kontakt Murat@Example.de
  await expect(page.getByTestId('portal-row-nina@example.de')).toContainText('Vorschlag offen');
  await page.getByRole('radio', { name: 'Ohne Rechnung' }).check();
  await expect(page.locator('[data-testid^="portal-row-"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'Kein zahlendes Mitglied: team' }).click();
  await expect(page.getByTestId('portal-row-team@nexusnetzwerk.de')).toHaveCount(0);
  await page.getByRole('button', { name: 'Vertrag anlegen für Paula Neu' }).click();
  const card = page.getByTestId('proposal-portal_nexus:neu@example.de');
  await expect(card).toContainText('bitte ergänzen');
  await card.getByRole('button', { name: 'Bearbeiten' }).click();
  await card.getByLabel('Gesamt').fill('600,00');
  await card.getByLabel('Raten').fill('6');
  await card.getByLabel('Rate', { exact: true }).fill('100,00');
  await card.getByLabel('Fälligkeitstag').fill('1');
  await card.getByLabel('Start').fill('2026-10-01');
  await card.getByRole('button', { name: 'Übernehmen' }).click();
  await expect(page).toHaveURL(/\/nexus\/mitglieder\/[^/]+\/uebernahme$/);
  await page.goto('/verbindungen');
  await expect(page.getByTestId('setup-portal_nexus')).toContainText(/Verbunden · Stand vor \d+ Min/);
  await page.goto('/nexus/mitglieder');
  await expect(page.getByTestId('portal-summary')).toContainText('4 im Portal · 3 mit Vertrag · 1 Vorschlag offen · 0 ohne Rechnung');
  // CSV-Upload: zweite, andere Liste → Fehlende werden nur markiert
  await page.getByRole('button', { name: 'Mitgliederliste einfügen' }).click();
  await page.getByLabel('CSV-Datei').setInputFiles({ name: 'mitglieder.csv', mimeType: 'text/csv', buffer: Buffer.from(portalListCsv, 'utf8') });
  await expect(page.getByTestId('portal-preview')).toHaveText(/3 Mitglieder erkannt · 0 doppelt · 1 Zeilen ohne E-Mail/);
  await page.getByRole('button', { name: '3 Mitglieder übernehmen' }).click();
  await expect(page.getByTestId('portal-row-murat@example.de')).toContainText('nicht mehr in Liste');
  await expect(page.getByTestId('portal-row-team@nexusnetzwerk.de')).toHaveCount(0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/selectors.test.ts tests/unit/proposal-card.test.ts 2>&1 | tail -15` und `fuser -k 3100/tcp; npm run e2e -- tests/e2e/auth.spec.ts 2>&1 | tail -15`
Expected: FAIL (`portalRows` fehlt, `portal-link` nicht gefunden)

- [ ] **Step 3: Implement** nach den UI-Festlegungen. Die Seite ist eine Client-Seite wie `vorschlaege/page.tsx`. Die Vorschau entsteht mit `parsePortalList` aus dem Feldinhalt (`useMemo`). Zählungen kommen nur aus `portalSummary`. Die Doku-Datei schreiben.

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `npx eslint src/app/nexus src/components/ProposalCard.tsx src/data/selectors.ts`, dann `fuser -k 3100/tcp; npm run e2e -- tests/e2e/auth.spec.ts tests/e2e/nexus.spec.ts tests/e2e/assistant.spec.ts 2>&1 | tail -15`
Expected: alles grün

- [ ] **Step 5: Commit**

```bash
git add src/app/nexus src/components/ProposalCard.tsx src/data/selectors.ts docs/setup-portal.md tests/unit tests/e2e/auth.spec.ts tests/fixtures
git commit -m "feat: Portal-Mitglieder einfügen und mit Status und Aktionen anzeigen"
```

---

**Ausblick (nicht Teil dieses Plans):** Sobald die Agentur die Portal-Schlüssel herausgibt, kann ein optionaler Connector über die Supabase-Auth-Admin-API (Spec Abschnitt 8) dieselbe Liste automatisch über die `mergePortalList`-Logik speisen.

## Self-Review (erledigt)

- **Spec-Abdeckung:**
  - Einfügen/CSV mit Vorschau (T3/T8), Übernehmen ohne Löschen (T4), Verbindung und 30-Tage-Frische (T1/T2/T4).
  - Status (T5/T8), Vertrag anlegen (T6/T8), Ausblenden (T6/T8), Hinweis (T7), Verbindungen-Eintrag (T1/T2), Setup-Doku (T8).
  - Anti-Ziele: kein stilles Löschen (T4), Namenstreffer nur als Vorschlag (T5/T6), Vertrag nur durch den Inhaber (T6, nur Client-Event).
  - Tests aus Spec 6 verteilt auf T2–T8.
- **Typen:** `PortalMember`, `PortalListEntry`, `PortalView` (`inLatestList`), `mergePortalList`, `portalProposal` und die Events heißen in allen Tasks gleich. `sourceLabel 'Portal'` gibt es ab T5, `dismissLabel` ab T8.
- **Bewusst offen:** Rückgängig machen von „Kein zahlendes Mitglied“ (nicht in der Spec). Die Demo enthält keine Portal-Mitglieder, damit sich Heute- und Demo-Tests nicht verschieben.
