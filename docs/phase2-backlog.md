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
