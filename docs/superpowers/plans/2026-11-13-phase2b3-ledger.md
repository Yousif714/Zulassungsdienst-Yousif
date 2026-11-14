# 2b-3 Umsetzungs-Ledger (Kopie für die nächste Session)

Arbeitskopie liegt git-ignoriert unter `.superpowers/sdd/2026-11-13-phase2b3-stripe-umstellung/` und geht mit dem Container verloren. Diese Datei ist der Stand zum Weitermachen. In neuer Session: Workspace per sdd-workspace-Skript anlegen, diesen Inhalt (bis zur Trennlinie) als progress.md und den Teil nach der Trennlinie als preflight.md dort ablegen; global-constraints.md aus dem Plan (Abschnitte Global Constraints + Review Focus) neu extrahieren.

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
Task 8: Review dispatched (opus) nach Session-Resume.
Task 8: review → Needs fixes (Important: Rückbuchung nach Einrichtung (negativ, bank incoming) erzeugt falsche „Doppelzahlung“, takeover.ts:49-50).
Task 8: minor (deferred): Abgleich-Prädikat doppelt (takeover.ts:124-126 vs link.ts:23-30); Text „bestätigt: unbekannt“ bei Plan-Abos; Tests fehlen: aufgeteilte Zahlung, Erinnerungen nach aborted; Demo-Briefing 6× rate_upcoming → Bündelung in Task 9 entscheiden.
Task 8: fix round 1/5 (1 addressed, 0 open; commits 6f44ecc..07a3d15)
Task 8: complete (commits 5169104..07a3d15, review clean after fix)
NÄCHSTER SCHRITT: Task 9 (Brief per task-brief-Skript aus dem Plan erzeugen; Carry: Demo-Briefing-Bündelung der rate_upcoming-Hinweise entscheiden; B3 paymentLinkFor nur bei link_sent; B7 syncTakeoverDraft aus Task 6 wiederverwenden).

Task 9: dispatched (BASE 07a3d15, sonnet; B3,B7,B11; Bündelung → Backlog) [Session 3, 14.11.]
Task 9: implementer DONE_WITH_CONCERNS 517384b (refresh legt im Demo Erinnerungsentwürfe an → Testbasen executor/store/assistant/api-events angepasst; E2E nicht gelaufen). Hinweis: tsc-Fehler LayoutProps = fehlende .next/types im frischen Container → `npx next typegen` vorher. Review dispatched (sonnet).
Task 9: review → Needs fixes (Important: E2E nexus.spec.ts:143 erwartet nur reminder-…, jetzt +6 upcoming-Demo-Entwürfe).
Task 9: Ruling: Demo-refresh legt Erinnerungsentwürfe bewusst an (Funktion im Demo sichtbar) → E2E-Filter auf `reminder-`; zusätzlich Minor fixen: offener upcoming-Entwurf bekommt neuen Text (editDraft), wenn sich Link/Text ändert; Cast `as never` + Re-Export entfernen — falls falsch: Demo zeigt 6 Entwürfe mehr, Bündelung Backlog.
Task 9: fix round 1/5 (3 addressed, 0 open; commits 517384b..a33722f; Re-Review durch Controller: Diff klein, ok; E2E nexus+heute+assistant grün)
Task 9: complete (commits 07a3d15..a33722f)
Task 9: minor (deferred): kein Test mehr für Executor/Reducer mit vorhandenen Auto-Entwürfen; Demo-Briefing +6 Entwürfe (Bündelung Backlog).
Task 10: dispatched (BASE a33722f, sonnet; Carry Phasen-Felder, B11)
Task 10: implementer DONE 7424ba9 (TDD-Reihenfolge verletzt: Rotlauf nachträglich per stash belegt; Concern Phasen-Felder erst Task 14). Review dispatched (opus, Zeitplan-Felder).
Task 10: complete (commits a33722f..7424ba9, review clean, opus; Feldnamen gegen stripe@19.3.0 Clover-Typen geprüft)
Task 10: minor (deferred → Final-Review): leere Phasen TypeError; encodeForm leere Arrays/NaN; Kundensuche strippt Quotes; 401-Test schwach.
Carry → Task 11: (a) 409 idempotency_key_in_use bei gleichzeitigem Webhook → als wiederholbar behandeln (Webhook 500, Stripe wiederholt), Test; (b) Basis-URL ohne abschließenden Schrägstrich normalisieren + Token encodeURIComponent; (c) Integrationstest echte schedulePhases-Ausgabe (inkl. Lücken-Phase) durch scheduleParams.
Task 11: dispatched (BASE 7424ba9, opus; B1,B2,B9,B11,B12 + Carry)
Task 11: implementer DONE_WITH_CONCERNS c350af6 (Abweichung: simulatedFor(a) in machine.ts/executor.ts, damit echte stripe_takeover nicht als Demo gilt; findSchedule nur erste 100). Review dispatched (opus).
Task 11: review → Needs fixes (Important #1 Doppel-Zeitplan nach Ablauf Idempotency-Key/Tageswechsel (Parameter ändern sich) → Doppelabbuchung; Important #2 Zurückziehen während Webhook → echter Zeitplan ohne Umstellung).
Task 11: Ruling #1: vor createSchedule in BEIDEN Pfaden findSchedule (Kunde + metadata.takeoverId, Status not_started/active, paginiert) → vorhandenen übernehmen — Spec-Anti-Ziel Doppelabbuchung — falls falsch: ein GET mehr.
Task 11: Ruling #2: unmittelbar vor createSchedule Status frisch laden (≠ link_sent → abbrechen ohne Zeitplan); nach dispatchEvents prüfen: Umstellung nicht set_up mit dieser scheduleId → Zeitplan in Stripe stornieren (POST /v1/subscription_schedules/<id>/cancel, invoice_now=false, prorate=false) + Audit „Zeitplan storniert: Umstellung inzwischen zurückgezogen“, Rückgabe 'ignored' — Spec 'nichts abbuchen ohne gültige Umstellung' — falls falsch: Inhaber legt neu an.
Task 11: Minor mitfixen: Rückgabe 'set_up' nur wenn wirklich set_up (#1); session.customer gegen stripeCustomerId prüfen (#2); findSchedule paginiert + Statusfilter (#3).
Task 11: fix round 1/5 done 15b4cf1 (neue Server-Ereignisse takeoverScheduleCanceled/takeoverCustomerMismatch; Concerns: verwaister Zeitplan bei withdrawn wird bei Wiederholung nicht storniert).
Task 11: Ruling fix round 2: Webhook für Umstellung withdrawn/aborted → findSchedule; offener Zeitplan mit dieser takeoverId → stornieren + Audit (idempotent, Fehler → 500, Stripe wiederholt) — deckt beide Concerns — falls falsch: ein GET mehr je Webhook auf erledigte Umstellung.
Task 11: fix round 2/5 done 7f74762 (withdrawn/aborted → offenen Zeitplan stornieren). Concern → Final-Review: Cancel-Idempotency-Key cached 500 bis 24h (evtl. Key weglassen, Storno ist über findSchedule-Filter natürlich idempotent). Re-review dispatched (opus).
Task 11: re-review Approved (opus).
Task 11: complete (commits 7424ba9..7f74762)
Task 11: minor (deferred → Final-Fix, Geldbezug): (1) !check.ok-Zweig: offene Zeitpläne suchen+stornieren; (2) takeover.ts:72 auch active mit gleicher scheduleId akzeptieren; (3) Storno-Key mit scheduleId bzw. ohne Key (cached 500); (4) Provider-Pfad ohne Race-Prüfung Zurückziehen; alte Minor 4–7 aus task-11-review.md.
Task 12: dispatched (BASE 7f74762, sonnet; B10,B11)
Task 12: implementer DONE_WITH_CONCERNS ca22581 (ungültige Seite 200 statt 404 wegen Suspense-Root/Cache Components; registry.ts Repos+Test-Schreiber auf globalThis; E2E stateful nur Desktop; auth-routes-Test einmal flaky). Remote meldet Umzug nach Yousif714/NEXUS-ASSISTENT.
Task 12: Ruling 404: 200 + identischer neutraler Inhalt + noindex akzeptiert (Spec-Kern „verrät nichts“ erfüllt; echter 404 bräuchte Route-Gruppen-Umbau aller Seiten) — falls falsch: Bots sehen 200, kein Datenleck. Backlog-Eintrag.
Task 12: Review dispatched (opus, Sicherheit).
Task 12: review → Needs fixes (Important #1 /api/test/takeover resetTestRepos zerstört parallele auth.spec → npm run e2e rot; #2 Testlücke Seite: 429, neutral bei erledigt/zurückgezogen, GET ohne Sitzung). Minor mitfixen: Service Worker nicht auf /zahlung; eigene neutrale Metadaten für /zahlung. Rest (job_runs-Last, x-forwarded-for, ganzer Stand je Aufruf) → Backlog.
Task 12: fix round 1/5 done 34ca8e8 (Playwright stateful-Projekte seriell; Seitentests; SW nicht auf /zahlung; neutrale Metadaten). npm run e2e 114 passed/0 failed. Re-Review durch Controller (Bericht + Diffstat) ok.
Task 12: complete (commits 7f74762..34ca8e8)
Task 12: backlog: 200 statt 404; job_runs rl:-Aufräumen + Last bei Flut; x-forwarded-for nur Vercel; ganzer Stand je Seitenaufruf.
Task 13: dispatched (BASE 34ca8e8, sonnet; B4,B8,B11 + Carry Demo-Link absolut, /nexus/umstellung#erinnerungen)
Task 13: implementer DONE_WITH_CONCERNS 8de2b2e (Moduswechsel schreibt Entwurf fort; keine TakeoverCard bei Bank nicht verbunden; neue Zeile NEXUS-Seite; Fehlgeschlagen/Unklar eigene Knöpfe statt ActionSheet). Review dispatched (opus, UI).
Task 13: review → Needs fixes (I1 Namen abgeschnitten /nexus/umstellung; I2 Zählung umstellbar Startseite vs. Umstellungsseite + Prädikat dupliziert → takeoverCandidates). Ruling: alle 11 Minor mitfixen (UI-Politur).
Supabase create_project: 2. Versuch Timeout (Rückfrage an Inhaber unbeantwortet).
Task 13: fix round 1/5 done 412952b (I1,I2 + Minor; E2E 118 grün; Screenshots vom Controller gesichtet ok).
Task 13: complete (commits 34ca8e8..412952b)
Final review: dispatched (opus, 168534e..412952b, inkl. aller deferred Minors)
Final review: Needs fixes (0 C, 3 I, 10 M jetzt; 23 Backlog). I1 Rückstands-Erinnerungen nach Einrichtung; I2 Neu-Freigabe/Retry ohne Abgleich → Doppelabbuchung; I3 Vertrag mit Plan korrigier-/löschbar + fehlende Sperrgründe.
Final fix: dispatched (opus, alle 13 + Backlog-Einträge)
Final fix: DONE 412952b..1b53318 (13 Punkte, 1398 Tests, E2E 118). Abweichungen: I3 sperrt ab link_sent; Knopf „Neu vorbereiten“; Storno ohne Idempotency-Key. Re-review dispatched (opus). Task 14 Docs dispatched (sonnet) parallel.
Final re-review: Needs fixes → Final-Fix 2 81039de (reminder-Entwürfe bei Stripe abbrechen; stale failed auch im Sperrfall aufgeben; m2/m3 Backlog). Controller-Check Diff ok. 1402 Unit, E2E 118 grün.
NÄCHSTER SCHRITT: Task 14 Testlauf (braucht Inhaber-Freigaben: Supabase-Projekt-Bestätigung, sk_test-Credential), danach PR nur mit Freigabe.

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
