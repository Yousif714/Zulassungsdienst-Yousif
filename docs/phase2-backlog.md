# Phase 2 – offene Punkte aus Phase 1

Stand nach der Gesamtprüfung von Phase 1 (Vorschau mit Demo-Daten). Die Vorschau ist abgenommen. Diese Punkte sind bewusst verschoben.

## Architektur (vor echten Verbindungen erledigen)

1. **Aktionen aus den Seiten lösen:**
   - Heute lösen die Seiten Freigabe und Ausführung selbst aus (`approveAction` + `actionExecuted`).
   - Für Phase 2 braucht es einen Ausführer auf dem Server: `ActionProvider.execute(a, idempotencyKey(a))`, „Ausgang unklar“ → Abgleich, eine Oberfläche für Fehlgeschlagenes und Erneut-Versuchen.
   - Die Seiten lösen dann nur noch `approveAction` aus.
2. **KI austauschbar machen:**
   - `demoAI` wird in Seiten und in `src/domain/assistant.ts` direkt importiert. Das muss über einen Provider/Context injiziert werden.
   - `AIProvider` braucht asynchrone, toolbasierte Signaturen. Die KI bekommt nicht den ganzen `AppState`, sondern Daten nur über Tools.
   - `demoPaymentLink` kommt in die Domain bzw. hinter eine eigene Schnittstelle.
3. **Erinnerungs- und Antwort-Aktionen an einer Stelle erzeugen** (Fabrikfunktion in der Domain). Heute gibt es zwei Stellen: Mitgliedsseite und WhatsApp.
4. **Speicher:**
   - Supabase statt localStorage, mit Repositories pro Entität.
   - UUIDs statt `p-sim-n`/`am-n`.
   - Unique-Constraints auf (connection, external_id), `dedupe_key` und `job_run.key`.
   - Ein Schema-Version-Feld.
5. **Stripe:** Zuordnung Kunde → Vertrag. In der Demo sind die Stripe-Zahlungen im Seed fest zugeordnet.
6. **WhatsApp:**
   - Webhook-Signatur prüfen.
   - Absender auch bei Knopf-Rückrufen prüfen.
   - Den 24-Std.-Knopf gegen Server-Uhr und gespeicherten Ausstellungszeitpunkt prüfen.
   - Toleranz für Uhrabweichung einbauen.
7. **Briefing:** den `job_run`-Eintrag atomar anlegen, bevor gesendet wird. `dueRuns` an Vercel Cron anschließen.

## Vor echten Bank-, Mail- und Stripe-Daten

- Rückbuchungen bzw. Beträge ≤ 0 in `allocate` behandeln.
- Verträge beim Import prüfen: letzte Rate darf nicht negativ werden, Ausnahmen werden nach `from` sortiert.
- IBAN-Vergleich normalisieren (Leerzeichen, Groß-/Kleinschreibung).
- Stripe-Erkennung enger fassen („stripe“ im Verwendungszweck eines Mitglieds darf nicht reichen).
- Namensabgleich:
  - NFD und türkische Buchstaben (Çelik, Öztürk)
  - Titel wie „Dr.“
  - mehrdeutige Treffer nicht automatisch nehmen
- Telefonnummern: „(0)“ und reines „49“-Präfix.
- E-Mail-Abgleich über die exakte Adresse statt über Teilstring.
- Kennzeichen eines anderen Kontakts darf keinen Auftrag setzen.
- Zweite bzw. „bestimmte“ Erinnerung erlauben, solange dieselbe Rate offen bleibt. Die Erinnerungs-ID hängt heute an `oldestUnpaidDue`.
- Schlummern mit Weckzeit (`snoozeUntil`).
- Zusagen-Erkennung genauer machen: „Bitte schicken Sie mir die Rechnung“ ist keine eigene Zusage.

## Kleinigkeiten

- Auf Heute „Alles erledigt“ nicht anzeigen, wenn Hinweise wegen veralteter Daten ausgeblendet sind.
- `dataAsOf` im Briefing soll der älteste Abruf sein, nicht „jetzt“.
- Der Dedupe-Schlüssel für den Coach-Hinweis „Vor-Ort-Aufpreis“ ist zu instabil.
- Formulierungen: „1 Dinge heute“; „Er wartet“ bei einem Autohaus.
- Betragseingabe strenger machen und mit Obergrenze versehen.
- `globals.css` (ca. 1.700 Zeilen) aufteilen.
- Am Tag der Winterzeit-Umstellung den Sync nach UTC takten.
- `scripts/contrast.mjs` soll die Tokens aus dem CSS lesen.
- Testlücken: Schaltjahr, Monatsvorschau mit gelben Mitgliedern, Ändern → Senden im E2E.

## Entscheidungen aus Phase 1, die in Phase 2 nachgeschärft werden

- Ausführung im Reducer statt auf dem Server (siehe 1).
- Ein abgelehnter Hinweis bleibt innerhalb einer „Episode“ abgelehnt und kommt zurück, wenn das Problem später erneut auftritt. Ausnahmen: veraltete Quelle und unterdrückte Coach-Tipps.
- Fehlende Verbindungen gelten als „Datenstand zu alt“.

## Offen aus Paket 2a (Reviews, nicht merge-blockierend)

**Vor 2b/2f fällig**
- ~~Auftrag und Übernahme zeigen im Echtmodus „Demo“ im Kopf.~~ (erledigt in 2b-1)
- Antworttext „Gesendet (Demo)“ und Protokolltexte für echte Anbieter anpassen.
- Wenn das Speichern von `actionExecuted` dreimal am Konflikt scheitert, kommt der Fehler erst nach dem Anbieter-Aufruf. Der Sweep fängt das ab. Besser wäre ein eigener Retry nur für dieses Event.
- `recentJobRuns` und der Supabase-Client sind nur gegen Fake/Memory getestet: einmal `npm run test:integration` gegen „nexus-test“ laufen lassen.

## Offen aus „Rechnungen lesen“ (Claude)
- Monatslimit (100 €) in der Oberfläche änderbar machen.
- Kosten mit echtem Wechselkurs statt 1 $ = 1 € rechnen.
- Demo-Daten um einen von Claude gelesenen Vertrag ergänzen (Plakette im Demo-Modus sichtbar).
- Korrigieren und Löschen für alle Verträge, nicht nur für von Claude gelesene.
- Token-Kosten bei abgebrochener Antwort (max_tokens, kaputtes JSON) mitzählen.
- Prompt mit echten Rechnungstexten prüfen (erste Lesungen im Protokoll ansehen).
- Review-Minors: Claude-Antwort zur Laufzeit prüfen (Schema), `quote` fehlt → leer; Briefing ohne ruhende Verträge; ein Überfällig-Hinweis je Kontakt statt je Vertrag; Referenz-Zuordnung, wenn Lexware die Quellrechnung auf bezahlt setzt; Kosten und Limit in einer Währung; Löschen auch nach „Passt“; doppelte Lesekosten bei parallelen Läufen; nur in der App offene Rechnungen lesen; Hinweis „als bezahlt markiert“ mit Erledigen-Knopf.

## Offen aus dem Portal-Abgleich (Reviews, nicht merge-blockierend)
- `OPTIONAL_TABLES` in `src/server/db/supabase.ts` entfernen, sobald die Migration `20261115000000_portal.sql` sicher eingespielt ist.
- Automatischer Abgleich über die Portal-Supabase (Auth-Admin-API + `profiles`), sobald die Agentur URL und service_role-Schlüssel liefert. Bis dahin wird die Excel-Liste hochgeladen.
- `unignorePortalMember` prüft nur einen nicht leeren String (keine Längengrenze, keine Existenzprüfung).
- Übrige Minor-Punkte aus dem Abschlussreview (M1–M8): u. a. `t="d"`-Zellen, Zeitformate, Zip64 im XLSX-Leser, mehrere E-Mails in einer Freitextzeile, Demo-Test für `/nexus/mitglieder`.

## Offen aus Paket 2b-2 (Reviews, nicht merge-blockierend)

**Mit der ersten echten Qonto-Lieferung prüfen**
- Die Feldnamen sind nicht gegen die Doku geprüft (Konstanten `QF`/`QO`, „gegen Doku prüfen“). Zu prüfen:
  - ob die Gegenpartei-IBAN bei Eingängen mitkommt; fehlt sie, lernt die App nie eine IBAN,
  - welche `operation_type`-Werte eine Rückbuchung trägt; ein falscher Wert lässt die Originalzahlung fälschlich gutgeschrieben,
  - `local_currency` für Fremdwährung.

**Sonstiges**
- F12: Eine Gutschrift auf einer Rechnung, die später durch einen bestätigten Vertrag abgedeckt wird, bleibt bei der Rechnung. Der Vertragsrückstand ist dann zu hoch, bis der Inhaber die Zahlung neu zuordnet.
- Ein neues Qonto-Konto, das während eines Teillaufs vor dem Cursor einsortiert wird, verliert ältere Buchungen (3 Tage Überlappung). Das ist selten. Abhilfe: den Cursor zurücksetzen.
- `referenceHasNumber` ist asymmetrisch: „RE1101“ gespeichert findet „RE-1101“ im Verwendungszweck nicht.
- `dismissPayment` ist nicht auf Bank/NEXUS/Eingänge beschränkt.
- `linkBankReturns` wählt gierig in Eingabereihenfolge statt nach Datum.
- Testlücken:
  - Der next_page-Test braucht ein Aufruf-Limit.
  - Task 8: Payout-Test mit Stripe-Schlüssel, `sanitizeError` entfernt Login und Secret, `api-sync` mit `syncSecrets`.
- Schichtung: `ledger/receivables.ts` importiert aus `detectors/members`.
- E2E „Kommt als Upload“ ist nicht an die Sparkassen-Zeile gebunden.

## Offen aus Paket 2b-1 (Reviews, nicht merge-blockierend)

**Vor 2b-3 (Umstellung auf Stripe): erledigt am 13.11.**
- ~~Späte Zahlung alter Rechnungen~~: Der Cursor merkt sich offene und uneinbringliche Rechnungen (`pending`) und lädt sie einzeln nach, sobald sie nicht mehr offen sind. Rest: Rechnungen, die vor diesem Fix spät bezahlt wurden, kommen nur über einen Neustart ab IMPORT_SINCE nach (Cursor zurücksetzen).
- ~~Streitfall ohne Zahlung~~: Die Rechnung wird nachgeladen, außer die Zahlung ist schon importiert (`ctx.known`).
- ~~Natürliches Abo-Ende~~: Ist das bestätigte Enddatum erreicht, kommt kein Hinweis „gekündigt“.

**Vor Echtbetrieb prüfen**
- Die Stripe-Felder (API-Version `2025-09-30.clover`, `parent.subscription_details`, `/v1/invoice_payments`) und die Lexware-Felder und -Parameter (`sort=voucherDate,ASC`, voucherlist-Felder, `updatedDate`-Filter) sind nicht gegen die Doku geprüft, weil das Netz in der Session gesperrt war. Fehler zeigen sich als Verbindungsfehler, nicht als falsche Daten.

**Sonstiges**
- Eine Erstattung, die vor ihrer Zahlung gebucht ist, wird verworfen (nur bei Datenfehlern).
- Das Webhook-Body-Limit zählt Zeichen statt Bytes, wenn `content-length` fehlt.
- Retry nach 429 kann die Deadline überschreiten. Livelock, wenn das Budget kürzer ist als eine Erstattungsseite. Der `get`-Wrapper ist doppelt vorhanden.
- Ein Lexware-Statuswechsel ohne neues `updatedDate` kommt nicht an (hängt von Lexware ab).
- `loadInitial` ergänzt alte Demo-Stände nur flach: Neue Felder in `connections`/`settings` fehlen dort.
- E2E deckt die Ja/Nein-Frage bei reinem Namenstreffer nicht ab (nur Unit).

**Vor 2e fällig**
- Stürzt ein Tick nach `claimJobRun` ab, geht der Lauf verloren (kein Neuversuch).
- Der Sweep für hängende Ausführungen läuft nur in den 15-Min-Sync-Slots, nicht alle 5 Min.

**Sonstiges**
- `updateCounter` (Passkey-Zähler) ist nicht atomar. Alte `job_runs`-Zeilen werden nie gelöscht, `ran_at` hat keinen Index.
- `recover` hat keine Drosselung (Codes mit 50 Bit, unkritisch).
- „Neue Wiederherstellungscodes“ ohne Rückfrage. Kein Test für „Passkey hinzufügen“ und neue Codes. Login-Routen ohne eigene Unit-Tests.
- Heute-Hinweis „Noch nichts verbunden“ erscheint nur, wenn alle Verbindungen `missing` sind (`error` versteckt ihn).
- Doppelte Hilfen: `postJson`/`run` in Einstellungen und Anmelden, `norm()` in `src/ai/tools.ts` und `demo-ai.ts`.
- Session-500 ohne Anmelde-Flag führt zu Demo statt Offline. Fehler beim Schreiben des Flags führen fälschlich zu Offline.
- Architektur-Test erkennt keine dynamischen Importe. `api-guard` prüft nur per Textsuche.
- Die globale Demo-Leiste schiebt den Seitenkopf um ca. 44 px.
- Kleinkram: Import-Reihenfolge, schwache Assertions in einzelnen Tests.

## Offen aus Sparkasse-Upload (Reviews, nicht merge-blockierend)

**Abnahme nach Merge (Inhaber)**
- Je einen echten CSV- und CAMT-Export hochladen, Vorschau prüfen; `RETURN_TEXTS`, `RETURN_BANK_CODES`, `CSV_COLUMNS` und die Annahme „ganze Buchungstage“ gegen die echten Dateien prüfen; Hash-Gleichheit CSV/CAMT prüfen (CSV danach CAMT darf nichts doppeln). Ausdrücklich mit einer Sammelgutschrift und einer Rücklastschrift prüfen: CSV führt eine Sammelbuchung als eine Zeile (Sammlerreferenz), CAMT zerlegt sie je `TxDtls`; die Vorschau warnt nur (`batchBookings`), ein Abgleich fehlt.

**Funktion**
- Drag-and-drop fehlt (Spec 4.5 „wählen/ziehen“, umgesetzt nur Dateifeld).
- CSV-MT940 nicht umgesetzt (eigenes Format, kein Mehrwert ohne echte Datei).
- Sammelzahlung und „in Lexware bezahlt“ nur für Zulassung; NEXUS bei Bedarf nachziehen.
- Überzahlungs-Rest nur Anzeige, kein Ausblenden.
- „Alle offenen Rechnungen“ ohne Obergrenze; Engine lehnt > 50 ab (`MAX_SPLIT_INVOICES`), Option bei > 50 weglassen. Literal 50 in `state-service.ts` und `engine.ts` zu gemeinsamer Konstante.
- Sammelbuchung CSV/CAMT mit echter Datei abgleichen (CAMT-Sammler über Ntry-Schlüssel Datum | Summe | Sammlerreferenz gegen CSV-Zeile) oder Format je Zeitraum festschreiben; bis dahin nur Warnung in der Vorschau.
- Sammelzahlung auf Lexware-bezahlte Rechnungen → leere Auswahl: `matchMatches` mit zwei `paid`-Nummern liefert Kandidaten, `matchOptions` enthält nur offene Rechnungen (`PaymentCard.tsx:60`), `invoiceIds` scheitert in der Engine. Kandidaten aus `match.candidates` immer als Option zeigen und mit `invoiceAllocatableCents` verteilen.
- Rückbuchung auf eine in Lexware bezahlte Rechnung öffnet sie nicht wieder (`invoiceOpenCents` = 0 bei `paid`, Spec 4.7 „wieder offen“): bewusst, Lexware führt.
- `customerPayments` beschriftet jede Allocation auf eine heute `paid`-Rechnung mit „in Lexware schon bezahlt“, auch wenn sie zugeordnet wurde, als die Rechnung noch offen war (`selectors.ts:170`); nur Text.
- „Alle offenen Rechnungen“ (`allOpenInvoiceOptions`) in `PaymentCard.tsx` gehört als Selektor neben `matchOptions`.
- Sortierung uneinheitlich: `customerOpenInvoices` `localeCompare` ohne `'de'`, `distributeOldestFirst` mit `'de'`.
- `shortDateDe` liegt in `import/statement.ts`, genutzt von `detectors/sources.ts` und `components/connection-labels.ts`; gehört nach `clock.ts` (neben `formatIsoDe`).
- ZIP mit fremden `.xml`-Einträgen (`__MACOSX/._auszug.xml`, camt.052) lässt den Upload mit „kein Sparkassen-Auszug“ scheitern; `__MACOSX/` und `._` ignorieren, nur abbrechen, wenn keine Datei lesbar ist.
- `new Date(Date.UTC(...))` in `parseDeDate`/`camtDate` (`import/sparkasse.ts`): gemeinsamer `isValidIsoDate` in `clock.ts`, den auch `state-service.ts` (`isBookingDate`) nutzt.
- Rückbuchung trifft bei gleicher Fälligkeit die ältere Rechnung zuerst; Tie-Break nach Nummer absteigend.
- CAMT `RvslInd=true` bei CRDT (Storno einer Ausgabe) wird als Kundenzahlung importiert; `Amt`-Fallback kann `AmtDtls/InstdAmt/Amt` greifen; selbstschließendes `<Ustrd />` (xml.ts) verschluckt das nächste Element; `account` nur von der ersten Datei im ZIP, keine Warnung bei abweichendem Konto.
- `bookedOn`-Obergrenze nutzt echte Uhr statt Demo-Uhr; Obergrenze heute+1 Tag, 7-Tage-Hinweis höchstens 1 Tag zu spät.
- Engine zählt verworfene Rückbuchungen ohne Original als „schon vorhanden“; Upload nur aus solchen setzt Verbindung `connected` mit `cursor: null`.
- `iban` im Event nur Länge ≤ 34, kein Format.
- Demo: `StatementUpload` setzt `busy` ohne `try/finally`; Demo-Dispatch liefert kein `ok` (abgelehnter Import zeigt „0 neu“). Verbindungen zeigt für Sparkasse noch „So verbindest du das (Phase 2)“ (`HOW_TO.bank_sparkasse`).

**Aufräumen und Tests**
- Dedupe-Filter mit Komma-Ausdruck in `parseSparkasse` schwer lesbar; `SkipReason 'zero'` UI-Text; „zu groß“-Text für Mitglieder neutraler; `createKeyer` wiederholt Basis-Normalisierung von `statementKey` (gemeinsame `keyBase()`); `const n` verdeckt `forEach`-Index.
- Selektoren: `customerInvoiceRows` rechnet `invoiceOpenCents` doppelt (O(n²)); `invoicePaidCents` bei abdeckendem Vertrag undokumentiert; `partlyAllocatedPayments` nicht auf Bank beschränkt; `statementSummary` O(n·m), `returnIds` O(n²).
- `PaymentCard`: Optionswert-Kopplung der `invoices`-Option über String fragil.
- Testlücken: Überzahlung bei Verteilung (`invoiceIds`); Regel 1 mit `paidInLexware`-Treffer; umgekehrte Firmengrenze in `confirmPaymentMatch`; Kontext-NEXUS-Test nur `every`; CAMT-Rückbuchung = CSV-Schlüssel; mehrere `Stmt`; Rangfolge `expense` vs. `before_since`; Doppel-externalId im selben Event; E2E `toContainText('0')` zu schwach (`zulassung.spec.ts`); `briefing.test.ts` ggf. vakuum.
- Prozess: Task 5 ohne TDD-Reihenfolge (RED nachträglich belegt).


## Offen aus 2b-3 Stripe-Umstellung (Task-Reviews, fürs Gesamtreview)
- Echtbetrieb ohne Ergebnisdaten: Aktion steht auf „ausgeführt“ ohne Umstellung, sichtbar nur im Protokoll.
- `endedAsAgreed` steht doppelt (`takeover/link.ts`, `detectors/subscriptions.ts`) → Helfer.
- Reguläres Abo-Ende ohne `schedule`/`cancel_at` ergibt `endDate = null` und damit einen Fehlalarm. Im Stripe-Testmodus prüfen, ggf. `ended_at` nutzen.
- Tag-31-Läufe erzeugen zusätzliche Lücken-Phasen (Beträge stimmen). Stripes Phasen-Obergrenze beachten.
- Zurückziehen geht nur, bis der Zeitplan angelegt ist. Ein vor dem Start in Stripe gekündigter Zeitplan fällt der App nicht auf.

- Umstellung (Task 13, M10): „Später“ bei Erinnerungen in `/nexus/umstellung` blendet nur lokal aus; nach dem Senden verschwindet das Sheet ohne sichtbare Bestätigung.

## Offen aus 2b-3 (Gesamtreview)
Erledigt im Final-Fix (14.11.): I1–I3, M1–M10 (Erinnerung trotz Stripe, Neu-Freigabe mit altem Plan, Vertrag mit Plan änderbar, Webhook-Ränder, Storno-Key cachte 500, `checkAction`, Lookup ohne Zeitplan, tote Link-Nachfragen, doppeltes Abo-Prädikat, Demo-Knopf/-Link im Echtbetrieb, Ende ohne Stripe-Enddatum).
- Settings-Literal in `seed.ts` doppelt zu `DEFAULT_SETTINGS`; Migrationstest prüft nicht, dass vorhandene Einstellungswerte erhalten bleiben; Einstellungsformular lässt 0/Dezimal für die Erinnerungstage zu (Server lehnt ab).
- `takeoverAction` bekommt `mode` getrennt, obwohl `plan.mode` ihn schon trägt.
- Plural in Audit-Texten: „1 Umstellungen vorbereitet“, „Sammelfreigabe: 1 Aktionen“.
- Abo-Ende nach der letzten bezahlten Rate, aber vor dem Planende (vom Mitglied gekündigt): Status „abgebrochen“ ist irreführend, obwohl nichts mehr offen ist (seit M10 nur noch, wenn doch etwas offen ist).
- Umstellung bleibt dauerhaft „eingerichtet“, wenn das Abo beim ersten Abgleich schon gekündigt ist oder der Zeitplan vor dem Start storniert wurde: Hinweis „eingerichtet, aber kein Abo X Tage nach erstem Planstart“ (heute fängt nur `member_overdue` das auf).
- Umstellung ohne `stripeCustomerId` (Altbestand/Fehler) wird nie verknüpft; Sperrgrund „Stripe-Lesezugang nicht verbunden“, wenn der Schreib-Schlüssel da ist, `stripe_nexus` aber nicht verbunden.
- Preis-Hinweis bei Plan-Abos zeigt „bestätigt: unbekannt“; stattdessen die Plan-Preise nennen.
- `double_payment` prüft ab `setUpAt`: Überweisung, die vor der Einrichtung gebucht, aber erst danach importiert wurde, bleibt ohne Hinweis (nur Guthaben im Ledger); ab Link-Versand prüfen.
- `checkCompletion` vergleicht nur die Summe: gleiche Summe bei anderer Verteilung (Zahlung plus Vertragsänderung) wird mit alten Fälligkeiten eingerichtet.
- Provider-Pfad: Phasen mit `o.now()`, `confirmedEndDate` mit `setUpAt` → um Mitternacht ein Tag Versatz möglich; Planende besser an der Umstellung speichern.
- Provider-Pfad: Zurückziehen der alten „Plan geändert“-Umstellung während der Neu-Freigabe wird nicht gegengeprüft (neue Freigabe gilt trotzdem).
- `ensureTakeoverDrafts` bricht offene Umstellungs-Entwürfe ab, sobald ein Sperrgrund kurz greift (z. B. Bank vorübergehend nicht verbunden); vorbereitete „Alle umstellen“ gehen still verloren.
- Sammelfreigabe vieler Umstellungen läuft im selben Request nacheinander (je Kunde Suche + Anlage); bei Zeitlimit landen Reste in „Ausgang unklar“. Ausführung entkoppeln oder in Häppchen.
- Demo-Umstellungen im Echtbetrieb (ohne Schreib-Schlüssel) liefern ihren Demo-Link in Erinnerungen und Link-Nachfragen (der Demo-Fallback ohne Umstellung ist seit M9 weg).
- Demo-Briefing: 6 `rate_upcoming`-Hinweise und Entwürfe am selben Tag nicht gebündelt.
- Stripe-Kundensuche ist nicht sofort konsistent (bis ~1 Min.): Zwei Versuche kurz nacheinander können zwei Kunden je Vertrag anlegen.
- `scheduleParams` mit leeren Phasen wirft `TypeError` (heute durch `checkCompletion`/Sperrgrund ausgeschlossen); `encodeForm` lässt leere Arrays weg und schreibt `NaN`; Kundensuche entfernt Anführungszeichen still aus der Vertrags-ID.
- `getActionProvider()` baut je Aufruf einen neuen Stripe-Schreiber (kein gemeinsamer Drosselzustand).
- Spec 12 um `simulatedFor` (Ausführer je Aktion Demo/echt) ergänzen.
- Zahlungsseite: `/zahlung/<ungültig>` antwortet 200 statt 404 (neutraler Inhalt, `noindex`); `rl:`-Zeilen in `job_runs` werden nie aufgeräumt, die Ratenbegrenzung schreibt bei einer Flut bis zu 20 Zeilen je abgewiesenem Aufruf; `x-forwarded-for` ist nur hinter Vercel verlässlich; jeder Seitenaufruf lädt den ganzen Stand.
- `takeoverRows` rechnet `memberView` je Zeile doppelt.
- Testlücken: Stripe-Zahlung nach der Umstellung tilgt die Plan-Raten (Status grün, kein Rückstand); aufgeteilte Zahlung bei `double_payment`; Erinnerungen nach `aborted` laufen wieder; Executor/Reducer mit vorhandenen Auto-Entwürfen; 401-Test im Writer schwach; `webhook-stripe.test.ts` „gleichzeitig“ prüft `>= 1` statt der exakten Anzahl; E2E echter Modus (Fixture-Stripe) für „Plan geändert“ → Neu-Freigabe ohne Link.
- `member_overdue` bei laufender Stripe-Abbuchung erscheint sofort ab Fälligkeit (nur `nextStep` „In Stripe prüfen“); ggf. erst X Tage nach Fälligkeit bzw. bei `past_due` melden.
- Zurückziehen ist ab „eingerichtet“ nur in Stripe möglich (Zeitplan dort kündigen); kein Knopf in der App.
