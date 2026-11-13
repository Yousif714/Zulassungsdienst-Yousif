# Design-Spec Paket 2b-2: Qonto und Zuordnung

**Stand:** 13.11.2026 · **Status:** Entwurf, wartet auf Freigabe
**Baut auf:** `2026-11-12-phase2b-design.md` (Abschnitt 11) und Paket 2b-1 (live). Die Regeln aus Spec 4a gelten unverändert.

## 1. Warum
Überweisungs-Mitglieder zeigen „Bank nicht verbunden“. Ohne Kontodaten weiß die App nicht, wer wie viel gezahlt hat. Davon hängen zwei Dinge ab: Kernziel 1 („Wer schuldet wie viel?“) und Paket 2b-3, weil der Restbetrag im Stripe-Link stimmen muss.

## 2. Ziele, Nicht-Ziele, Anti-Ziele
**Ziele**
- Qonto (NEXUS-Konto) wird alle 15 Min. und über „Jetzt abgleichen“ gelesen: alle Buchungen ab 01.08.2026.
- Eingehende Überweisungen werden Mitgliedsverträgen zugeordnet. Die erste Zahlung pro Mitglied bestätigt der Inhaber einmal auf „Zuordnen“, danach wird automatisch über die gelernte IBAN zugeordnet.
- Die Zuordnung wird vor echten Bankdaten gehärtet (Backlog „Vor echten Bank-, Mail- und Stripe-Daten“).

**Nicht-Ziele**
- Sparkasse-Upload (CAMT/CSV) kommt als eigener PR danach (2b-2b).
- Abgleich mit dem NEXUS-Portal (Mitgliederliste) ist eigenes Thema, siehe Abschnitt 8.
- Kein Schreiben bei Qonto.

**Anti-Ziele**
- Eine Stripe-Auszahlung auf Qonto wird als Mitgliedszahlung gutgeschrieben (doppelt gezählt).
- Bei mehreren möglichen Treffern wird automatisch zugeordnet.
- Ein Schlüssel landet in DB, Client oder Protokoll.

## 3. Ansätze (entschieden)
| Weg | Bewertung |
|---|---|
| **A – Erst Qonto + Härtung, Sparkasse danach** | **Gewählt (Inhaber).** Liefert am schnellsten echte Mitgliedsrückstände und ist Voraussetzung für 2b-3. |
| B – Qonto und Sparkasse zusammen | Größerer PR, NEXUS-Zahlen kommen später. |
| C – Sparkasse zuerst | Bringt nur dem Zulassungsdienst etwas. |

## 4. Festlegungen
**Vom Inhaber**
- Im Verwendungszweck steht meist nur „Mitgliedschaft“, „Nexus“, „Monatsbeitrag“ oder nichts. Deshalb wird über Name, Betrag und IBAN zugeordnet, nicht über eine Rechnungsnummer.

**Calls von Claude (korrigierbar)**
- **Verbindungen:** `bank` wird ersetzt durch `bank_qonto` (NEXUS) und `bank_sparkasse` (Zulassung, bleibt bis 2b-2b `missing`). Bestehende Daten mit `bank` werden migriert. `contractSources`/`notConnected` für Legacy-Verträge prüfen `bank_qonto`.
- **Schlüssel:** `QONTO_LOGIN` und `QONTO_SECRET_KEY` als Vercel-Variablen, nur Production, optional. Header `Authorization: <login>:<secret-key>`, Basis `https://thirdparty.qonto.com/v2`. Feldnamen gegen die aktuelle Doku prüfen.
- **Abruf:**
  - Erst `/organization` für die Konto-IDs (nur das Hauptkonto bzw. alle Konten der Organisation), dann `/transactions?bank_account_id=…&status[]=completed&settled_at_from=…`.
  - Blättern mit Cursor wie bei Lexware, gleiche Drossel und gleiches 429-Verhalten (`RateLimited`).
  - `external_id` = Qonto-`transaction_id`.
- **Nur Eingänge:** `side = credit` wird importiert. Ausgänge bleiben weg. Eine Rückbuchung einer Lastschrift ist ein Ausgang, sie wird als negative Zahlung importiert, wenn sie sich auf eine importierte Zahlung bezieht. Sonst wird sie ignoriert.
- **Stripe-Auszahlung erkennen:** Gegenpartei oder Verwendungszweck enthält „STRIPE“ **und** der Absender ist Stripe (Name „Stripe“ / „Stripe Payments“, keine Mitglieds-IBAN). Ein „Stripe“ im Verwendungszweck eines Mitglieds reicht nicht. Auszahlungen bekommen `kind: 'stripe_payout'` und werden nie gutgeschrieben.

## 5. Zuordnung (Härtung)
- **IBAN** wird normalisiert (Leerzeichen raus, Großbuchstaben) beim Import, beim Verknüpfen und beim Vergleich.
- **Beträge ≤ 0** werden in `matchBankPayment` nie einem Vertrag als Gutschrift vorgeschlagen.
- **Namen:**
  - NFD und türkische Buchstaben sind seit 2b-1 abgedeckt.
  - Firmen-Zusätze (GmbH, UG, e.K., GbR, „und“) werden beim Vergleich ignoriert.
  - Ein Vertrag über eine Firma passt auch zum Namen des Ansprechpartners, wenn Lexware ihn als Kontaktperson führt.
- **Betrag passt:**
  - genau die Rate,
  - ein ganzzahliges Vielfaches der Rate bis zum offenen Betrag,
  - genau der Rückstand,
  - oder genau der offene Betrag.
  - Toleranz 0 Cent.
- **Mehrdeutig:** Passen mehrere Verträge, entsteht immer nur ein Vorschlag mit Auswahl, nie eine automatische Zuordnung.
- **Lernen:** Bestätigt der Inhaber, wird die IBAN mit dem Kontakt verknüpft (`IbanLink`). Ab dann gilt: gleiche IBAN plus passender Betrag → automatisch. Gleiche IBAN mit abweichendem Betrag → Vorschlag.
- **Telefon und E-Mail** (Backlog) betrifft Nachrichten, nicht Bank. Bleibt im Backlog.

## 6. Oberfläche
- **NEXUS → Zuordnen** (gibt es schon):
  - zeigt echte Qonto-Eingänge ohne sicheren Treffer,
  - Vorschläge mit „Ja, gehört zu …“ (ein Tipp, lernt die IBAN), Auswahl bei Mehrdeutigkeit,
  - „Keine Mitgliedszahlung“ (blendet die Buchung aus, kommt nicht wieder).
- **Heute:** Hinweis „N Zahlungen zuordnen“, solange offene Eingänge da sind (Hinweis `unmatched_payment` gibt es schon).
- **Verbindungen:** „Qonto (NEXUS)“ mit Status. „Sparkasse (Zulassung)“ zeigt „kommt als Upload“.
- **Mitglieder:** Legacy-Verträge zeigen nach dem ersten Qonto-Abgleich echte Rückstände.

## 7. Tests
- Qonto-Mapper mit Fixture-JSON: Eingang, Ausgang, Stripe-Auszahlung, Rückbuchung, Fremdwährung (wird übersprungen).
- Connector: Blättern, Cursor, 429, Fehler ohne Schlüssel.
- Zuordnung:
  - IBAN-Schreibweisen
  - Firmen-Zusätze
  - Vielfache der Rate
  - mehrdeutig → kein Auto
  - ≤ 0 → nie gutgeschrieben
  - Stripe im Verwendungszweck eines Mitglieds → kein Payout
- Migration `bank` → `bank_qonto` ohne Datenverlust.
- E2E (Echtmodus, Memory-DB): Qonto-Import → Vorschlag auf „Zuordnen“ → Ja → zweite Zahlung derselben IBAN automatisch.

## 8. Ausblick: Abgleich mit dem NEXUS-Portal (eigenes Paket)
Der Inhaber will die Mitgliederliste des Portals (Name, E-Mail) gegen Verträge und Lexware-Rechnungen abgleichen: „Wem habe ich keine Rechnung geschrieben?“ Wie die Liste ins System kommt (Export-Datei oder Schnittstelle), hängt von der Portal-Software ab und wird separat geklärt.

## 9. Dem Bauenden überlassen
- Genaue Qonto-Felder und Parameter (vorher gegen die Doku prüfen; im Session-Netz evtl. gesperrt → Feldnamen markieren, Fehlertexte zeigen den Grund wie bei Lexware).
- Tabellenmigration für die Umbenennung der Verbindung.
