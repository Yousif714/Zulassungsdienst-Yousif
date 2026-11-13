# Design: Lexware-Auftragsbestätigungen und Import ab Juni

**Stand:** 13.11.2026 · **Status:** vom Inhaber beauftragt („mach das bitte jetzt ganz schnell“). Kleine Änderung, die Calls von Claude stehen unten.

## Warum
- Laut Portal-Liste sind **24 von 43 Mitgliedern im Juli 2026** beigetreten. Der Import beginnt bisher am **01.08.2026** (`IMPORT_SINCE`). Juli-Rechnungen, Juli-Auftragsbestätigungen und Juli-Zahlungen fehlen deshalb komplett. Das ist der Hauptgrund für „nur 19 Vorschläge bei 43 Mitgliedern“.
- Der Inhaber schreibt in Lexware auch **Auftragsbestätigungen (AB)**, wenn ein Mitglied den Auftrag bestätigt hat. Für Mitglieder ohne Rechnung stehen die Konditionen oft nur dort.

## Festlegungen (Calls von Claude)
1. **Import ab 01.06.2026** (`IMPORT_SINCE = '2026-06-01'`) für Lexware, Stripe und Qonto.
   - Jeder Cursor speichert sein `since`.
   - Ist das `since` eines gespeicherten Cursors **später** als das aktuelle `IMPORT_SINCE` (oder fehlt es), startet die Verbindung einmal von vorn.
   - Doppelte Daten entstehen nicht, weil der Import über `connection + external_id` zusammenführt und bestehende Zahlungen gewinnen.
2. **Lexware-AB importieren:**
   - Belegliste `voucherType=orderconfirmation`, Status `any`, ab `IMPORT_SINCE`.
   - Detail über `/v1/order-confirmations/{id}`.
   - Gilt für NEXUS und Zulassung.
   - Feldnamen gegen die Doku prüfen. Fehler zeigen den Grund in Klammern, wie bei den Rechnungen.
   - Neue Phase im Lexware-Cursor nach den Rechnungen.
3. **Speicher:**
   - Neue Liste `orderConfirmations` (Typ `OrderConfirmation { id, company, connectionId, externalId, contactExternalId, contactId, number, totalCents, issuedOn, status, text }`).
   - Eigene Tabelle `order_confirmations` per idempotenter Migration (apply_changes wie zuletzt + neue Tabelle).
   - **ABs sind keine Forderungen:** keine offenen Beträge, keine Zuordnung von Zahlungen, keine Überfällig-Hinweise.
4. **Vertragsvorschläge:**
   - Eine AB mit „Mitgliedschaft“ und Laufzeit ist eine Quelle wie eine Mitgliedschafts-Rechnung.
   - Hat derselbe Lexware-Kontakt eine Mitgliedschafts-Rechnung, gilt die Rechnung. Sonst gilt die AB.
   - Ein Kontakt bekommt einen Vorschlag. Die Referenz lautet „Auftragsbestätigung AB-…“, die Quelle „Lexware (AB)“.
   - Gleiche Regeln wie bisher: „zum Monatsende“, wenn kein Tag angegeben ist.
5. **Portal-Status:**
   - Hat ein Mitglied eine AB, aber keine Rechnung, bekommt die Zeile den Hinweis „AB AB-… vorhanden, Rechnung fehlt“.
   - Mit Mitgliedschafts-AB entsteht ohnehin ein Vorschlag, Status also „Vorschlag offen“.
   - Ohne Mitgliedschaftstext zeigt die Zeile die AB-Nummern, wie bei „Rechnung ohne Mitgliedschaft“.
6. **Hinweis auf Heute:** „N Mitglieder mit Auftragsbestätigung, aber ohne Rechnung“ (Key `ab-ohne-rechnung`, ohne Datum).

## Nicht-Ziele
- Rechnungen aus ABs anlegen. Das macht der Inhaber in Lexware, ab Paket 2f vielleicht als Entwurf.

## Tests
- Mapper mit Fixtures.
- Connector-Phase mit Cursor.
- Cursor-Neustart bei geändertem `since`.
- Vorschlag aus AB, und die Rechnung schlägt die AB.
- AB ist nie eine Forderung.
- Portal-Hinweis.
- E2E: Test-Import mit AB, dann Vorschlag und Portal-Zeile.
