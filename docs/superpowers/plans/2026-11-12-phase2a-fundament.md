# Nexus-Assistent Phase 2a (Fundament) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die App bekommt einen echten Server-Unterbau: Supabase-Speicher, Passkey-Login, Event-Endpunkt mit gemeinsamer Engine, Server-Ausführer für Aktionen, austauschbare KI, Cron-Takt und einen Demo-Schalter. Die Phase-1-Demo läuft unverändert weiter.

**Architecture:** Die Zustandslogik zieht aus `store.tsx` in die React-freie Engine `src/data/engine.ts`. Diese Engine nutzen der Client (Demo-Modus, localStorage) und der Server (Echtmodus, Supabase) gleichermaßen. Der Server lädt den ganzen Zustand, wendet ein Event an und speichert die Differenz in einer Transaktion mit Revisionsprüfung. Ausführung, KI und Speicher hängen an Schnittstellen (`ActionProvider`, `AIProvider`, `StateRepository`/`AuthRepository`). In 2a gibt es dafür nur Demo- bzw. In-Memory- und Supabase-Implementierungen.

**Tech Stack:** Next.js 16.4 (App Router, Route Handlers, Server Actions, `cacheComponents: true`) · `@supabase/supabase-js` 2.x · `@simplewebauthn/server` + `@simplewebauthn/browser` 14.x · `jose` 6.x · Vitest · Playwright (Chromium, CDP-WebAuthn).

**Spec:** `docs/superpowers/specs/2026-11-12-phase2-design.md` (Abschnitte 0, 1, 2, 5, 6 – nur Paket 2a). Basis-Spec: `docs/superpowers/specs/2026-11-12-nexus-assistent-design.md`, Abschnitt 4a gilt unverändert. Verschobene Punkte: `docs/phase2-backlog.md` (Punkte 1–4, 7).

## Global Constraints

- Regeln aus Spec 4a gelten unverändert: Cent-Ganzzahlen, Kalendertage Europe/Berlin über `src/domain/clock.ts`, Geld nur über Ledger-/Domain-Funktionen, Aktionsstatus und Freigabe an `aktion:version`, Timeout → „ausgang unklar“, Erneut senden nur aus `fehlgeschlagen`.
- `src/domain/` bleibt rein: kein React, keine Importe aus `src/data`, `src/app`, `src/components`, `src/ai`, `src/server`.
- Nur der Server greift auf die Datenbank zu, mit `SUPABASE_SERVICE_ROLE_KEY`. RLS an, `anon`/`authenticated` dürfen nichts. Der Browser spricht nie mit Supabase.
- Umgebungsvariablen genau: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `OWNER_SETUP_TOKEN`, `CRON_SECRET`, `APP_ORIGIN`. Keine mit `NEXT_PUBLIC_`. Nur für Tests zusätzlich: `NEXUS_TEST_MEMORY_DB=1` (E2E ohne Datenbank, auf Vercel verboten), `SUPABASE_TEST_URL` + `SUPABASE_TEST_SERVICE_ROLE_KEY` (Integrationstest).
- Sitzungs-Cookie `nexus_session`: httpOnly, Secure, SameSite=Lax, Path `/`, JWT HS256 mit `SESSION_SECRET` (jose), 30 Tage.
- Neue Datensätze: `crypto.randomUUID()` über `newId()` aus `src/domain/ids.ts`. Aktions-IDs bleiben fachlich (`reminder-…`, `reply-…`) und entstehen nur in `src/domain/action-factory.ts`.
- Echt- und Demo-Daten mischen sich nie: eigener localStorage-Schlüssel nur für Demo (`nexus-demo-v1`); Echtzustand wird im Browser nicht gespeichert.
- Im Echtmodus und auf dem Server gilt die echte Uhr (`realNow()`), Demo-Uhr und `?now=` nur im Demo-Modus.
- In 2a verlässt nichts die App: nur `DemoProvider` und `DemoAI`.
- Next 16: Route Handlers ohne `export const runtime` (mit `cacheComponents` verboten, Node ist Standard). `cookies()` ist async (`await cookies()`). Kein `middleware.ts` (heißt jetzt `proxy.ts`, wird hier nicht gebraucht).
- UI-Texte Deutsch, Design-Bausteine aus `src/components` wiederverwenden.
- Vor jedem Commit: `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npx tsc --noEmit`; bei UI-Änderungen die betroffene E2E-Spec (`fuser -k 3100/tcp; npm run e2e -- <spec> 2>&1 | tail -15`). Nach jedem Commit pushen auf `claude/cool-hopper-hcnb9d`.

## Review Focus

1. **Zwei Events gleichzeitig** (zwei Geräte, oder Cron und Nutzer) → keine verlorene Änderung: Speichern prüft die Revision, bei Konflikt neu laden und erneut anwenden (max. 3 Versuche, dann 409). Test in Task 8.
2. **Absturz zwischen Anbieter-Aufruf und Speichern** → Aktion bleibt nicht ewig „wird ausgeführt“: der Takt setzt `executing` älter als 5 Min. auf „ausgang unklar“, „Prüfen“ gleicht über `lookup` ab, nie ein zweiter Versand. Test in Task 3 und 12.
3. **Demo-Ausführer im Echtmodus** → es entsteht keine erfundene ausgehende Nachricht in echten Daten; nur interne Aktionen (Zuordnen, Rechnung erledigt) wirken. Test in Task 3.
4. **Gefälschte oder verbotene Client-Events** (`actionExecuted`, `resetDemo`, `simulateTransfer`, `setConnectionStatus`, `assistantOutbound` an `/api/events`) und **neue `/api`-Route ohne Sitzungsprüfung** → 400 bzw. Test schlägt fehl. Tests in Task 8 und 10.
5. **Einrichtungs-Token zweimal oder parallel benutzt, Wiederherstellungscode zweimal benutzt** → genau ein Erst-Passkey, jeder Code genau einmal. Test in Task 9.

---

## Dateistruktur

```
src/domain/
  ids.ts                newId()
  action-factory.ts     reminderAction, replyAction, reminderActionId, replyActionId
  payment-link.ts       paymentLinkFor()
  ai-port.ts            AIProvider (async, toolbasiert), AITools, ChatAnswer
  connections.ts        CONNECTION_CATALOG
  clock.ts              + setClockMode, realNow
  freshness.ts          + notConnected
  events.ts             + actionStarted, actionReconciled, retryAction, checkAction
  actions/machine.ts    ActionProvider + simulated, STALE_EXECUTING_MS
  briefing.ts           + kind 'weekly'
src/data/
  engine.ts             applyEvent/applyEvents/refresh (React-frei)
  executor.ts           executeApproved, checkAction, sweepStaleExecutions
  empty-state.ts        createEmptyState()
  store.tsx             React-Hülle: Demo lokal, Echt über /api
  mode.tsx              ModeProvider, useMode()
  ai-client.ts          useAI(): AIClient (Demo lokal | Server Actions)
src/ai/
  provider.ts           Re-Export aus domain/ai-port
  tools.ts              createStateTools(state, now)
  demo-ai.ts            DemoAI gegen AITools
src/server/
  env.ts                readEnv()
  registry.ts           getRepos(), getAI(), getActionProvider()
  state-service.ts      loadState, dispatchEvent (Revision, Retry, Whitelist)
  db/tables.ts          TABLES, toRows, fromRows, diffState
  db/repository.ts      StateRepository, AuthRepository (Typen)
  db/memory.ts          MemoryRepos
  db/supabase.ts        SupabaseRepos
  auth/session.ts       createSessionToken, verifySessionToken, requireSession
  auth/recovery.ts      generateRecoveryCodes, hashRecoveryCode
  auth/setup.ts         checkSetupToken
  auth/webauthn.ts      Optionen/Verifikation (SimpleWebAuthn), Challenge-Cookie
  cron.ts               runTick
src/app/api/
  state/route.ts  events/route.ts  cron/tick/route.ts
  auth/{session,register/options,register/verify,login/options,login/verify,recover,logout,recovery-codes}/route.ts
  test/reset/route.ts   nur mit NEXUS_TEST_MEMORY_DB=1
src/app/actions/ai.ts   'use server': askAI, draftReplyFor, draftReminderFor, slidesForCall, sendToAssistant
src/app/anmelden/page.tsx
src/components/ModeBadge.tsx  SetupChecklist.tsx
supabase/migrations/20261112000000_fundament.sql
vercel.json  .env.example  docs/setup-phase2a.md
tests/unit/…  tests/unit/stubs/server-only.ts  tests/integration/supabase-repo.test.ts  tests/e2e/auth.spec.ts
```

---

### Task 1: Engine aus dem Store lösen, UUIDs, `isDemo` pro Modus

**Files:**
- Create: `src/data/engine.ts`, `src/domain/ids.ts`, `tests/unit/engine.test.ts`
- Modify: `src/data/store.tsx`, `src/domain/types.ts` (Action.isDemo, AssistantMessage), `src/domain/events.ts`, `src/domain/assistant.ts` (deliver), `src/app/nexus/zuordnen/page.tsx`, `tests/unit/store.test.ts`, `tests/unit/assistant.test.ts`

**Interfaces:**
- Produces:
  - `newId(): string` (= `crypto.randomUUID()`) in `src/domain/ids.ts`
  - `interface EngineContext { at: Date; isDemo: boolean; newId: () => string }`
  - `interface EngineResult { state: AppState; created: string[] }` – IDs der Datensätze, die das Event selbst neu angelegt hat, in Reihenfolge
  - `applyEvent(s: AppState, e: StoreEvent, ctx: EngineContext): EngineResult`
  - `applyEvents(s: AppState, es: StoreEvent[], ctx: EngineContext): EngineResult`
  - `refresh(s: AppState, at: Date, isDemo = true): AppState` (aus `engine.ts`, `store.tsx` re-exportiert weiter `refresh`, `reducer`, `loadInitial`, `STORE_KEY`)
  - `demoContext(): EngineContext` in `store.tsx` = `{ at: now(), isDemo: true, newId }`
  - `Action.isDemo: boolean` (bisher Literal `true`); `assistantOutbound` bekommt optionales `id?: string`
  - Store-Kontext: `dispatch(e: StoreEvent): Promise<{ created: string[] }>`

- [ ] **Step 1: Write the failing tests** in `tests/unit/engine.test.ts`

```ts
const ctx = (p: Partial<EngineContext> = {}): EngineContext => ({ at: NOW, isDemo: true, newId: seq(), ...p }); // seq() → 'id-1','id-2',…
test('simulateTransfer legt Zahlung mit neuer ID an und meldet sie', () => {
  const r = applyEvent(s, { type: 'simulateTransfer', iban: IBAN, payerName: 'Selin Yilmaz', amountCents: 30000 }, ctx());
  expect(r.created).toEqual(['id-1']);
  expect(r.state.payments.at(-1)!.id).toBe('id-1');
});
test('Echtmodus schreibt isDemo=false ins Protokoll', () => {
  const r = applyEvent(s, { type: 'dismissInsight', key: anyOpenKey }, ctx({ isDemo: false }));
  expect(r.state.audit.at(-1)!.isDemo).toBe(false);
});
test('assistantOutbound übernimmt die mitgegebene ID', () => {
  expect(applyEvent(s, { type: 'assistantOutbound', id: 'x', text: 'Hi' }, ctx()).state.assistantChat.at(-1)!.id).toBe('x');
});
test('reducer ist verhaltensgleich zu applyEvent mit Demo-Kontext', () => { /* gleiche Events, gleiche Zustände bis auf IDs */ });
```

- [ ] **Step 2: Run** `npx vitest run tests/unit/engine.test.ts` → FAIL („Cannot find module '@/data/engine'“).
- [ ] **Step 3: Implement.** `refresh`, `mutate` und alle Mutationen wandern unverändert nach `engine.ts`; jedes `isDemo: true` wird `ctx.isDemo`; Zähler-IDs (`p-sim-n`, `am-n`, `m-out-…`, `c-…`) werden `ctx.newId()`. `deliver()` in `assistant.ts` vergibt die Antwort-ID über `newId()` und schickt sie im `assistantOutbound`-Event mit, damit `reply.id` der gespeicherten ID entspricht. `store.tsx` hält den Zustand zusätzlich in einem Ref, rechnet `applyEvent(ref.current, e, demoContext())` synchron und gibt `created` zurück (schnelle Folge-Dispatches wie `createAction` + `approveAction` sehen so den neuen Stand). `zuordnen/page.tsx` nimmt die Zahlungs-ID aus `(await dispatch(...)).created[0]` statt sie zu erraten.
- [ ] **Step 4: Bestehende Tests anpassen:** `store.test.ts` und `assistant.test.ts` prüfen statt `m-out-${id}`-Präfixen die Anzahl ausgehender Nachrichten mit dem Aktionstext. Run `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` → alle grün.
- [ ] **Step 5:** `npx tsc --noEmit`; `npm run e2e -- tests/e2e/nexus.spec.ts 2>&1 | tail -15` (Zuordnen-Ablauf) → grün.
- [ ] **Step 6: Commit** `refactor: Engine aus dem Store lösen, UUIDs für neue Datensätze`

---

### Task 2: Aktions-Fabrik und `paymentLinkFor`

**Files:**
- Create: `src/domain/action-factory.ts`, `src/domain/payment-link.ts`, `tests/unit/action-factory.test.ts`
- Modify: `src/app/nexus/mitglieder/[id]/page.tsx`, `src/app/nachrichten/[threadId]/page.tsx`, `src/domain/assistant.ts`, `src/ai/demo-ai.ts` (`demoPaymentLink` entfernen)

**Interfaces:**
- Produces:
  - `paymentLinkFor(contractId: string): string` → in 2a `https://buy.stripe.com/demo/${contractId}` (echter Link folgt in 2b)
  - `reminderActionId(contractId: string, oldestUnpaidDue: IsoDate | null): string` → `reminder-${contractId}-${oldestUnpaidDue ?? 'none'}`
  - `replyActionId(lastInboundId: string): string` → `reply-${lastInboundId}`
  - `reminderAction(i: { contract: MemberContract; contact: Contact; status: MemberStatus; text: string; at: Date; isDemo: boolean }): Action` – `type 'send_reminder'`, `company 'nexus'`, Titel `Erinnerung an ${name}`, Payload `{ threadId: t-${contact.id}, channel: 'whatsapp', contactId, text }`, `insightKey overdue:${contract.id}`, `version 1`, `status 'draft'`
  - `replyAction(i: { lastIn: Message; contact: Contact | null; threadId: string; text: string; at: Date; isDemo: boolean }): Action` – Typ nach `lastIn.channel` (`send_email`/`send_whatsapp`), Titel `Antwort an ${name}`, `insightKey reply:${lastIn.id}`

- [ ] **Step 1: Failing tests:** gleiche Eingaben wie heute auf der Mitgliedsseite → `toEqual` dem bisher dort gebauten Objekt (ID, Payload, insightKey); E-Mail-Thread → `send_email`; `isDemo: false` wird übernommen; `paymentLinkFor('mc-kaya')` = `'https://buy.stripe.com/demo/mc-kaya'`.
- [ ] **Step 2:** `npx vitest run tests/unit/action-factory.test.ts` → FAIL.
- [ ] **Step 3: Implement** und die drei Aufrufer umstellen (Seiten und `handleInbound` bauen keine Aktions-Objekte mehr selbst). `isDemo` kommt aus `useMode()` (bis Task 11: `true`) bzw. aus dem Engine-Kontext.
- [ ] **Step 4:** `npm test …`, `npx tsc --noEmit` → grün; `npm run e2e -- tests/e2e/nexus.spec.ts tests/e2e/assistant.spec.ts` → grün.
- [ ] **Step 5: Commit** `refactor: Aktions-Fabrik und paymentLinkFor in der Domain`

---

### Task 3: Gemeinsamer Ausführer, Zustände „fehlgeschlagen“ und „ausgang unklar“

**Files:**
- Create: `src/data/executor.ts`, `tests/unit/executor.test.ts`
- Modify: `src/domain/events.ts`, `src/domain/actions/machine.ts`, `src/domain/actions/demo-provider.ts`, `src/domain/types.ts` (`Action.executingSince?: string`), `src/data/engine.ts`, `src/data/store.tsx`, `src/domain/assistant.ts` (`handleButton` ohne `actionExecuted`), beide Seiten aus Task 2 (nur noch `approveAction`), `src/components/ActionSheet.tsx`, `tests/unit/assistant.test.ts`

**Interfaces:**
- Consumes: `applyEvent`, `EngineContext` (Task 1); `idempotencyKey`, `startExecution`, `finishExecution`, `reconcileUncertain`, `retry` (bestehend)
- Produces:
  - `ActionProvider` erweitert um `readonly simulated: boolean`; `DemoProvider.simulated = true`
  - `STALE_EXECUTING_MS = 5 * 60_000`, `EXECUTE_TIMEOUT_MS = 10_000` in `machine.ts`
  - Neue Events: `{ type: 'actionStarted'; id }` (approved→executing, setzt `executingSince`), `actionExecuted` bekommt `simulated?: boolean` und akzeptiert `approved` (wie bisher) und `executing`, `{ type: 'actionReconciled'; id; found: boolean }`, `{ type: 'retryAction'; id }` (failed→approved), `{ type: 'checkAction'; id }` (Engine: kein Effekt, nur Auslöser für den Ausführer)
  - `interface EventSink { current(): AppState; apply(e: StoreEvent): Promise<AppState> }`
  - `executeApproved(sink: EventSink, provider: ActionProvider, timeoutMs = EXECUTE_TIMEOUT_MS): Promise<void>` – für jede `approved`-Aktion: `actionStarted` anwenden (gespeichert!), dann `provider.execute(a, idempotencyKey(a))` mit `Promise.race` gegen Timeout (→ `'timeout'`), Exception → `'error'` mit Meldung, dann `actionExecuted { result, simulated: provider.simulated }`
  - `checkAction(sink, provider, id): Promise<void>` – nur aus `uncertain`: `lookup(key)` → `actionReconciled`
  - `sweepStaleExecutions(sink, at: Date): Promise<void>` – `executing` mit `executingSince` älter als `STALE_EXECUTING_MS` → `actionExecuted { result: 'timeout' }`

- [ ] **Step 1: Failing tests** (`executor.test.ts`, In-Memory-Sink über `applyEvent`):

```ts
test('freigegebene Aktion wird genau einmal mit aktion:version ausgeführt', async () => {
  const p = new DemoProvider(); await executeApproved(sink, p); await executeApproved(sink, p);
  expect(p.executedCount('a-1:1')).toBe(1); expect(sink.current().actions[0].status).toBe('executed');
});
test('Timeout → uncertain, Prüfen mit Treffer → executed, ohne zweiten execute', …);
test('Prüfen ohne Treffer → failed, Erneut versuchen → approved → executed', …);
test('Prüfen auf eine nicht-uncertain Aktion ändert nichts', …);
test('executing älter als 5 Min. → uncertain (sweep), jünger → unverändert', …);
test('simulierter Versand im Echtmodus legt keine ausgehende Nachricht an, Protokoll „Nicht gesendet (Demo-Ausführer)“', …);
test('simulierter Versand im Demo-Modus verhält sich wie Phase 1 (Nachricht + „Gesendet (Demo)“)', …);
test('interne Aktion (link_invoice_to_job) wirkt auch simuliert im Echtmodus', …);
```

- [ ] **Step 2:** `npx vitest run tests/unit/executor.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Engine: bei `actionExecuted` mit `simulated && !ctx.isDemo` werden für `send_whatsapp`/`send_email`/`send_reminder` keine Effekte angewandt; Protokolltext `Nicht gesendet (Demo-Ausführer): ${title}`. Client-Store: nach jedem `dispatch` läuft `executeApproved` mit einem modulweiten `DemoProvider` (Sink = Store-Ref); bei `checkAction` zusätzlich `checkAction(...)`. `dispatch` löst erst nach dem Ausführer auf. `handleButton` gibt nur noch `[approveEvent]` zurück (Antworttext unverändert „Gesendet (Demo): …“).
- [ ] **Step 4: ActionSheet:** neue Props `onRetry: () => void`, `onCheck: () => void`. Bei `failed` Knopf „Erneut versuchen“ (`retryAction`), bei `uncertain` Knopf „Prüfen“ (`checkAction`); Status-Texte bleiben. Seiten reichen `dispatch({ type: 'retryAction' | 'checkAction', id })` durch.
- [ ] **Step 5:** `assistant.test.ts` und `store.test.ts` an den Ablauf ohne `actionExecuted` anpassen (Hilfsfunktion `drain(state)` = Executor mit DemoProvider). `npm test …` → grün; `npx tsc --noEmit`; `npm run e2e -- tests/e2e/nexus.spec.ts tests/e2e/zulassung.spec.ts tests/e2e/assistant.spec.ts` → grün.
- [ ] **Step 6: Commit** `feat: gemeinsamer Ausführer mit Abgleich und Erneut-Versuchen`

---

### Task 4: AIProvider asynchron und toolbasiert, Domain ohne `src/ai`

**Files:**
- Create: `src/domain/ai-port.ts`, `src/ai/tools.ts`, `tests/unit/ai-tools.test.ts`, `tests/unit/architecture.test.ts`
- Modify: `src/ai/provider.ts` (nur Re-Export), `src/ai/demo-ai.ts`, `src/domain/assistant.ts`, `tests/unit/demo-ai.test.ts`, `tests/unit/assistant.test.ts`

**Interfaces:**
- Produces (in `src/domain/ai-port.ts`):
  - `interface ChatAnswer { text: string; links: { label: string; href: string }[] }`
  - `type ToolName = 'overdue_members' | 'open_today' | 'month_money' | 'series_calls' | 'find_job'`
  - `interface ToolArgs { overdue_members: {}; open_today: {}; month_money: {}; series_calls: { query: string }; find_job: { query: string } }`; `ToolResult` je Name mit genau den Daten, die die heutigen `answer*`-Funktionen in `demo-ai.ts` lesen (keine `AppState`-Referenz)
  - `interface AITools { call<K extends ToolName>(name: K, args: ToolArgs[K]): Promise<ToolResult[K]> }`
  - `interface AIContext { now: Date; tools: AITools }`
  - `interface AIProvider { answer(q: string, ctx: AIContext): Promise<ChatAnswer>; draftReply(i: { thread: Message[]; contact: Contact | null }): Promise<string>; draftReminder(i: { contact: Contact; status: MemberStatus; tone: 'freundlich' | 'bestimmt'; paymentLink: string }): Promise<string>; slidesFor(call: Call): Promise<Call['slides']>; detectCommitment(text: string, sentAt: string): Promise<{ kind: Commitment['kind']; dueAt: string } | null> }`
- `createStateTools(s: AppState, now: Date): AITools` in `src/ai/tools.ts` (nutzt `src/data/selectors`)
- `handleInbound(s, from, text, now, ai: AIProvider)` baut den Kontext selbst nicht: neue Signatur `handleInbound(s, from, text, now, ai: AIProvider, tools: AITools)`

- [ ] **Step 1: Failing tests:**
  - `architecture.test.ts`: kein Datei-Inhalt unter `src/domain/**` matcht `/from ['"](@\/(ai|data|app|components|server)|\.\.\/(ai|data|app|components|server))/` (liest Dateien per `fs`).
  - `ai-tools.test.ts`: `createStateTools(demo, NOW).call('overdue_members', {})` liefert dieselben Namen/Beträge wie `overdueMembers(...)`.
  - `demo-ai.test.ts`: bestehende Antworten unverändert, jetzt über `demoAI.answer(q, { now: NOW, tools })`.
- [ ] **Step 2:** `npx vitest run tests/unit/architecture.test.ts tests/unit/ai-tools.test.ts` → FAIL (Treffer in `assistant.ts`).
- [ ] **Step 3: Implement.** DemoAI liest nur noch Tool-Ergebnisse; `draftReminder` bekommt den Link von außen (`paymentLinkFor`). Seiten rufen bis Task 11 weiter `demoAI` direkt, aber mit `createStateTools(state, now())`.
- [ ] **Step 4:** `npm test …`, `npx tsc --noEmit` → grün; `npm run e2e -- tests/e2e/assistant.spec.ts tests/e2e/heute.spec.ts` → grün.
- [ ] **Step 5: Commit** `refactor: KI-Schnittstelle asynchron und toolbasiert, Domain ohne src/ai`

---

### Task 5: Uhr im Echtmodus, leerer Startzustand, „Noch nicht verbunden“

**Files:**
- Create: `src/domain/connections.ts`, `src/data/empty-state.ts`, `tests/unit/empty-state.test.ts`
- Modify: `src/domain/clock.ts`, `src/domain/freshness.ts`, `src/data/seed.ts` (Katalog importieren), `src/components/StaleNotice.tsx`, `tests/unit/clock.test.ts`, `tests/unit/freshness.test.ts`

**Interfaces:**
- Produces:
  - `setClockMode(m: 'demo' | 'real'): void`; `realNow(): Date` (Test-Override, sonst `new Date()` – die einzige erlaubte Stelle); `now()`: Override → bei `'real'` `realNow()` → sonst `?now=`/`DEMO_NOW`. Standard bleibt `'demo'` (bestehende Tests unverändert).
  - `CONNECTION_CATALOG: readonly { id: ConnectionId; company: Company | null; label: string }[]` (aus `seed.ts` verschoben)
  - `createEmptyState(): AppState` – alle Verbindungen `status 'missing'`, `lastSuccessAt null`, leere Listen, `exceptions {}`, Settings `{ replyThresholdHours: 2, briefingsEnabled: true, ownerPhone: '', suppressedCoachKeys: [] }`
  - `notConnected(sources: ConnectionId[], connections: Connection[]): boolean` – true, wenn alle genannten Quellen `missing` sind

- [ ] **Step 1: Failing tests:** `setClockMode('real')` + `setNowForTests(null)` → `now()` liegt innerhalb ±1 s von `Date.now()` und ignoriert `?now=`; `setClockMode('demo')` → `DEMO_NOW`. `refresh(createEmptyState(), NOW)` wirft nicht und erzeugt nur `stale_source`-Hinweise oder keine (keine Geld-Hinweise). Leere Settings: `validPhone('')` ist `null` → `handleInbound` ignoriert jede Nummer. `notConnected(['bank','stripe_nexus'], empty.connections)` = true; mit einer `error`-Quelle = false.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** `StaleNotice` zeigt „Noch nicht verbunden“, wenn `notConnected(sources, state.connections)`, sonst wie bisher „Datenstand zu alt, um das zu beurteilen“.
- [ ] **Step 4:** `npm test …`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: echte Uhr im Echtmodus, leerer Startzustand`

---

### Task 6: Tabellen-Abbildung, Repository-Schnittstellen, In-Memory-Implementierung

**Files:**
- Create: `src/server/db/tables.ts`, `src/server/db/repository.ts`, `src/server/db/memory.ts`, `tests/unit/repo-contract.ts`, `tests/unit/db-tables.test.ts`, `tests/unit/memory-repo.test.ts`, `tests/unit/stubs/server-only.ts`
- Modify: `vitest.config.ts` (Alias `server-only` → Stub; `include` um `tests/integration/**/*.test.ts` erweitern), `package.json` (`server-only` als Dependency)

**Interfaces:**
- Produces:
  - `TABLES` – Zuordnung AppState-Schlüssel → Tabelle und Zeilen-ID:

    | AppState | Tabelle | `id` | Schlüsselspalten |
    |---|---|---|---|
    | connections, contacts, contracts, payments, invoices, messages, commitments, events, calls, content, vehicles, jobs, actions | gleichnamig (`contracts`) | `.id` | payments/invoices/messages/events: `connection_id`, `external_id` (aus `connectionId`/`externalId`, sonst `null`) |
    | insights | `insights` | `.dedupeKey` | `dedupe_key` |
    | assistantChat | `assistant_messages` | `.id` | – |
    | allocations | `allocations` | `${paymentId}:${contractId}:${n}` (n = laufende Nr. je Paar) | – |
    | ibanLinks | `iban_links` | `.iban` | – |
    | exceptions | `contract_exceptions` | Vertrags-ID, `data` = Array | – |
    | audit | `audit` | Index, 8-stellig mit Nullen (nur anhängen) | – |
    | settings | `settings` | `'owner'` | – |
    | jobRuns | `job_runs` (nur über `claimJobRun`) | `key` | `key` |
  - `type Row = { id: string; data: unknown; connection_id?: string | null; external_id?: string | null; dedupe_key?: string }`
  - `toRows(s: AppState): Record<TableName, Row[]>`, `fromRows(r: Partial<Record<TableName, Row[]>>, jobRunKeys: string[]): AppState` (fehlende Tabellen → Werte aus `createEmptyState()`)
  - `type ChangeSet = Record<TableName, { upsert: Row[]; delete: string[] }>`; `diffState(prev: AppState, next: AppState): ChangeSet` (nur geänderte Zeilen, Vergleich per `JSON.stringify` der Zeile)
  - In `repository.ts`:

```ts
export interface StateRepository {
  load(): Promise<{ state: AppState; revision: number }>;
  save(changes: ChangeSet, expectedRevision: number): Promise<{ ok: true; revision: number } | { ok: false; reason: 'conflict' }>;
  claimJobRun(key: string, at: Date): Promise<boolean>; // true nur für den ersten
}
export interface StoredPasskey { id: string; publicKey: string; counter: number; transports: string[]; createdAt: string }
export interface AuthRepository {
  passkeyCount(): Promise<number>;
  listPasskeys(): Promise<StoredPasskey[]>;
  addFirstPasskey(p: StoredPasskey): Promise<boolean>; // false, wenn schon einer existiert
  addPasskey(p: StoredPasskey): Promise<void>;
  updateCounter(id: string, counter: number): Promise<void>;
  replaceRecoveryCodes(hashes: string[]): Promise<void>;
  consumeRecoveryCode(hash: string, at: Date): Promise<boolean>; // true genau einmal
}
export interface Repos { state: StateRepository; auth: AuthRepository }
```
  - `createMemoryRepos(): Repos` in `memory.ts`
  - `repositoryContract(name: string, make: () => Promise<Repos>): void` in `tests/unit/repo-contract.ts` – gemeinsame Vertragstests für Memory und Supabase

- [ ] **Step 1: Failing tests:**
  - `db-tables.test.ts`: `fromRows(toRows(demo))` `toEqual` Demo-Zustand (inkl. `exceptions`, doppelter Allocation-Paare, `jobRuns`); `diffState(s, s)` leer; nach `applyEvent(dismissInsight)` genau ein Upsert in `insights` und angehängte `audit`-Zeilen.
  - `repo-contract.ts`: leeres Repo lädt `createEmptyState()` mit Revision 0; `save` mit richtiger Revision → Revision+1, mit alter → `conflict` und nichts geschrieben; `Promise.all` von 10× `claimJobRun('k')` → genau ein `true`; zwei parallele `addFirstPasskey` → genau ein `true`; `consumeRecoveryCode` zweimal → `true`, dann `false`; `replaceRecoveryCodes` macht alte Codes ungültig.
  - `memory-repo.test.ts`: `repositoryContract('memory', async () => createMemoryRepos())`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Memory-Repo hält die Zeilen und klont beim Laden (`structuredClone`), damit kein Aufrufer gespeicherte Daten verändert.
- [ ] **Step 4:** `npm test …`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Tabellen-Abbildung und Repositories (In-Memory)`

---

### Task 7: Migration und Supabase-Repository

**Files:**
- Create: `supabase/migrations/20261112000000_fundament.sql`, `src/server/db/supabase.ts`, `tests/unit/migration.test.ts`, `tests/integration/supabase-repo.test.ts`
- Modify: `package.json` (`@supabase/supabase-js` ^2.119, Script `"test:integration": "vitest run tests/integration"`)

**Interfaces:**
- Consumes: `TABLES`, `ChangeSet`, `Repos`, `repositoryContract` (Task 6)
- Produces: `createSupabaseRepos(url: string, serviceRoleKey: string): Repos` (Client mit `auth: { persistSession: false, autoRefreshToken: false }`)

**Migration (Inhalt festgelegt):**
- Je Tabelle aus `TABLES` plus `passkeys`, `recovery_codes`, `job_runs`, `meta`: `id text primary key, data jsonb not null, updated_at timestamptz not null default now()`; Schlüsselspalten wie in Task 6.
- Unique: `(connection_id, external_id)` auf `payments`, `invoices`, `messages`, `events`; `dedupe_key` auf `insights`; `job_runs.key` ist Primärschlüssel (`key text pk, ran_at timestamptz`).
- `recovery_codes (hash text pk, used_at timestamptz)`; `passkeys (id text pk, data jsonb)`.
- `meta (key text pk, value jsonb)` mit `('schema_version', '1')`, `('revision', '0')`.
- Für jede Tabelle `alter table … enable row level security;` ohne Policy, dazu `revoke all on all tables in schema public from anon, authenticated;`.
- Funktionen (`language plpgsql`, `set search_path = public`, `revoke execute … from public, anon, authenticated`):
  - `apply_changes(p_expected_revision int, p_changes jsonb) returns int` – sperrt `meta`-Zeile `revision` (`for update`), wirft `'conflict'` bei Abweichung, wendet Upserts/Deletes je erlaubter Tabelle an (Tabellenname gegen feste Liste geprüft, `format('%I')`), setzt `revision + 1`, gibt sie zurück. Alles in einer Transaktion (Funktion = eine Transaktion).
  - `claim_job_run(p_key text, p_at timestamptz) returns boolean` – `insert … on conflict do nothing`, `return found`.
  - `add_first_passkey(p_id text, p_data jsonb) returns boolean` – `lock table passkeys in exclusive mode`; nur einfügen, wenn leer.
  - `consume_recovery_code(p_hash text, p_at timestamptz) returns boolean` – `update … where hash = p_hash and used_at is null`, `return found`.

- [ ] **Step 1: Failing tests:**
  - `migration.test.ts` (offline, liest die SQL-Datei): jede Tabelle aus `TABLES` und die vier Zusatztabellen hat `create table` und `enable row level security`; es gibt kein `create policy`; alle vier Funktionen existieren und haben `revoke execute`; die Unique-Indizes aus der Spec sind vorhanden.
  - `tests/integration/supabase-repo.test.ts`: `describe.skipIf(!process.env.SUPABASE_TEST_URL)` → `repositoryContract('supabase', …)` mit `SUPABASE_TEST_URL`/`SUPABASE_TEST_SERVICE_ROLE_KEY`; vor jedem Test alle Tabellen leeren (Hilfs-RPC nicht nötig: `delete … neq id ''` je Tabelle, `meta.revision` auf 0); zusätzlich: Anon-Key-Client (`SUPABASE_TEST_ANON_KEY`, falls gesetzt) liest `contacts` → Fehler oder 0 Zeilen.
- [ ] **Step 2:** `npx vitest run tests/unit/migration.test.ts` → FAIL; `npm run test:integration` → Integrationstests „skipped“ (offline).
- [ ] **Step 3: Implement** `createSupabaseRepos`: `load` liest alle Tabellen parallel (`select('id,data,connection_id,external_id,dedupe_key')`, bei > 1000 Zeilen mit `.range()` seitenweise), `revision` aus `meta`; `save` → `rpc('apply_changes', …)`, Fehlermeldung `conflict` → `{ ok: false }`; die übrigen Methoden über die RPCs bzw. einfache Selects.
- [ ] **Step 4:** `npm test …` (Integration übersprungen), `npx tsc --noEmit` → grün. Wenn ein Testprojekt erreichbar ist: `SUPABASE_TEST_URL=… SUPABASE_TEST_SERVICE_ROLE_KEY=… npm run test:integration` → grün (offline nicht nötig).
- [ ] **Step 5: Commit** `feat: Supabase-Schema mit RLS und Repository`

**Wie Inhaber/CI den Integrationstest fahren** (kommt auch in `docs/setup-phase2a.md`): zweites Supabase-Projekt „nexus-test“ (Frankfurt), Migration im SQL-Editor ausführen, dann `SUPABASE_TEST_URL` und `SUPABASE_TEST_SERVICE_ROLE_KEY` lokal bzw. als CI-Secret setzen und `npm run test:integration`. Alternative für Entwickler mit Docker: `npx supabase start` + `npx supabase db reset`, Werte aus der Ausgabe übernehmen.

---

### Task 8: Server-Umgebung, Registry und Zustands-Dienst

**Files:**
- Create: `src/server/env.ts`, `src/server/registry.ts`, `src/server/state-service.ts`, `.env.example`, `tests/unit/env.test.ts`, `tests/unit/state-service.test.ts`

**Interfaces:**
- Consumes: `applyEvents`, `executeApproved`, `checkAction` (Tasks 1, 3); `Repos`, `diffState` (Task 6); `createSupabaseRepos` (Task 7); `realNow`, `newId`
- Produces:
  - `interface ServerEnv { supabaseUrl?: string; supabaseServiceRoleKey?: string; sessionSecret: string; ownerSetupToken: string; cronSecret: string; appOrigin: string; testMemoryDb: boolean }`
  - `readEnv(e: Record<string, string | undefined> = process.env): ServerEnv` – wirft `Error('Fehlende Umgebungsvariablen: A, B')`; `SESSION_SECRET` mindestens 32 Zeichen; `testMemoryDb` nur wenn `NEXUS_TEST_MEMORY_DB === '1'` **und** `VERCEL` nicht gesetzt (sonst Fehler); ohne Supabase-Variablen und ohne Testmodus → Fehler
  - `getRepos(): Repos` (Supabase oder modulweite Memory-Instanz), `resetTestRepos(): void` (nur Testmodus), `getAI(): AIProvider` (2a: `demoAI`), `getActionProvider(): ActionProvider` (modulweiter `DemoProvider`) in `registry.ts`
  - `CLIENT_EVENTS: ReadonlySet<StoreEvent['type']>` = `confirmPaymentMatch, settleInvoice, linkInvoiceToJob, setJobStatus, createAction, editAction, approveAction, retryAction, checkAction, dismissInsight, snoozeInsight, suppressCoach, setSlides, updateSettings`
  - `loadState(repos: Repos, at: Date): Promise<AppState>` (mit `refresh(…, at, false)`)
  - `dispatchEvents(repos: Repos, events: StoreEvent[], deps: { at: () => Date; provider: ActionProvider }): Promise<{ state: AppState; created: string[] }>` – laden → `applyEvents` mit `{ isDemo: false }` → `save(diff, revision)`; bei `conflict` bis zu 3 Versuche, dann `Error('conflict')`; danach `executeApproved` und ggf. `checkAction` über einen Sink, der jedes Ausführer-Event einzeln auf dieselbe Weise speichert
  - `isClientEvent(e: unknown): e is StoreEvent` – prüft `type` gegen `CLIENT_EVENTS` und Grundform (Objekt, String-IDs)

- [ ] **Step 1: Failing tests:**
  - `env.test.ts`: fehlende Variablen werden alle genannt; `NEXUS_TEST_MEMORY_DB=1` mit `VERCEL=1` → Fehler; kurzes `SESSION_SECRET` → Fehler.
  - `state-service.test.ts` (Memory-Repos): `approveAction` auf gespeicherten Entwurf → Antwortzustand `executed`, Repo-Zustand ebenso, Protokoll `isDemo: false`; zwischengeschaltetes `save` eines zweiten „Geräts“ (Test-Repo, das beim ersten `save` einmal `conflict` liefert) → zweiter Versuch gewinnt, beide Änderungen erhalten; dauerhafter Konflikt → `Error('conflict')`; `isClientEvent` lehnt `actionExecuted`, `actionStarted`, `actionReconciled`, `resetDemo`, `simulateTransfer`, `setConnectionStatus`, `assistantInbound`, `assistantOutbound`, `assistantButton` und Nicht-Objekte ab.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** `.env.example` listet die sechs Variablen ohne Werte, mit deutschem Kommentar je Zeile.
- [ ] **Step 4:** `npm test …`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Zustands-Dienst mit Revisionsprüfung und Event-Whitelist`

---

### Task 9: Auth-Kern (Sitzung, Einrichtungs-Token, Wiederherstellung, WebAuthn-Hülle)

**Files:**
- Create: `src/server/auth/session.ts`, `src/server/auth/setup.ts`, `src/server/auth/recovery.ts`, `src/server/auth/webauthn.ts`, `tests/unit/auth-session.test.ts`, `tests/unit/auth-recovery.test.ts`, `tests/unit/auth-setup.test.ts`
- Modify: `package.json` (`jose` ^6.2, `@simplewebauthn/server` ^14, `@simplewebauthn/browser` ^14)

**Interfaces:**
- Consumes: `AuthRepository` (Task 6), `ServerEnv` (Task 8)
- Produces:
  - `SESSION_COOKIE = 'nexus_session'`, `SESSION_MAX_AGE_S = 30 * 24 * 3600`
  - `createSessionToken(secret: string, at: Date): Promise<string>` (`sub: 'owner'`, `iat`, `exp = at + 30 Tage`, HS256)
  - `verifySessionToken(token: string | undefined, secret: string, at: Date): Promise<boolean>` (prüft mit `currentDate: at`)
  - `sessionCookieOptions(appOrigin: string)` → `{ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE_S }`
  - `requireSession(): Promise<boolean>` (liest `(await cookies()).get(SESSION_COOKIE)`) – für Route Handler und Server Actions
  - `checkSetupToken(given: string | undefined, expected: string): boolean` (`timingSafeEqual` über SHA-256 beider Werte, leere Eingabe → false)
  - `generateRecoveryCodes(): string[]` – 10 Codes, Format `XXXXX-XXXXX` aus Crockford-Base32 (`crypto.randomBytes`)
  - `normalizeRecoveryCode(input: string): string` (Großschreibung, Leerzeichen/Bindestriche weg)
  - `hashRecoveryCode(code: string, secret: string): string` (HMAC-SHA256 hex über den normalisierten Code)
  - `webauthn.ts`: `registrationOptionsFor(env, existing: StoredPasskey[])`, `verifyRegistrationFor(env, response, expectedChallenge): Promise<StoredPasskey | null>`, `authenticationOptionsFor(env, passkeys)`, `verifyAuthenticationFor(env, response, expectedChallenge, passkey): Promise<{ ok: boolean; newCounter: number }>`; `rpID = new URL(appOrigin).hostname`, `rpName = 'Nexus Assistent'`, `userName = 'Inhaber'`, `residentKey: 'required'`, `userVerification: 'required'`
  - Challenge-Cookie `nexus_webauthn`: `signChallenge(secret, { challenge, purpose: 'register' | 'login' }, at)` / `readChallenge(token, secret, purpose, at)` – JWT HS256, 5 Min., httpOnly

- [ ] **Step 1: Failing tests:**
  - Sitzung: gültig direkt nach Erstellung und nach 29 Tagen; ungültig nach 31 Tagen, mit anderem Secret, mit verändertem Token, ohne Token.
  - Token: richtig → true; falsch, leer, `undefined`, Präfix des richtigen → false.
  - Wiederherstellung: 10 eindeutige Codes im Format `/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/`; `hashRecoveryCode('abcde fghjk', s) === hashRecoveryCode('ABCDE-FGHJK', s)`; Memory-Repo: Code einmal einlösbar, zweites Mal nicht.
  - Challenge: richtiger Zweck → Challenge; falscher Zweck oder abgelaufen → `null`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Die WebAuthn-Hülle wird in Task 13 per E2E gegen den virtuellen Authenticator geprüft; hier nur Typen und Konfiguration.
- [ ] **Step 4:** `npm test …`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Auth-Kern mit Sitzung, Einrichtungs-Token und Wiederherstellungscodes`

---

### Task 10: Auth-Routen, Routen-Schutz, Anmeldeseite

**Files:**
- Create: die acht Routen unter `src/app/api/auth/*/route.ts`, `src/app/api/test/reset/route.ts`, `src/app/anmelden/page.tsx`, `tests/unit/api-guard.test.ts`, `tests/unit/auth-routes.test.ts`

**Interfaces:**
- Consumes: alles aus Task 9, `getRepos`, `readEnv`, `resetTestRepos`
- Produces (alle JSON, Fehler als `{ error: string }` auf Deutsch):

| Route | Schutz | Verhalten |
|---|---|---|
| `GET /api/auth/session` | offen | `{ authenticated: boolean; setupOpen: boolean }` (`setupOpen` = kein Passkey) |
| `POST /api/auth/register/options` | Body `{ setupToken? }` | ohne Passkey: Token Pflicht (sonst 403); mit Passkey: Sitzung Pflicht (sonst 401). Setzt Challenge-Cookie |
| `POST /api/auth/register/verify` | wie oben | Erst-Passkey über `addFirstPasskey` (false → 409 „Bereits eingerichtet“), dann 10 Codes erzeugen, Hashes speichern, Sitzung setzen, Antwort `{ recoveryCodes }`; weitere Passkeys: `addPasskey`, Antwort `{}` |
| `POST /api/auth/login/options` | offen | Optionen mit `allowCredentials` aller Passkeys |
| `POST /api/auth/login/verify` | offen | Signatur + Zähler prüfen, `updateCounter`, Sitzung setzen; Fehler → 401 |
| `POST /api/auth/recover` | offen | `{ code }` → `consumeRecoveryCode(hash)`; ok → Sitzung, sonst 401 |
| `POST /api/auth/logout` | offen | Cookie löschen |
| `POST /api/auth/recovery-codes` | Sitzung | neue 10 Codes, alte ungültig |
| `POST /api/test/reset` | nur `testMemoryDb` (sonst 404) | `resetTestRepos()` |

- Anmeldeseite `/anmelden` (Client Component): bei `setupOpen` Feld „Einrichtungs-Code“ + Knopf „Passkey anlegen“, danach die 10 Codes mit Hinweis „Jetzt sicher speichern. Sie werden nur einmal angezeigt.“ und Knopf „Weiter“ → `/`; sonst Knopf „Mit Passkey anmelden“ und aufklappbar „Wiederherstellungscode verwenden“. Nutzt `startRegistration`/`startAuthentication` aus `@simplewebauthn/browser` (`{ optionsJSON }`).

- [ ] **Step 1: Failing tests:**
  - `api-guard.test.ts`: findet alle `src/app/api/**/route.ts`; jede Datei außerhalb der Liste `auth/session`, `auth/register/*` (eigene Prüfung), `auth/login/*`, `auth/recover`, `auth/logout`, `cron/tick` (eigene Prüfung), `test/reset` (eigene Prüfung) enthält `requireSession(`. Neue Route ohne Schutz → Test rot.
  - `auth-routes.test.ts` (Handler direkt aufrufen, `next/headers` per `vi.mock` mit In-Memory-Cookie-Store, Memory-Repos): `register/options` ohne Token bei leerem Repo → 403; mit falschem Token → 403; nachdem ein Passkey existiert, mit richtigem Token aber ohne Sitzung → 401; `recover` mit gültigem Code → 200 + Cookie, zweites Mal → 401; `session` ohne Cookie → `authenticated: false`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** die Routen als dünne Hüllen um Task 9; Cookies über `(await cookies()).set(...)`.
- [ ] **Step 4:** `npm test …`, `npx tsc --noEmit`, `npm run lint` → grün.
- [ ] **Step 5: Commit** `feat: Passkey-Anmeldung mit Einrichtungs-Token und Wiederherstellung`

---

### Task 11: Echtmodus im Client – `/api/state`, `/api/events`, KI über Server Actions

**Files:**
- Create: `src/app/api/state/route.ts`, `src/app/api/events/route.ts`, `src/app/actions/ai.ts`, `src/data/mode.tsx`, `src/data/ai-client.ts`, `tests/unit/mode.test.ts`, `tests/unit/api-events.test.ts`
- Modify: `src/data/store.tsx`, `src/app/layout.tsx` (`<ModeProvider>` außen um `<AppStoreProvider>`), Seiten mit KI: `src/app/chat/page.tsx`, `src/app/nachrichten/[threadId]/page.tsx`, `src/app/nexus/mitglieder/[id]/page.tsx`, `src/app/nexus/calls/[id]/page.tsx`, `src/app/assistent/page.tsx`

**Interfaces:**
- Consumes: `dispatchEvents`, `loadState`, `isClientEvent` (Task 8), `requireSession` (Task 9), `getAI`, `createStateTools`, `paymentLinkFor`, `setClockMode`
- Produces:
  - `GET /api/state` → `{ state: AppState }` (401 ohne Sitzung)
  - `POST /api/events` Body `{ event: StoreEvent }` → `{ state, created }`; kein Client-Event → 400; Konflikt → 409; ohne Sitzung → 401
  - Server Actions (`'use server'`, jede beginnt mit `requireSession()`, sonst `throw new Error('Nicht angemeldet')`): `askAI(question: string): Promise<ChatAnswer>`, `draftReplyFor(threadId: string): Promise<string>`, `draftReminderFor(contractId: string, tone: 'freundlich' | 'bestimmt'): Promise<string>`, `slidesForCall(callId: string): Promise<Call['slides']>`, `sendToAssistant(text: string): Promise<{ state: AppState }>` (ruft `handleInbound` mit `settings.ownerPhone` als Absender, `getAI()`, Tools, dann `dispatchEvents` mit diesen Events – die `assistant*`-Events gelten hier als Server-Events)
  - `type AppMode = 'demo' | 'real'`; `DEMO_FLAG_KEY = 'nexus-demo-mode'`
  - `resolveMode(i: { authenticated: boolean; demoFlag: string | null; reachable: boolean }): AppMode` – real nur bei `authenticated && reachable && demoFlag !== '1'`
  - `useMode(): { mode: AppMode; authenticated: boolean; setDemo(on: boolean): void }` (ruft beim Start `GET /api/auth/session`, setzt `setClockMode(mode)`)
  - `interface AIClient { answer(q: string): Promise<ChatAnswer>; draftReply(threadId: string): Promise<string>; draftReminder(contractId: string, tone: 'freundlich' | 'bestimmt'): Promise<string>; slidesFor(callId: string): Promise<Call['slides']>; sendToAssistant(text: string): Promise<void> }` und `useAI(): AIClient` – Demo: `demoAI` mit `createStateTools(state, now())` lokal; Echt: Server Actions
  - Store: `useAppStore(): { state; dispatch; mode }`; im Echtmodus lädt der Provider `/api/state`, `dispatch` postet an `/api/events` und übernimmt den Antwortzustand; 401 → `location.assign('/anmelden')`; Fehler → Status-Meldung „Konnte nicht gespeichert werden“ (Zustand unverändert). Im Echtmodus wird nichts in localStorage geschrieben.

- [ ] **Step 1: Failing tests:**
  - `mode.test.ts`: Tabelle für `resolveMode` (nicht angemeldet → demo; angemeldet ohne Flag → real; Flag `'1'` → demo; Server nicht erreichbar → demo).
  - `api-events.test.ts` (Handler direkt, `requireSession` gemockt, Memory-Repos über Testmodus): ohne Sitzung → 401; `{ event: { type: 'resetDemo' } }` → 400; gültiges `dismissInsight` → 200 und Repo-Revision +1; Body ohne `event` → 400.
  - Store-Test: `loadInitial` bleibt grün; neuer Test, dass ein Echt-Provider-Hilfsmodul nie `STORE_KEY` schreibt (Spy auf `setItem`).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.** Seiten nutzen `useAI()` statt `demoAI`; danach findet `grep -rn "demoAI" src/app` nichts mehr. `assistent/page.tsx`: im Echtmodus `sendToAssistant`, die Briefing-Auslöser und „fremde Nummer“-Werkzeuge nur im Demo-Modus.
- [ ] **Step 4:** `npm test …`, `npx tsc --noEmit`, `npm run lint` → grün; volle E2E-Suite (Demo-Modus) `fuser -k 3100/tcp; npm run e2e 2>&1 | tail -15` → grün.
- [ ] **Step 5: Commit** `feat: Echtmodus über /api/state und /api/events, KI über Server Actions`

---

### Task 12: Cron-Takt mit atomarem `job_runs`

**Files:**
- Create: `vercel.json`, `src/server/cron.ts`, `src/app/api/cron/tick/route.ts`, `tests/unit/cron.test.ts`
- Modify: `src/domain/briefing.ts` (`kind: 'morning' | 'evening' | 'weekly'`, Titel „Wochenrückblick“), `src/domain/types.ts` (`AssistantMessage.delivery?: 'whatsapp_freeform' | 'whatsapp_template' | 'push'`), `src/domain/events.ts` (`assistantOutbound.delivery?`), `src/data/engine.ts`, `tests/unit/briefing.test.ts`

**Interfaces:**
- Consumes: `dueRuns`, `chooseDelivery`, `buildBriefing`, `renderBriefingText`; `Repos.state.claimJobRun`; `dispatchEvents`, `loadState`; `sweepStaleExecutions`
- Produces:
  - `vercel.json`: `{ "crons": [{ "path": "/api/cron/tick", "schedule": "*/5 * * * *" }] }`
  - `runTick(deps: { repos: Repos; at: Date; provider: ActionProvider }): Promise<{ ran: string[]; skipped: string[] }>` – `dueRuns(at, new Set(state.jobRuns), state.settings)`; je Lauf **zuerst** `claimJobRun(key, at)`; nur bei `true` ausführen, sonst `skipped`
    - `sync`: keine Connectoren in 2a; `refresh` speichern (über `dispatchEvents([])`) und `sweepStaleExecutions`
    - `briefing_morning` / `review_evening` / `review_weekly`: `buildBriefing(state, 'morning' | 'evening' | 'weekly', at)` → `assistantOutbound { text: renderBriefingText(b), delivery: chooseDelivery({ waConfigured: false, windowOpenUntil: null, templateApproved: false }, at) }` (in 2a also `'push'`, ohne echte Zustellung)
  - `GET /api/cron/tick`: `Authorization` muss timing-safe `Bearer ${CRON_SECRET}` sein, sonst 401; Antwort `{ ran, skipped }`
- Hinweis: `dispatchEvents` akzeptiert hier die Server-Events `assistantOutbound`/`actionExecuted`; die Whitelist gilt nur am HTTP-Eingang (`isClientEvent`).

- [ ] **Step 1: Failing tests** (`cron.test.ts`, Memory-Repos):

```ts
test('zwei parallele Ticks ergeben genau einen Lauf je Schlüssel', async () => {
  const at = new Date('2026-11-12T06:05:00Z'); // 07:05 Berlin
  const [a, b] = await Promise.all([runTick({ repos, at, provider }), runTick({ repos, at, provider })]);
  expect([...a.ran, ...b.ran].filter((k) => k === 'briefing_morning:2026-11-12:07:00')).toHaveLength(1);
  expect((await repos.state.load()).state.assistantChat.filter((m) => m.text.startsWith('Guten Morgen'))).toHaveLength(1);
});
test('Briefings aus → nur sync', …);
test('Sonntag 19:05 → review_evening und review_weekly', …);
test('Briefing-Nachricht trägt delivery "push"', …);
test('sync setzt executing älter als 5 Min. auf uncertain', …);
test('Route: falsches oder fehlendes Bearer → 401', …);
```

  (`renderBriefingText` beginnt mit dem Titel aus `buildBriefing`: „Guten Morgen“ / „Guten Abend“ / neu „Wochenrückblick“ – vorher per Test prüfen.)
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test …`, `npx tsc --noEmit` → grün.
- [ ] **Step 5: Commit** `feat: Cron-Takt mit atomaren Läufen und Briefings`

---

### Task 13: Demo-Schalter, Einrichtungs-Zustand, E2E-Erstanmeldung

**Files:**
- Create: `src/components/ModeBadge.tsx`, `src/components/SetupChecklist.tsx`, `tests/e2e/auth.spec.ts`
- Modify: `src/components/AppShell.tsx` (ModeBadge), `src/app/einstellungen/page.tsx`, `src/app/verbindungen/page.tsx`, `src/app/page.tsx` (Heute), `src/app/nexus/zuordnen/page.tsx` (Demo-Werkzeug nur im Demo-Modus), `playwright.config.ts`, CSS nur in vorhandenen Dateien mit vorhandenen Tokens

**Interfaces:**
- Consumes: `useMode`, `useAppStore`, `notConnected`, `HOW_TO` (bestehend in `verbindungen/page.tsx`)
- Produces:
  - `ModeBadge`: im Demo-Modus „Demo“ (`data-testid="mode-badge"`), ohne Anmeldung zusätzlich Link „Anmelden für echte Daten“ → `/anmelden`; im Echtmodus nichts
  - Einstellungen, Gruppe „Konto“ (nur angemeldet): Schalter „Demo-Modus“ (`id="set-demo"`), Knopf „Passkey hinzufügen“, Knopf „Neue Wiederherstellungscodes“ (zeigt die Codes einmal), Knopf „Abmelden“. Gruppe „Demo“ mit „Demo zurücksetzen“ nur im Demo-Modus.
  - `SetupChecklist` (`data-testid="setup-checklist"`): Liste aller Verbindungen aus `state.connections` mit Häkchen bei `connected` und der Klickanleitung aus `HOW_TO`; Überschrift „Einrichtung“. Verbindungen-Seite zeigt sie im Echtmodus statt der Simulations-Knöpfe; Heute zeigt im Echtmodus, solange keine Verbindung `connected` ist, eine Karte „Noch nichts verbunden – zur Einrichtung“ → `/verbindungen` statt leerer Karten.
  - `playwright.config.ts`: `webServer.env = { NEXUS_TEST_MEMORY_DB: '1', SESSION_SECRET: <32+ Zeichen Testwert>, OWNER_SETUP_TOKEN: 'e2e-setup-token', CRON_SECRET: 'e2e-cron', APP_ORIGIN: 'http://localhost:3100' }`

- [ ] **Step 1: Failing E2E** `tests/e2e/auth.spec.ts` (nur Projekt `desktop`, `test.describe.configure({ mode: 'serial' })`, vorher `POST /api/test/reset`):

```ts
const cdp = await page.context().newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
```
  - Ohne Anmeldung: `/` zeigt `mode-badge` „Demo“ und den Link „Anmelden für echte Daten“.
  - `/anmelden` → Einrichtungs-Code `e2e-setup-token` → „Passkey anlegen“ → 10 Codes sichtbar → „Weiter“ → Heute zeigt „Noch nichts verbunden“, kein `mode-badge`.
  - `/verbindungen` zeigt `setup-checklist` mit 10 Einträgen, alle ohne Häkchen.
  - Einstellungen → „Demo-Modus“ an → Demo-Daten (Badge, Demo-Inhalte); aus → wieder leerer Echtzustand (keine Demo-Daten sichtbar).
  - „Abmelden“ → `/anmelden` zeigt „Mit Passkey anmelden“ (Einrichtung gesperrt) → anmelden mit demselben virtuellen Authenticator → Echtmodus.
  - Erneuter Einrichtungsversuch per `request.post('/api/auth/register/options', { data: { setupToken: 'e2e-setup-token' } })` ohne Cookie → 401.
- [ ] **Step 2:** `fuser -k 3100/tcp; npm run e2e -- tests/e2e/auth.spec.ts 2>&1 | tail -15` → FAIL.
- [ ] **Step 3: Implement.** Bestehende `demo-badge`-Testids bleiben unverändert.
- [ ] **Step 4:** volle Suite `fuser -k 3100/tcp; npm run e2e 2>&1 | tail -15` → grün (alte Specs im Demo-Modus unverändert); `npm test …`, `npx tsc --noEmit`, `npm run lint`, `npm run contrast` → grün.
- [ ] **Step 5: Commit** `feat: Demo-Schalter, Einrichtungs-Zustand und Passkey-E2E`

---

### Task 14: Inhaber-Checkliste `docs/setup-phase2a.md`

**Files:**
- Create: `docs/setup-phase2a.md`
- Modify: `docs/PROJEKT-STAND.md` (Tabelle „Dokumente“ um die Checkliste ergänzen)

Inhalt (Deutsch, du-Form, kurze nummerierte Schritte mit Klickpfaden; keine echten Werte):
1. **Supabase-Projekt anlegen:** supabase.com → Dashboard → „New project“ → Name `nexus-assistent`, Region **Central EU (Frankfurt)**, starkes DB-Passwort im Passwort-Manager speichern.
2. **Migration ausführen:** Projekt → „SQL Editor“ → „New query“ → Inhalt von `supabase/migrations/20261112000000_fundament.sql` einfügen → „Run“. Prüfen: „Table Editor“ zeigt die Tabellen, jede mit Schloss „RLS enabled“. (Alternative mit CLI: `npx supabase link --project-ref <ref>` und `npx supabase db push`.)
3. **Schlüssel holen:** Project Settings → „API“ (bzw. „API Keys“) → Project URL = `SUPABASE_URL`, `service_role`-Schlüssel = `SUPABASE_SERVICE_ROLE_KEY`. Hinweis: nie weitergeben, nie in den Browser.
4. **Vercel Pro:** vercel.com → Team „NEXUS“ → Settings → Billing → „Upgrade to Pro“ (nötig für Cron alle 5 Min.).
5. **Umgebungsvariablen:** Projekt → Settings → „Environment Variables“ → für „Production“ (und „Preview“, falls gewünscht) anlegen: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET` (mind. 32 Zeichen, z. B. `openssl rand -base64 48`), `OWNER_SETUP_TOKEN` (zufällig, nur einmal gebraucht), `CRON_SECRET` (zufällig), `APP_ORIGIN` (z. B. `https://<deine-domain>` ohne Schrägstrich am Ende, genau die Adresse, unter der du die App öffnest). Danach „Deployments“ → letztes Deployment → „Redeploy“.
6. **Cron prüfen:** Projekt → Settings → „Cron Jobs“ zeigt `/api/cron/tick` alle 5 Min.
7. **Erste Anmeldung:** auf dem iPhone in Safari `APP_ORIGIN/anmelden` öffnen → `OWNER_SETUP_TOKEN` eingeben → „Passkey anlegen“ → Face ID bestätigen.
8. **Wiederherstellungscodes sichern:** die 10 Codes sofort im Passwort-Manager (z. B. iCloud-Schlüsselbund, Notiz) speichern; jeder Code gilt einmal. Neue Codes später unter Einstellungen → Konto.
9. **Optional:** `OWNER_SETUP_TOKEN` in Vercel löschen (die Einrichtung ist ohnehin gesperrt). Zweites Gerät: angemeldet unter Einstellungen → Konto → „Passkey hinzufügen“.
10. **Integrationstest (für Entwickler):** zweites Projekt „nexus-test“ in Frankfurt, Schritt 2 dort wiederholen, `SUPABASE_TEST_URL` und `SUPABASE_TEST_SERVICE_ROLE_KEY` lokal setzen, `npm run test:integration`.
11. **Was 2a noch nicht tut:** keine echten Verbindungen, nichts wird gesendet, KI ist die Demo-KI (Spec Abschnitt 6).

- [ ] **Step 1:** Datei schreiben; Variablenliste gegen `src/server/env.ts` und `.env.example` abgleichen (`grep -o "[A-Z_]\{6,\}" docs/setup-phase2a.md | sort -u`).
- [ ] **Step 2: Commit** `docs: Einrichtungs-Checkliste Paket 2a`

---

## Self-Review (erledigt)

- **Spec-Abdeckung 2a:** Laufzeit/Supabase (T7, T8) · Datenzugriff nur Server, RLS (T7) · Engine (T1) · Echtmodus-Ablauf 1–4 (T8, T11) · Schema inkl. Unique und `meta.schema_version` (T6, T7) · UUIDs, Server gibt ID zurück (T1) · Passkey, Token, Sitzung, Recovery, Routen-Schutz (T9, T10) · Server-Ausführer, `uncertain`/`failed`-UI (T3, T8) · Aktions-Fabrik (T2) · AIProvider-Injektion, `paymentLinkFor` (T2, T4, T11) · Cron mit `job_runs` (T12) · Demo-Schalter (T11, T13) · Uhr (T5, T11) · Leerer Echt-Start (T5, T13) · Env-Variablen (T8, T14) · Tests aus Abschnitt 5 (T1, T6, T7, T9, T12, T13).
- **Typkonsistenz:** `EngineContext`, `EventSink`, `Repos`, `ChangeSet`, `StoredPasskey`, `AIClient`, `AppMode` jeweils einmal definiert und in späteren Interfaces-Blöcken gleich benannt.
- **Spec-Lücken, im Plan entschieden:** siehe Abschnitt unten.

## Entscheidungen zu Spec-Lücken

1. **Zusätzliche Tabellen** `contract_exceptions`, `iban_links`, `passkeys`, `recovery_codes`: Der Spec-Katalog nennt sie nicht, `AppState` und Login brauchen sie. Entitäten ohne eigene ID (Allocations, Audit) bekommen abgeleitete, stabile Zeilen-IDs.
2. **Transaktion über PostgREST:** `supabase-js` hat keine Client-Transaktionen. Darum speichert die SQL-Funktion `apply_changes` alle Änderungen in einer Transaktion mit Revisionsprüfung (`meta.revision`). Das schützt auch gegen parallele Events.
3. **Demo-Ausführer im Echtmodus** (Spec: „nichts verlässt die App“ und „mischen sich nie“): Sende-Aktionen werden als ausgeführt protokolliert („Nicht gesendet (Demo-Ausführer)“), erzeugen aber keine ausgehende Nachricht. Interne Aktionen wirken normal.
4. **Hängende Ausführung:** Neues Event `actionStarted` speichert `executing` vor dem Anbieter-Aufruf. Der Takt setzt Hänger nach 5 Min. auf „ausgang unklar“.
5. **E2E ohne Datenbank:** Nur für Tests gibt es `NEXUS_TEST_MEMORY_DB=1` (In-Memory-Repos und `/api/test/reset`), auf Vercel gesperrt. Die sechs Produktions-Variablen bleiben genau wie in der Spec.
6. **Modus-Erkennung im Client** über `GET /api/auth/session`. Ohne Antwort vom Server gilt der Demo-Modus mit Badge, damit nie Echt- und Demo-Daten gemischt angezeigt werden. Der Demo-Schalter ist pro Gerät gespeichert (localStorage).
7. **Wochenrückblick:** `buildBriefing` bekommt `kind: 'weekly'` statt einer eigenen Funktion. Zustellweg in 2a ist immer `push`, er wird nur an der Nachricht vermerkt.
8. **Assistent-Seite im Echtmodus:** Eingaben laufen über die Server Action `sendToAssistant`. Die Simulationswerkzeuge (fremde Nummer, Briefing auslösen) gibt es nur im Demo-Modus.
