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

**Vor 2b-3 (Umstellung auf Stripe) fällig**
- Stripe-Rechnungen, die mehr als 35 Tage vor der Zahlung erstellt wurden, fehlen im Import. Das ergibt einen falschen Rückstand.
- Ein Streitfall ohne importierte Zahlung geht verloren und wird auch später nicht nachgeholt.
- Ein natürliches Abo-Ende (`cancel_at` erreicht) löst den Hinweis „Abo gekündigt“ aus.

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
