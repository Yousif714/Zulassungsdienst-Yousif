# Design-Spec Paket 2b: Geld

**Stand:** 12.11.2026 · **Status:** Entwurf, wartet auf Freigabe des Inhabers
**Baut auf:** `2026-11-12-phase2-design.md` (Abschnitte 1 und 3) und `2026-11-12-nexus-assistent-design.md` (Regeln 4a gelten unverändert). Offene Punkte: `docs/phase2-backlog.md`.

## 1. Warum
Im Echtmodus ist die App heute leer. Kernziel 1 („Wer schuldet wie viel?“) braucht echte **Verträge** und echte **Zahlungen**. Die Vertragsdaten der Mitglieder stehen laut Inhaber in **Stripe** und **Lexware**. Sie sollen nicht von Hand eingetippt werden: Die App schlägt Verträge vor, der Inhaber bestätigt.

## 2. Ziele, Nicht-Ziele, Anti-Ziele
**Ziele**
- Stripe NEXUS, Lexware NEXUS und Lexware Zulassung werden lesend und regelmäßig abgeglichen.
- Aus Stripe-Abos und Lexware-Rechnungen entstehen **Vertragsvorschläge**. Der Inhaber bestätigt jeden Vorschlag mit einem Tipp und kann ihn vorher korrigieren.
- Stripe-Zahlungen landen als Zahlungen im Ledger und werden ihrem Abo-Vertrag sicher zugeordnet.
- Danach (2b-2): Qonto per API, Sparkasse per CAMT/CSV-Upload und die Härtung der Zuordnung.

**Nicht-Ziele**
- Schreiben in Stripe oder Lexware (Stripe-Plan anlegen, Lexware-Entwurf) kommt in 2f.
- Mail, Kalender, Claude und WhatsApp.
- Eine Eingabemaske für API-Schlüssel in der App.

**Anti-Ziele** (das wäre ein Fehlschlag, auch wenn es technisch läuft)
- Ein Vertrag entsteht ohne Bestätigung des Inhabers.
- Ein Betrag wird doppelt gutgeschrieben, z. B. Stripe-Zahlung und Stripe-Auszahlung auf Qonto.
- Ein Sync-Fehler löscht oder überschreibt bestätigte Daten.
- Ein Geheimnis landet in der Datenbank, im Client oder im Protokoll.

## 3. Ansätze (entschieden)
| Weg | Inhalt | Bewertung |
|---|---|---|
| A – Bank zuerst | 2b-1 Qonto/Sparkasse/Härtung, 2b-2 Stripe/Lexware/Übernahme | Echte Buchungen sind schnell sichtbar, aber ohne Verträge bleibt fast alles „nicht zugeordnet“. |
| **B – Verträge zuerst** | **2b-1 Stripe, Lexware, Vertragsvorschläge. 2b-2 Qonto, Sparkasse, Zuordnungs-Härtung** | **Gewählt.** Nach 2b-1 stehen alle Mitglieder mit echten Verträgen drin, und die Stripe-Mitglieder sind sofort korrekt. 2b-2 ordnet dann Überweisungen bestehenden Verträgen zu. |
| C – Alles in einem PR | wie B, nur ein PR | Zu groß für ein sicheres Review. |

Der Inhaber hat die Wahl an Claude übergeben, Claude hat B gewählt.

## 4. Festlegungen
### 4.1 Vom Inhaber
- Die Vertragsdaten stehen in Stripe und Lexware.
- Stripe-Ratenzahlung = **Abo mit festem Enddatum**.

### 4.2 Calls von Claude (korrigierbar)
- **Schlüssel als Vercel-Variablen** (nur Production): `STRIPE_RESTRICTED_KEY`, `STRIPE_WEBHOOK_SECRET`, `LEXWARE_NEXUS_API_KEY`, `LEXWARE_ZULASSUNG_API_KEY`. Eine Verbindung ohne Schlüssel bleibt `missing`. Ein fehlender Schlüssel ist kein Startfehler (`readEnv` bleibt grün).
- **Abruf:** Lexware wird im 15-Min-Sync-Slot des Crons abgefragt (Rate-Limit 2 Anfragen/s beachten). Stripe meldet sich per Webhook (`/api/webhooks/stripe`, Signaturprüfung) und wird zusätzlich im 15-Min-Slot abgeglichen.
- **Rückblick:** Beim ersten Lauf wird alles ab 01.08.2026 geladen, danach inkrementell (z. B. nach `updatedDate` bzw. `created`).
- **Lexware-Rechnungen:** Erkannt werden beide Varianten, eine Gesamtrechnung oder eine Rechnung pro Rate. Was sich nicht sicher ablesen lässt, ist im Vorschlag leer bzw. markiert und wird vom Inhaber ergänzt.
- **Mitglied vs. Kunde:** Nur Lexware NEXUS erzeugt Vertragsvorschläge. Lexware Zulassung liefert Rechnungen und Kontakte für Aufträge und offene Rechnungen, aber keine Verträge.

## 5. Ablauf
```
Cron-Slot / Stripe-Webhook
  → Connector (server, fetch)          src/server/connectors/{stripe,lexware}.ts
  → Mapper (rein, Domain)              src/domain/import/{stripe,lexware}.ts
  → Import-Event in den State          über commit() + mergeImported (Schlüssel = connection + external_id)
  → refresh(): Zuordnung, Ledger, Hinweise
  → Vorschläge (rein abgeleitet)       src/domain/import/proposals.ts
```
- **Connectors** holen und blättern Seiten durch, **Mapper** sind reine Funktionen von API-JSON auf Domain-Typen. Nur die Mapper enthalten Fachlogik.
- Verbindungsstatus: Erfolg → `connected` + `lastSuccessAt`. Fehler → `error` + `lastError` (ohne Geheimnisse). Der letzte Datenstand bleibt erhalten. Nach 3 Fehlversuchen kommt ein Hinweis (Spec 6).

## 6. Datenmodell (Erweiterung)
- **`subscriptions`** (neu, importiert): `{ id, connectionId:'stripe_nexus', externalId, stripeCustomerId, customerName, customerEmail, amountCents, interval:'month', startDate, cancelAt, status, contractId|null }`.
- **`Contact`** bekommt optionale Herkunft (`externalRefs: { connectionId, externalId }[]`), damit Lexware-Kontakte und Stripe-Kunden demselben Mitglied zugeordnet werden können.
- **`MemberContract`** bekommt eine optionale Herkunft (`origin: { connectionId, externalId }[]`). Ein bestätigter Vertrag wird beim nächsten Sync **nie** überschrieben.
- **Vorschläge werden nicht gespeichert**, sondern aus `subscriptions`, `invoices` und `contacts` abgeleitet. Gespeichert werden nur Entscheidungen: bestätigt (→ Vertrag mit `origin`) oder verworfen (`dismissedProposals: string[]`).
- **Stripe-Zahlungen:** Jede bezahlte Abo-Rechnung wird eine `Payment` (`source:'stripe'`, `externalId` = Stripe-Rechnungs-ID). Gehört das Abo zu einem bestätigten Vertrag, wird die Zahlung mit `method:'auto'` zugeordnet (sichere Verknüpfung über das Abo). Auszahlungen (`payout`) werden nie gutgeschrieben.
- Supabase: neue Tabelle(n) per Migration, analog `tables.ts`, mit Unique-Constraint (connection_id, external_id).

## 7. Vertragsvorschlag
- **Aus Stripe-Abo:** Rate = Abo-Betrag. Anzahl = Abrechnungsperioden von Start bis `cancel_at`, alternativ aus einem Subscription Schedule. Fälligkeitstag = Tag des Abrechnungsankers. Start = Abo-Start. `billing:'stripe'`. Gesamt = Rate × Anzahl.
- **Aus Lexware NEXUS:** Rechnungen pro Kontakt gruppieren.
  - Mehrere gleich hohe Rechnungen im Monatsabstand → Rate, Anzahl und Start daraus.
  - Eine Gesamtrechnung → Gesamtbetrag. Raten und Fälligkeitstag aus dem Text, wenn eindeutig erkennbar, sonst leer.
  - `billing:'legacy'`.
- **Zusammenführen:** Haben ein Stripe-Kunde und ein Lexware-Kontakt dieselbe E-Mail (exakt, kleingeschrieben) oder denselben normalisierten Namen, wird **ein** Vorschlag mit beiden Quellen gezeigt. Bei unsicherem Namens-Treffer werden zwei Vorschläge gezeigt, mit dem Hinweis „gehört evtl. zu …“. Es wird nie automatisch zusammengeführt.
- Jeder Vorschlag zeigt seinen **Rechenweg** (Quelle, Rechnungen bzw. Abo) und eine **Sicherheit** (vollständig / bitte ergänzen).

## 8. Oberfläche
Auf **Mitglieder** erscheint oben eine Karte, solange Vorschläge offen sind:
```
┌ 12 Verträge zum Bestätigen ─────────────── › ┐
```
Die Seite **Mitglieder › Vorschläge** zeigt eine Karte pro Vorschlag:
```
Ayşe Öztürk                         Stripe + Lexware
1.200 €  ·  4 × 300 €  ·  am 1.  ·  ab 01.09.2026
Quelle: Abo sub_…, Rechnungen RE-1043, RE-1051
[Bearbeiten]                 [Verwerfen] [Übernehmen]
```
- „Bearbeiten“ öffnet dieselben Felder wie die Übernahme. „Übernehmen“ legt Vertrag und Kontakt an und führt zur bestehenden Übernahme-Seite (Rückstand, Nachzahlungsmodus).
- Design-Bausteine aus `src/components` wiederverwenden, keine neue Optik.
- Die Seite **Verbindungen** zeigt je Verbindung den Status, „Stand vor …“ und den letzten Fehler im Klartext.
- Backlog „Vor 2b“: Auftrag und Übernahme zeigen im Echtmodus nicht mehr „Demo“ im Kopf.

## 9. Sicherheit
- Restricted Key nur lesend (Customers, Subscriptions, Invoices, Charges). Der Webhook prüft `Stripe-Signature` mit Zeittoleranz und verarbeitet idempotent (Event-ID).
- Schlüssel nur serverseitig (`server-only`), nie in State, Protokoll oder Fehlertexten.
- Die Webhook-Route ist vom Login ausgenommen, alles andere bleibt hinter der Sitzung.

## 10. Tests
- Mapper: Unit-Tests mit Fixture-JSON (Stripe-Abo mit `cancel_at`, mit Schedule, gekündigt; Lexware Gesamtrechnung, Ratenrechnungen, Storno).
- Vorschläge: Ableitung, Zusammenführen, verworfen bleibt verworfen, bestätigt wird nie überschrieben.
- Connectors: Blättern, Fehler → `error`, kein Geheimnis im Fehlertext. `fetch` wird gefälscht, es gibt keine echten Aufrufe in Tests.
- Webhook: gültige und ungültige Signatur, doppeltes Event.
- E2E: Vorschläge bestätigen im Echtmodus gegen die Memory-DB mit gefälschtem Connector. Die bestehende Demo-Suite bleibt grün.

## 11. Paket 2b-2 (Kurzfassung, eigenes Design-Update vor dem Bau)
- Verbindung `bank` wird aufgeteilt in `bank_qonto` (NEXUS, API) und `bank_sparkasse` (Zulassung, Upload).
- Qonto: Transaktionen per API, `external_id` = Transaktions-ID.
- Sparkasse: CAMT.053 bevorzugt, sonst CSV. `external_id` aus der Bankreferenz oder einem Hash.
- Härtung aus Backlog und Spec 3: IBAN, Beträge ≤ 0, Stripe-Erkennung, Namen (NFD, Türkisch, Titel), Mehrdeutigkeit, Vertragsprüfung.

## 11a. Nach Prüfung (Builder-Check)
**Calls von Claude**
- **Rückwirkend zuordnen:** Beim Bestätigen werden alle schon importierten Stripe-Zahlungen des Abos dem Vertrag zugeordnet (`auto`). Der Rückstand auf der Übernahme-Seite kommt aus dem Ledger und wird nie eingetippt. Stripe-Zahlungen von unbestätigten Abos erzeugen keinen `unmatched_payment`-Hinweis, sie zählen als „wartet auf Vorschlag“.
- **Legacy ohne Bank:** Bis `bank_*` verbunden ist (2b-2), zeigen `legacy`-Verträge „Bank nicht verbunden“ statt Rückstand. Der Mechanismus ist der bestehende über `needsSources`/`notConnected`. Bezahlte Lexware-Rechnungen sind keine Gutschrift (Regel 4a: Gutschriften nur aus Zahlungen).
- **Beträge:** Rate = tatsächlich gezahlter Betrag der Abo-Rechnungen (`amount_paid`, brutto, nach Rabatt). Nur EUR und Monatsintervall gelten als „vollständig“, alles andere als „bitte ergänzen“.
- **Abo ohne Enddatum** (weder `cancel_at` noch Schedule): Vorschlag mit leerer Anzahl („bitte ergänzen“).
- **Nach Bestätigung:** Kündigung, Preisänderung, `past_due`, Erstattung und Chargeback erzeugen nur einen Hinweis, der Vertrag bleibt unverändert. Erstattungen werden als Zahlung mit Betrag < 0 importiert und wie im Backlog-Punkt „Beträge ≤ 0“ behandelt. Diese Härtung von `allocate` wird für diesen Fall in 2b-1 vorgezogen.
- **Kontakt-Wiederverwendung:** zuerst über `externalRefs`, dann über die exakte E-Mail (kleingeschrieben). Bei reinem Namenstreffer fragt die Karte „Ist das … ?“ mit Ja/Nein.
- **Stripe-Rechnungen** werden nur als `Payment` + `subscriptions` gespeichert, nicht als `Invoice`. `stripe_paid_lexware_open` bleibt bis 2b-2 Demo-Logik.
- **Erstimport fortsetzbar:** Fortschritt je Verbindung (Cursor) wird gespeichert. Ein Lauf bricht vor dem Vercel-Zeitlimit ab und macht im nächsten Slot weiter.
- **Vorschlags-ID** = sortierte Quellschlüssel (`connection:external_id`). Ein verworfener Vorschlag bleibt verworfen. Kommt eine neue Quelle hinzu (z. B. ein neues Abo), entsteht eine neue ID und damit ein neuer Vorschlag.

**Offen beim Inhaber**
1. Woran erkennt man eine Mitgliedschaft in Stripe bzw. Lexware NEXUS? Vorschlag, falls unbekannt: alle Stripe-Abos mit Enddatum und alle Lexware-NEXUS-Rechnungen. Falsches verwirft der Inhaber einmal.
2. Umgestellte Mitglieder: Deckt das Stripe-Abo nur den Restbetrag ab (→ ein zusammengeführter Vertrag) oder ist es ein neuer Vertrag (→ zwei)?

## 12. Dem Bauenden überlassen
- Genaue API-Felder und Endpunkte (vorher in der aktuellen Doku prüfen).
- Tabellenschnitt in Supabase.
- Schwellwerte für „gleich hohe Rechnungen im Monatsabstand“.
- Reihenfolge der Tasks im Plan.
