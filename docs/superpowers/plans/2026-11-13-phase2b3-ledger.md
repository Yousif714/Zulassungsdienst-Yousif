# 2b-3 Umsetzungs-Ledger (Kopie für die nächste Session)

Arbeitskopie liegt git-ignoriert unter `.superpowers/sdd/2026-11-13-phase2b3-stripe-umstellung/` und geht mit dem Container verloren. Diese Datei ist der Stand zum Weitermachen.

# SDD ledger — plan: docs/superpowers/plans/2026-11-13-phase2b3-stripe-umstellung.md

Spec: docs/superpowers/specs/2026-11-13-phase2b3-stripe-umstellung-design.md
Branch: claude/cool-hopper-hcnb9d (kein Worktree; Arbeitsbranch, nicht main)
Start-HEAD: 168534e
Stripe-Typen (Ersatz für Doku): /tmp/claude-0/-home-user-Zulassungsdienst-Yousif/95a221d2-e42e-4a94-8415-eea72c87c50a/scratchpad/stripe19/package/types/
Inhaber-Punkte offen (nur für Task 14): Preview-Supabase eigenes Projekt?, Vercel-Schutz lockern, Testmitglied mit Bank.

## Pre-flight
Tabelle + 12 Befunde: preflight.md. Alle Rulings B1–B12 übernommen (Controller). Jeder Task-Dispatch verweist auf die ihn betreffenden Befunde.

## Tasks
Task 1: dispatched (BASE 168534e, sonnet)
Task 1: implementer DONE_WITH_CONCERNS bf8e42d (DEFAULT_SETTINGS in src/domain/settings.ts; isActionType excludes stripe_takeover → Task 6 must test). Review dispatched (sonnet).
Task 1: complete (commits 168534e..bf8e42d, review clean; 3 Minor notiert: Settings-Literal DRY, Migrationstest Werterhalt, nudgeDays 0/Dezimal)
Task 2: dispatched (BASE bf8e42d, sonnet). Ruling: Step 5 (MCP apply_migration) macht der Controller nach Review — Migration ist externer Schreibvorgang auf Live-DB, CLAUDE.md erlaubt idempotente Migration durch Claude — falls falsch: Tabelle ohne Nutzer, harmlos.
Task 2: implementer DONE 7100d52; apply_changes-Diff vs. 20261117 geprüft: nur +stripe_takeovers. Review dispatched (sonnet).
Task 2: complete (commits bf8e42d..7100d52, review clean). OFFEN: Migration NICHT eingespielt — apply_migration 2x Timeout (MCP-Rückfrage an Inhaber unbeantwortet). Vor Merge nachholen + list_tables/execute_sql prüfen.
Task 3: dispatched (BASE 7100d52, sonnet)
Task 3: implementer DONE 862b0f5 (Report-TDD-Beleg nur zusammengefasst). Review dispatched (opus, Geldlogik).
Task 3: complete (commits 7100d52..862b0f5, review clean). Minor geparkt fürs Final-Review: withPlan verliert Rest still, wenn paidCents > Grundplan (Vertragskorrektur nach Umstellung, engine.ts:515) → Korrektur bei plan sperren?; Testlücke Stripe-Zahlung nach Umstellung.
Task 4: dispatched (BASE 862b0f5, opus; Rulings B1,B4,B5,B8,B11 mitgegeben)
Task 4: implementer DONE e883f03 (Concern: Importzyklus status.ts↔detectors/members.ts falls Task 8 runsViaStripe dort nutzt). Review dispatched (opus).
Task 4: review → Needs fixes (Important, plan-mandated: Sofort-Phase für Rückstand ist Monatspreis mit Anker jetzt → Stripe verlängert nach 1 Monat, wenn nächste Fälligkeit >1 Monat bzw. Tag 31 / vor 07:00 → Doppelabbuchung).
Task 4: Ruling: Sofort-Phase endet bei min(nächste Fälligkeit 07:00 Berlin, jetzt + 14 Tage); liegt die nächste Fälligkeit später, füllt eine Lücken-Phase (trial) bis dorthin — Spec Anti-Ziel Doppelabbuchung schlägt Plan; nur verifizierte Felder (end_date, trial), Phase kürzer als jeder Abrechnungszeitraum bucht genau einmal — falls falsch: eine Zusatzphase je Plan, Test im Stripe-Testmodus deckt es auf.
Task 4: minor (deferred): Provider muss je Phase billing_cycle_anchor 'phase_start' + proration_behavior 'none' setzen → in Task 10/11-Dispatch mitgeben + Kommentar in plan.ts.
Task 4: minor (deferred): Tag-31-Läufe erzeugen Zusatz-Lückenphasen (Beträge korrekt; Phasen-Obergrenze beachten).
Task 4: minor (deferred): takeoverAction(mode) doppelt zu plan.mode.
Task 4: Ruling für Task 8: runsViaStripe/currentTakeover nicht aus detectors/members.ts importieren, falls Zyklus — ggf. in Modul ohne memberView-Import auslagern.
Task 4: fix round 1 implementer done 66f64f9 (Planende ohne künftige Rate jetzt +14 Tage statt +1 Monat → Task 7/11 übernehmen planEndDate). Re-review dispatched (opus).
Task 4: fix round 1/5 (1 addressed, 0 open — Sofort-Phase Doppelabbuchung; commits e883f03..66f64f9)
Task 4: complete (commits 862b0f5..66f64f9, review clean after fix)
Carry → Task 10/11: Provider setzt je Phase billing_cycle_anchor 'phase_start' (nicht bei trial) + proration_behavior 'none'; trial als trial:true übergeben; chargedTotal-Annahme nur im Stripe-Testmodus beweisbar (Task 14).
Task 5: dispatched (BASE 66f64f9, sonnet; B11,B12)
Task 5: implementer DONE 6336cc1. Review dispatched (sonnet).
Task 5: complete (commits 66f64f9..6336cc1, review clean)
Task 5: minor (deferred): checkAction found = typeof boolean ? : true → undefined zählt als gefunden, null wirft (Härtung im Final-Review)
Task 6: dispatched (BASE 6336cc1, opus; B1,B4,B5,B7,B11,B12 + Test Client-Fälschung stripe_takeover)
Task 6: implementer DONE f38971a (setUpContract in domain/takeover/lifecycle.ts; failed blockiert neue Umstellung bis Retry). Review dispatched (opus).
Task 2: Migration stripe_umstellung LIVE eingespielt (14.11.) und geprüft: RLS an, apply_changes kennt stripe_takeovers, 0 Zeilen.
Inhaber-Antworten (14.11.): Preview bekommt eigenes Supabase-Projekt = ja; erfundenes Testmitglied mit Bank in Preview = ja. Stripe-Testschlüssel wird gerade angelegt.
Task 6: review → Needs fixes (Important, plan-mandated: simulateTakeoverSetUp + isDemo aus output abgeleitet → im Echtmodus kann Client echten Vertrag ohne Zeitplan auf stripe stellen; Erinnerungen stoppen, niemand zieht ein).
Task 6: Ruling: isDemo der Umstellung = ctx.isDemo || e.simulated (nicht aus output); simulateTakeoverSetUp nur wenn ctx.isDemo UND takeover.isDemo, sonst nur Audit; Echtmodus-Ausführung/Abgleich ohne output (kein stripeCustomerId) → keine Umstellung anlegen, Audit „Umstellung ohne Ergebnisdaten – bitte prüfen“ — Spec-Anti-Ziel (nichts still auf Stripe ohne Abbuchung) schlägt Brief — falls falsch: Demo im Echtmodus zeigt keinen Fake-Link.
Task 6: minor (deferred): veralteter Entwurf bleibt freigebbar bis Task 9; failed-Aktion blockiert neue Umstellung (Backlog); relativer Demo-Link → Task 13; Plural-Audit-Texte.
Task 6: fix round 1 implementer done 0d8a126 (Concern: Echtbetrieb ohne output → Aktion executed ohne Umstellung, nur Audit sichtbar). Re-review dispatched (sonnet).
Task 6: fix round 1/5 (1 addressed, 0 open; commits f38971a..0d8a126)
Task 6: complete (commits 6336cc1..0d8a126, review clean after fix)
Task 6: minor (deferred): no_output → Aktion executed ohne Umstellung, Recovery nur über neue Vorbereitung (prüfen im Final-Review).
Task 7: dispatched (BASE 0d8a126, sonnet)
Task 7: implementer DONE d2c4017. Review dispatched (opus).
Task 7: review → Needs fixes: Critical #1 neue Umstellung nach Abbruch verknüpft altes gekündigtes Abo (link.ts:21); Important #2 kein Abgleich stripeCustomerId (+ Demo-Umstellung darf echtes Abo nicht verknüpfen); Important #3 verwaiste Abos mit metadataContractId fallen nirgends auf.
Task 7: Ruling #3: kein Fix in Task 7 — neuer Hinweis „Stripe-Abo mit Vertrags-ID ohne passende Umstellung“ wird in Task 8 (Hinweise) gebaut — gehört fachlich zu Detektoren — falls falsch: ein Task später.
Task 7: minor (deferred): endedAsAgreed doppelt (link.ts:38 / detectors/subscriptions.ts:32) → Helfer; reguläres Ende ohne schedule/cancel_at → endDate null → Fehlalarm (in Task 14 gegen echtes Stripe prüfen, ggf. ended_at); Abbruch nach letzter bezahlter Rate → Status irreführend.
Task 7: fix round 1 implementer done 5169104. Re-review dispatched (sonnet).
Task 7: fix round 1/5 (2 addressed, 0 open; commits d2c4017..5169104)
Task 7: complete (commits 0d8a126..5169104, review clean after fix)
Task 7: minor (deferred): Abo schon canceled beim ersten Sync wird nie verknüpft (undokumentiert); Umstellung ohne stripeCustomerId bleibt dauerhaft unverknüpft.
Carry → Task 8: zusätzlicher Hinweis „Stripe-Abo mit Vertrags-ID ohne passende Umstellung“ (Ruling Task 7 #3); runsViaStripe-Importzyklus beachten (Ruling Task 4).
Task 8: dispatched (BASE 5169104, opus; B6, B11, Zyklus-Ruling, Zusatzhinweis verwaiste Abos)
Task 8: implementer DONE_WITH_CONCERNS 6f44ecc (6 neue Hinweise inkl. takeover_subscription_orphan; Concerns: Demo zeigt 6 rate_upcoming-today-Hinweise → Bündelung in Task 9 entscheiden; Hinweise verlinken /nexus/umstellung (Task 13); Preisabweichung zeigt „bestätigt: unbekannt“). REVIEW NOCH OFFEN (Session-Übergabe 14.11.).

---

# Pre-flight-Konfliktscan 2b-3 (Plan 2026-11-13, 14 Tasks)

Gelesen: Plan (ganz), Spec (ganz), CLAUDE.md; gezielt geprüft: `actions/machine.ts`, `demo-provider.ts`, `data/executor.ts`, `engine.ts` (applyEffects, actionExecuted, refresh), `state-service.ts` (CLIENT_EVENTS, SETTINGS, loadState), `action-factory.ts`, `payment-link.ts`, `ledger/schedule.ts`, `ledger/takeover.ts`, `detectors/members.ts`, `detectors/subscriptions.ts`, `import/stripe.ts`, `connections.ts`, `http.ts`, `fixture-fetch.ts`, `stripe-signature.ts`, Webhook-Route, `clock.ts`, Migration 20261117, `migration.test.ts`, `schedule.test.ts`.

Bestehende Signaturen stimmen: `buildSchedule(c, ex)`, `monthDate`, `planTakeover(states, today, mode)` + `TakeoverPlan`, `memberView(s, id, today)` (`.states`, `.status.openCents`), `idempotencyKey = id:version`, `editDraft`, `coveringContract`, `detectStripePaidLexwareOpen(s)`, `detectInvoiceOverdue(s, now)`, `detectSubscriptionChanges`, `mapStripe` (liest `schedule.phases[-1].end_date`), `mergeBatch`, `deriveProposals`, `refresh(s, at, isDemo)`, `EngineContext {at,isDemo,newId}`, `claimJobRun`, `dispatchEvents`, `contractSources`/`notConnected`, `berlinLocalToUtc`, `daysBetween(a,b)=b−a`, `formatIsoDe`, `OPTIONAL_TABLES`, `v_allowed`. `actionExecuted` ist kein Client-Ereignis (keine Fälschung von `output` möglich). `ContractException` ändert keine Beträge → `paidCents = totalCents − Σ rates` ist korrekt.

## Paare (geteilte Datei/Schnittstelle)

| A | B | A produziert ↔ B konsumiert | Befund |
|---|---|---|---|
| 1 | 2–13 | Typen `StripeTakeover`, `plan`, `metadataContractId`, Settings, `DEFAULT_SETTINGS` | ok |
| 1 | 6 | `state-service.ts` SETTINGS ↔ CLIENT_EVENTS/SHAPE | ok (sequenziell) |
| 2 | 12 | Tabelle/Mapping `stripe_takeovers` ↔ Token-Lookup aus Repo | ok |
| 3 | 6, 7 | `buildSchedule` mit `plan` ↔ `setUpContract` setzt `plan`, Rückfall behält `plan` | ok |
| 4 | 6 | `takeoverToken(newId)` (setzt UUID-newId voraus) ↔ Test-ctx „Zähler-IDs“ (`id-1`) | **B5** |
| 4 | 6, 9, 13 | `openTakeoverAction` (draft…failed) ↔ Task 6 „offener Entwurf“, Task 13 N über `prepared` | **B4** |
| 4 | 13 | Entfernen `stripePlanAction` ↔ Übernahme-Seite + `nexus.spec.ts` | **B8** |
| 4 | 7, 10, 11 | `schedulePhases`/`planEndDate`/`phaseStartUnix` ↔ `scheduleParams`, `confirmedEndDate`, Provider | ok (gleiche Funktion, gleicher Tag) |
| 5 | 6, 11 | `ActionOutput`, `lookup(key, a)`, `cancelDraft` ↔ applyEffects, Provider | ok; Wortlaut „mit output“ vs. Demo ohne output **B12** |
| 6 | 11 | `StripeTakeover.id = ctx.newId()` erst NACH Ausführung ↔ Provider braucht `ScheduleInput.takeoverId` VOR Ausführung | **B1** |
| 6 | 9 | `prepareTakeover` editDraft bei Planänderung ↔ `ensureTakeoverDrafts` editDraft/cancelDraft | **B7** |
| 6/11 | 11 | Zeitplan-Key Provider `${aktion:version}:schedule` ↔ Webhook `takeover:<id>:schedule`; `lookup` liefert nur Kunden | **B2** |
| 8 | 9 | `upcomingRates`/`unusedLinks`, Dedupe = insightKey | ok |
| 8 | – | `needsSources` hart (`stripe_nexus`, `bank_qonto`) ↔ bestehend `contractSources` | **B6** |
| 9 | 12 | `paymentLinkFor` liefert Link bei `link_sent|plan_changed` ↔ Seite gültig nur bei `link_sent` | **B3** |
| 10 | 11, 12 | `StripeWriter`, `stripeWriteRoutes`, `fixtureFetch.requests` | ok |
| 11 | Webhook | braucht `data.object` ↔ `verifyStripeSignature` liefert nur `{id,type}`, Datei nicht in Files | **B9** |
| 11 | 12 | `createCheckoutForToken`, `getStripeWriter`/`setTestStripeWriter` | ok |
| 12 | 13 | `RootChrome`/layout ↔ App-Seiten; `umstellung.spec.ts` beide Teile | ok |

## Je Task

| Task | Befund |
|---|---|
| 1 | ok. |
| 2 | ok (Muster 20261117, `migration.test` prüft TABLES automatisch). |
| 3 | Test „Referenz 4a“ hat nur Kommentare, keine Assertion → **B11**. |
| 4 | Step 3 berührt Übernahme-Seite, die nicht in Files steht → **B8**. Sonst stimmig. |
| 5 | ok. |
| 6 | **B1, B4, B5, B7, B12**. |
| 7 | ok (`mapStripe` liest Zeitplan-Ende bereits; `confirmedPriceCents: null` bis Task 8 unkritisch). |
| 8 | **B6**. |
| 9 | **B3, B7**. `assistant.ts` und `state-ai.ts` nutzen `paymentLinkFor` wirklich → Files stimmen. |
| 10 | ok. |
| 11 | **B1, B2, B9**. |
| 12 | Job-Runs-Zähler vs. Spec „schreibt nichts außer Checkout“ → **B10**. Kein Proxy/Middleware: Login läuft clientseitig → `RootChrome` ohne Provider reicht. |
| 13 | **B4** (Zählung N), **B8** (E2E-Anpassung erst hier). |
| 14 | ok. |
| 3–12 | Viele Platzhalter `/* … */` → **B11**. |

## Befunde und Rulings

**B1 (hoch) takeoverId fehlt zur Ausführungszeit.** Der Provider (Neu-Freigabe mit hinterlegtem Zahlungsmittel) muss `createSchedule({…, takeoverId})` mit Metadaten aufrufen. Die ID entsteht aber erst danach im Reducer per `ctx.newId()`.
Ruling: `StripeTakeover.id = action.id` (deterministisch, `stripe-takeover-<c>-<n>`), Metadaten `takeoverId` = Aktions-ID — Spec 6.5 verlangt ohnehin „Aktions-ID“ in den Metadaten, und der Provider kennt sie — Kosten, falls falsch: eine Umbenennung des Felds, kein Datenverlust.

**B2 (hoch) Doppel-Zeitplan möglich (Anti-Ziel Doppelzahlung).** Provider-Pfad und Webhook nutzen verschiedene Idempotency-Keys. Bei Timeout findet `lookup` nur den Kunden → `link_sent` ohne `scheduleId`, obwohl der Zeitplan existiert. Wird danach der Link genutzt, legt der Webhook einen zweiten Zeitplan an.
Ruling: Beide Pfade nutzen den Key `takeover:<actionId>:schedule`. `lookup` sucht bei `payload.paymentMethodId` den Zeitplan (Kunde + `metadata.takeoverId`) und liefert `scheduleId`. Test in Task 11 dazu — Spec §4 Anti-Ziel schlägt Plan — Kosten, falls falsch: ein Such-Aufruf mehr.

**B3 (mittel) Toter Link in Erinnerungen.** `paymentLinkFor` (Task 9) liefert den Link auch bei `plan_changed`, die Seite (Task 12) akzeptiert nur `link_sent`. Ohne Umstellung fällt sie auf den Demo-Link `buy.stripe.com/demo` zurück.
Ruling: Echter Link nur bei `link_sent`. `upcomingReminderText` bekommt sonst `null`, nie den Demo-Fallback — Spec 7 „Stripe-Link (falls schon erzeugt)“ — Kosten, falls falsch: Erinnerung ohne Link.

**B4 (mittel) Zweite offene Umstellung möglich.** `prepareTakeover`/`prepareAllTakeovers` prüfen nur „offener Entwurf“. Bei einer Aktion in `approved|executing|uncertain|failed` entsteht ein neuer Versuch. Task 13 zählt N dagegen über `prepared` (= alle offenen Status).
Ruling: Überall gilt das Prädikat `openTakeoverAction`. Ist die offene Aktion kein Entwurf, passiert nichts außer einem Audit-Eintrag (`Umstellung läuft bereits`) — Spec 6.1 „höchstens eine offene Umstellung“ — Kosten, falls falsch: Nutzer muss eine fehlgeschlagene Aktion erst erneut versuchen.

**B5 (mittel) Test kann nicht grün werden.** Der Task-6-Kontext nutzt Zähler-IDs (`id-1`), der Test erwartet aber `token` als 64 Hex-Zeichen.
Ruling: Die Test-`newId` liefert UUID-förmige Hex-IDs (wie im Task-4-Test) — `takeoverToken` setzt UUIDs voraus (Prod: `crypto.randomUUID`) — Kosten, falls falsch: keine.

**B6 (mittel) `needsSources` hart statt wiederverwendet.** `rate_upcoming` mit `['stripe_nexus']` ist falsch, denn Legacy-Raten hängen an der Bank.
Ruling: `rate_upcoming` → `contractSources(contract)`. `double_payment` → `['bank_qonto']` (nach `set_up` liefert `contractSources` Stripe). Link- und Plan-Hinweise → `['stripe_nexus']` — CLAUDE.md „wiederverwenden“ — Kosten, falls falsch: Hinweis wird bei veralteter Quelle falsch unterdrückt oder angezeigt.

**B7 (mittel) Duplikation Entwurfspflege.** Task 6 (`prepareTakeover`) und Task 9 (`ensureTakeoverDrafts`) gleichen den `stripe_takeover`-Entwurf jeweils selbst ab (editDraft/cancelDraft).
Ruling: Task 6 legt eine Domain-Funktion an (z. B. `takeover/prepare.ts`: `syncTakeoverDraft(s, contractId, mode, at, isDemo)`). Reducer und `ensureTakeoverDrafts` rufen nur diese auf — CLAUDE.md „nicht duplizieren“ — Kosten, falls falsch: eine Datei mehr.

**B8 (niedrig) UI-Eingriff in einem Domain-Task.** Task 4 entfernt `stripePlanAction` und ändert damit die Übernahme-Seite (nicht in Files). Der alte Knopf bzw. `nexus.spec.ts` bricht bis Task 13.
Ruling: `stripePlanAction` bleibt (deprecated) bis Task 13 und wird dort mit der Seite und der E2E-Anpassung entfernt — Kosten, falls falsch: toter Code über 9 Tasks.

**B9 (niedrig) Datei fehlt in Task 11.** `verifyStripeSignature` gibt nur `{id,type}` zurück. `completeTakeoverCheckout` braucht `data.object`.
Ruling: `stripe-signature.ts` (+Test) in die Files von Task 11 aufnehmen und das Ereignis um `object` erweitern — Kosten, falls falsch: keine.

**B10 (niedrig) Ratenbegrenzung schreibt `job_runs`.** Spec 10 sagt: „schreibt nichts außer der Checkout-Sitzung“.
Ruling: zulassen. Die Ratenbegrenzung ist Spec-Pflicht und serverlos nur mit Speicher machbar. Die Schlüssel sind gehasht und ohne IP, es sind keine Fachdaten — Kosten, falls falsch: wachsende `job_runs`, Aufräumen später im Backlog.

**B11 (niedrig) Platzhalter-Tests ohne Assertion.** Betrifft Task 3 „Referenz 4a“ und die `/* … */` in Tasks 4, 6–9, 11, 12.
Ruling: Der Implementierer schreibt je Stub konkrete `expect`-Werte. Der Task-Review lehnt leere Bodies ab — TDD-Regel — Kosten, falls falsch: keine.

**B12 (niedrig) Wortlaut zu applyEffects widersprüchlich.** Dort steht „nur mit output“, der Demo-Test läuft aber ohne output (der `DemoProvider` im Client liefert keins).
Ruling: Der `stripe_takeover`-Zweig läuft immer, `output` ist optional (fehlt → Demo) — Kosten, falls falsch: keine.
