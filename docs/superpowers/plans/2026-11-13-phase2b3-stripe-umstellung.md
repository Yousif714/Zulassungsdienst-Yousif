# Paket 2b-3: Umstellung der Bestandsmitglieder auf Stripe – Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bestandsmitglieder (`billing: 'legacy'`, offener Betrag > 0) bekommen nach Freigabe einen eigenen Link `/zahlung/<token>`, hinterlegen dort Karte oder SEPA, und der Server legt einen Stripe-Abo-Zeitplan an, der genau dem freigegebenen Restplan entspricht. Wer nicht umstellt, bekommt vor jeder Rate einen Erinnerungsentwurf.

**Architecture:** Die reine Domain (`src/domain/takeover/`) rechnet alles: Status, Sperrgrund, Aktionsentwurf, Plan-Prüfung beim Abschluss, Abo-Phasen, Texte, Verknüpfung beim Import, Erinnerungsentwürfe. Ein neuer Aktionstyp `stripe_takeover` läuft durch die bestehende Freigabe-Zustandsmaschine; der Server-Ausführer legt den Stripe-Kunden an und meldet das Ergebnis über ein neues `output` am Ereignis `actionExecuted` zurück. Den Token erzeugt der Reducer. Der Webhook `checkout.session.completed` prüft den Plan, legt den Zeitplan an und schreibt `takeoverSetUp`. Der Vertrag bekommt ein Feld `plan`, damit `buildSchedule` ab der Umstellung die Plan-Raten liefert. Die Umstellungen liegen in einer eigenen Tabelle `stripe_takeovers`.

**Tech Stack:** Next.js 16 (App Router, `cacheComponents: true`; vor Route-Handlern und Seiten `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`, `page.md`, `04-functions/redirect.md` lesen; `params` ist ein Promise), TypeScript, Vitest, Playwright, Supabase (SQL-Migration per MCP). Stripe per `fetch` über `createApiClient` (kein SDK).

**Spec:** `docs/superpowers/specs/2026-11-13-phase2b3-stripe-umstellung-design.md` (verbindlich). Basis: `docs/superpowers/specs/2026-11-12-nexus-assistent-design.md` Abschnitt 4a.

## Global Constraints

- `src/domain/` bleibt rein (prüft `tests/unit/architecture.test.ts`): kein `fetch`, kein React, keine Importe aus `src/data`, `src/server`, `src/app`, `src/components`.
- Geld nur als Cent-Ganzzahl, gerechnet nur in Domain/Ledger. Kalendertage Europe/Berlin über `src/domain/clock.ts` (`todayBerlin`, `addDaysIso`, `daysBetween`, `berlinLocalToUtc`, `formatIsoDe`); `monthDate` aus `ledger/schedule.ts` für Monatsschritte. Nie `new Date()` ohne Argument in `src/domain`.
- Kontakt → Vertrag nur über `membershipContractOf`/`contractsOfContact` (`ledger/contracts.ts`).
- Stripe-API-Version bleibt `STRIPE_API_VERSION = '2025-09-30.clover'` (Header `Stripe-Version`). Die Felder unten sind gegen die stripe-node-Typen der Clover-Generation (`2025-10-29.clover`) geprüft; **vor dem Merge im Stripe-Testmodus auf der Preview gegen echtes Stripe verifizieren** (Task 14, Testlauf).
- Schreib-Schlüssel `STRIPE_WRITE_KEY` (optional, nur `src/server/**`). Fehlt er, läuft `stripe_takeover` als Demo: kein Stripe-Aufruf, Token mit Präfix `demo-`, öffentliche Seite zeigt „Demo“. Schlüssel nie in AppState, Audit, `lastError`, Logs.
- Basis-URL des Links: Umgebungsvariable `PAYMENT_LINK_BASE_URL`, sonst `APP_ORIGIN`. Der fertige Link wird an der Umstellung gespeichert (spätere Domain betrifft nur neue Links).
- Exakte UI-Texte: Knopf „Auf Stripe umstellen“; Status `vorbereitet`, `Link verschickt`, `eingerichtet`, `aktiv`, `Plan geändert`, `zurückgezogen`, `abgebrochen`; Plakette „läuft über Stripe“; Knöpfe „Freigeben“, „Kopieren“, „Zurückziehen“, „Neu freigeben“, „Alle umstellen (N)“, „Alle freigeben (N)“, „Zahlungsmittel hinterlegt (Demo)“; öffentliche Seite „Weiter zu Stripe“, ungültig: „Link nicht mehr gültig, bitte melde dich bei NEXUS.“; Stripe-Produkt „NEXUS-Mitgliedschaft (Ratenplan)“.
- Einstellungen (Standard): `takeoverReminderDays: 3` (1–14), `takeoverLinkNudgeDays: 7` (1–30).
- `/zahlung/**` ist der einzige Teil ohne Login: gibt außer dem Plan des Tokens nichts preis (kein Name, keine E-Mail), ist ratenbegrenzt, schreibt nichts außer der Checkout-Sitzung (und Zähler in `job_runs`), GET legt nie eine Checkout-Sitzung an.
- Fixtures nur erfunden (`@example.de`, `cus_test_…`). Tests rufen nie echtes Stripe.
- Vor jedem Commit: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`; bei UI-Änderungen zusätzlich `fuser -k 3100/tcp; npx playwright test <spec> --trace off 2>&1 | tail -15`. Branch `claude/cool-hopper-hcnb9d`, nach jedem Commit `git push`. Commit-Nachrichten Deutsch (`feat:`/`fix:`/`test:`/`docs:`), jede endet mit:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_0118JMve5yL1H6x8wUGJiZmL
  ```
- **Mergen erst, nachdem Claude die Migration aus Task 2 per Supabase-MCP eingespielt und geprüft hat.**

## Stripe-Festlegungen (aus den Clover-Typen)

| Zweck | Aufruf | Felder |
|---|---|---|
| Kunde wiederfinden | `GET /v1/customers/search?query=metadata['contractId']:'<id>'` | erster Treffer |
| Kunde anlegen | `POST /v1/customers` + `Idempotency-Key: <aktion:version>:customer` | `name`, `email`, `metadata[contractId]` |
| Produkt | `GET /v1/products/search?query=metadata['nexus']:'ratenplan' AND active:'true'`, sonst `POST /v1/products` (Key `nexus-ratenplan-product-v1`) | `name=NEXUS-Mitgliedschaft (Ratenplan)`, `metadata[nexus]=ratenplan` |
| Checkout (je Klick neu) | `POST /v1/checkout/sessions` | `mode=setup`, `customer`, `payment_method_types[0]=card`, `payment_method_types[1]=sepa_debit` (dann ist `currency` nicht nötig), `locale=de`, `success_url=<base>/zahlung/danke`, `cancel_url=<base>/zahlung/abbruch?t=<token>`, `metadata[takeoverId]`, `metadata[contractId]`, `setup_intent_data[metadata][takeoverId]` |
| Zahlungsmittel | `GET /v1/setup_intents/<session.setup_intent>` → `payment_method` | |
| Standard setzen | `POST /v1/customers/<cus>` | `invoice_settings[default_payment_method]` |
| Zeitplan | `POST /v1/subscription_schedules` + `Idempotency-Key: takeover:<takeoverId>:schedule` | `customer`, `start_date` (Unix oder `now`), `end_behavior=cancel`, `default_settings[collection_method]=charge_automatically`, `default_settings[default_payment_method]`, `metadata[contractId]`, `metadata[takeoverId]`; je Phase `items[0][price_data][currency]=eur`, `[product]`, `[unit_amount]`, `[recurring][interval]=month`, `items[0][quantity]=1`, `billing_cycle_anchor=phase_start` (nicht bei Lücken-Phasen), `proration_behavior=none`, **`metadata[contractId]` und `metadata[takeoverId]` an jeder Phase** (nur Phasen-Metadaten gehen ans Abo über), Ende per `duration[interval]=month` + `duration[interval_count]=k` **oder** `end_date` |

Phasenmodell: Clover kennt kein `iterations` mehr, nur `duration` oder `end_date`. Gleich hohe Raten im exakten Monatsabstand werden zu einer Phase mit `duration` k Monate zusammengefasst; jede Phase rechnet an ihrem Start ab (`billing_cycle_anchor=phase_start`), danach monatlich. Startzeit 07:00 Europe/Berlin am Fälligkeitstag (`berlinLocalToUtc(date, '07:00')`). Unregelmäßige Abstände (Pause, Verschiebung): Ist die nächste Rate früher als das natürliche Phasenende, endet die Phase per `end_date` am nächsten Fälligkeitstag; ist sie später, folgt eine Lücken-Phase mit `trial=true` bis zum nächsten Fälligkeitstag (keine Abbuchung). Überfällige Plan-Raten beim Abschluss: erste Phase `start_date=now` mit ihrer Summe, Ende am nächsten Fälligkeitstag. Ende nach der letzten Phase: `end_behavior=cancel`.

## Review Focus

1. **Gefälschte Client-Ereignisse:** `createAction`/`editAction` mit Typ `stripe_takeover` und eigenen Raten werden abgelehnt; Beträge entstehen nur im Reducer aus dem Stand. Tests in Task 6.
2. **Webhook doppelt, gleichzeitig oder nach „Zurückziehen“:** höchstens ein Zeitplan (Idempotency-Key), Status springt nie zurück, zurückgezogene Umstellung wird nicht eingerichtet. Tests in Task 11.
3. **Monatsende und Sommerzeit:** Fälligkeitstag 31 über Februar, Start im Winter und Ende im Sommer: `planEndDate` = Enddatum, das der Import aus dem Zeitplan liest → kein „Enddatum geändert“. Tests in Task 4 und Task 7.
4. **Link erst nach der ersten Fälligkeit genutzt bzw. Mitglied hat inzwischen überwiesen:** gleiche offene Summe → überfällige Rate sofort, Rest nach Plan; andere Summe → `Plan geändert`, kein Zeitplan, Zahlungsmittel bleibt. Tests in Task 4 und Task 11.
5. **Öffentliche Seite unter Last oder von Link-Vorschau-Bots aufgerufen:** GET legt keine Checkout-Sitzung an, ungültiger Token verrät nichts, 21. Aufruf pro Minute und IP wird abgewiesen (429). Tests in Task 12.

---

## Dateistruktur

```
src/domain/
  types.ts                 StripeTakeover, TakeoverStatus, AppState.takeovers, MemberContract.plan, Subscription.metadataContractId,
                           ActionType +stripe_takeover, InsightType +4, Settings +2
  events.ts                prepareTakeover, prepareAllTakeovers, withdrawTakeover, approveActions, simulateTakeoverSetUp,
                           takeoverSetUp, takeoverPlanChanged; actionExecuted/actionReconciled.output
  ledger/schedule.ts       buildSchedule liefert nach Umstellung Plan-Raten
  takeover/status.ts (neu)  Labels, currentTakeover, takeoverStatus, runsViaStripe, takeoverBlockReason, takeoverActionId
  takeover/plan.ts (neu)    checkCompletion, schedulePhases, planEndDate, publicPlanView, takeoverToken, paymentLinkUrl
  takeover/texts.ts (neu)   shareText, upcomingReminderText, linkNudgeText
  takeover/link.ts (neu)    syncTakeovers (Abo verknüpfen, Rückfall auf legacy)
  takeover/drafts.ts (neu)  ensureTakeoverDrafts (Entwürfe aktuell halten, Erinnerungen, Link-Erinnerung)
  action-factory.ts        takeoverAction (ersetzt stripePlanAction), upcomingReminderAction, linkNudgeAction
  actions/machine.ts       ActionOutput, ExecuteOutcome, cancelDraft, ActionProvider.lookup(key, a)
  detectors/takeover.ts (neu), subscriptions.ts, invoices.ts, refs.ts, index.ts
  import/stripe.ts, batch.ts, merge.ts, proposals.ts   metadata.contractId
  payment-link.ts          paymentLinkFor(s, contractId)
  migrate.ts               Settings-Standardwerte, takeovers
src/data/
  engine.ts                Reducer, applyEffects stripe_takeover, refresh → ensureTakeoverDrafts, importBatch → syncTakeovers
  executor.ts              output durchreichen
  empty-state.ts, seed.ts  takeovers: [], Settings
src/server/
  env.ts                   stripeWriteKey, paymentLinkBaseUrl
  connectors/http.ts       postForm
  connectors/form.ts (neu)       encodeForm
  connectors/stripe-write.ts (neu) createStripeWriter, scheduleParams
  connectors/fixture-fetch.ts    Methode im Routenschlüssel
  action-provider.ts (neu) createActionProvider
  takeover.ts (neu)        completeTakeoverCheckout, createCheckoutForToken
  rate-limit.ts (neu)      allowRequest
  registry.ts              getActionProvider, getStripeWriter, setTestStripeWriter
  state-service.ts         CLIENT_EVENTS/SHAPE
  db/tables.ts, db/supabase.ts   stripe_takeovers
src/app/
  layout.tsx               RootChrome
  zahlung/[token]/page.tsx, zahlung/[token]/weiter/route.ts, zahlung/danke/page.tsx, zahlung/abbruch/page.tsx (neu)
  api/webhooks/stripe/route.ts   checkout.session.completed
  api/test/takeover/route.ts (neu)
  nexus/umstellung/page.tsx (neu), nexus/page.tsx (Link)
  nexus/mitglieder/[id]/uebernahme/page.tsx, nexus/mitglieder/[id]/page.tsx, nexus/offen/page.tsx, einstellungen/page.tsx
src/components/RootChrome.tsx (neu), TakeoverCard.tsx (neu)
supabase/migrations/20261118000000_stripe_umstellung.sql (neu)
tests/unit/takeover/*.test.ts (neu), connectors/stripe-write.test.ts, connectors/form.test.ts, action-provider.test.ts,
  rate-limit.test.ts, zahlung-route.test.ts + bestehende
tests/fixtures/stripe-write.ts (neu)
tests/e2e/umstellung.spec.ts (neu), playwright.config.ts (STRIPE_WEBHOOK_SECRET Testwert)
docs/setup-phase2b3.md (neu), docs/PROJEKT-STAND.md, docs/phase2-backlog.md
```

---

### Task 1: Typen, Zustand, Einstellungen

**Files:**
- Modify: `src/domain/types.ts`, `src/domain/events.ts` (nur Typen), `src/data/empty-state.ts`, `src/data/seed.ts` (nur `takeovers: []`), `src/domain/migrate.ts`, `tests/unit/helpers.ts` (`stateWith`: `takeovers: []`), `src/server/state-service.ts` (nur `SETTINGS`-Prüfer)
- Test: `tests/unit/empty-state.test.ts`, `tests/unit/migrate.test.ts`, `tests/unit/state-service.test.ts`

**Interfaces:**
- Produces (types.ts):
  ```ts
  export type TakeoverStatus = 'prepared'|'link_sent'|'set_up'|'active'|'plan_changed'|'withdrawn'|'aborted';
  export interface StripeTakeover {
    id: string; contractId: string; contactId: string; actionId: string; actionVersion: number;
    status: Exclude<TakeoverStatus, 'prepared'>;            // 'prepared' wird aus der offenen Aktion abgeleitet
    token: string; link: string; mode: MemberContract['catchUpMode']; rates: Installment[]; openCents: number;
    stripeCustomerId: string | null; paymentMethodId: string | null; scheduleId: string | null; subscriptionExternalId: string | null;
    isDemo: boolean; linkSentAt: string; setUpAt?: string; activeAt?: string; endedAt?: string;
  }
  // MemberContract zusätzlich:
  plan?: { takeoverId: string; paidCents: number; rates: Installment[] };
  // Subscription zusätzlich (fehlt bei alten Daten = null):
  metadataContractId?: string | null;
  // ActionType zusätzlich: 'stripe_takeover'
  // InsightType zusätzlich: 'rate_upcoming'|'takeover_link_unused'|'takeover_plan_changed'|'double_payment'
  // Settings zusätzlich: takeoverReminderDays: number; takeoverLinkNudgeDays: number
  // AppState zusätzlich: takeovers: StripeTakeover[]
  ```
- Produces (`empty-state.ts`): `export const DEFAULT_SETTINGS: Settings` (inkl. `takeoverReminderDays: 3, takeoverLinkNudgeDays: 7`).

- [ ] **Step 1: Failing tests**
```ts
// empty-state.test.ts
expect(e.takeovers).toEqual([]);
expect(e.settings).toMatchObject({ takeoverReminderDays: 3, takeoverLinkNudgeDays: 7 });
// migrate.test.ts
test('alte Stände bekommen Umstellungs-Einstellungen und takeovers', () => {
  const old = { ...stateWith({}), settings: { replyThresholdHours: 2, briefingsEnabled: true, ownerPhone: '', suppressedCoachKeys: [] } } as unknown as AppState;
  delete (old as Partial<AppState>).takeovers;
  const m = migrateState(old);
  expect(m.settings.takeoverReminderDays).toBe(3);
  expect(m.takeovers).toEqual([]);
  expect(migrateState(m)).toBe(m); // idempotent
});
// state-service.test.ts
expect(isClientEvent({ type: 'updateSettings', patch: { takeoverReminderDays: 5 } })).toBe(true);
expect(isClientEvent({ type: 'updateSettings', patch: { takeoverReminderDays: 0 } })).toBe(false);
expect(isClientEvent({ type: 'updateSettings', patch: { takeoverLinkNudgeDays: 31 } })).toBe(false);
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/empty-state.test.ts tests/unit/migrate.test.ts tests/unit/state-service.test.ts` → FAIL.
- [ ] **Step 3: Implement** Typen, `DEFAULT_SETTINGS`, `migrateState` ergänzt fehlende Settings-Schlüssel aus `DEFAULT_SETTINGS` und `takeovers ?? []` (gleiches Objekt, wenn nichts fehlt), `SETTINGS`-Prüfer (Ganzzahl, 1–14 bzw. 1–30). `tsc` zeigt alle Stellen, die `AppState`/`Settings` vollständig bauen.
- [ ] **Step 4: Run** dieselben Tests, dann `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Typen und Einstellungen für die Umstellung auf Stripe` (Dateien aus Files).

---

### Task 2: Persistenz und Migration `stripe_takeovers`

**Files:**
- Create: `supabase/migrations/20261118000000_stripe_umstellung.sql`
- Modify: `src/server/db/tables.ts` (`ArrayKey`/`SIMPLE` +`takeovers`, `TABLES.takeovers = 'stripe_takeovers'`), `src/server/db/supabase.ts` (`OPTIONAL_TABLES` +`stripe_takeovers`)
- Test: `tests/unit/db-tables.test.ts`, `tests/unit/migration.test.ts` (prüft automatisch alle `TABLES`)

**Interfaces:** Produces Tabelle `stripe_takeovers (id text primary key, ord int not null, data jsonb not null, updated_at timestamptz not null default now())`, RLS an, keine Policy; `apply_changes` erlaubt `'stripe_takeovers'`.

- [ ] **Step 1: Failing test** in `db-tables.test.ts`:
```ts
test('takeovers laufen über stripe_takeovers hin und zurück', () => {
  const t: StripeTakeover = { id: 'tk1', contractId: 'c1', contactId: 'm1', actionId: 'stripe-takeover-c1-1', actionVersion: 1, status: 'link_sent', token: 'a'.repeat(64), link: 'https://x.example.de/zahlung/' + 'a'.repeat(64), mode: 'first_rate', rates: [{ no: 1, dueDate: '2026-12-01', amountCents: 30000 }], openCents: 30000, stripeCustomerId: 'cus_test_1', paymentMethodId: null, scheduleId: null, subscriptionExternalId: null, isDemo: false, linkSentAt: '2026-11-13T10:00:00Z' };
  const s = stateWith({ takeovers: [t] });
  expect(toRows(s).stripe_takeovers).toEqual([{ id: 'tk1', ord: 0, data: t }]);
  expect(fromRows(toRows(s)).takeovers).toEqual([t]);
});
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/db-tables.test.ts tests/unit/migration.test.ts` → FAIL (Tabelle fehlt in Mapping und Migration).
- [ ] **Step 3: Implement** Mapping und Migration. Migration nach Vorbild `20261117000000_rechnungen_lesen.sql`: `create table if not exists stripe_takeovers …`, `alter table … enable row level security`, `revoke all … from anon, authenticated`, `grant … to service_role`, `create or replace function apply_changes` mit vollständiger `v_allowed`-Liste + `'stripe_takeovers'` (sonst unverändert), `revoke/grant execute`. Kopf-Kommentar: „Idempotent. Claude spielt sie per Supabase-MCP ein.“
- [ ] **Step 4: Run** dieselben Tests + `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Migration einspielen (Claude, Supabase-MCP, Projekt `nexus-assistent`, ID `bqnbboopqeilxflnqgiu`):** `apply_migration` mit Name `stripe_umstellung` und Dateiinhalt. Prüfen: `list_tables` zeigt `stripe_takeovers`; `execute_sql`: `select relrowsecurity from pg_class where relname = 'stripe_takeovers';` → `true`, `select prosrc like '%stripe_takeovers%' from pg_proc where proname = 'apply_changes';` → `true`. Falls in Task 14 eine Preview-Datenbasis entsteht: dort ebenso.
- [ ] **Step 6: Commit** `feat: Tabelle stripe_takeovers (Migration)`.

---

### Task 3: Plan im Vertrag (`buildSchedule`)

**Files:**
- Modify: `src/domain/ledger/schedule.ts`
- Test: `tests/unit/ledger/schedule.test.ts`

**Interfaces:**
- Consumes: `MemberContract.plan` (Task 1).
- Produces: `buildSchedule(c, ex)` unverändert in der Signatur. Mit `c.plan`: zuerst die Raten des Grundplans (mit Ausnahmen) in Reihenfolge, gekappt auf zusammen `plan.paidCents` (Rate mit 0 entfällt, letzte ggf. gekürzt), danach `plan.rates`; alle neu nummeriert ab 1. Summe = `paidCents + Σ plan.rates`.

- [ ] **Step 1: Failing tests**
```ts
test('nach Umstellung: bezahlter Teil + Plan-Raten, neu nummeriert', () => {
  const c = { ...base, plan: { takeoverId: 'tk1', paidCents: 45000, rates: [{ no: 1, dueDate: '2026-12-01', amountCents: 45000 }, { no: 2, dueDate: '2027-01-01', amountCents: 30000 }] } };
  expect(buildSchedule(c, [])).toEqual([
    { no: 1, dueDate: '2026-10-01', amountCents: 30000 },
    { no: 2, dueDate: '2026-11-01', amountCents: 15000 },
    { no: 3, dueDate: '2026-12-01', amountCents: 45000 },
    { no: 4, dueDate: '2027-01-01', amountCents: 30000 },
  ]);
});
test('paidCents 0: nur Plan-Raten', () => {
  const rates = [{ no: 1, dueDate: '2026-12-01', amountCents: 120000 }];
  expect(buildSchedule({ ...base, plan: { takeoverId: 'tk1', paidCents: 0, rates } }, [])).toEqual(rates);
});
test('Referenz 4a: 1.200 € = 4 × 300 €, 450 € gezahlt → Rückstand/Zukunft bleiben nach Umstellung stimmig', () => {
  // planTakeover(first_rate) am 2026-11-12 → Plan [{2026-12-01, 45000}, {2027-01-01, 30000}], paidCents 45000
  // memberView mit plan und 450 € Zahlungen: arrearsCents 0, openCents 75000
});
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/ledger/schedule.test.ts` → FAIL.
- [ ] **Step 3: Implement** Fallunterscheidung in `buildSchedule` (Grundplan wie bisher berechnen, dann kappen und anhängen).
- [ ] **Step 4: Run** Test, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Vertrag liefert nach der Umstellung die Plan-Raten`.

---

### Task 4: Domain-Kern der Umstellung

**Files:**
- Create: `src/domain/takeover/status.ts`, `src/domain/takeover/plan.ts`, `src/domain/takeover/texts.ts`
- Modify: `src/domain/action-factory.ts` (`stripePlanAction`/`stripePlanActionId` entfernen, `takeoverAction` neu), `tests/unit/action-factory.test.ts`
- Test: `tests/unit/takeover/status.test.ts`, `tests/unit/takeover/plan.test.ts`, `tests/unit/takeover/texts.test.ts`

**Interfaces:**
- Consumes: `memberView`, `planTakeover`, `contractSources`, `notConnected`, `monthDate`, `berlinLocalToUtc`, `addDaysIso`, `formatIsoDe`, `formatEuro`.
- Produces (`status.ts`):
  ```ts
  export const TAKEOVER_STATUS_LABEL: Record<TakeoverStatus, string>; // prepared 'vorbereitet', link_sent 'Link verschickt', set_up 'eingerichtet', active 'aktiv', plan_changed 'Plan geändert', withdrawn 'zurückgezogen', aborted 'abgebrochen'
  export const takeoverActionId = (contractId: string, attempt: number): string => `stripe-takeover-${contractId}-${attempt}`;
  export function nextTakeoverAttempt(s: AppState, contractId: string): number;        // Anzahl Aktionen `stripe-takeover-<id>-*` + 1
  export function openTakeoverAction(s: AppState, contractId: string): Action | undefined; // stripe_takeover in draft|approved|executing|uncertain|failed
  export function currentTakeover(s: AppState, contractId: string): StripeTakeover | undefined; // jüngste nach linkSentAt
  export function takeoverStatus(s: AppState, contractId: string): TakeoverStatus | null;  // offene Aktion → 'prepared', sonst currentTakeover?.status
  export function runsViaStripe(s: AppState, contractId: string): boolean;              // status set_up | active
  export function takeoverBlockReason(s: AppState, contractId: string, today: IsoDate): string | null;
  ```
  Sperrgründe exakt, in dieser Reihenfolge: `'Zahlt bereits über Stripe.'` (billing stripe) · `'Bank nicht verbunden: Der Restbetrag wird erst nach der Bankanbindung berechnet.'` · `'Nichts mehr offen.'` (openCents 0) · `'Umstellung läuft bereits.'` (Status link_sent | set_up | active). `prepared` sperrt nicht (erneutes Drücken überschreibt den Entwurf).
- Produces (`plan.ts`):
  ```ts
  export type TakeoverPhase = { start: IsoDate | 'now'; end: { months: number } | { date: IsoDate }; amountCents: number; trial?: true };
  export function checkCompletion(rates: Installment[], currentOpenCents: number, today: IsoDate): { ok: true; phases: TakeoverPhase[] } | { ok: false };
  export function schedulePhases(rates: Installment[], today: IsoDate): TakeoverPhase[];
  export function phaseStartUnix(start: IsoDate | 'now'): number | 'now';   // berlinLocalToUtc(date, '07:00') in Sekunden
  export function planEndDate(phases: TakeoverPhase[], today: IsoDate): IsoDate; // Ende der letzten Phase als Berlin-Datum
  export function planPrices(rates: Installment[], today: IsoDate): number[];     // unit_amounts aller Phasen
  export function publicPlanView(t: Pick<StripeTakeover, 'rates'>, today: IsoDate): { count: number; rates: { label: string; amountCents: number }[]; first: string; last: string };
  export function takeoverToken(newId: () => string): string;   // zwei newId ohne Bindestriche, 64 Hex-Zeichen
  export function paymentLinkUrl(base: string, token: string): string; // `${base ohne / am Ende}/zahlung/${token}`
  ```
  Regeln `schedulePhases`: Raten mit `dueDate <= today` → eine Phase `{ start: 'now', end: { date: erste künftige Fälligkeit }, amountCents: Summe }` (gibt es keine künftige: `end: { months: 1 }`). Künftige Raten: maximale Läufe gleicher Beträge, bei denen Rate i+1 = `monthDate(Jahr, Monat(start)+i+1, Tag(start))`; Lauf → `{ start, end: { months: len } }`. Nächster Lauf früher als natürliches Ende → letzte Rate des Laufs als eigene Phase mit `end: { date: nächster Start }`; später → Lücken-Phase `{ start: natürliches Ende, end: { date: nächster Start }, amountCents: Betrag der nächsten Phase, trial: true }`. `checkCompletion`: ok genau dann, wenn `currentOpenCents === Σ rates.amountCents` und `rates.length > 0`.
- Produces (`texts.ts`, du-Form, exakt):
  ```ts
  export function shareText(i: { name: string; link: string; rates: Installment[] }): string;
  // `Hallo ${Vorname}, ab sofort kannst du deine NEXUS-Raten automatisch abbuchen lassen (Karte oder SEPA-Lastschrift). ${n} Raten, erste am ${TT.MM.JJJJ}. Hier hinterlegst du dein Zahlungsmittel: ${link}\nWichtig: Bitte lösche danach deinen Dauerauftrag für NEXUS, damit nichts doppelt abgeht. Danke!`
  export function upcomingReminderText(i: { name: string; amountCents: number; dueDate: IsoDate; link: string | null }): string;
  // `Hallo ${Vorname}, kurze Erinnerung: Am ${TT.MM.JJJJ} ist deine NEXUS-Rate über ${Betrag} fällig.` + (link ? ` Bequemer geht es mit automatischer Abbuchung: ${link}` : '')
  export function linkNudgeText(i: { name: string; link: string }): string;
  // `Hallo ${Vorname}, hast du meinen Link schon gesehen? Dort kannst du deine NEXUS-Raten automatisch abbuchen lassen: ${link}`
  ```
  Vorname = erstes Wort von `name`.
- Produces (`action-factory.ts`):
  ```ts
  export function takeoverAction(i: { contract: MemberContract; contact: Contact; mode: MemberContract['catchUpMode']; plan: TakeoverPlan; attempt: number; prior?: StripeTakeover; at: Date; isDemo: boolean }): Action;
  // id takeoverActionId(contract.id, attempt), type 'stripe_takeover', company 'nexus', title `Umstellung auf Stripe: ${name}`,
  // payload { contractId, contactId, name, email: contact.emails[0] ?? null, mode, rates, openCents,
  //           stripeCustomerId?: prior.stripeCustomerId, paymentMethodId?: prior.paymentMethodId (nur wenn prior.status === 'plan_changed') }
  ```

- [ ] **Step 1: Failing tests** (Auszug; Fixtures über `stateWith`, `base`, Zahlungen wie in `tests/unit/ledger/takeover.test.ts`):
```ts
// plan.test.ts
test('gleiche Raten im Monatsabstand → eine Phase', () => {
  expect(schedulePhases([r(1,'2026-12-01',30000), r(2,'2027-01-01',30000), r(3,'2027-02-01',30000)], '2026-11-13'))
    .toEqual([{ start: '2026-12-01', end: { months: 3 }, amountCents: 30000 }]);
});
test('erste Rate höher (first_rate) → zwei Phasen', () => {
  expect(schedulePhases([r(1,'2026-12-01',45000), r(2,'2027-01-01',30000)], '2026-11-13'))
    .toEqual([{ start: '2026-12-01', end: { months: 1 }, amountCents: 45000 }, { start: '2027-01-01', end: { months: 1 }, amountCents: 30000 }]);
});
test('Fälligkeitstag 31 über Februar bleibt ein Lauf', () => {
  expect(schedulePhases([r(1,'2027-01-31',10000), r(2,'2027-02-28',10000), r(3,'2027-03-31',10000)], '2027-01-01'))
    .toEqual([{ start: '2027-01-31', end: { months: 3 }, amountCents: 10000 }]);
});
test('Pause: Lücken-Phase ohne Abbuchung', () => {
  expect(schedulePhases([r(1,'2026-12-01',30000), r(2,'2027-03-01',30000)], '2026-11-13')).toEqual([
    { start: '2026-12-01', end: { months: 1 }, amountCents: 30000 },
    { start: '2027-01-01', end: { date: '2027-03-01' }, amountCents: 30000, trial: true },
    { start: '2027-03-01', end: { months: 1 }, amountCents: 30000 }]);
});
test('Abstand unter einem Monat: Phase endet am nächsten Fälligkeitstag', () => {
  expect(schedulePhases([r(1,'2026-12-15',30000), r(2,'2027-01-01',30000)], '2026-11-13')).toEqual([
    { start: '2026-12-15', end: { date: '2027-01-01' }, amountCents: 30000 },
    { start: '2027-01-01', end: { months: 1 }, amountCents: 30000 }]);
});
test('Link nach erster Fälligkeit genutzt: überfällige Rate sofort, Rest nach Plan', () => {
  expect(checkCompletion([r(1,'2026-12-01',45000), r(2,'2027-01-01',30000)], 75000, '2026-12-05')).toEqual({ ok: true, phases: [
    { start: 'now', end: { date: '2027-01-01' }, amountCents: 45000 }, { start: '2027-01-01', end: { months: 1 }, amountCents: 30000 }] });
});
test('inzwischen überwiesen → nicht ok', () => {
  expect(checkCompletion([r(1,'2026-12-01',45000), r(2,'2027-01-01',30000)], 45000, '2026-11-20')).toEqual({ ok: false });
});
test('planEndDate: Start Winter, Ende Sommer, Tag 31', () => {
  expect(planEndDate([{ start: '2027-01-31', end: { months: 3 }, amountCents: 1 }], '2027-01-01')).toBe('2027-04-30');
});
test('phaseStartUnix: 07:00 Berlin (Winter und Sommer)', () => {
  expect(phaseStartUnix('2026-12-01')).toBe(Date.parse('2026-12-01T06:00:00Z') / 1000);
  expect(phaseStartUnix('2027-06-01')).toBe(Date.parse('2027-06-01T05:00:00Z') / 1000);
});
test('Token 64 Hex, Link ohne doppelten Schrägstrich', () => {
  let i = 0; const t = takeoverToken(() => `0000000${i++}-aaaa-bbbb-cccc-dddddddddddd`);
  expect(t).toMatch(/^[0-9a-f]{64}$/);
  expect(paymentLinkUrl('https://nexus.example.de/', t)).toBe(`https://nexus.example.de/zahlung/${t}`);
});
test('publicPlanView: Anzahl, erste/letzte Abbuchung, überfällig = „sofort“', () => { /* first 'sofort' wenn dueDate <= today, sonst formatIsoDe */ });
// status.test.ts
test('Sperrgründe in fester Reihenfolge', () => { /* stripe → 'Zahlt bereits über Stripe.'; Bank fehlt → 'Bank nicht verbunden: …'; bezahlt → 'Nichts mehr offen.'; link_sent → 'Umstellung läuft bereits.'; offener Entwurf → null */ });
test('takeoverStatus: offene Aktion → prepared, sonst jüngste Umstellung, sonst null', () => { /* … */ });
test('runsViaStripe nur bei set_up und active', () => { /* … */ });
test('nextTakeoverAttempt zählt frühere Aktionen', () => { /* 2 Aktionen stripe-takeover-c1-* → 3 */ });
// texts.test.ts: shareText enthält 'Dauerauftrag' und den Link; upcomingReminderText mit und ohne Link (exakt wie oben)
// action-factory.test.ts: takeoverAction-Payload; paymentMethodId nur aus prior mit status 'plan_changed'
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/takeover tests/unit/action-factory.test.ts` → FAIL.
- [ ] **Step 3: Implement** die drei Module und `takeoverAction`. Die Übernahme-Seite importiert `stripePlanAction` noch: dort vorläufig auf `takeoverAction` umstellen oder Import entfernen, damit `tsc` grün ist (UI folgt in Task 13).
- [ ] **Step 4: Run** Tests, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Domain-Kern der Stripe-Umstellung (Status, Phasen, Texte)`.

---

### Task 5: Ausführer liefert Ergebnis (`output`)

**Files:**
- Modify: `src/domain/actions/machine.ts`, `src/domain/actions/demo-provider.ts`, `src/data/executor.ts`, `src/domain/events.ts`
- Test: `tests/unit/executor.test.ts`, `tests/unit/actions.test.ts`

**Interfaces:**
- Produces (`machine.ts`):
  ```ts
  export type ActionOutput = Record<string, string>;
  export type ExecuteOutcome = 'ok' | 'error' | 'timeout' | { result: 'ok'; output: ActionOutput };
  export interface ActionProvider { readonly simulated: boolean; execute(a: Action, key: string): Promise<ExecuteOutcome>; lookup(key: string, a?: Action): Promise<boolean | { output: ActionOutput }> }
  export function cancelDraft(a: Action): Action; // nur draft → cancelled, sonst Fehler „Ungültiger Übergang“
  ```
- Produces (`events.ts`): `actionExecuted` und `actionReconciled` bekommen `output?: ActionOutput`.

- [ ] **Step 1: Failing tests**
```ts
test('output des Anbieters landet im Ereignis actionExecuted', async () => {
  const provider = { simulated: false, execute: async () => ({ result: 'ok' as const, output: { stripeCustomerId: 'cus_test_1' } }), lookup: async () => false };
  // Sink mit einer freigegebenen Aktion; nach executeApproved: angewendetes Ereignis enthält { result: 'ok', output: { stripeCustomerId: 'cus_test_1' } }
});
test('checkAction reicht output aus lookup weiter', async () => { /* lookup → { output: {...} } ⇒ actionReconciled { found: true, output } */ });
test('cancelDraft nur aus draft', () => {
  expect(cancelDraft(draft).status).toBe('cancelled');
  expect(() => cancelDraft({ ...draft, status: 'approved' })).toThrow('Ungültiger Übergang');
});
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/executor.test.ts tests/unit/actions.test.ts` → FAIL.
- [ ] **Step 3: Implement** `runWithTimeout` normalisiert `ExecuteOutcome` zu `{ result, output?, error? }`; `checkAction` übergibt `a` an `lookup` und reicht `output` durch.
- [ ] **Step 4: Run** Tests, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Ausführer meldet Ergebnisdaten zurück`.

---

### Task 6: Reducer – vorbereiten, freigeben, zurückziehen, einrichten

**Files:**
- Modify: `src/domain/events.ts`, `src/data/engine.ts`, `src/server/state-service.ts`
- Test: `tests/unit/takeover/events.test.ts` (neu), `tests/unit/state-service.test.ts`

**Interfaces:**
- Consumes: Task 4 (`takeoverAction`, `takeoverBlockReason`, `openTakeoverAction`, `nextTakeoverAttempt`, `takeoverToken`, `paymentLinkUrl`, `currentTakeover`), Task 5 (`output`, `cancelDraft`).
- Produces (`events.ts`):
  ```ts
  | { type: 'prepareTakeover'; contractId: string; mode: MemberContract['catchUpMode'] }   // Client
  | { type: 'prepareAllTakeovers' }                                                      // Client, mode = contract.catchUpMode
  | { type: 'withdrawTakeover'; contractId: string }                                     // Client
  | { type: 'approveActions'; items: { id: string; version: number }[] }                 // Client, 1–100, via 'app'
  | { type: 'simulateTakeoverSetUp'; contractId: string }                                // Client, nur wenn Umstellung isDemo
  | { type: 'takeoverSetUp'; takeoverId: string; scheduleId: string; paymentMethodId: string } // nur Server
  | { type: 'takeoverPlanChanged'; takeoverId: string; paymentMethodId: string }          // nur Server
  ```
- Verhalten (Reducer in `engine.ts`):
  - `prepareTakeover`: Sperrgrund ≠ null → Zustand gleich, Audit `Umstellung nicht vorbereitet: <Grund>`. Offener Entwurf vorhanden → `editDraft` mit neuem Payload, wenn Raten/Modus/openCents abweichen (sonst nichts). Sonst `takeoverAction` mit `attempt = nextTakeoverAttempt`, `prior = currentTakeover`. Raten immer aus `planTakeover(memberView(...).states, today, mode)`.
  - `prepareAllTakeovers`: wie oben für jeden Mitgliedschaftsvertrag ohne Sperrgrund und ohne offenen Entwurf; Audit `${n} Umstellungen vorbereitet`.
  - `approveActions`: je Eintrag dieselbe Logik wie `approveAction` (`via: 'app'`); Audit `Sammelfreigabe: ${n} Aktionen`.
  - `applyEffects` `stripe_takeover` (aus `actionExecuted`/`actionReconciled` mit `output`): neue `StripeTakeover` mit `id = ctx.newId()`, `token = (isDemo ? 'demo-' : '') + takeoverToken(ctx.newId)`, `isDemo = !output?.stripeCustomerId`, `link = paymentLinkUrl(output?.linkBase ?? '', token)`, `status = output?.scheduleId ? 'set_up' : 'link_sent'`, Felder aus Payload/Output. Bei `set_up` zusätzlich `setUpContract`.
  - `setUpContract(s, t, at)` (privat): Vertrag `billing: 'stripe'`, `plan: { takeoverId: t.id, paidCents: contract.totalCents − Σ t.rates, rates: t.rates }`; Umstellung `set_up`, `setUpAt`.
  - `takeoverSetUp`: nur aus `link_sent` (sonst nichts); setzt `scheduleId`, `paymentMethodId`, dann `setUpContract`; Audit-Akteur `system`: `Umstellung eingerichtet: ${name}, ${n} Raten (Zeitplan ${scheduleId})`.
  - `takeoverPlanChanged`: nur aus `link_sent` → `plan_changed`, `paymentMethodId`; Audit `system`: `Umstellung ${name}: Plan hat sich geändert, neu freigeben`.
  - `simulateTakeoverSetUp`: nur wenn `currentTakeover` `isDemo` und `link_sent` → wie `takeoverSetUp` mit `scheduleId: 'demo'`, `paymentMethodId: 'demo'`.
  - `withdrawTakeover`: offener Entwurf → `cancelDraft`; sonst `currentTakeover` in `link_sent`|`plan_changed` → `withdrawn`, `endedAt`. Ab `set_up` nichts (Audit `Zurückziehen nicht möglich: Zeitplan besteht, bitte in Stripe kündigen`).
  - `editAction` ignoriert `stripe_takeover`.
- `state-service.ts`: `CLIENT_EVENTS` + die fünf Client-Ereignisse mit `SHAPE` (`mode` ∈ first_rate|spread, `items` 1–100 mit `isStr(id)`/`isVersion`); `isActionType` bekommt `stripe_takeover` **nicht** (createAction lehnt ab); `takeoverSetUp`/`takeoverPlanChanged` nicht in `CLIENT_EVENTS`.

- [ ] **Step 1: Failing tests** (`events.test.ts`, Kontext `{ at: new Date('2026-11-13T09:00:00Z'), isDemo: false, newId }` mit Zähler-IDs; Vertrag `base` mit Bank verbunden, 450 € gezahlt):
```ts
test('prepareTakeover legt Entwurf mit Raten aus dem Stand an', () => {
  const r = applyEvent(s, { type: 'prepareTakeover', contractId: 'c1', mode: 'first_rate' }, ctx);
  const a = r.state.actions.find((x) => x.id === 'stripe-takeover-c1-1')!;
  expect(a).toMatchObject({ type: 'stripe_takeover', status: 'draft', version: 1 });
  expect(a.payload.rates).toEqual([{ no: 1, dueDate: '2026-12-01', amountCents: 45000 }, { no: 2, dueDate: '2027-01-01', amountCents: 30000 }]);
});
test('erneut mit anderem Modus → neue Version, keine zweite Aktion', () => { /* spread → version 2, genau eine stripe_takeover-Aktion */ });
test('Sperrgrund: nichts angelegt, Audit nennt Grund', () => { /* billing stripe → Audit 'Umstellung nicht vorbereitet: Zahlt bereits über Stripe.' */ });
test('createAction mit stripe_takeover wird vom Server abgelehnt', () => {
  expect(isClientEvent({ type: 'createAction', action: { ...draftAction, type: 'stripe_takeover' } })).toBe(false);
});
test('editAction ändert stripe_takeover nicht', () => { /* payload.rates bleibt, version bleibt 1 */ });
test('Ausführung mit output → link_sent, Token 64 Hex, Link aus linkBase', () => {
  // approveAction, actionStarted, actionExecuted { result: 'ok', output: { stripeCustomerId: 'cus_test_1', linkBase: 'https://nexus.example.de' } }
  const t = r.state.takeovers[0];
  expect(t).toMatchObject({ status: 'link_sent', isDemo: false, stripeCustomerId: 'cus_test_1', actionId: 'stripe-takeover-c1-1', actionVersion: 1 });
  expect(t.token).toMatch(/^[0-9a-f]{64}$/);
  expect(t.link).toBe(`https://nexus.example.de/zahlung/${t.token}`);
});
test('Ausführung ohne output (Demo) → Token demo-…, isDemo', () => { /* … */ });
test('takeoverSetUp → eingerichtet, billing stripe, plan mit paidCents', () => {
  // contract.plan = { takeoverId, paidCents: 45000, rates }, billing 'stripe'; zweites takeoverSetUp ändert nichts
});
test('takeoverSetUp nach Zurückziehen ändert nichts', () => { /* withdrawn bleibt, billing legacy */ });
test('output mit scheduleId (Neu-Freigabe mit hinterlegtem Zahlungsmittel) → direkt eingerichtet', () => { /* … */ });
test('approveActions gibt mehrere Entwürfe frei, veraltete Version bleibt Entwurf', () => { /* … */ });
test('prepareAllTakeovers überspringt Stripe-, bezahlte und schon vorbereitete Verträge', () => { /* … */ });
test('simulateTakeoverSetUp nur für Demo-Umstellungen', () => { /* isDemo false → nichts */ });
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/takeover/events.test.ts tests/unit/state-service.test.ts` → FAIL.
- [ ] **Step 3: Implement** Ereignisse, Reducer-Fälle, `applyEffects`-Zweig, `SHAPE`/`CLIENT_EVENTS`.
- [ ] **Step 4: Run** Tests, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Umstellung vorbereiten, freigeben, zurückziehen und einrichten`.

---

### Task 7: Import und Verknüpfung (`metadata.contractId`, Rückfall)

**Files:**
- Create: `src/domain/takeover/link.ts`
- Modify: `src/domain/import/stripe.ts`, `src/domain/import/batch.ts` (Typ), `src/domain/import/merge.ts`, `src/domain/import/proposals.ts`, `src/data/engine.ts` (`importBatch` ruft `syncTakeovers`)
- Test: `tests/unit/import/stripe.test.ts`, `tests/unit/import/proposals.test.ts`, `tests/unit/takeover/link.test.ts`

**Interfaces:**
- Consumes: `schedulePhases`, `planEndDate` (Task 4).
- Produces:
  ```ts
  // mapStripe: ImportedSubscription.metadataContractId = s.metadata?.contractId ?? null
  // merge: metadataContractId wird übernommen (alte Daten ohne Feld = null)
  export function syncTakeovers(s: AppState, today: IsoDate, at: Date): { state: AppState; audit: string[] };
  ```
  `syncTakeovers`: (a) Umstellung `set_up` + Abo mit `metadataContractId === contractId` → Abo `contractId`, `confirmedPriceCents: null`, `confirmedEndDate = planEndDate(schedulePhases(rates, setUpAt-Tag))`; Umstellung `active`, `subscriptionExternalId`, `activeAt`; Audit `Stripe-Abo verknüpft: ${name}`. (b) Umstellung `active`, Abo `canceled` und nicht regulär beendet (`endDate === confirmedEndDate && endDate <= today`) → Umstellung `aborted`, `endedAt`; Vertrag `billing: 'legacy'` (`plan` bleibt); Audit `Stripe-Abo vorzeitig beendet: ${name}, zurück auf Überweisung`.
  `deriveProposals`: Abos mit `metadataContractId` erzeugen nie einen Vorschlag.

- [ ] **Step 1: Failing tests**
```ts
// import/stripe.test.ts
test('metadata.contractId wird gelesen', () => { /* Abo-Fixture mit metadata { contractId: 'c1' } → metadataContractId 'c1'; ohne → null */ });
// import/proposals.test.ts
test('Abo mit metadata.contractId erzeugt keinen Vorschlag', () => { /* unverknüpftes Abo, Mitgliedschafts-Produkt, metadataContractId 'c-unbekannt' → deriveProposals leer */ });
// takeover/link.test.ts
test('Abo des Zeitplans wird automatisch verknüpft, ohne Vorschlag', () => {
  // takeover set_up (c1), Abo sub_test_1 metadataContractId 'c1', contractId null
  // → sub.contractId 'c1', confirmedEndDate = planEndDate(...), takeover active; s.contracts.length unverändert
});
test('importiertes Enddatum aus dem Zeitplan = planEndDate (kein „Enddatum geändert“)', () => {
  // Abo-Fixture mit schedule.phases[-1].end_date = phaseStartUnix-Rechnung des Planendes → detectSubscriptionChanges ohne 'end'
});
test('vorzeitige Kündigung → abgebrochen und zurück auf legacy', () => { /* status canceled, endDate < confirmedEndDate */ });
test('reguläres Ende → bleibt aktiv, kein Rückfall', () => { /* … */ });
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/import/stripe.test.ts tests/unit/import/proposals.test.ts tests/unit/takeover/link.test.ts` → FAIL.
- [ ] **Step 3: Implement**; `importBatch`-Reducer wendet nach `mergeBatch` `syncTakeovers` an und schreibt dessen Audit-Zeilen (Akteur `system`).
- [ ] **Step 4: Run** Tests, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Stripe-Abo der Umstellung automatisch mit dem Vertrag verknüpfen`.

---

### Task 8: Hinweise (Plan statt Einzelpreis, Lexware still, Doppelzahlung, Link, Plan geändert)

**Files:**
- Create: `src/domain/detectors/takeover.ts`
- Modify: `src/domain/detectors/subscriptions.ts`, `src/domain/detectors/invoices.ts`, `src/domain/detectors/refs.ts`, `src/domain/detectors/index.ts`
- Test: `tests/unit/detectors-subscriptions.test.ts`, `tests/unit/detectors.test.ts`, `tests/unit/takeover/detectors.test.ts`

**Interfaces:**
- Consumes: `runsViaStripe`, `currentTakeover`, `planPrices`, `coveringContract`, `memberView`.
- Produces:
  ```ts
  export const takeoverRef: (label: string) => Ref; // { kind: 'member', id: 'umstellung', href: '/nexus/umstellung', label }
  export function detectTakeover(s: AppState, now: Date): Insight[];
  // gemeinsame Fallfindung, auch für Task 9 (nicht doppelt implementieren):
  export function upcomingRates(s: AppState, today: IsoDate): { contractId: string; dueDate: IsoDate; amountCents: number }[]; // amountCents = Rest der Rate
  export function unusedLinks(s: AppState, today: IsoDate): StripeTakeover[];
  ```
  `detectTakeover` liefert (company `nexus`, `needsSources: ['stripe_nexus']` bzw. `['bank_qonto']` bei Doppelzahlung):
  - `double_payment`, dedupe `double-pay:<paymentId>`, priority `today`: Bank-Zahlung (`source 'bank'`, `kind 'incoming'`) zugeordnet zu einem Vertrag mit `runsViaStripe`, `bookedOn >= todayBerlin(new Date(setUpAt))`. Titel `Doppelzahlung: ${name} hat ${Betrag} überwiesen`, Body `Die Raten laufen seit ${TT.MM.JJJJ} über Stripe. Bitte von Hand erstatten.`, nextStep `Von Hand erstatten`.
  - `takeover_link_unused`, dedupe `takeover-link:<takeoverId>`, priority `info`: `link_sent` seit ≥ `settings.takeoverLinkNudgeDays` Tagen. Titel `${name}: Stripe-Link seit ${n} Tagen nicht genutzt`, nextStep `Erinnerung an den Link freigeben`.
  - `takeover_plan_changed`, dedupe `takeover-changed:<takeoverId>`, priority `today`: jüngste Umstellung `plan_changed` und kein offener Entwurf. Titel `${name}: Plan hat sich geändert, Umstellung neu freigeben`.
  - `rate_upcoming`, dedupe `upcoming:<contractId>:<dueDate>`, priority `today`: Vertrag `legacy`, nicht `runsViaStripe`, künftige Rate mit Rest > 0 und `0 ≤ daysBetween(today, dueDate) ≤ settings.takeoverReminderDays`. Titel `${name}: Rate über ${Betrag} am ${TT.MM.JJJJ} fällig`, nextStep `Erinnerung freigeben`, Ref `takeoverRef('Erinnerungen')`.
  `detectSubscriptionChanges`: für Abos, deren Vertrag `plan` hat und `runsViaStripe` bzw. `aborted` ist, gilt der Preis als unverändert, wenn `priceCents ∈ planPrices(plan.rates, …)`. `detectStripePaidLexwareOpen` und `detectInvoiceOverdue` überspringen Rechnungen, deren `coveringContract` `runsViaStripe` ist.

- [ ] **Step 1: Failing tests**
```ts
test('Ratenwechsel laut Plan ist kein „Preis geändert“', () => { /* Plan 45000 dann 30000; Abo priceCents 30000 → kein dedupe 'sub:…:price' */ });
test('Preis außerhalb des Plans → „Preis geändert“', () => { /* priceCents 99900 → Hinweis */ });
test('Lexware-Gesamtrechnung schweigt, wenn der Vertrag über Stripe läuft', () => {
  // Rechnung abgedeckt (coveringContract = c1), überfällig, passende Stripe-Zahlung mit reference = number
  // → weder 'stripe-lex:<id>' noch 'inv-over:nexus'
});
test('Doppelzahlung nach eingerichtet', () => { /* Bank 30000 am 2026-12-02 → Titel 'Doppelzahlung: Lena Kaya hat 300,00 € überwiesen' */ });
test('keine Doppelzahlung vor eingerichtet', () => { /* … */ });
test('Link 7 Tage ungenutzt (Einstellung 7), nicht nach 6', () => { /* … */ });
test('Erinnerung 3 Tage vorher, nicht 4, nicht ab eingerichtet, nicht wenn bezahlt', () => { /* … */ });
test('Einstellung takeoverReminderDays 5 → schon 5 Tage vorher', () => { /* … */ });
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/detectors-subscriptions.test.ts tests/unit/detectors.test.ts tests/unit/takeover/detectors.test.ts` → FAIL.
- [ ] **Step 3: Implement**; `runDetectors` ergänzt `detectTakeover`.
- [ ] **Step 4: Run** Tests, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Hinweise zur Umstellung, Abo-Prüfung gegen den Plan`.

---

### Task 9: Entwürfe im Abgleich (Erinnerungen, Link-Erinnerung, Plan aktuell halten)

**Files:**
- Create: `src/domain/takeover/drafts.ts`
- Modify: `src/domain/action-factory.ts`, `src/domain/payment-link.ts`, `src/ai/state-ai.ts`, `src/domain/assistant.ts` (Aufruf `paymentLinkFor(s, id)`), `src/data/engine.ts` (`refresh`)
- Test: `tests/unit/takeover/drafts.test.ts`, `tests/unit/refresh.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const upcomingReminderId = (contractId: string, dueDate: IsoDate) => `upcoming-${contractId}-${dueDate}`;
  export function upcomingReminderAction(i: { contract: MemberContract; contact: Contact; dueDate: IsoDate; text: string; at: Date; isDemo: boolean }): Action; // send_reminder, insightKey `upcoming:<contractId>:<dueDate>`, payload wie reminderAction
  export const linkNudgeId = (takeoverId: string) => `link-nudge-${takeoverId}`;
  export function linkNudgeAction(i: { takeover: StripeTakeover; contact: Contact; text: string; at: Date; isDemo: boolean }): Action; // insightKey `takeover-link:<id>`
  export function ensureTakeoverDrafts(s: AppState, at: Date, isDemo: boolean): AppState;
  export function paymentLinkFor(s: AppState, contractId: string): string; // Link der jüngsten Umstellung in link_sent|plan_changed, sonst bisheriger Demo-Link
  ```
  `ensureTakeoverDrafts` (idempotent, gleiche IDs; nutzt `upcomingRates`/`unusedLinks` aus Task 8): legt Entwürfe zu jedem `rate_upcoming`-Fall an (Text `upcomingReminderText` mit `paymentLinkFor`-Link nur wenn Umstellung vorhanden) und zu jedem `takeover_link_unused`-Fall (`linkNudgeText`); bricht `upcoming-*`-Entwürfe ab (`cancelDraft`), deren Fälligkeit vorbei ist oder deren Vertrag inzwischen `runsViaStripe`; hält offene `stripe_takeover`-Entwürfe aktuell (anderer Plan → `editDraft`; Sperrgrund → `cancelDraft`).

- [ ] **Step 1: Failing tests**
```ts
test('3 Tage vor Fälligkeit entsteht genau ein Erinnerungsentwurf', () => {
  const st = ensureTakeoverDrafts(ensureTakeoverDrafts(s, new Date('2026-11-28T08:00:00Z'), false), new Date('2026-11-28T09:00:00Z'), false);
  expect(st.actions.filter((a) => a.id === 'upcoming-c1-2026-12-01')).toHaveLength(1);
  expect(st.actions[0].payload.text).toBe('Hallo Lena, kurze Erinnerung: Am 01.12.2026 ist deine NEXUS-Rate über 300,00 € fällig.');
});
test('mit Umstellung enthält die Erinnerung den Stripe-Link', () => { /* … endet mit ` Bequemer geht es mit automatischer Abbuchung: ${link}` */ });
test('ab eingerichtet: offener Erinnerungsentwurf wird abgebrochen, kein neuer', () => { /* … */ });
test('Plan ändert sich vor Freigabe → stripe_takeover-Entwurf neue Version', () => { /* Zahlung kommt dazu → version 2, openCents neu */ });
test('voll bezahlt vor Freigabe → stripe_takeover-Entwurf abgebrochen', () => { /* … */ });
// refresh.test.ts
test('refresh legt Erinnerungsentwürfe an', () => { /* refresh(s, at) enthält upcoming-… */ });
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/takeover/drafts.test.ts tests/unit/refresh.test.ts` → FAIL.
- [ ] **Step 3: Implement**; `refresh` ruft `ensureTakeoverDrafts` vor dem Hinweis-Abgleich.
- [ ] **Step 4: Run** Tests, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Erinnerungsentwürfe vor jeder Rate und Link-Erinnerung`.

---

### Task 10: Stripe schreiben (POST, Formular, Schreiber)

**Files:**
- Create: `src/server/connectors/form.ts`, `src/server/connectors/stripe-write.ts`, `tests/fixtures/stripe-write.ts`
- Modify: `src/server/connectors/http.ts`, `src/server/connectors/fixture-fetch.ts`, `src/server/env.ts`
- Test: `tests/unit/connectors/form.test.ts`, `tests/unit/connectors/http.test.ts`, `tests/unit/connectors/stripe-write.test.ts`, `tests/unit/env.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // form.ts
  export type FormValue = string | number | boolean | null | undefined | FormValue[] | { [k: string]: FormValue };
  export function encodeForm(v: Record<string, FormValue>): string; // a[b][0][c]=…, null/undefined weg, URL-kodiert
  // http.ts: createApiClient(...) liefert zusätzlich
  postForm(path: string, body: string, idempotencyKey?: string): Promise<unknown>; // content-type application/x-www-form-urlencoded, gleiche 429-Logik, gleiche Fehlertexte
  // stripe-write.ts
  export interface StripeWriter {
    findOrCreateCustomer(i: { contractId: string; name: string; email: string | null }, idemKey: string): Promise<string>;
    createSetupCheckout(i: { customerId: string; takeoverId: string; contractId: string; token: string; base: string }): Promise<{ id: string; url: string }>;
    setupIntentPaymentMethod(setupIntentId: string): Promise<string>;
    setDefaultPaymentMethod(customerId: string, paymentMethodId: string): Promise<void>;
    ensurePlanProduct(): Promise<string>;
    createSchedule(i: ScheduleInput, idemKey: string): Promise<string>;
  }
  export interface ScheduleInput { customerId: string; paymentMethodId: string; productId: string; phases: TakeoverPhase[]; contractId: string; takeoverId: string }
  export function scheduleParams(i: ScheduleInput): Record<string, FormValue>; // rein, Felder laut „Stripe-Festlegungen“
  export const PLAN_PRODUCT_NAME = 'NEXUS-Mitgliedschaft (Ratenplan)';
  export function createStripeWriter(o: { key: string; fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number }): StripeWriter;
  // env.ts: stripeWriteKey?: string (STRIPE_WRITE_KEY), paymentLinkBaseUrl: string (PAYMENT_LINK_BASE_URL ?? APP_ORIGIN)
  // fixture-fetch.ts: Routenschlüssel zuerst `${METHOD} ${pfad+query}`, dann `${METHOD} ${pfad}`, dann wie bisher; opts.requests?: { method; path; body; idempotencyKey }[]
  // tests/fixtures/stripe-write.ts: export const stripeWriteRoutes (erfundene IDs cus_test_1, cs_test_1, seti_test_1, pm_test_1, prod_test_1, sub_sched_test_1)
  ```
- [ ] **Step 1: Failing tests**
```ts
test('encodeForm verschachtelt wie Stripe', () => {
  expect(decodeURIComponent(encodeForm({ phases: [{ items: [{ price_data: { unit_amount: 30000, recurring: { interval: 'month' } } }] }], x: null })))
    .toBe('phases[0][items][0][price_data][unit_amount]=30000&phases[0][items][0][price_data][recurring][interval]=month');
});
test('postForm: Methode, Content-Type, Idempotency-Key, Schlüssel nie in Fehlertext', async () => { /* 400 mit error.message mit Schlüssel → '***' */ });
test('postForm wiederholt 429 mit demselben Idempotency-Key', async () => { /* … */ });
test('scheduleParams: Start 07:00 Berlin, Phasen mit Metadaten, cancel am Ende', () => {
  const p = scheduleParams({ customerId: 'cus_test_1', paymentMethodId: 'pm_test_1', productId: 'prod_test_1', contractId: 'c1', takeoverId: 'tk1',
    phases: [{ start: '2026-12-01', end: { months: 1 }, amountCents: 45000 }, { start: '2027-01-01', end: { months: 2 }, amountCents: 30000 }] });
  expect(p).toMatchObject({ customer: 'cus_test_1', start_date: Date.parse('2026-12-01T06:00:00Z') / 1000, end_behavior: 'cancel',
    default_settings: { collection_method: 'charge_automatically', default_payment_method: 'pm_test_1' }, metadata: { contractId: 'c1', takeoverId: 'tk1' } });
  expect(p.phases).toEqual([
    { items: [{ price_data: { currency: 'eur', product: 'prod_test_1', unit_amount: 45000, recurring: { interval: 'month' } }, quantity: 1 }],
      duration: { interval: 'month', interval_count: 1 }, billing_cycle_anchor: 'phase_start', proration_behavior: 'none', metadata: { contractId: 'c1', takeoverId: 'tk1' } },
    { /* 30000, interval_count 2 */ }]);
});
test('scheduleParams: Lücken-Phase trial ohne billing_cycle_anchor, end_date als Unix 07:00', () => { /* … */ });
test('scheduleParams: überfällige Rate → start_date now', () => { /* … */ });
test('findOrCreateCustomer findet vorhandenen Kunden über contractId', async () => { /* search liefert cus_test_1 → kein POST */ });
test('findOrCreateCustomer legt an mit Idempotency-Key', async () => { /* requests[0] POST /v1/customers, idempotencyKey 'stripe-takeover-c1-1:1:customer' */ });
test('createSetupCheckout: mode setup, card + sepa_debit, Danke-/Abbruch-URL', async () => { /* body enthält success_url=<base>/zahlung/danke, cancel_url=<base>/zahlung/abbruch?t=<token> */ });
test('ensurePlanProduct legt Produkt nur an, wenn die Suche nichts findet', async () => { /* … name PLAN_PRODUCT_NAME */ });
test('readEnv: STRIPE_WRITE_KEY optional, PAYMENT_LINK_BASE_URL fällt auf APP_ORIGIN zurück', () => { /* … */ });
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/connectors tests/unit/env.test.ts` → FAIL.
- [ ] **Step 3: Implement** (`Stripe-Version`-Header wie `pullStripe`; `minIntervalMs: 0`).
- [ ] **Step 4: Run** Tests, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Stripe-Schreibzugriff (Kunde, Checkout, Zeitplan)`.

---

### Task 11: Server-Ausführer und Webhook `checkout.session.completed`

**Files:**
- Create: `src/server/action-provider.ts`, `src/server/takeover.ts`
- Modify: `src/server/registry.ts`, `src/app/api/webhooks/stripe/route.ts`
- Test: `tests/unit/action-provider.test.ts`, `tests/unit/takeover/complete.test.ts`, `tests/unit/webhook-stripe.test.ts`

**Interfaces:**
- Consumes: `StripeWriter` (Task 10), `checkCompletion`, `schedulePhases`, `memberView`, `dispatchEvents`, `idempotencyKey`.
- Produces:
  ```ts
  // action-provider.ts
  export function createActionProvider(o: { writer: StripeWriter | null; linkBase: string; now: () => Date; demo?: DemoProvider }): ActionProvider;
  // simulated: true (Nachrichten bleiben Demo). stripe_takeover mit writer: Kunde (payload.stripeCustomerId oder findOrCreateCustomer(key + ':customer'));
  //   mit payload.paymentMethodId zusätzlich setDefaultPaymentMethod + ensurePlanProduct + createSchedule(schedulePhases(rates, today), `${key}:schedule`)
  //   → { result: 'ok', output: { stripeCustomerId, linkBase, scheduleId?, paymentMethodId? } }.
  // stripe_takeover ohne writer → { result: 'ok', output: { linkBase } } (Demo). Andere Typen → DemoProvider.
  // lookup(key, a) für stripe_takeover mit writer: Kunde per contractId gefunden → { output: { stripeCustomerId, linkBase } }, sonst false.
  // takeover.ts
  export async function completeTakeoverCheckout(repos: Repos, writer: StripeWriter, session: { id: string; mode: string; setup_intent: string | null; metadata?: Record<string, string> }, deps: { at: Date; provider: ActionProvider }): Promise<'ignored' | 'set_up' | 'plan_changed'>;
  export async function createCheckoutForToken(repos: Repos, writer: StripeWriter | null, token: string, base: string): Promise<{ kind: 'redirect'; url: string } | { kind: 'demo' } | { kind: 'invalid' }>;
  // registry.ts
  export function getStripeWriter(): StripeWriter | null;        // STRIPE_WRITE_KEY oder Test-Überschreibung
  export function setTestStripeWriter(w: StripeWriter | null): void; // wirft außerhalb testMemoryDb
  // getActionProvider() und getSyncDeps().provider liefern createActionProvider({ writer: getStripeWriter(), linkBase: env.paymentLinkBaseUrl, now: realNow })
  ```
  `completeTakeoverCheckout`: `mode !== 'setup'` oder Umstellung ≠ `link_sent` → `ignored`. Sonst Zahlungsmittel holen, `memberView(...).status.openCents` gegen `checkCompletion` prüfen; nicht ok → `takeoverPlanChanged`; ok → Standard setzen, Produkt, Zeitplan (Key `takeover:<id>:schedule`), `takeoverSetUp`. Ereignisse über `dispatchEvents`.
  Webhook-Reihenfolge: Signatur → bei `checkout.session.completed` mit `metadata.takeoverId` und vorhandenem Schreiber `completeTakeoverCheckout` (Fehler → 500, damit Stripe wiederholt; Idempotenz über Status + Idempotency-Key) → danach wie bisher `claimJobRun` und Sync für `STRIPE_SYNC_EVENTS`.

- [ ] **Step 1: Failing tests** (Memory-Repos, `fixtureFetch(stripeWriteRoutes, { requests })`, Webhook-Body signiert mit Testgeheimnis wie in `webhook-stripe.test.ts`):
```ts
test('Ausführung legt Kunden an und liefert output', async () => { /* … output.stripeCustomerId 'cus_test_1', linkBase 'https://nexus.example.de' */ });
test('Neu-Freigabe mit hinterlegtem Zahlungsmittel legt sofort den Zeitplan an', async () => { /* output.scheduleId 'sub_sched_test_1' */ });
test('ohne Schreib-Schlüssel: Demo-output, kein Stripe-Aufruf', async () => { /* requests leer */ });
test('Webhook: gleicher Plan → eingerichtet, Zeitplan genau einmal', async () => {
  // POST zweimal mit demselben Ereignis → takeovers[0].status 'set_up', contract.billing 'stripe'
  // requests.filter(r => r.method === 'POST' && r.path === '/v1/subscription_schedules') alle mit idempotencyKey 'takeover:<id>:schedule'
});
test('Webhook: inzwischen überwiesen → Plan geändert, kein Zeitplan, Zahlungsmittel gespeichert', async () => { /* paymentMethodId 'pm_test_1' */ });
test('Webhook nach Zurückziehen → ignoriert', async () => { /* status withdrawn, kein Zeitplan */ });
test('Webhook: Stripe-Fehler beim Zeitplan → 500, Ereignis nicht als erledigt beansprucht', async () => { /* zweiter Versuch richtet ein */ });
test('Webhook ohne Schreib-Schlüssel ändert nichts', async () => { /* … */ });
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/action-provider.test.ts tests/unit/takeover/complete.test.ts tests/unit/webhook-stripe.test.ts` → FAIL.
- [ ] **Step 3: Implement**.
- [ ] **Step 4: Run** Tests, `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Server-Ausführer und Webhook richten den Stripe-Zeitplan ein`.

---

### Task 12: Öffentliche Seiten `/zahlung/…` mit Ratenbegrenzung

**Files:**
- Create: `src/server/rate-limit.ts`, `src/components/RootChrome.tsx`, `src/app/zahlung/[token]/page.tsx`, `src/app/zahlung/[token]/weiter/route.ts`, `src/app/zahlung/danke/page.tsx`, `src/app/zahlung/abbruch/page.tsx`, `src/app/api/test/takeover/route.ts`
- Modify: `src/app/layout.tsx`, `next.config.ts` (Header `Referrer-Policy: no-referrer` für `/zahlung/:path*`), `playwright.config.ts` (`STRIPE_WEBHOOK_SECRET: 'whsec_e2e_nur_test'`)
- Test: `tests/unit/rate-limit.test.ts`, `tests/unit/zahlung-route.test.ts`, `tests/e2e/umstellung.spec.ts` (öffentlicher Teil)

**Interfaces:**
- Consumes: `createCheckoutForToken`, `publicPlanView`, `getRepos`, `getStripeWriter`, `readEnv`.
- Produces:
  ```ts
  export async function allowRequest(repo: Pick<StateRepository, 'claimJobRun'>, key: string, limit: number, at: Date): Promise<boolean>;
  // versucht job_runs-Schlüssel `rl:${key}:${YYYY-MM-DDTHH:MM (UTC)}:${i}` für i = 0..limit-1, true beim ersten erfolgreichen Claim
  export function clientKey(req: Request, secret: string): string; // sha256(erste x-forwarded-for-IP + secret), 16 Hex; nie die IP selbst speichern
  ```
  Grenzen: Seite (GET) 20 je Minute und IP; `weiter` (POST) 10 je Minute und IP und 5 je Minute und Token. Abgewiesen → 429 mit Text „Zu viele Aufrufe, bitte kurz warten.“
  - `/zahlung/[token]` (Server-Komponente, `await connection()`, `metadata.robots = { index: false, follow: false }`): Token gültig = Umstellung `link_sent`. Zeigt „NEXUS – Ratenplan“, `count` Raten mit Datum/Betrag, „Erste Abbuchung: …“ (`sofort` bei überfälliger Rate), „Letzte Abbuchung: …“, Formular `method="post" action="/zahlung/<token>/weiter"` mit Knopf „Weiter zu Stripe“. Demo-Umstellung: Plakette „Demo“, Knopf deaktiviert („Demo – hier öffnet später Stripe“). Ungültig/erledigt/zurückgezogen: nur „Link nicht mehr gültig, bitte melde dich bei NEXUS.“, Status 404, keine Daten. Kein Name, keine E-Mail.
  - `weiter/route.ts` `POST`: `createCheckoutForToken` → `redirect` 303 auf `url`; `demo`/`invalid` → 303 zurück auf `/zahlung/<token>`. Nur POST (GET → 405), damit Link-Vorschauen keine Sitzung anlegen.
  - `danke`: „Danke! Dein Zahlungsmittel ist hinterlegt. Die Raten werden ab jetzt automatisch abgebucht. Bitte lösche deinen Dauerauftrag für NEXUS.“ · `abbruch`: „Abgebrochen. Es wurde nichts eingerichtet.“ + Link „Erneut versuchen“ auf `/zahlung/<t>` (nur wenn `t` 64 Hex).
  - `RootChrome` (Client): Pfad beginnt mit `/zahlung` → nur `children` (ohne `ModeProvider`, `AppStoreProvider`, `AppShell`); sonst wie bisher. `layout.tsx` nutzt `RootChrome`.
  - `/api/test/takeover` (nur `testMemoryDb`, sonst 404): `POST { routes, state }` setzt Memory-Stand und `setTestStripeWriter(createStripeWriter({ key: 'test', fetch: fixtureFetch(routes), … }))`; `GET` liefert `takeovers`.

- [ ] **Step 1: Failing tests**
```ts
// rate-limit.test.ts
test('5 je Minute erlaubt, 6. nicht, nächste Minute wieder', async () => { /* Memory-Repo */ });
test('clientKey enthält die IP nicht', () => { expect(clientKey(reqWithIp('203.0.113.7'), 's'.repeat(32))).not.toContain('203'); });
// zahlung-route.test.ts (Route-Handler direkt aufrufen, Memory-Repos, Test-Schreiber)
test('POST weiter: gültiger Token → 303 auf Checkout-URL, Sitzung mit mode setup', async () => { /* … */ });
test('GET weiter → 405, keine Sitzung', async () => { /* requests leer */ });
test('POST weiter mit ungültigem Token → 303 zurück, keine Sitzung', async () => { /* … */ });
test('6. POST je Token und Minute → 429', async () => { /* … */ });
```
```ts
// tests/e2e/umstellung.spec.ts (öffentlicher Teil)
test('ungültiger Link: neutrale Seite ohne App-Rahmen', async ({ page }) => {
  await page.goto('/zahlung/' + '0'.repeat(64));
  await expect(page.getByText('Link nicht mehr gültig, bitte melde dich bei NEXUS.')).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
});
test('Fixture-Stripe: Plan sehen, weiter zu Stripe, Webhook richtet ein', async ({ page, request }) => {
  // POST /api/test/takeover { routes: stripeWriteRoutes (checkout url → http://localhost:3100/zahlung/danke), state: Testmitglied mit link_sent-Umstellung }
  // page.goto(link) → sieht '2 Raten', 'Erste Abbuchung: 01.12.2026', keinen Namen
  // Klick 'Weiter zu Stripe' → URL endet mit /zahlung/danke, Text 'Danke!'
  // request.post('/api/webhooks/stripe', signiert mit 'whsec_e2e_nur_test') → GET /api/test/takeover: status 'set_up'
});
```
- [ ] **Step 2: Run** `npx vitest run tests/unit/rate-limit.test.ts tests/unit/zahlung-route.test.ts` → FAIL; `fuser -k 3100/tcp; npx playwright test umstellung.spec.ts --trace off 2>&1 | tail -15` → FAIL.
- [ ] **Step 3: Implement** (Next-Doku zu `route.md`, `page.md`, `redirect.md` lesen; `params` per `await`).
- [ ] **Step 4: Run** dieselben Befehle + `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `fuser -k 3100/tcp; npx playwright test shell.spec.ts --trace off 2>&1 | tail -15` (App-Rahmen unverändert) → grün.
- [ ] **Step 5: Commit** `feat: Öffentliche Zahlungsseite mit Ratenbegrenzung`.

---

### Task 13: App-Oberfläche (Übernahme, Mitglied, Übersicht „Umstellung“, Plakette, Einstellungen)

**Files:**
- Create: `src/components/TakeoverCard.tsx`, `src/app/nexus/umstellung/page.tsx`
- Modify: `src/app/nexus/mitglieder/[id]/uebernahme/page.tsx`, `src/app/nexus/mitglieder/[id]/page.tsx`, `src/app/nexus/offen/page.tsx`, `src/app/nexus/page.tsx` (Zeile „Umstellung auf Stripe“), `src/app/einstellungen/page.tsx`, `src/data/selectors.ts`
- Test: `tests/unit/selectors.test.ts`, `tests/e2e/umstellung.spec.ts` (Demo-Teil), `tests/e2e/nexus.spec.ts` (Knopftext)

**Interfaces:**
- Consumes: Task 4/6/9 (`takeoverStatus`, `TAKEOVER_STATUS_LABEL`, `takeoverBlockReason`, `currentTakeover`, `runsViaStripe`, `shareText`, Ereignisse).
- Produces (`selectors.ts`):
  ```ts
  export function takeoverRows(s: AppState, today: IsoDate): { contractId: string; name: string; status: TakeoverStatus | null; blockReason: string | null; openCents: number }[]; // alle Mitgliedschaftsverträge mit billing legacy oder Umstellung, nach Name
  export function openTakeoverDrafts(s: AppState): Action[];   // stripe_takeover in draft
  export function openUpcomingReminders(s: AppState): Action[]; // send_reminder `upcoming-*` und `link-nudge-*` in draft
  ```
  UI (Design-Bausteine aus `src/components` wiederverwenden: `ListGroup`, `ListRow`, `ActionSheet`, `DemoBadge`, Chip):
  - Übernahme-Seite: Knopf „Auf Stripe umstellen“ → `prepareTakeover { contractId, mode }`; gesperrt mit sichtbarem Grund (`takeoverBlockReason`). Darunter `TakeoverCard`.
  - `TakeoverCard`: Status-Chip mit Label; `prepared`: Plan-Zusammenfassung + „Freigeben“ (`approveAction` mit aktueller Version) + „Zurückziehen“; `link_sent`: Link, `shareText` in `<textarea readonly>`, „Kopieren“ (`navigator.clipboard.writeText`, Bestätigung „Kopiert“), „Zurückziehen“, bei Demo „Zahlungsmittel hinterlegt (Demo)“; `plan_changed`: Hinweis + „Neu freigeben“ (`prepareTakeover`); `set_up`/`active`: „Raten laufen über Stripe“ + Zeitplan-ID; `aborted`: „Abo vorzeitig beendet, zurück auf Überweisung“ + „Auf Stripe umstellen“. Ausführung fehlgeschlagen/unklar: wie `ActionSheet` (Erneut versuchen / Prüfen).
  - Mitgliedsseite: Zeile „Umstellung: <Label>“ mit Link zur Übernahme; Plakette „läuft über Stripe“ wenn `runsViaStripe`.
  - `/nexus/offen` (Forderungsliste): Plakette „läuft über Stripe“ an Vertragszeilen mit `runsViaStripe`.
  - `/nexus/umstellung`: Liste `takeoverRows` mit Status; Knopf „Alle umstellen (N)“ (N = Zeilen ohne Sperrgrund und ohne Status `prepared`) → `prepareAllTakeovers`; „Alle freigeben (N)“ für `openTakeoverDrafts` → `approveActions`; Abschnitt `id="erinnerungen"` „Erinnerungen vor Fälligkeit“ mit `ActionSheet` je Entwurf und „Alle freigeben (N)“.
  - Einstellungen: Zahlenfelder „Erinnerung vor Fälligkeit (Tage)“ (1–14) und „Hinweis, wenn Link ungenutzt (Tage)“ (1–30) → `updateSettings`.

- [ ] **Step 1: Failing tests**
```ts
// selectors.test.ts
test('takeoverRows: Status und Sperrgrund je Vertrag', () => { /* legacy ohne Bank → blockReason 'Bank nicht verbunden: …'; vorbereitet → status 'prepared' */ });
```
```ts
// tests/e2e/umstellung.spec.ts (Demo-Teil; Seed-Mitglied mit Rückstand wie in nexus.spec.ts)
test('Umstellung im Demo-Modus: vorbereiten, freigeben, Link kopieren, einrichten', async ({ page }) => {
  // /nexus/mitglieder/<id>/uebernahme → 'Auf Stripe umstellen' → Chip 'vorbereitet' → 'Freigeben' → Chip 'Link verschickt'
  // textarea enthält '/zahlung/demo-' und 'Dauerauftrag' → 'Kopieren' → 'Kopiert'
  // 'Zahlungsmittel hinterlegt (Demo)' → Chip 'eingerichtet'; Mitgliedsseite zeigt 'läuft über Stripe'
});
test('Alle umstellen und Sammelfreigabe', async ({ page }) => {
  // /nexus/umstellung → 'Alle umstellen (N)' → 'Alle freigeben (N)' → alle Zeilen 'Link verschickt'
});
test('Zurückziehen macht den Link ungültig', async ({ page }) => { /* Chip 'zurückgezogen' */ });
```
In `tests/e2e/nexus.spec.ts` Erwartungen „Stripe-Plan vorbereiten (Demo)“ auf „Auf Stripe umstellen“ anpassen.
- [ ] **Step 2: Run** `npx vitest run tests/unit/selectors.test.ts` → FAIL; `fuser -k 3100/tcp; npx playwright test umstellung.spec.ts nexus.spec.ts --trace off 2>&1 | tail -15` → FAIL.
- [ ] **Step 3: Implement** (Komponenten rechnen nicht: Beträge nur aus Selektoren/Domain, Anzeige über `formatEuro`).
- [ ] **Step 4: Run** dieselben Befehle + `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `npm run contrast` → grün.
- [ ] **Step 5: Commit** `feat: Oberfläche der Umstellung auf Stripe`.

---

### Task 14: Inhaber-Anleitung, Projektstand, Testlauf

**Files:**
- Create: `docs/setup-phase2b3.md`
- Modify: `docs/PROJEKT-STAND.md` (Dokumententabelle, Stand), `docs/phase2-backlog.md`

**Interfaces:** keine Code-Schnittstellen.

- [ ] **Step 1: `docs/setup-phase2b3.md` schreiben** (Klick-Anleitung, Deutsch, kurz):
  1. **Preview-Datenbasis:** Empfehlung eigenes Supabase-Projekt `nexus-assistent-preview` (Testdaten dürfen nicht in den Live-Stand). Claude spielt dort alle Migrationen per MCP ein, sobald das Projekt im MCP sichtbar ist. Vercel › Settings › Environment Variables › nur **Preview**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` des Preview-Projekts, eigenes `OWNER_SETUP_TOKEN`; danach auf der Preview-Adresse Passkey neu einrichten.
  2. **Stripe Testmodus:** Entwickler › API-Schlüssel › Eingeschränkten Schlüssel erstellen „Nexus Assistent schreiben (Test)“ mit Schreibrecht: Customers, Checkout Sessions, SetupIntents (Lesen), PaymentMethods, Subscription Schedules, Subscriptions, Products, Prices; Leserecht wie Lese-Schlüssel. Zusätzlich Test-Lese-Schlüssel wie in `docs/setup-phase2b.md`.
  3. **Test-Webhook** auf `https://<stabile Preview-Adresse des Branches>/api/webhooks/stripe`, Ereignisse wie live + `checkout.session.completed`; Signaturgeheimnis kopieren.
  4. **Vercel Preview-Variablen:** `STRIPE_RESTRICTED_KEY` (Test), `STRIPE_WRITE_KEY` (Test), `STRIPE_WEBHOOK_SECRET` (Test), `PAYMENT_LINK_BASE_URL` (stabile Preview-Adresse). Production unverändert lassen.
  5. **Vercel-Schutz:** Preview-Deployments mit „Vercel Authentication“ blockieren Stripe und Mitglieder. Für den Test unter Settings › Deployment Protection für Preview ausschalten oder „Protection Bypass for Automation“ nutzen; danach wieder einschalten.
  6. **Testlauf:** Testmitglied (erfundener Name) per Portal-Liste anlegen, Bank verbunden; „Auf Stripe umstellen“ → „Freigeben“ → Link öffnen → Testkarte `4242 4242 4242 4242` bzw. Test-IBAN `DE89370400440532013000` → Danke-Seite → in der App „eingerichtet“; in Stripe (Test) Zeitplan prüfen: Beträge, Startdatum, Ende, Produkt „NEXUS-Mitgliedschaft (Ratenplan)“, Metadaten `contractId` am Abo; Test-Uhr (Stripe Test Clocks) bis zur ersten Abbuchung vorspulen → Abo erscheint verknüpft, Status „aktiv“.
  7. **Live schalten:** gleiche Schritte mit Live-Schlüsseln in **Production**, Live-Webhook um `checkout.session.completed` ergänzen.
- [ ] **Step 2: Testlauf auf der Preview (mit Inhaber):** Claude prüft die Stripe-Felder aus „Stripe-Festlegungen“ gegen die echte Testmodus-Antwort (Checkout `url`, `setup_intent`, Zeitplan-Phasen, Abo-`metadata.contractId`, `schedule.phases[-1].end_date` = `planEndDate`). Abweichungen als `fix:` mit Test nachziehen.
- [ ] **Step 3: Projektstand und Backlog:** PROJEKT-STAND (Dokumente-Tabelle: Spec, Plan, `setup-phase2b3.md`; Migration bis `20261118000000_stripe_umstellung.sql`), Backlog: „Zeitplan vor Start in Stripe gekündigt wird nicht erkannt“, „`paymentLinkFor` fällt ohne Umstellung auf Demo-Link zurück“, „Zurückziehen ab eingerichtet nur in Stripe“.
- [ ] **Step 4: Run** `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"`, `npx tsc --noEmit`, `fuser -k 3100/tcp; npm run e2e 2>&1 | tail -15` → grün.
- [ ] **Step 5: Commit** `docs: Inhaber-Anleitung 2b-3 und Projektstand`.

---

## Zuordnung Spec → Task

| Spec | Task |
|---|---|
| 2.1 Link je Bestandsmitglied, 6.2 Kunde + eigener Link + Token am Vertrag | 4, 6, 11 |
| 2.2 Abo genau nach Restplan, 6.5 Zeitplan, Produkt (6.6) | 4, 10, 11 |
| 2.3/6.6 Verknüpfung ohne zweiten Vertrag, keine Vorschläge bei `metadata.contractId` | 7 |
| 2.4/7 Erinnerungen 3 Tage vorher, Link-7-Tage, Werte als Einstellung, keine ab `eingerichtet` | 1, 8, 9, 13 |
| 2.5 „Alle umstellen“, Sammelfreigabe | 6, 13 |
| 6.1 Knopf, Voraussetzungen, eine offene Umstellung, neue Version | 4, 6, 9, 13 |
| 6.3 Link teilen, Text mit Dauerauftrag, Basis-URL aus Env | 4, 10, 13 |
| 6.4 Öffentliche Seite, Plan, ungültig, Danke/Abbruch | 12 |
| 6.5 Plan-Prüfung, `Plan geändert`, Zahlungsmittel bleibt, Protokoll | 4, 6, 11 |
| 6.7 Status-Maschine, Zurückziehen | 4, 6, 13 |
| 6.8 Fälligkeiten in der Vergangenheit | 4, 11 |
| 7a Doppelzahlung, fehlgeschlagene Abbuchung (bestehend), Rückfall auf legacy | 7, 8 |
| 8 Plan im Vertrag, Abo-Hinweise gegen Plan, Lexware still + Plakette, Webhook | 3, 8, 11, 13 |
| 9 Schreib-Schlüssel, Demo ohne Schlüssel, Preview-Testsatz, Anleitung, POST + Idempotenz | 10, 11, 14 |
| 10 Domain rein, Migration per MCP, Felder prüfen, Fixtures, öffentlicher Pfad | alle, 2, 12, 14 |
