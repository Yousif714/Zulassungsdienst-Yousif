# Nexus-Assistent Phase 1 (Vorschau mit Demo-Daten) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eine klickbare PWA-Vorschau des Nexus-Assistenten mit echter Fachlogik (Raten, Zuordnung, Hinweise, Aktionen, Zeitsteuerung) auf deterministischen Demo-Daten, inklusive simuliertem WhatsApp-Assistenten. Abnahme sind die 11 E2E-Abläufe der Spec.

**Architecture:** Alle Fachlogik liegt als reines, DB-freies TypeScript in `src/domain/`. Die UI (Next.js App Router, Client Components) liest und schreibt über einen `AppStore` (React Context + `useReducer`, persistiert in localStorage). Der Store wird aus `createDemoState()` befüllt. Die KI-Rolle übernimmt `DemoAI` hinter der Schnittstelle `AIProvider`, damit Phase 2 Claude einsetzen kann, ohne die UI zu ändern.

**Tech Stack:** Node 22 · Next.js 16 (TypeScript, App Router) · Tailwind CSS · `@date-fns/tz` + `date-fns` · Vitest · `@playwright/test@1.63.0` (passend zum vorinstallierten Chromium).

**Spec:** `docs/superpowers/specs/2026-11-12-nexus-assistent-design.md` (vor allem Abschnitt 4a „Festgelegte Rechen- und Zuordnungsregeln“ und 10 „Tests“). Fachliche Anforderungen: `docs/NEXUS-Assistent-Prompt.md`.

## Global Constraints

- UI-Sprache durchgehend **Deutsch**. Beträge mit `formatEuro()` im Format `1.150,00 €` (`Intl.NumberFormat('de-DE', {style:'currency', currency:'EUR'})`).
- Beträge intern **immer Ganzzahl in Cent**. Kalendertage als `IsoDate` (`'YYYY-MM-DD'`) in **Europe/Berlin**.
- **Demo-Uhr:** Die App rechnet mit `DEMO_NOW = 2026-11-12T09:30:00+01:00` (überschreibbar über `?now=<ISO>`). Überall wird `now()` aus `src/domain/clock.ts` verwendet, nie `new Date()` direkt.
- **Nichts verlässt die App:** Jede ausgeführte Aktion läuft über `DemoProvider`, wird im Protokoll erfasst und trägt das sichtbare Etikett **„Demo“**.
- Zwei Firmen: `'nexus' | 'zulassung'`. Kein Datensatz ohne eindeutige Firma, wo die Spec eine verlangt.
- Mobile Breakpoint `< 768px`: Tab-Leiste unten mit genau **Heute · NEXUS · Zulassungsdienst** plus Assistenten-Knopf. Ab 768px: Seitenleiste.
- Design: Apple Erinnerungen (Aufgaben), Apple Wallet (Beträge), iOS-Einstellungen (Details). System-Schrift (`-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui`), Dark Mode über `prefers-color-scheme`, Tippflächen mindestens 44 px hoch.
- Keine Portal-Anbindung, keine Portal-Statistik (außerhalb des Umfangs).
- Kein `new Date()`-Formatieren mit lokaler Server-Zeitzone; immer `@date-fns/tz` mit `'Europe/Berlin'`.
- **Nicht in Phase 1:** Login, echte Verbindungen, Claude-Anbindung, echter Push- und WhatsApp-Versand. Die Schnittstellen (`AIProvider`, `ActionProvider`, Store-Ereignisse) sind so geschnitten, dass Phase 2 sie ersetzt, ohne die UI anzufassen.

## Review Focus

1. **Monatsende und Fälligkeitstag 29–31** (z. B. `dueDay: 31` im Februar) → Fälligkeit am letzten Tag des Monats, nicht im Folgemonat. Test in Task 2.
2. **Überzahlung** (Mitglied zahlt mehr als fällig) → Rückstand 0, Überschuss mindert die künftigen Raten, `offen gesamt` sinkt entsprechend, nie negativ. Test in Task 3.
3. **Erneuter Import derselben Buchung** (gleiche Verbindung + externe ID) und **Stripe-Auszahlung auf dem Bankkonto** → keine zweite Gutschrift. Test in Task 5.
4. **Antwort im falschen Thread** derselben Person → Hinweis „wartet auf Antwort“ bleibt offen. Test in Task 6.
5. **Doppelter Cron-Takt und Zeitumstellung** (29.03.2026 und 25.10.2026) → genau ein Briefing um 7:00 Ortszeit. Test in Task 9.

---

## Dateistruktur

```
src/domain/
  clock.ts            now(), todayBerlin(), Berlin-Zeitfunktionen
  money.ts            formatEuro()
  types.ts            alle Fachtypen (siehe Task 2)
  ledger/schedule.ts  buildSchedule()
  ledger/allocate.ts  allocate()
  ledger/status.ts    memberStatus()
  ledger/takeover.ts  planTakeover()
  ledger/forecast.ts  monthForecast()
  matching/imports.ts importKey(), mergeImported()
  matching/payments.ts classifyBankTx(), matchBankPayment()
  matching/messages.ts matchMessage(), openReplies()
  freshness.ts        sourceFreshness(), areaStale()
  detectors/index.ts  runDetectors(), selectTop(), reconcileInsights()
  detectors/*.ts      je ein Detektor
  coach.ts            runCoach()
  actions/machine.ts  Aktions-Zustandsmaschine
  actions/demo-provider.ts
  scheduler.ts        dueRuns(), chooseDelivery()
  briefing.ts         buildBriefing(), renderBriefingText()
src/ai/
  provider.ts         AIProvider-Schnittstelle
  demo-ai.ts          DemoAI
src/data/
  seed.ts             createDemoState()
  store.tsx           AppStore (Context, Reducer, localStorage)
  selectors.ts        abgeleitete Sichten für die UI
src/components/       AppShell, TabBar, Sidebar, ListGroup, ListRow, MoneyCard, TaskRow, DemoBadge, StaleNotice
src/app/              Seiten (siehe Tasks 11–15)
tests/unit/           Vitest, gespiegelt zu src/domain
tests/e2e/            Playwright
```

---

### Task 1: Projekt-Setup, Uhr und Geldformat

**Files:**
- Create: Next.js-Projekt im Repo-Root, `src/domain/clock.ts`, `src/domain/money.ts`, `vitest.config.ts`, `playwright.config.ts`
- Test: `tests/unit/clock.test.ts`, `tests/unit/money.test.ts`

**Interfaces:**
- Produces: `now(): Date` · `setNowForTests(d: Date | null): void` · `todayBerlin(d?: Date): IsoDate` · `berlinParts(d: Date): {date: IsoDate; time: 'HH:mm'; weekday: 0..6}` · `berlinLocalToUtc(date: IsoDate, time: 'HH:mm'): Date` · `addDaysIso(d: IsoDate, n: number): IsoDate` · `daysBetween(a: IsoDate, b: IsoDate): number` · `formatEuro(cents: number): string` · `formatBerlin(d: Date, pattern: string): string`

- [ ] **Step 1:** `npx create-next-app@latest . --ts --tailwind --app --src-dir --eslint --import-alias "@/*" --use-npm --yes` (README bleibt erhalten). Danach `npm i date-fns @date-fns/tz` und `npm i -D vitest @playwright/test@1.63.0`. Scripts in `package.json`: `"test": "vitest run"`, `"e2e": "playwright test --trace off"`.
- [ ] **Step 2:** `playwright.config.ts`: `webServer: {command: 'npm run build && npm run start -- -p 3100', port: 3100, reuseExistingServer: true}`, Projekte `iphone` (`...devices['iPhone 15']`, `browserName: 'chromium'`, `launchOptions.executablePath: '/opt/pw-browsers/chromium'` falls vorhanden) und `desktop` (`devices['Desktop Chrome']`), plus `iphone-webkit` (`devices['iPhone 15']`) nur wenn `process.env.E2E_WEBKIT === '1'`. `use.permissions: ['clipboard-read','clipboard-write']` für Chromium-Projekte.
- [ ] **Step 3: Failing tests schreiben**

```ts
// tests/unit/money.test.ts
expect(formatEuro(115000)).toBe('1.150,00 €');
expect(formatEuro(0)).toBe('0,00 €');
expect(formatEuro(-2550)).toBe('-25,50 €');
// tests/unit/clock.test.ts
expect(todayBerlin(new Date('2026-11-11T23:30:00Z'))).toBe('2026-11-12');
expect(berlinLocalToUtc('2026-11-12','07:00').toISOString()).toBe('2026-11-12T06:00:00.000Z');
expect(berlinLocalToUtc('2026-07-01','07:00').toISOString()).toBe('2026-07-01T05:00:00.000Z');
expect(daysBetween('2026-11-01','2026-11-12')).toBe(11);
setNowForTests(null); expect(now().toISOString()).toBe('2026-11-12T08:30:00.000Z'); // DEMO_NOW
```

- [ ] **Step 4:** `npm test` → FAIL (Module fehlen).
- [ ] **Step 5:** Implementieren. `now()` liefert in dieser Reihenfolge: Test-Override, `?now=` aus `window.location` (nur im Browser), sonst `DEMO_NOW`.
- [ ] **Step 6:** `npm test` → PASS. `npm run build` → erfolgreich.
- [ ] **Step 7:** Commit `chore: Next.js-Projekt, Uhr und Geldformat`.

---

### Task 2: Fachtypen und Ratenplan

**Files:**
- Create: `src/domain/types.ts`, `src/domain/ledger/schedule.ts`
- Test: `tests/unit/ledger/schedule.test.ts`

**Interfaces:**
- Produces (in `types.ts`, von allen späteren Tasks genutzt):

```ts
export type Company = 'nexus' | 'zulassung';
export type IsoDate = string;
export type ConnectionId = 'lexware_nexus'|'lexware_zulassung'|'stripe_nexus'|'bank'|'gmail'|'icloud'|'info_mail'|'calendar'|'whatsapp_kunden'|'whatsapp_assistent';
export interface Connection { id: ConnectionId; company: Company | null; label: string; status: 'connected'|'missing'|'error'; lastSuccessAt: string | null; lastError?: string }
export interface Contact { id: string; company: Company; kind: 'member'|'private'|'dealer'; name: string; phones: string[]; emails: string[] }
export interface MemberContract { id: string; contactId: string; totalCents: number; installments: number; installmentCents: number; dueDay: number; startDate: IsoDate; billing: 'legacy'|'stripe'; specialTerms?: string; catchUpMode: 'first_rate'|'spread' }
export type ContractException =
  | { kind: 'deferral'; from: IsoDate; to: IsoDate }
  | { kind: 'pause'; from: IsoDate; months: number }
  | { kind: 'due_day_shift'; from: IsoDate; newDueDay: number };
export interface Installment { no: number; dueDate: IsoDate; amountCents: number }
export interface InstallmentState extends Installment { paidCents: number; paidOn: IsoDate | null }
export interface Payment { id: string; company: Company; source: 'bank'|'stripe'|'manual'; connectionId: ConnectionId | null; externalId: string; amountCents: number; bookedOn: IsoDate; payerName?: string; iban?: string; reference?: string; kind: 'incoming'|'stripe_payout' }
export interface Allocation { paymentId: string; contractId: string; amountCents: number; method: 'auto'|'confirmed'|'manual' }
export interface IbanLink { iban: string; contactId: string; confirmedAt: string }
export interface Invoice { id: string; company: Company; source: 'lexware'|'stripe'; connectionId: ConnectionId; externalId: string; contactId: string | null; number: string; totalCents: number; openCents: number; issuedOn: IsoDate; dueDate: IsoDate; status: 'open'|'paid'|'overdue'|'void'; text?: string; settledByPaymentId?: string }
export interface Message { id: string; channel: 'whatsapp'|'email'; connectionId: ConnectionId; externalId: string; threadId: string; direction: 'in'|'out'; from: string; to: string; body: string; sentAt: string; contactId: string | null; jobId: string | null; needsReply: boolean; doneManually?: boolean }
export interface Commitment { id: string; messageId: string; contactId: string; kind: 'invoice'|'callback'|'other'; text: string; dueAt: string; status: 'open'|'kept'|'broken' }
export interface CalendarEvent { id: string; title: string; startAt: string; endAt: string; location?: string }
export interface Call { id: string; series: string; startsAt: string; topic: string; slideCount: number; slidesStatus: 'todo'|'draft'|'reviewed'|'copied'; slides: { position: number; title: string; body: string }[] }
export interface ContentItem { id: string; title: string; stage: 'idea'|'raw'|'edit'|'approval'|'published'; due?: IsoDate }
export interface Vehicle { id: string; contactId: string; vin: string; plate: string; model: string }
export interface Job { id: string; vehicleId: string; contactId: string; service: string; location: 'bottrop'|'essen'|'online'|'onsite'; priceCents: number; status: 'open'|'waiting_customer'|'done'|'invoiced'|'paid'; doneAt: string | null; invoiceIds: string[]; notes?: string }
export type InsightType = 'reply_waiting'|'member_overdue'|'unmatched_payment'|'stripe_paid_lexware_open'|'double_invoice'|'job_not_invoiced'|'invoice_overdue'|'call_slides_missing'|'commitment_broken'|'stale_source'|'coach_quick_reply'|'coach_due_day'|'coach_onsite_surcharge'|'coach_invoice_delay';
export interface Ref { kind: 'member'|'message'|'thread'|'invoice'|'job'|'call'|'payment'|'connection'; id: string; href: string; label: string }
export interface Insight { dedupeKey: string; type: InsightType; company: Company | null; priority: 'now'|'today'|'info'; title: string; body: string; amountCents?: number; refs: Ref[]; nextStep: string; needsSources: ConnectionId[] }
export interface StoredInsight extends Insight { status: 'open'|'done'|'snoozed'|'dismissed'; createdAt: string; resolvedAt?: string }
export interface Settings { replyThresholdHours: number; briefingsEnabled: boolean; ownerPhone: string; suppressedCoachKeys: string[] }
export interface AppState { connections: Connection[]; contacts: Contact[]; contracts: MemberContract[]; exceptions: Record<string, ContractException[]>; payments: Payment[]; allocations: Allocation[]; ibanLinks: IbanLink[]; invoices: Invoice[]; messages: Message[]; commitments: Commitment[]; events: CalendarEvent[]; calls: Call[]; content: ContentItem[]; vehicles: Vehicle[]; jobs: Job[]; insights: StoredInsight[]; actions: Action[]; audit: AuditEntry[]; jobRuns: string[]; assistantChat: AssistantMessage[]; settings: Settings }
```

`Action`, `AuditEntry` und `AssistantMessage` definiert Task 8 bzw. Task 14 in `types.ts`.

- `buildSchedule(c: MemberContract, ex: ContractException[]): Installment[]` in `ledger/schedule.ts`

- [ ] **Step 1: Failing tests**

```ts
const base = { id:'c1', contactId:'m1', totalCents:120000, installments:4, installmentCents:30000, dueDay:1, startDate:'2026-10-01', billing:'legacy', catchUpMode:'first_rate' } as const;
test('vier Raten monatlich ab Start', () => expect(buildSchedule(base, []).map(i=>[i.dueDate,i.amountCents])).toEqual([['2026-10-01',30000],['2026-11-01',30000],['2026-12-01',30000],['2027-01-01',30000]]));
test('letzte Rate fängt Rest auf', () => expect(buildSchedule({...base, totalCents:100000, installmentCents:33333, installments:3}, []).map(i=>i.amountCents)).toEqual([33333,33333,33334]));
test('Fälligkeitstag 31 → Monatsende', () => expect(buildSchedule({...base, dueDay:31, startDate:'2027-01-31'}, []).map(i=>i.dueDate)).toEqual(['2027-01-31','2027-02-28','2027-03-31','2027-04-30']));
test('Stundung verschiebt Raten im Zeitraum auf "bis"', () => expect(buildSchedule(base, [{kind:'deferral', from:'2026-11-01', to:'2026-11-20'}])[1].dueDate).toBe('2026-11-20'));
test('Pause verschiebt alle folgenden Raten', () => expect(buildSchedule(base, [{kind:'pause', from:'2026-11-01', months:1}]).map(i=>i.dueDate)).toEqual(['2026-10-01','2026-12-01','2027-01-01','2027-02-01']));
test('Fälligkeitstag ändern ab Datum', () => expect(buildSchedule(base, [{kind:'due_day_shift', from:'2026-12-01', newDueDay:5}]).map(i=>i.dueDate)).toEqual(['2026-10-01','2026-11-01','2026-12-05','2027-01-05']));
```

- [ ] **Step 2:** `npx vitest run tests/unit/ledger/schedule.test.ts` → FAIL.
- [ ] **Step 3:** Implementieren. Reihenfolge der Ausnahmen: erst `pause`, dann `due_day_shift`, dann `deferral`.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit `feat(ledger): Fachtypen und Ratenplan`.

---

### Task 3: Zahlungsverteilung und Mitgliedsstatus

**Files:**
- Create: `src/domain/ledger/allocate.ts`, `src/domain/ledger/status.ts`
- Test: `tests/unit/ledger/status.test.ts`

**Interfaces:**
- Consumes: `buildSchedule`, Typen aus Task 2
- Produces: `allocate(schedule: Installment[], paid: {bookedOn: IsoDate; amountCents: number}[]): {states: InstallmentState[]; overpaidCents: number}` · `memberStatus(states: InstallmentState[], overpaidCents: number, today: IsoDate): MemberStatus` mit `MemberStatus = {dueCents; paidCents; arrearsCents; futureCents; openCents; traffic: 'green'|'yellow'|'red'; oldestUnpaidDue: IsoDate | null; daysOverdue: number; nextDue: Installment | null; steps: string[]}`. `steps` ist der Rechenweg in deutschen Sätzen für die UI.

- [ ] **Step 1: Failing tests (Referenzbeispiel der Spec)**

```ts
const s = buildSchedule(base, []); // aus Task 2
const { states, overpaidCents } = allocate(s, [{bookedOn:'2026-10-02', amountCents:30000},{bookedOn:'2026-11-03', amountCents:15000}]);
const st = memberStatus(states, overpaidCents, '2026-11-12');
expect([st.dueCents, st.paidCents, st.arrearsCents, st.futureCents, st.openCents]).toEqual([60000,45000,15000,60000,75000]);
expect(st.traffic).toBe('red'); expect(st.oldestUnpaidDue).toBe('2026-11-01'); expect(st.daysOverdue).toBe(11);
// gelb: älteste offene Rate ≤ 7 Tage
expect(memberStatus(states, overpaidCents, '2026-11-05').traffic).toBe('yellow');
// grün
expect(memberStatus(allocate(s,[{bookedOn:'2026-10-01',amountCents:60000}]).states, 0, '2026-11-12').traffic).toBe('green');
// Überzahlung mindert künftige Raten, nie negativ
const over = allocate(s, [{bookedOn:'2026-10-01', amountCents:70000}]);
const so = memberStatus(over.states, over.overpaidCents, '2026-11-12');
expect([so.arrearsCents, so.futureCents, so.openCents]).toEqual([0,50000,50000]);
expect(memberStatus(allocate(s,[{bookedOn:'2026-10-01',amountCents:130000}]).states, 10000, '2026-11-12').openCents).toBe(0);
```

- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren: Zahlungen nach `bookedOn` sortiert auf die älteste offene Rate verteilen, Überschuss auf die nächste. `paidOn` = Datum der Zahlung, die die Rate vollständig macht. Nach der letzten Rate übrig bleibt `overpaidCents`.
- [ ] **Step 4:** → PASS. **Step 5:** Commit `feat(ledger): Zahlungsverteilung und Mitgliedsstatus`.

---

### Task 4: Übernahme und Monatsvorschau

**Files:**
- Create: `src/domain/ledger/takeover.ts`, `src/domain/ledger/forecast.ts`
- Test: `tests/unit/ledger/takeover.test.ts`, `tests/unit/ledger/forecast.test.ts`

**Interfaces:**
- Consumes: `InstallmentState`, `memberStatus`
- Produces: `planTakeover(states: InstallmentState[], today: IsoDate, mode: 'first_rate'|'spread'): TakeoverPlan` mit `TakeoverPlan = {arrearsCents; futureCents; openCents; rates: Installment[]; mode}` · `monthForecast(members: {status: MemberStatus; states: InstallmentState[]}[], month: 'YYYY-MM', today: IsoDate): {expectedCents: number; atRiskCents: number}`

- [ ] **Step 1: Failing tests**

```ts
// Referenzbeispiel (states aus Task 3)
const a = planTakeover(states, '2026-11-12', 'first_rate');
expect([a.arrearsCents, a.futureCents, a.openCents]).toEqual([15000,60000,75000]);
expect(a.rates.map(r=>[r.dueDate,r.amountCents])).toEqual([['2026-12-01',45000],['2027-01-01',30000]]);
const b = planTakeover(states, '2026-11-12', 'spread');
expect(b.rates.map(r=>r.amountCents)).toEqual([37500,37500]);
// Rundungsrest auf letzte Rate
const odd = allocate(buildSchedule({...base,totalCents:100001,installmentCents:25000},[]), [{bookedOn:'2026-10-01',amountCents:25000}]);
const c = planTakeover(odd.states, '2026-11-12', 'spread'); // Rückstand 25000 + künftig 50001 = 75001 auf 2 Raten
expect(c.rates.map(r=>r.amountCents)).toEqual([37500,37501]);
expect(c.rates.reduce((x,r)=>x+r.amountCents,0)).toBe(c.openCents);
// keine künftige Rate, aber Rückstand → eine Rate heute
const all = allocate(s, []); expect(planTakeover(all.states, '2027-02-01', 'first_rate').rates).toEqual([{no:1, dueDate:'2027-02-01', amountCents:120000}]);
// Vorschau
const f = monthForecast([{status: st, states}], '2026-11', '2026-11-12');
expect(f).toEqual({ expectedCents: 15000, atRiskCents: 15000 }); // Rest der Novemberrate, Ampel rot
```

`monthForecast` definiert: `expectedCents` = noch nicht bezahlter Anteil aller Raten mit Fälligkeit im Monat. `atRiskCents` = davon der Anteil von Mitgliedern mit Ampel gelb oder rot.

- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(ledger): Übernahme und Monatsvorschau`.

---

### Task 5: Importe und Zahlungszuordnung

**Files:**
- Create: `src/domain/matching/imports.ts`, `src/domain/matching/payments.ts`
- Test: `tests/unit/matching/payments.test.ts`

**Interfaces:**
- Produces: `importKey(x: {connectionId: ConnectionId | null; externalId: string}): string` (`${connectionId}:${externalId}`) · `mergeImported<T extends {connectionId: ConnectionId | null; externalId: string}>(existing: T[], incoming: T[]): T[]` (bestehende gewinnen) · `classifyBankTx(t: {payerName?: string; reference?: string}): 'incoming'|'stripe_payout'` · `normalizeName(s: string): string` · `matchBankPayment(p: Payment, ctx: {contacts: Contact[]; ibanLinks: IbanLink[]; expected: Map<string, {nextRateCents: number; arrearsCents: number}>}): {contactId: string | null; confidence: 'high'|'medium'|'low'; reason: string}`

- [ ] **Step 1: Failing tests**

```ts
test('erneuter Import ändert nichts', () => expect(mergeImported([p1], [p1, {...p1}]).length).toBe(1));
test('Stripe-Auszahlung erkannt', () => {
  expect(classifyBankTx({payerName:'Stripe Technologies Europe Ltd'})).toBe('stripe_payout');
  expect(classifyBankTx({reference:'STRIPE PAYOUT po_1QxYz'})).toBe('stripe_payout');
  expect(classifyBankTx({payerName:'Mehmet Kaya', reference:'Rate November'})).toBe('incoming');
});
test('hoch: bestätigte IBAN + Betrag = nächste Rate', () => expect(matchBankPayment(tx({iban:IBAN_KAYA, amountCents:30000}), ctx).confidence).toBe('high'));
test('hoch: bestätigte IBAN + Betrag = Rückstand', () => expect(matchBankPayment(tx({iban:IBAN_KAYA, amountCents:15000}), ctx).confidence).toBe('high'));
test('mittel: bestätigte IBAN, anderer Betrag', () => expect(matchBankPayment(tx({iban:IBAN_KAYA, amountCents:12345}), ctx).confidence).toBe('medium'));
test('mittel: Name + Betrag ohne IBAN-Verknüpfung', () => expect(matchBankPayment(tx({iban:'DE00UNBEKANNT', payerName:'S. Yilmaz', amountCents:30000}), ctx)).toMatchObject({contactId:'m-yilmaz', confidence:'medium'}));
test('niedrig: unbekannter Dritter', () => expect(matchBankPayment(tx({iban:'DE00X', payerName:'Firma XY GmbH', amountCents:90000}), ctx)).toMatchObject({contactId:null, confidence:'low'}));
test('Stripe-Auszahlung wird nie Mitglied zugeordnet', () => expect(matchBankPayment(tx({payerName:'Stripe', kind:'stripe_payout', amountCents:30000, iban:IBAN_KAYA}), ctx)).toMatchObject({contactId:null, confidence:'low'}));
```

Namensregel: `normalizeName` (klein, ä→ae, ö→oe, ü→ue, ß→ss, Satzzeichen weg). Passt, wenn der Nachname des Kontakts als Wort im Zahlernamen vorkommt **und** Vorname oder dessen Initiale vorkommt.

- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(matching): Importe und Zahlungszuordnung`.

---

### Task 6: Nachrichten-Zuordnung und Antwortpflicht

**Files:**
- Create: `src/domain/matching/messages.ts`
- Test: `tests/unit/matching/messages.test.ts`

**Interfaces:**
- Produces: `normalizePhone(s: string): string` (E.164, `0151…` → `+49151…`) · `extractPlates(text: string): string[]` (Format `GE-AS 123`, `BOT MK 456`, normalisiert zu `GE-AS 123`) · `extractVins(text: string): string[]` (17 Zeichen `[A-HJ-NPR-Z0-9]`) · `matchMessage(m: Pick<Message,'from'|'to'|'direction'|'body'>, contacts: Contact[], vehicles: Vehicle[], jobs: Job[]): {contactId: string | null; jobId: string | null}` · `openReplies(messages: Message[], now: Date, thresholdHours: number): {message: Message; waitingHours: number}[]`

- [ ] **Step 1: Failing tests**

```ts
expect(normalizePhone('0151 234 567')).toBe('+49151234567');
expect(extractPlates('Ist der Golf GE-AS 123 fertig?')).toEqual(['GE-AS 123']);
expect(matchMessage({direction:'in', from:'+49209111222', to:'', body:'Hallo'}, contacts, vehicles, jobs).contactId).toBe('d-schmidt');
expect(matchMessage({direction:'in', from:'+49000', to:'', body:'Wegen BOT-MK 456'}, contacts, vehicles, jobs)).toEqual({contactId:'d-mueller', jobId:'j-mueller-1'});
// Antwortpflicht
const inMsg = msg({id:'a', threadId:'t1', direction:'in', needsReply:true, sentAt:'2026-11-12T05:30:00Z'});
expect(openReplies([inMsg], NOW_0930, 2)).toEqual([{message: inMsg, waitingHours: 3}]);
expect(openReplies([inMsg, msg({threadId:'t1', direction:'out', sentAt:'2026-11-12T06:00:00Z'})], NOW_0930, 2)).toEqual([]);
test('Antwort im anderen Thread schließt nicht', () => expect(openReplies([inMsg, msg({threadId:'t2', direction:'out', sentAt:'2026-11-12T06:00:00Z', to: inMsg.from})], NOW_0930, 2)).toHaveLength(1));
test('unter Schwelle nicht gemeldet', () => expect(openReplies([inMsg], new Date('2026-11-12T06:30:00Z'), 2)).toEqual([]));
expect(openReplies([{...inMsg, doneManually:true}], NOW_0930, 2)).toEqual([]);
```

`waitingHours` wird abgerundet. `matchMessage` versucht der Reihe nach: Telefon, E-Mail, Kennzeichen, FIN. Ein Kennzeichen oder eine FIN setzt auch `jobId` auf den jüngsten nicht bezahlten Auftrag des Fahrzeugs.

- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(matching): Nachrichten und Antwortpflicht`.

---

### Task 7: Datenstand, Detektoren und Hinweis-Lebenszyklus

**Files:**
- Create: `src/domain/freshness.ts`, `src/domain/detectors/index.ts`, `src/domain/detectors/{replies,members,payments,invoices,jobs,calls,commitments,sources}.ts`
- Test: `tests/unit/detectors.test.ts`, `tests/unit/freshness.test.ts`

**Interfaces:**
- Consumes: Tasks 2–6
- Produces: `sourceFreshness(c: Connection, now: Date): 'fresh'|'stale'|'error'|'missing'` (stale = `lastSuccessAt` älter als 45 Min.) · `areaStale(sources: ConnectionId[], connections: Connection[], now: Date): ConnectionId[]` (liefert die veralteten Quellen) · `runDetectors(s: AppState, now: Date): Insight[]` · `selectTop(list: StoredInsight[], max = 3): StoredInsight[]` · `reconcileInsights(existing: StoredInsight[], fresh: Insight[], now: Date): StoredInsight[]` · `memberView(s: AppState, contractId: string, today: IsoDate): {contract; contact; schedule; states; status: MemberStatus}` (Hilfsfunktion in `detectors/members.ts`, auch von der UI genutzt)

**Detektoren (Typ → Auslöser → Priorität → Quellen → `dedupeKey`):**

| Typ | Auslöser | Prio | needsSources | dedupeKey |
|---|---|---|---|---|
| `reply_waiting` | Eintrag aus `openReplies` | `now` ab 3 Std. bei `dealer`, sonst `today` | Kanal-Verbindung | `reply:<messageId>` |
| `member_overdue` | ein Hinweis pro Mitglied mit Ampel rot/gelb **und** ein Sammelhinweis „N Mitglieder überfällig, zusammen X“ | Sammel `today`, einzeln `info` | `bank`, `stripe_nexus` | `overdue:<contractId>` / `overdue:all:<today>` |
| `unmatched_payment` | `incoming`-Zahlung ohne Allocation und ohne `high` | `today` | `bank` | `unmatched:<paymentId>` |
| `stripe_paid_lexware_open` | Stripe-Zahlung mit `reference` = Lexware-Rechnungsnummer, Rechnung `open`, ohne `settledByPaymentId` | `today` | `stripe_nexus`, `lexware_nexus` | `stripe-lex:<invoiceId>` |
| `double_invoice` | gleicher Kontakt, Lexware- und Stripe-Rechnung mit gleichem Betrag innerhalb von 7 Tagen | `today` | beide | `double:<lexId>:<stripeId>` |
| `job_not_invoiced` | Auftrag `done`, Summe der `invoiceIds` < `priceCents` | `today` | `lexware_zulassung` | `job-inv:<jobId>` |
| `invoice_overdue` | offene Rechnung, `dueDate` < heute, pro Kontakt zusammengefasst | `info` | jeweilige Lexware-Verbindung | `inv-over:<contactId>` |
| `call_slides_missing` | Call heute oder morgen, `slidesStatus` = `todo` | `now` am Call-Tag | `calendar` | `slides:<callId>` |
| `commitment_broken` | `commitment.status = 'open'` und `dueAt` < now | `today` | Kanal-Verbindung | `commit:<id>` |
| `stale_source` | Verbindung `error` oder stale | `info` | – | `stale:<connectionId>` |

Hinweise, deren `needsSources` veraltet sind, werden **nicht** erzeugt. Die UI zeigt für den Bereich stattdessen „Datenstand zu alt“ (über `areaStale`). Der Text jedes Hinweises nennt den nächsten Schritt in `nextStep`, z. B. „Antwort senden“, „Erinnerung vorbereiten“, „Rechnung zuordnen“, „Folientexte vorbereiten“.

- [ ] **Step 1: Failing tests** (Fixtures als kleine Inline-`AppState`-Bausteine. Die Test-Helper `stateWith`, `conn`, `inv`, `ins`, `msg`, `tx`, `types`, `find`, `open`, `isOpen`, `contractOf` liegen gesammelt in `tests/unit/helpers.ts` und werden in den Tasks 5–11 nach Bedarf ergänzt.)

```ts
expect(sourceFreshness(conn({lastSuccessAt:'2026-11-12T07:40:00Z'}), NOW_0930)).toBe('stale'); // 50 Min.
expect(sourceFreshness(conn({lastSuccessAt:'2026-11-12T08:00:00Z'}), NOW_0930)).toBe('fresh');
expect(types(runDetectors(stateWith({messages:[schmidtIn]}), NOW_0930))).toContain('reply_waiting');
test('veraltete Quelle → kein Hinweis aus ihr', () => expect(types(runDetectors(stateWith({jobs:[muellerDone], connections:[conn({id:'lexware_zulassung', status:'error'})]}), NOW_0930))).not.toContain('job_not_invoiced'));
test('Teilrechnung reicht nicht', () => expect(find(runDetectors(stateWith({jobs:[{...muellerDone, invoiceIds:['i40']}], invoices:[inv('i40', 4000)]}), NOW_0930), 'job_not_invoiced').amountCents).toBe(4900)); // Preis 8900
test('voll abgerechnet → kein Hinweis', () => expect(types(runDetectors(stateWith({jobs:[{...muellerDone, invoiceIds:['i89']}], invoices:[inv('i89', 8900)]}), NOW_0930))).not.toContain('job_not_invoiced'));
// Lebenszyklus
const r1 = reconcileInsights([], [ins('k1')], NOW_0930);           expect(r1[0].status).toBe('open');
const r2 = reconcileInsights(r1, [], NOW_0930);                     expect(r2[0].status).toBe('done');
const r3 = reconcileInsights([{...r1[0], status:'dismissed'}], [ins('k1')], NOW_0930); expect(r3[0].status).toBe('dismissed');
expect(reconcileInsights(r1, [ins('k1'), ins('k1')], NOW_0930)).toHaveLength(1);
// Top 3
expect(selectTop(list5).map(i=>i.priority)).toEqual(['now','now','today']);
```

`selectTop` sortiert nach Priorität (`now` > `today` > `info`), dann nach `amountCents` absteigend, dann nach `createdAt`. Nur Status `open`.

- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(detectors): Datenstand, Hinweise und Lebenszyklus`.

---

### Task 8: Aktionen-Zustandsmaschine

**Files:**
- Create: `src/domain/actions/machine.ts`, `src/domain/actions/demo-provider.ts`; Typen `Action`, `AuditEntry` in `types.ts` ergänzen
- Test: `tests/unit/actions.test.ts`

**Interfaces:**
- Produces:

```ts
export type ActionType = 'send_whatsapp'|'send_email'|'send_reminder'|'create_invoice_draft'|'create_calendar_event'|'mark_invoice_settled'|'link_invoice_to_job'|'confirm_payment_match';
export type ActionStatus = 'draft'|'approved'|'executing'|'executed'|'failed'|'uncertain'|'cancelled';
export interface Action { id: string; type: ActionType; company: Company | null; title: string; payload: Record<string, unknown>; version: number; status: ActionStatus; createdAt: string; approvedVia?: 'app'|'whatsapp'|'auto'; approvedAt?: string; executedAt?: string; error?: string; isDemo: true; insightKey?: string }
export interface AuditEntry { at: string; actor: 'owner'|'assistant'|'system'; text: string; actionId?: string; isDemo: boolean }
editDraft(a: Action, payload: Record<string, unknown>): Action
approve(a: Action, req: { version: number; via: 'app'|'whatsapp'; buttonIssuedAt?: string }, now: Date): { ok: true; action: Action } | { ok: false; reason: 'stale_version'|'not_draft'|'already_approved'|'expired' }
startExecution(a: Action): Action
finishExecution(a: Action, result: 'ok'|'error'|'timeout', now: Date, error?: string): Action
reconcileUncertain(a: Action, foundAtProvider: boolean, now: Date): Action
retry(a: Action): Action
idempotencyKey(a: Action): string   // `${a.id}:${a.version}`
interface ActionProvider { execute(a: Action, key: string): Promise<'ok'|'error'|'timeout'>; lookup(key: string): Promise<boolean> }
class DemoProvider implements ActionProvider  // merkt sich ausgeführte Schlüssel, führt nie extern aus
```

- [ ] **Step 1: Failing tests**

```ts
const d = draft();                                         // version 1, status draft
expect(editDraft(d, {text:'neu'}).version).toBe(2);
expect(approve(d, {version:1, via:'app'}, NOW).ok).toBe(true);
test('doppelt tippen', () => { const a = (approve(d,{version:1,via:'app'},NOW) as any).action; expect(approve(a,{version:1,via:'app'},NOW)).toEqual({ok:false, reason:'already_approved'}); });
test('alter Knopf nach Änderung', () => expect(approve(editDraft(d,{text:'x'}), {version:1, via:'whatsapp', buttonIssuedAt:'2026-11-12T08:00:00Z'}, NOW)).toEqual({ok:false, reason:'stale_version'}));
test('Knopf älter als 24 Std.', () => expect(approve(d, {version:1, via:'whatsapp', buttonIssuedAt:'2026-11-11T07:00:00Z'}, NOW)).toEqual({ok:false, reason:'expired'}));
test('Timeout → ausgang unklar, kein Retry ohne Abgleich', () => {
  const u = finishExecution(startExecution(approved()), 'timeout', NOW);
  expect(u.status).toBe('uncertain');
  expect(() => retry(u)).toThrow();
  expect(reconcileUncertain(u, true, NOW).status).toBe('executed');
  expect(reconcileUncertain(u, false, NOW).status).toBe('failed');
});
expect(retry(finishExecution(startExecution(approved()), 'error', NOW, 'x')).status).toBe('approved');
test('DemoProvider idempotent', async () => { const p = new DemoProvider(); await p.execute(a, 'k'); expect(await p.lookup('k')).toBe(true); expect(p.executedCount('k')).toBe(1); await p.execute(a,'k'); expect(p.executedCount('k')).toBe(1); });
```

- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren (ungültige Übergänge werfen `Error('Ungültiger Übergang: <von> → <nach>')`). **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(actions): Freigabe-Zustandsmaschine`.

---

### Task 9: Zeitsteuerung, Zustellung und Briefing

**Files:**
- Create: `src/domain/scheduler.ts`, `src/domain/briefing.ts`
- Test: `tests/unit/scheduler.test.ts`, `tests/unit/briefing.test.ts`

**Interfaces:**
- Consumes: `clock.ts`, `selectTop`, `areaStale`, `memberView`, `monthForecast`
- Produces: `type JobName = 'sync'|'briefing_morning'|'review_evening'|'review_weekly'` · `dueRuns(nowUtc: Date, existingKeys: Set<string>, settings: Pick<Settings,'briefingsEnabled'>): {key: string; job: JobName; scheduledFor: string}[]` (Schlüssel `job:YYYY-MM-DD:HH:mm` in Berlin-Zeit; ein Slot ist fällig, wenn `0 ≤ now − slot < 2 Std.`; Sync nur der jüngste fällige 15-Min.-Slot; `review_weekly` sonntags 19:00) · `chooseDelivery(o: {waConfigured: boolean; windowOpenUntil: string | null; templateApproved: boolean}, now: Date): 'whatsapp_freeform'|'whatsapp_template'|'push'` · `buildBriefing(s: AppState, kind: 'morning'|'evening', now: Date): Briefing` mit `Briefing = {kind; title; top: StoredInsight[]; events: CalendarEvent[]; money: {company: Company; openCents: number; overdueCents: number; stale: boolean}[]; repliesOpen: number; coach: StoredInsight[]; dataAsOf: string; staleSources: ConnectionId[]}` · `renderBriefingText(b: Briefing): string`

- [ ] **Step 1: Failing tests**

```ts
const keys = (d: string, ex = new Set<string>()) => dueRuns(new Date(d), ex, {briefingsEnabled:true}).map(r=>r.key);
expect(keys('2026-11-12T06:02:00Z')).toContain('briefing_morning:2026-11-12:07:00');
expect(keys('2026-03-29T05:01:00Z')).toContain('briefing_morning:2026-03-29:07:00');   // Sommerzeit
expect(keys('2026-10-25T06:01:00Z')).toContain('briefing_morning:2026-10-25:07:00');   // Winterzeit
expect(keys('2026-10-25T05:01:00Z')).not.toContain('briefing_morning:2026-10-25:07:00'); // 06:01 Ortszeit
test('doppelter Takt → kein zweiter Lauf', () => expect(keys('2026-11-12T06:07:00Z', new Set(['briefing_morning:2026-11-12:07:00']))).not.toContain('briefing_morning:2026-11-12:07:00'));
expect(keys('2026-11-12T06:02:00Z').filter(k=>k.startsWith('sync:'))).toEqual(['sync:2026-11-12:07:00']);
expect(dueRuns(new Date('2026-11-12T06:02:00Z'), new Set(), {briefingsEnabled:false}).map(r=>r.job)).not.toContain('briefing_morning');
expect(keys('2026-11-15T18:03:00Z')).toContain('review_weekly:2026-11-15:19:00');      // Sonntag
// Zustellung
expect(chooseDelivery({waConfigured:true, windowOpenUntil:'2026-11-12T10:00:00Z', templateApproved:true}, NOW)).toBe('whatsapp_freeform');
expect(chooseDelivery({waConfigured:true, windowOpenUntil:'2026-11-12T07:00:00Z', templateApproved:true}, NOW)).toBe('whatsapp_template');
expect(chooseDelivery({waConfigured:true, windowOpenUntil:null, templateApproved:false}, NOW)).toBe('push');
expect(chooseDelivery({waConfigured:false, windowOpenUntil:'2026-11-12T10:00:00Z', templateApproved:true}, NOW)).toBe('push');
// Briefing
const b = buildBriefing(createDemoStateForTests(), 'morning', NOW);
expect(b.top.length).toBeLessThanOrEqual(3);
expect(renderBriefingText(b)).toMatch(/^Guten Morgen/);
expect(renderBriefingText(b)).toContain('Stand: 09:30');
```

`renderBriefingText` (Morgen) hat dieses Format: `Guten Morgen. {n} Dinge heute:` · nummerierte Top-Hinweise mit `title · nextStep` · `Termine:` · `Geld NEXUS: offen X, überfällig Y` · `Geld Zulassungsdienst: …` (bei veralteter Quelle `Datenstand zu alt`) · `Stand: HH:mm`. Abends beginnt der Text mit `Guten Abend. Rückblick:` und enthält am Ende die Coach-Tipps.

`createDemoStateForTests` kommt aus Task 10. Den Briefing-Test schreibt man in diesem Task, führt ihn aber erst nach Task 10 aus. Alternativ verschiebt man den `buildBriefing`-Teil an den Anfang von Task 10.

- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** Scheduler-Tests → PASS.
- [ ] **Step 5:** Commit `feat(scheduler): Zeitsteuerung, Zustellung, Briefing`.

---

### Task 10: Demo-Daten, Coach und Store

**Files:**
- Create: `src/data/seed.ts`, `src/domain/coach.ts`, `src/data/store.tsx`, `src/data/selectors.ts`
- Test: `tests/unit/seed.test.ts`, `tests/unit/coach.test.ts`, `tests/unit/store.test.ts`

**Interfaces:**
- Consumes: alles aus `src/domain`
- Produces: `createDemoState(): AppState` (deterministisch, ohne `Math.random`; nutzt einen festen Seed-PRNG) · `createDemoStateForTests = createDemoState` · `runCoach(s: AppState, now: Date): Insight[]` (Regeln aus Spec 4a „Coach“, Typen `coach_*`, `priority: 'info'`, ohne Einträge aus `settings.suppressedCoachKeys`) · `refresh(s: AppState, now: Date): AppState` (Auto-Zuordnung `high`, Commitments auf `broken` setzen, `reconcileInsights(runDetectors + runCoach)`) · `reducer(s: AppState, e: StoreEvent): AppState` · `<AppStoreProvider>`, `useAppStore(): {state; dispatch}` · Store-Schlüssel in localStorage: `nexus-demo-v1`

`StoreEvent` (alle Ereignisse rufen danach `refresh`):
`confirmPaymentMatch {paymentId, contractId}` (Allocation `confirmed` + `IbanLink`) · `simulateTransfer {iban, payerName, amountCents}` (neue Bankzahlung) · `settleInvoice {invoiceId, paymentId}` · `linkInvoiceToJob {jobId, invoiceId}` · `setJobStatus {jobId, status}` · `createAction {action}` · `editAction {id, payload}` · `approveAction {id, version, via, buttonIssuedAt?}` · `actionExecuted {id, result}` (setzt Effekte: `send_whatsapp`/`send_email`/`send_reminder` → ausgehende Nachricht im selben Thread) · `dismissInsight {key}` · `snoozeInsight {key}` · `suppressCoach {key}` · `setSlides {callId, slides, status}` · `setConnectionStatus {id, status}` · `assistantInbound {from, text}` · `assistantOutbound {text, buttons?}` · `resetDemo`

**Pflichtinhalt der Demo-Daten** (die E2E-Tests verlassen sich darauf; IDs exakt so):

| Inhalt | Werte |
|---|---|
| 40 NEXUS-Mitglieder | gemischt `legacy`/`stripe`, Starts Aug–Nov 2026, 6 oder 12 Raten, mindestens 3 mit `specialTerms`, mindestens 4 gelb/rot |
| `m-kaya` „Mehmet Kaya“ | Referenzbeispiel: 1.200 €, 4 × 300 €, Start 2026-10-01, Tag 1, `legacy`, Zahlungen 300 € am 2026-10-02 + 150 € am 2026-11-03, IBAN `DE89370400440532013000` verknüpft |
| `m-yilmaz` „Selin Yilmaz“ | `legacy`, Rate 300 €, keine IBAN-Verknüpfung; offene Bankbuchung `p-yilmaz-1`: 300 € von „S. Yilmaz“, IBAN `DE02120300000000202051`, 2026-11-11 |
| `m-schulz` „Anna Schulz“ | `stripe`, Lexware-Rechnung `i-lex-118` „RE-2026-118“ 250 € offen, Stripe-Zahlung `p-stripe-118` 250 € mit `reference: 'RE-2026-118'` |
| Stripe-Auszahlung | Bankbuchung `p-payout-1` „Stripe Technologies Europe Ltd“, 1.480 €, `kind: 'stripe_payout'` |
| `d-schmidt` „Autohaus Schmidt“ | Händler, Telefon `+49209111222`. Fahrzeug Golf `GE-AS 123`, Auftrag `j-schmidt-1` Umschreibung, `waiting_customer`. WhatsApp-Thread `t-schmidt`: eingehende Nachricht `m-schmidt-in-1` am 2026-11-12 06:30 Berlin „Guten Morgen, ist der Golf GE-AS 123 heute fertig?“ (`needsReply`) |
| `d-mueller` „Autohaus Müller“ | Fahrzeug `BOT-MK 456`, Auftrag `j-mueller-1` Umschreibung, Preis 89 €, `done` am 2026-11-10, ohne Rechnung. Lexware-Zulassung-Rechnung `i-z-311` „RE-Z-2026-311“ 89 €, Text „Umschreibung BOT-MK 456“, nicht verknüpft. Außerdem 2 überfällige Rechnungen, zusammen 640 € |
| `p-demir` „Herr Demir“ | Privatkunde. Ausgehende WhatsApp am 2026-11-10 „Die Rechnung schicke ich Ihnen morgen.“, Commitment `c-demir` (`invoice`, fällig 2026-11-11 18:00), keine Rechnung danach |
| Calls | `call-seele` „SEELE“ heute 20:00, 10 Folien, `todo` · `call-finance` „Finance“ 2026-11-19 19:00, 6 Folien, `todo` |
| Coach-Auslöser | 3 gleiche ausgehende WhatsApps „Für die Umschreibung brauchen wir: ZB I + II, eVB, Ausweis, Vollmacht, SEPA-Mandat.“ in den letzten 7 Tagen · Mitglied `m-becker` mit 3 Zahlungen jeweils 5 Tage nach Fälligkeit · ein `onsite`-Auftrag mit Rechnung ohne Aufpreis-Position |
| Termine heute | 3 Termine, einer ohne `location` |
| Content | 5 Einträge über alle Stufen |
| Verbindungen | alle `connected`, `lastSuccessAt` = 2026-11-12 09:20 Berlin, `whatsapp_assistent` connected |
| Einstellungen | `replyThresholdHours: 2`, `briefingsEnabled: true`, `ownerPhone: '+491510000000'` |

- [ ] **Step 1: Failing tests**

```ts
const s = refresh(createDemoState(), NOW);
expect(s.contracts).toHaveLength(40);
expect(memberView(s, contractOf(s,'m-kaya'), '2026-11-12').status.arrearsCents).toBe(15000);
expect(types(open(s))).toEqual(expect.arrayContaining(['reply_waiting','member_overdue','unmatched_payment','stripe_paid_lexware_open','job_not_invoiced','call_slides_missing','commitment_broken','coach_quick_reply','coach_due_day','coach_onsite_surcharge']));
expect(s.allocations.find(a=>a.paymentId==='p-payout-1')).toBeUndefined();
expect(JSON.stringify(createDemoState())).toBe(JSON.stringify(createDemoState()));   // deterministisch
// Store-Abläufe
const s2 = reducer(s, {type:'confirmPaymentMatch', paymentId:'p-yilmaz-1', contractId: contractOf(s,'m-yilmaz')});
const s3 = reducer(s2, {type:'simulateTransfer', iban:'DE02120300000000202051', payerName:'Selin Yilmaz', amountCents:30000});
expect(s3.allocations.at(-1)).toMatchObject({method:'auto'});
expect(isOpen(reducer(s, {type:'linkInvoiceToJob', jobId:'j-mueller-1', invoiceId:'i-z-311'}), 'job-inv:j-mueller-1')).toBe(false);
expect(isOpen(reducer(s, {type:'settleInvoice', invoiceId:'i-lex-118', paymentId:'p-stripe-118'}), 'stripe-lex:i-lex-118')).toBe(false);
expect(isOpen(reducer(s, {type:'setConnectionStatus', id:'lexware_zulassung', status:'error'}), 'job-inv:j-mueller-1')).toBe(false); // unterdrückt, nicht erledigt-gemeldet
```

- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. Der Provider lädt beim Start aus localStorage, sonst `createDemoState()`, und speichert nach jedem Ereignis. **Step 4:** → PASS, inklusive des Briefing-Tests aus Task 9.
- [ ] **Step 5:** Commit `feat(data): Demo-Daten, Coach und Store`.

---

### Task 11: DemoAI

**Files:**
- Create: `src/ai/provider.ts`, `src/ai/demo-ai.ts`
- Test: `tests/unit/demo-ai.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ChatAnswer { text: string; links: { label: string; href: string }[] }
export interface AIProvider {
  answer(question: string, s: AppState, now: Date): Promise<ChatAnswer>;
  draftReply(thread: Message[], contact: Contact | null): Promise<string>;
  draftReminder(contact: Contact, status: MemberStatus, tone: 'freundlich'|'bestimmt', paymentLink: string): Promise<string>;
  slidesFor(call: Call): Promise<Call['slides']>;
  detectCommitment(text: string, sentAt: string): { kind: Commitment['kind']; dueAt: string } | null;
}
export const demoAI: AIProvider;
export const demoPaymentLink = (contractId: string) => `https://buy.stripe.com/demo/${contractId}`;
```

Die Absichten von `answer` werden über Schlüsselwörter erkannt (klein geschrieben, Umlaute normalisiert):

| Frage enthält | Antwort | Links |
|---|---|---|
| „überfällig“ | alle gelben/roten Mitglieder mit Rückstand, sortiert nach Betrag, plus Summe | je Mitglied `/nexus/mitglieder/<contractId>` |
| „heute“ + „offen“ | Anzahl offener Hinweise und die Top 3 mit `nextStep` | je `refs[0].href` |
| „seele“ (bzw. Call-Serie) | nächster Call der Serie, Uhrzeit, Folienstand `x/10` | `/nexus/calls/<id>` |
| „auftrag“ + Kontaktname | Status, letzte Nachricht mit Uhrzeit, wartet seit | `/zulassung/auftraege/<id>`, `/nachrichten/<threadId>` |
| „geld“ / „rein“ + „monat“ | NEXUS `monthForecast` (erwartet, davon wackelig) + offene Zulassungsrechnungen mit Fälligkeit im Monat | `/nexus`, `/zulassung` |
| sonst | „Das kann die Demo noch nicht beantworten. Ab Phase 2 beantwortet Claude jede Frage.“ | – |

`detectCommitment`: Treffer bei `/(schick|send)\w*.*rechnung|rechnung.*(schick|send)/i` → `invoice`, bei `/(ruf\w* .*zurück|melde mich)/i` → `callback`. Fälligkeit „heute“ → selber Tag 18:00, „morgen“ → nächster Tag 18:00, sonst +48 Std. (Berlin).
`slidesFor`: liefert genau `call.slideCount` Folien mit `title` „Folie n: …“ und mehrzeiligem `body`, thematisch zur `topic`.

- [ ] **Step 1: Failing tests**

```ts
const s = refresh(createDemoState(), NOW);
const a = await demoAI.answer('Wer ist bei NEXUS überfällig?', s, NOW);
for (const m of overdueMembers(s)) { expect(a.text).toContain(m.name); expect(a.links.map(l=>l.href)).toContain(`/nexus/mitglieder/${m.contractId}`); }
expect((await demoAI.answer('Was fehlt für SEELE?', s, NOW)).text).toContain('0/10');
expect((await demoAI.answer('Was ist mit dem Auftrag von Autohaus Schmidt?', s, NOW)).links.map(l=>l.href)).toContain('/zulassung/auftraege/j-schmidt-1');
expect((await demoAI.answer('Wie viel Geld kommt diesen Monat noch rein?', s, NOW)).text).toContain(formatEuro(nexusForecast(s).expectedCents));
expect((await demoAI.slidesFor(callById(s,'call-seele')))).toHaveLength(10);
expect(demoAI.detectCommitment('Die Rechnung schicke ich Ihnen morgen.', '2026-11-10T10:00:00Z')).toEqual({kind:'invoice', dueAt:'2026-11-11T17:00:00.000Z'});
expect(demoAI.detectCommitment('Danke, bis dann', '2026-11-10T10:00:00Z')).toBeNull();
```

`overdueMembers` und `nexusForecast` sind Selektoren in `src/data/selectors.ts`. Sie gehören zu diesem Task und werden auch von der UI genutzt.

- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(ai): DemoAI hinter AIProvider`.

---

### Task 12: App-Gerüst, Design-Bausteine und PWA

**Files:**
- Create: `src/app/layout.tsx`, `src/app/globals.css`, `src/app/manifest.ts`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/apple-touch-icon.png`, `public/sw.js`, `src/components/{AppShell,TabBar,Sidebar,ListGroup,ListRow,MoneyCard,TaskRow,DemoBadge,StaleNotice,AssistantButton}.tsx`
- Test: `tests/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `AppStoreProvider`
- Produces: `<AppShell>` (TabBar mobil / Sidebar ab 768px) · `<ListGroup title?>` · `<ListRow href? title subtitle? value? accessory? testId?>` · `<MoneyCard company openCents overdueCents stale>` · `<TaskRow insight onDone?>` · `<DemoBadge/>` (Text „Demo“) · `<StaleNotice sources/>` (Text „Datenstand zu alt, um das zu beurteilen“) · `<AssistantButton/>` (öffnet `/chat`)

`test-id`-Konvention für E2E: `tab-heute`, `tab-nexus`, `tab-zulassung`, `assistant-button`, `insight-row` (mit `data-key=<dedupeKey>`), `money-card-<company>`, `member-row-<contractId>`, `stale-notice`.

Die Tab-Leiste zeigt genau die Labels **Heute**, **NEXUS**, **Zulassungsdienst**. Die Seitenleiste enthält zusätzlich Chat, Assistent (WhatsApp), Verbindungen, Protokoll, Einstellungen. Mobil sind diese über „Mehr“ oben rechts auf Heute erreichbar. `manifest.ts`: `name: 'Nexus Assistent'`, `short_name: 'Nexus'`, `display: 'standalone'`, `lang: 'de'`, `start_url: '/'`, Icons. `sw.js` ist ein minimaler Offline-Cache der App-Shell, registriert in `layout.tsx`. In `layout.tsx` außerdem `apple-mobile-web-app-capable` und `viewport-fit=cover` mit Safe-Area-Abständen.

- [ ] **Step 1: Failing E2E**

```ts
test('mobil: drei Tabs unten', async ({ page, isMobile }) => {
  test.skip(!isMobile); await page.goto('/');
  for (const t of ['Heute','NEXUS','Zulassungsdienst']) await expect(page.getByTestId('tab-bar').getByText(t, {exact:true})).toBeVisible();
  await expect(page.getByTestId('assistant-button')).toBeVisible();
});
test('desktop: Seitenleiste', async ({ page, isMobile }) => { test.skip(isMobile); await page.goto('/'); await expect(page.getByTestId('sidebar')).toBeVisible(); });
test('Manifest erreichbar', async ({ request }) => expect((await request.get('/manifest.webmanifest')).ok()).toBe(true));
```

- [ ] **Step 2:** `npm run e2e -- tests/e2e/shell.spec.ts` → FAIL. **Step 3:** Implementieren (Platzhalterseiten für alle Routen aus Tasks 13–15 mit Überschrift). **Step 4:** → PASS in `iphone` und `desktop`.
- [ ] **Step 5:** Commit `feat(ui): App-Gerüst, Design-Bausteine, PWA`.

---

### Task 13: Heute und Nachrichten-Verlauf

**Files:**
- Create: `src/app/page.tsx`, `src/app/nachrichten/[threadId]/page.tsx`, `src/components/ActionSheet.tsx`
- Test: `tests/e2e/heute.spec.ts`

**Interfaces:**
- Consumes: `useAppStore`, `selectTop`, `buildBriefing`, `demoAI.draftReply`, Aktions-Ereignisse aus Task 10
- Produces: `<ActionSheet action onSend onEdit onLater>` (zeigt Entwurf, Knopf **Senden** mit `DemoBadge`; wird in Tasks 14–15 wiederverwendet)

Heute zeigt in dieser Reihenfolge: Top 3 (`TaskRow`) · Termine heute · `MoneyCard` NEXUS und Zulassungsdienst · Nachrichten mit Antwortbedarf · Coach-Tipp des Tages (mit „Übernehmen · Später · Nicht mehr vorschlagen“) · Link „Morgenbriefing ansehen“ (rendert `renderBriefingText`). Ein Tipp auf einen Hinweis öffnet `refs[0].href`. Der Verlauf zeigt die Nachrichten des Threads und darunter das `ActionSheet` mit dem Entwurf aus `draftReply`. „Senden“ löst `createAction` + `approveAction(via 'app')` + `actionExecuted('ok')` aus.

- [ ] **Step 1: Failing E2E (Abnahme 1)**

```ts
test('Abnahme 1: wartender Kunde → Antwort senden → Protokoll, Hinweis zu', async ({ page }) => {
  await page.goto('/?reset=1');
  const rows = page.getByTestId('insight-row'); expect(await rows.count()).toBeLessThanOrEqual(3);
  await page.locator('[data-key="reply:m-schmidt-in-1"]').click();
  await expect(page).toHaveURL(/\/nachrichten\/t-schmidt/);
  await expect(page.getByTestId('draft-text')).not.toBeEmpty();
  await page.getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByText('Gesendet (Demo)')).toBeVisible();
  await page.goto('/protokoll'); await expect(page.getByText(/Autohaus Schmidt/)).toBeVisible();
  await page.goto('/'); await expect(page.locator('[data-key="reply:m-schmidt-in-1"]')).toHaveCount(0);
});
```

`?reset=1` löst `resetDemo` aus (gilt für alle E2E-Tests). Die Nachrichten-ID des Schmidt-Eingangs ist `m-schmidt-in-1` (in Task 10 so anlegen).

- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS (beide Projekte).
- [ ] **Step 5:** Commit `feat(ui): Heute und Nachrichten-Verlauf`.

---

### Task 14: NEXUS-Bereich

**Files:**
- Create: `src/app/nexus/page.tsx`, `src/app/nexus/mitglieder/[id]/page.tsx`, `src/app/nexus/mitglieder/[id]/uebernahme/page.tsx`, `src/app/nexus/zuordnen/page.tsx`, `src/app/nexus/calls/[id]/page.tsx`, `src/app/nexus/content/page.tsx`
- Test: `tests/e2e/nexus.spec.ts`

**Interfaces:**
- Consumes: `memberView`, `planTakeover`, `monthForecast`, `matchBankPayment`, `demoAI.draftReminder`, `demoAI.slidesFor`, `ActionSheet`

**Seiten:**
- `/nexus`: `MoneyCard`, Monatsvorschau („erwartet X, davon Y wackelig“), Liste aller Mitglieder mit Ampel und Rückstand (Filter: alle / überfällig), Einstieg „Zuordnen (n)“, Calls, Content.
- Mitglied: Kennzahlen (fällig, gezahlt, **Rückstand**, **künftige Raten**, offen gesamt), `status.steps` als Rechenweg, Ratenliste mit Status, Zahlungsverlauf. Bei Rückstand der Knopf „Erinnerung vorbereiten“ → `ActionSheet` mit `draftReminder` (Ton umschaltbar), der Text enthält `demoPaymentLink`. Bei `legacy` gibt es den Knopf „Übernehmen“.
- Übernahme: bisherige Zahlungen (bestätigbar), Rückstand/künftig/offen, Umschalter `first_rate`/`spread` mit Ratenvorschau, Knopf „Stripe-Plan vorbereiten (Demo)“ → Aktion `create_invoice_draft` im Entwurf.
- Zuordnen: offene Zahlungen mit Vorschlag und Konfidenz, Knopf „Bestätigen“ (→ `confirmPaymentMatch`) oder Mitglied wählen. „Stripe bezahlt, Lexware offen“-Fälle mit „Als durch Stripe bezahlt markieren“ (→ `settleInvoice`). Demo-Werkzeug „Überweisung simulieren“ (IBAN, Name, Betrag).
- Call: Folienstand, „Folientexte vorbereiten“ (→ `slidesFor`, Status `draft`), Folien bearbeitbar, „Geprüft“ (→ `reviewed`), „Für Gamma kopieren“ (→ Zwischenablage, Status `copied`). Format pro Folie: `# Folie n: Titel\n\nText\n\n---\n\n`.
- Content: Board mit den 5 Stufen als Spalten (mobil als Abschnitte).

- [ ] **Step 1: Failing E2E (Abnahmen 2, 3, 4, 5, 6)**

```ts
test('Abnahme 2: überfälliges Mitglied → Rechenweg → Erinnerung mit Link', async ({ page }) => {
  await page.goto('/nexus?reset=1'); await page.getByTestId(`member-row-${KAYA}`).click();
  await expect(page.getByTestId('arrears')).toHaveText(formatEuro(15000));
  await expect(page.getByTestId('future')).toHaveText(formatEuro(60000));
  await page.getByRole('button', { name: 'Erinnerung vorbereiten' }).click();
  await expect(page.getByTestId('draft-text')).toContainText('https://buy.stripe.com/demo/');
});
test('Abnahme 3: Übernahme Referenzbeispiel', async ({ page }) => {
  await page.goto(`/nexus/mitglieder/${KAYA}/uebernahme?reset=1`);
  await expect(page.getByTestId('open-total')).toHaveText(formatEuro(75000));
  await expect(page.getByTestId('rate-amounts')).toHaveText([formatEuro(45000), formatEuro(30000)].join(' · '));
  await page.getByRole('radio', { name: /verteilen/i }).check();
  await expect(page.getByTestId('rate-amounts')).toHaveText([formatEuro(37500), formatEuro(37500)].join(' · '));
});
test('Abnahme 4: unbekannte Überweisung zuordnen, IBAN lernen', async ({ page }) => {
  await page.goto('/nexus/zuordnen?reset=1');
  await page.getByTestId('match-p-yilmaz-1').getByRole('button', { name: 'Bestätigen' }).click();
  await page.getByRole('button', { name: 'Überweisung simulieren' }).click();
  await page.getByLabel('IBAN').fill('DE02120300000000202051'); await page.getByLabel('Name').fill('Selin Yilmaz'); await page.getByLabel('Betrag').fill('300');
  await page.getByRole('button', { name: 'Buchen' }).click();
  await expect(page.getByText('Automatisch zugeordnet: Selin Yilmaz')).toBeVisible();
});
test('Abnahme 5: Stripe bezahlt, Lexware offen', async ({ page }) => {
  await page.goto('/?reset=1'); await page.locator('[data-key="stripe-lex:i-lex-118"]').click();
  await page.getByRole('button', { name: 'Als durch Stripe bezahlt markieren' }).click();
  await page.goto('/'); await expect(page.locator('[data-key="stripe-lex:i-lex-118"]')).toHaveCount(0);
});
test('Abnahme 6: SEELE-Folien für Gamma kopieren', async ({ page, browserName }) => {
  await page.goto('/nexus/calls/call-seele?reset=1');
  await page.getByRole('button', { name: 'Folientexte vorbereiten' }).click();
  await expect(page.getByTestId('slide')).toHaveCount(10);
  await page.getByRole('button', { name: 'Für Gamma kopieren' }).click();
  await expect(page.getByText('Kopiert')).toBeVisible();
  if (browserName === 'chromium') expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('# Folie 10:');
});
```

`KAYA` ist die Vertrags-ID von `m-kaya`. Sie wird im Test über `createDemoState()` ermittelt. Hinweis zu Abnahme 5: Der Hinweis steht auf Heute nur dann sicher in der Liste, wenn er unter den Top 3 ist. Deshalb öffnet der Test notfalls `/nexus/zuordnen` und prüft dort ebenso.

- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(ui): NEXUS-Bereich`.

---

### Task 15: Zulassungsdienst-Bereich

**Files:**
- Create: `src/app/zulassung/page.tsx`, `src/app/zulassung/kunden/[id]/page.tsx`, `src/app/zulassung/auftraege/[id]/page.tsx`
- Test: `tests/e2e/zulassung.spec.ts`

**Interfaces:**
- Consumes: `runDetectors`-Ergebnisse, `areaStale`, `linkInvoiceToJob`, `setJobStatus`, `ActionSheet`

**Seiten:**
- `/zulassung`: Tageszahlen (heute erledigt, offen, wartet auf Kunde, nicht abgerechnet), `MoneyCard` (bei veralteter `lexware_zulassung` mit `StaleNotice`), Aufträge gruppiert nach Status, Kundenliste.
- Kunde: Fahrzeuge, Aufträge, Rechnungen (offen/überfällig), letzte Nachrichten.
- Auftrag: Fahrzeug, Leistung, Standort, Preis, Status-Schalter (Segmente: offen · wartet auf Kunde · erledigt), letzte Kommunikation mit Link zum Thread, verknüpfte Rechnungen und Rest. Liste „Passende Rechnungen“ (gleicher Kontakt, nicht verknüpft, Betrag ≤ Rest; Rechnungen, deren Text das Kennzeichen enthält, zuerst) mit „Zuordnen“. Knopf „Rechnungsentwurf vorbereiten (Demo)“.

- [ ] **Step 1: Failing E2E (Abnahmen 7 und 11)**

```ts
test('Abnahme 7: erledigt, nicht abgerechnet → Rechnung zuordnen', async ({ page }) => {
  await page.goto('/zulassung?reset=1');
  await expect(page.getByTestId('kpi-not-invoiced')).toHaveText('1');
  await page.goto('/zulassung/auftraege/j-mueller-1');
  await page.getByTestId('invoice-candidate-i-z-311').getByRole('button', { name: 'Zuordnen' }).click();
  await expect(page.getByTestId('job-rest')).toHaveText(formatEuro(0));
  await page.goto('/zulassung'); await expect(page.getByTestId('kpi-not-invoiced')).toHaveText('0');
});
test('Abnahme 11: Verbindung gestört → Datenstand zu alt', async ({ page }) => {
  await page.goto('/verbindungen?reset=1');
  await page.getByTestId('conn-lexware_zulassung').getByRole('button', { name: 'Störung simulieren' }).click();
  await page.goto('/zulassung'); await expect(page.getByTestId('stale-notice')).toContainText('Datenstand zu alt');
  await expect(page.getByTestId('kpi-not-invoiced')).toHaveText('–');
});
```

Die Seite `/verbindungen` wird in Task 16 fertig gebaut. Für Abnahme 11 legt dieser Task dort bereits die Liste mit dem Knopf „Störung simulieren“ (→ `setConnectionStatus 'error'`) an.

- [ ] **Step 2:** → FAIL. **Step 3:** Implementieren. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(ui): Zulassungsdienst-Bereich`.

---

### Task 16: Chat, WhatsApp-Assistent (simuliert), Verbindungen, Protokoll, Einstellungen

**Files:**
- Create: `src/app/chat/page.tsx`, `src/app/assistent/page.tsx`, `src/domain/assistant.ts`, `src/app/verbindungen/page.tsx` (ausbauen), `src/app/protokoll/page.tsx`, `src/app/einstellungen/page.tsx`; Typ `AssistantMessage` in `types.ts`
- Test: `tests/unit/assistant.test.ts`, `tests/e2e/assistant.spec.ts`

**Interfaces:**
- Consumes: `demoAI`, `buildBriefing`, `renderBriefingText`, `chooseDelivery`, `approve`
- Produces:

```ts
export interface AssistantMessage { id: string; direction: 'to_owner'|'from_owner'|'ignored'; from: string; text: string; at: string; buttons?: { label: 'Senden'|'Ändern'|'Später'; actionId: string; version: number; issuedAt: string }[] }
// src/domain/assistant.ts
handleInbound(s: AppState, from: string, text: string, now: Date, ai: AIProvider): Promise<{ events: StoreEvent[]; reply: AssistantMessage | null }>
handleButton(s: AppState, b: NonNullable<AssistantMessage['buttons']>[number], now: Date): { events: StoreEvent[]; reply: AssistantMessage }
```

Regeln für `handleInbound`: Ist der Absender nicht `normalizePhone(settings.ownerPhone)`, gibt es kein Reply, nur ein `audit`-Eintrag und eine `ignored`-Nachricht. Enthält der Text „schick“ und einen Mitgliedsnamen plus „erinnerung“, wird eine `send_reminder`-Aktion als Entwurf angelegt und mit Knöpfen beantwortet. Sonst geht der Text an `ai.answer`.
Regeln für `handleButton`: **Senden** → `approve(via 'whatsapp', buttonIssuedAt)`. Bei `ok:false` lautet die Antwort „Dieser Knopf ist nicht mehr gültig (…). Ich habe nichts gesendet.“ mit Grund auf Deutsch.

**Seiten:**
- `/chat`: Chatverlauf mit `demoAI.answer`, Links als antippbare Chips, Vorschläge für die 5 Pflichtfragen als Schnellknöpfe.
- `/assistent`: WhatsApp-artige Ansicht (Kontakt „Nexus Assistent“). Demo-Werkzeuge: „Morgenbriefing auslösen“ (rendert über `chooseDelivery` und zeigt den gewählten Weg an), „Abendrückblick auslösen“, „Nachricht von fremder Nummer simulieren“. Eingabefeld für eigene Nachrichten (Absender = Inhaber).
- `/verbindungen`: jede `Connection` mit Firma, Status, „Stand vor n Min.“, Knopf „Störung simulieren“ / „Wieder verbinden“, Platz für die Klickanleitung (Phase 2).
- `/protokoll`: `audit` absteigend, mit `DemoBadge`.
- `/einstellungen`: Briefings an/aus, Antwortzeit-Schwelle, Inhaber-Nummer, unterdrückte Coach-Tipps zurücksetzen, „Demo zurücksetzen“.

- [ ] **Step 1: Failing Unit-Tests**

```ts
const s = refresh(createDemoState(), NOW);
expect((await handleInbound(s, '+4917099999', 'Hallo', NOW, demoAI)).reply).toBeNull();
const r = await handleInbound(s, '+491510000000', 'Schick Kaya die Erinnerung', NOW, demoAI);
expect(r.reply!.buttons!.map(b=>b.label)).toEqual(['Senden','Ändern','Später']);
const btn = r.reply!.buttons![0];
expect(handleButton(apply(s, r.events), {...btn, issuedAt:'2026-11-11T07:00:00Z'}, NOW).reply.text).toContain('nicht mehr gültig');
```

`apply(s, events)` ist ein Test-Helper, der die Events über `reducer` anwendet.

- [ ] **Step 2: Failing E2E (Abnahmen 8, 9, 10)**

```ts
const QUESTIONS = ['Wer ist bei NEXUS überfällig?','Was ist heute noch offen?','Was fehlt für SEELE?','Was ist mit dem Auftrag von Autohaus Schmidt?','Wie viel Geld kommt diesen Monat noch rein?'];
test('Abnahme 8: fünf Chat-Fragen mit Links', async ({ page }) => {
  await page.goto('/chat?reset=1');
  for (const q of QUESTIONS) {
    await page.getByRole('button', { name: q }).click();
    const last = page.getByTestId('chat-answer').last();
    await expect(last).not.toContainText('kann die Demo noch nicht');
    await expect(last.getByRole('link').first()).toBeVisible();
  }
});
test('Abnahme 9: gebrochene Zusage', async ({ page }) => {
  await page.goto('/?reset=1');
  await expect(page.getByText(/Herr Demir.*Rechnung/).first()).toBeVisible(); // auf Heute oder über „Alle Hinweise“
});
test('Abnahme 10: WhatsApp-Assistent', async ({ page }) => {
  await page.goto('/assistent?reset=1');
  await page.getByRole('button', { name: 'Morgenbriefing auslösen' }).click();
  await expect(page.getByTestId('wa-msg').last()).toContainText('Guten Morgen');
  await page.getByTestId('wa-input').fill('Wer ist überfällig?'); await page.getByTestId('wa-send').click();
  await expect(page.getByTestId('wa-msg').last()).toContainText('Mehmet Kaya');
  await page.getByTestId('wa-input').fill('Schick Kaya die Erinnerung'); await page.getByTestId('wa-send').click();
  await page.getByTestId('wa-msg').last().getByRole('button', { name: 'Senden' }).click();
  await expect(page.getByTestId('wa-msg').last()).toContainText('Gesendet (Demo)');
  await page.getByTestId('wa-msg').nth(-2).getByRole('button', { name: 'Senden' }).click(); // derselbe, nun alte Knopf
  await expect(page.getByTestId('wa-msg').last()).toContainText('nicht mehr gültig');
  await page.getByRole('button', { name: 'Nachricht von fremder Nummer simulieren' }).click();
  await expect(page.getByTestId('wa-ignored').last()).toContainText('ignoriert');
});
```

Für Abnahme 9 muss Heute einen Link „Alle Hinweise (n)“ haben, der unter `/hinweise` alle offenen Hinweise zeigt. Die Seite gehört zu diesem Task. Der Test klickt notfalls dorthin.

- [ ] **Step 3:** → FAIL. **Step 4:** Implementieren. **Step 5:** Unit + E2E → PASS.
- [ ] **Step 6:** Commit `feat(ui): Chat, WhatsApp-Assistent, Verbindungen, Protokoll, Einstellungen`.

---

### Task 17: Gesamtabnahme, Screenshots und Übergabe

**Files:**
- Create: `tests/e2e/screenshots.spec.ts`, `docs/vorschau/README.md`, `docs/vorschau/screenshots/*.png`

- [ ] **Step 1:** `screenshots.spec.ts` nimmt mit `deviceScaleFactor: 2` folgende Seiten auf: Heute, NEXUS, Mitglied Kaya, Übernahme, Zuordnen, SEELE-Call, Zulassungsdienst, Auftrag Müller, Chat, Assistent. Jeweils für `iphone` und `desktop`, im Hell- und im Dunkelmodus nur für Heute. Ablage unter `docs/vorschau/screenshots/<projekt>-<seite>.png`.
- [ ] **Step 2:** `npm test && npm run e2e` → alle Unit-Tests und alle 11 Abnahmen grün in `iphone` und `desktop`. Ausgabe sichern.
- [ ] **Step 3:** UI-Prüfung gegen Web-Interface-Guidelines (Kontrast, Fokus, Tippflächen ≥ 44 px, `aria-label` an Icon-Knöpfen). Gefundene Mängel beheben, E2E erneut grün.
- [ ] **Step 4:** `docs/vorschau/README.md` schreibt auf Deutsch:
  - **Was funktioniert:** echte Logik, Liste der Abläufe.
  - **Was läuft mit Beispieldaten:** alles. Keine echten Konten, Senden nur als Demo.
  - **So öffnest du die Vorschau auf dem iPhone:** Vercel → „Add New Project“ → GitHub-Repo wählen → Branch `claude/cool-hopper-hcnb9d` → Deploy → Link in Safari öffnen → Teilen → „Zum Home-Bildschirm“.
  - **Was Phase 2 von dir braucht:** pro Verbindung ein Satz.
- [ ] **Step 5:** Commit `docs: Vorschau, Screenshots, Übergabe` und Push auf `claude/cool-hopper-hcnb9d`.
