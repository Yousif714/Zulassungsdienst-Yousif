# Sparkasse-Upload mit automatischer Zuordnung (2b-2b) – Design

Stand: 13.11.2026 · Status: umgesetzt (Branch, wartet auf PR/Merge; Ansatz A vom Inhaber gewählt)

## 1. Warum
Beim Zulassungsdienst zeigt die App heute „offen/überfällig“ nur nach dem Lexware-Status. In Lexware Zulassung ist die Sparkasse **nicht** angebunden; Rechnungen bleiben dort offen, obwohl das Geld längst da ist (Inhaber, 13.11.). Ziel: Kontoauszug hochladen → die App erkennt Zahlungen, ordnet sie Rechnungen zu und sagt, was wirklich offen ist. Möglichst alles automatisch, der Inhaber bestätigt nur unsichere Fälle.

## 2. Ziele, Nicht-Ziele, Anti-Ziele
**Ziele**
- Upload des Sparkassen-Auszugs (Firma `zulassung`, Verbindung `bank_sparkasse`) als CAMT.053 (XML oder ZIP mit XMLs) oder Sparkassen-CSV (Format „CSV-CAMT V2“; „CSV-MT940“ wenn billig mitnehmbar). Format wird erkannt.
- Vorschau vor dem Übernehmen („42 Buchungen · 31 neu · 11 schon vorhanden · Zeitraum 01.10.–12.11.“).
- Automatische Zuordnung zu Lexware-Zulassungsrechnungen; unsichere Fälle in „Zulassung › Zuordnen“.
- Offene Beträge (Heute, Zulassung, Kundenseite, Briefing, Assistent) berücksichtigen Zuordnungen.

**Nicht-Ziele (jetzt)**
- Ausgaben (Gebühren Zulassungsstelle, Kosten). Nur Eingänge und Rückbuchungen, wie Qonto.
- Zurückschreiben nach Lexware (Verbindung bleibt nur lesend).
- PDF-Auszüge, finAPI/Banking-API, automatisches Zuführen per Mail.

**Anti-Ziele**
- Doppelte Zahlungen bei überlappenden Uploads oder CSV-und-CAMT-Mischung.
- Eine Zahlung wird automatisch einer falschen Rechnung zugeordnet (lieber Vorschlag als falsch auto).
- Rohdatei landet auf dem Server oder im Repo. Keine echten Bankdaten in Tests/Fixtures (`@example.de`, erfundene IBANs).

## 3. Ansätze (gewählt: A)
| Ansatz | Kurz | Bewertung |
|---|---|---|
| **A – Datei im Browser lesen, vorhandene Zuordnung nutzen** | Parser rein in `src/domain/import/`, Upload-UI wie Portal-Liste, Client-Event mit den gelesenen Zahlungen, `matchBankPayment` wiederverwendet | **Gewählt (Inhaber).** Wenig neuer Code, Rohdatei bleibt im Browser. |
| B – Datei an Server, dort parsen | Neuer Upload-Endpunkt mit Größen-/Sicherheitsprüfung | Nur nötig für automatische Zuführung (Mail); später ergänzbar. |
| C – Claude liest Auszug (auch PDF) | KI-Parsing | Kosten je Upload, Restrisiko Lesefehler bei Geld; unnötig bei strukturierten Dateien. |

## 4. Festlegungen

### 4.1 Lesen (rein, `src/domain/import/sparkasse.ts`)
- `parseSparkasse(file: { name; bytes }) → { payments: ImportedPayment[]; skipped: {reason; count}[]; from; to; account? }`. ZIP-Entpacken über den vorhandenen Leser in `src/data/xlsx.ts` (`unzip` exportieren, Fehlertexte neutral formulieren, Zip-Bomben-Budget bleibt); da `domain` nicht aus `data` importieren darf, entpackt die Seite und gibt die XML-Texte an die Domain-Funktion. Umgesetzt: `parseSparkasse` bekommt die Dateibytes (bei ZIP entpackt die Data-Schicht vorher; CSV wird in der Domain dekodiert).
- Text-Dekodierung CSV: `decodeListFile` (UTF-8, sonst Windows-1252). Trennzeichen `;`, Datum `TT.MM.JJ`/`TT.MM.JJJJ`, Betrag `1.234,56`/`-12,00` → Cent nur über eine Parse-Funktion, keine Floats.
- CAMT.053: je `Ntry` mit `Sts` gebucht (`BOOK`), `Ccy="EUR"`, Buchungsdatum `BookgDt/Dt` (sonst `ValDt`). Sammelbuchungen: je `TxDtls` eine Zahlung (Betrag aus `TxDtls/Amt`, sonst Ntry-Betrag bei genau einem TxDtls). Gegenpartei: bei Eingang `Dbtr/Nm` + `DbtrAcct/Id/IBAN`, Verwendungszweck `RmtInf/Ustrd` (mehrere Zeilen mit Leerzeichen verbunden).
- Übernommen werden: Eingänge (`CRDT` bzw. Betrag > 0) und Rückbuchungen (Ausgang, der eine Lastschrift/Überweisung zurückgibt: CAMT `RvslInd=true` oder Bank-Transaktionscode Rückgabe; CSV-Buchungstext enthält „Retoure“, „Rücklastschrift“, „Rückbuchung“ – Liste als Konstante, gegen echte Datei prüfen). Alle anderen Ausgänge werden gezählt („übersprungen: 17 Ausgaben“), nicht übernommen. Nur ab `IMPORT_SINCE`.
- `Payment`: `company: 'zulassung'`, `source: 'bank'`, `connectionId: 'bank_sparkasse'`, `kind` vom Importer gesetzt (`incoming`; Rückbuchung negativ wie Qonto), IBAN über `normalizeIban`.
- **`externalId`** (Importschlüssel, CSV und CAMT gleich, damit gemischte Uploads nicht doppeln): Hash aus Buchungsdatum | Betrag in Cent | normalisierte IBAN | normalisierter Verwendungszweck (Kleinbuchstaben, Leerraum entfernt) | laufende Nummer bei identischen Zeilen **innerhalb derselben Datei**. Die Bankreferenz (`AcctSvcrRef`) wird nicht als Schlüssel genutzt, weil die CSV sie nicht hat. Bekanntes Restrisiko: Unterscheidet sich der Verwendungszweck zwischen CSV und CAMT (Kürzung), doppelt es – Vorschau zeigt dann „neu“ statt „vorhanden“; im Test mit echten Dateien prüfen.

### 4.2 Übernahme (Client-Event)
- Neues Client-Event `importBankStatement { connectionId: 'bank_sparkasse'; payments: ImportedPayment[] }`; Allowlist + strenge Formprüfung in `state-service.ts` (1–5000 Zahlungen, Betrag ganzzahlig ≠ 0, Datum ISO, Firma/Verbindung fest, Längenlimits für Texte).
- Engine: `mergeBatch` (Rückbuchungs-Verknüpfung `linkBankReturns` und Klassifikation für `bank_sparkasse` freischalten, nicht nur `bank_qonto`), Verbindung `connected`, `lastSuccessAt = jetzt`, `sync.cursor` = jüngstes Buchungsdatum im Bestand („Auszug bis 12.11.“). Audit-Zeile mit Anzahl neu.
- Keine Migration nötig: Zahlungen nutzen die bestehende Tabelle (`payments_connection_external_key`). Builder prüft, dass keine Check-Constraints `bank_sparkasse` oder `zulassung` ausschließen.

### 4.3 Zuordnung für den Zulassungsdienst
- Die Nexus-Sperren werden firmenabhängig: `autoAllocate`, `unallocatedBankPayments`, `detectUnmatchedPayments`, `buildMatchContext`, `matchOptions`, `confirmPaymentMatch` (Rechnungsziel `lexware_nexus` **oder** `lexware_zulassung` passend zur Firma der Zahlung). Eine Zahlung wird nur Rechnungen/Kontakten **derselben Firma** zugeordnet.
- Kontext Zulassung: Kontakte der Firma, Rechnungen `lexware_zulassung` mit `invoiceOpenCents > 0`, keine Verträge.
- Stufen wie heute (`matchBankPayment`): Rechnungsnummer im Verwendungszweck + Betrag = auto; bestätigte IBAN + genau ein passender Betrag = auto; Name + Betrag = Vorschlag; sonst manuell. Bestätigen lernt die IBAN (vorhanden).
- **Sammelzahlung (neu, Inhaber-Ziel „alles automatisch“):** Ein Verwendungszweck mit mehreren Rechnungsnummern desselben Kunden, deren offene Beträge zusammen exakt den Betrag ergeben → automatisch auf alle aufgeteilt. Bestätigte IBAN, kein Einzeltreffer, aber Summe aller offenen Rechnungen des Kunden = Betrag → automatisch auf alle. Sonst Vorschlag. Beim manuellen Bestätigen eines Kunden (statt einer Rechnung) wird auf die älteste offene Rechnung zuerst verteilt (Regel 4a). Dafür eine reine Verteilungsfunktion im Ledger; mehrere `Allocation`s je Zahlung.
- Teilzahlung: Rechnungsnummer gefunden, Betrag kleiner → Vorschlag „Teilzahlung“, nach Bestätigung bleibt der Rest offen. Überzahlung: Rest der Zahlung bleibt als „nicht zugeordnet“ sichtbar.
- „Keine Kundenzahlung“ (`dismissPayment`) für Bareinzahlungen, Erstattungen usw.

### 4.4 Offene Beträge überall richtig
- Briefing (`briefing.ts`), `/zulassung/kunden/[id]`, Zulassung-Übersicht und Assistent-Tools (`ai/tools.ts`) rechnen Zulassung-Rechnungen über `invoiceOpenCents` statt `i.openCents`. Kundenseite zeigt zusätzlich „Zahlungen“ (zugeordnet, mit Datum und Rechnung) und Teilzahlungen („420 € von 600 € bezahlt“).
- Lexware setzt später selbst „bezahlt“ → offen 0, keine Doppelzählung (vorhandenes Verhalten von `invoiceOpenCents`).

### 4.5 Oberfläche
- **Verbindungen › Sparkasse (Zulassung):** Zeile zeigt „Auszug bis 12.11. · hochgeladen vor 2 Tagen“ bzw. „Noch kein Auszug“ und den Knopf „Auszug hochladen“ (Demo und Echtmodus).
- **Zulassung › Zuordnen** (`/zulassung/zuordnen`, neu): oben derselbe Upload-Baustein; darunter die Zahlungskarten wie in `/nexus/zuordnen` (gemeinsame Komponente, nicht kopieren) mit Vorschlag, Auswahl (Rechnungen/Kunden der Zulassung) und „Keine Kundenzahlung“. Nach dem Upload eine Zusammenfassung: „31 neu · 24 automatisch zugeordnet · 5 zum Bestätigen · 2 ohne Treffer“.
- Ablauf Upload: Datei wählen/ziehen → Vorschau (Zeitraum, Anzahl neu/vorhanden/übersprungen, Konto-IBAN gekürzt) → „Übernehmen“. Fehler verständlich („Das ist kein Sparkassen-Auszug (CAMT oder CSV)“). Max. 5 MB je Datei.
- **Hinweise:** `unmatched_payment` auch für Zulassung (Link `/zulassung/zuordnen`, Hrefs über `detectors/refs.ts`). Neuer Hinweis „Sparkasse-Auszug ist älter als 7 Tage – neuen hochladen“ (Priorität info). `bank_sparkasse` kommt **nicht** in `MONEY_SOURCES.zulassung`, damit ein alter Auszug die Lexware-Zahlen nicht als „Datenstand zu alt“ ausblendet; Frische für `bank_sparkasse` in `STALE_AFTER_MINUTES_BY_CONNECTION` auf 7 Tage.

### 4.6 Demo
- Demo-Seed bekommt `bank_sparkasse` weiter als „Noch kein Auszug“; eine erfundene Beispieldatei (`tests/fixtures/sparkasse/*.xml|csv`, Fantasie-IBANs, `@example.de`) dient für Unit- und E2E-Tests und kann im Demo-Modus hochgeladen werden.

### 4.7 Klärungen aus dem Builder-Check (Entscheidungen von Claude, Inhaber kann korrigieren)
- **Zahlung auf eine Rechnung, die Lexware schon als bezahlt führt** (Team hat von Hand abgeglichen): Für die Nummernsuche im Verwendungszweck zählen auch Lexware-bezahlte Zulassungsrechnungen der letzten 180 Tage. Ist die Nummer eindeutig und passt der Rechnungsbetrag (`totalCents`), wird automatisch zugeordnet und mit „in Lexware schon bezahlt“ markiert. Am offenen Betrag ändert sich nichts (`invoiceOpenCents` bleibt 0). So bleibt „ohne Treffer“ sauber. Ohne Nummer erscheint die Zahlung wie jede andere ohne offene Rechnung in „Zuordnen“.
- **Sammelzahlung mit Abweichung** (Skonto, Rundung, fehlende Rechnung): Automatisch nur bei exakter Summe. Sonst gibt es einen Vorschlag mit dem Kunden und einer angezeigten Verteilung, älteste offene Rechnung zuerst. „Bestätigen“ übernimmt genau diese Verteilung. Der Rest bleibt bei Unterzahlung an der jüngsten Rechnung offen, bei Überzahlung bleibt er als „nicht zugeordnet“ sichtbar. Keine Skonto-Toleranz.
- **Rückbuchung einer zugeordneten Zahlung:** `bankReturnAllocations` gilt auch für `bank_sparkasse`. Es muss auf **mehrere** Allocations der Originalzahlung erweitert werden, damit Sammelzahlungen funktionieren: jede wird anteilig negativ gegengebucht, jüngste Rechnung zuerst. Die betroffenen Rechnungen sind damit automatisch wieder offen.
- **Laufende Nummer im Schlüssel:** Sie zählt nur gleiche Zeilen (Datum, Betrag, IBAN, Zweck) innerhalb einer Datei. Annahme: Sparkassen-Exporte enthalten immer ganze Buchungstage, weil nach Datum gefiltert wird. Damit ist die Nummer in überlappenden Exporten stabil. Diese Annahme wird im Code kommentiert und in der Abnahme geprüft.
- **Fremde Sperren:** Der Plan beginnt mit einem Grep-Inventar aller Stellen mit `'nexus'`, `lexware_nexus` und `bank_qonto` in Zuordnung, Hinweisen, Selektoren und Assistent-Tools.
- **Typen und Datenbank:** `bank_sparkasse` ist schon im Typ `ConnectionId` und in der Verbindungsliste vorhanden. `payments` hat nur den Unique-Index `(connection_id, external_id)`, deshalb ist keine Migration nötig. Der Builder bestätigt das per Grep über `supabase/migrations`.
- **Echte Dateien:** Der Builder hat keine und committet auch keine. Codes und Feldvarianten stehen als Konstanten mit „gegen echte Datei prüfen“ im Code. **Abnahmeschritt nach dem Merge:** Der Inhaber lädt je einen echten CSV- und CAMT-Export hoch und prüft die Vorschau. Die Datei bleibt im Browser. Fehler werden als Nachbesserung behoben.

## 5. Tests
- Unit: Parser CSV/CAMT/ZIP (Sammelbuchung, Rückbuchung, Ausgänge übersprungen, Windows-1252, Beträge), gleicher Schlüssel für CSV und CAMT derselben Buchung, Idempotenz bei Doppel-Upload, Zuordnung Zulassung (Nummer, IBAN, Sammelzahlung, Teilzahlung, keine Firmen-Vermischung), `invoiceOpenCents` in Briefing/Kundenseite, Event-Validierung.
- E2E: Upload in Zulassung › Zuordnen → Zusammenfassung → Vorschlag bestätigen → Kundenseite zeigt Rechnung bezahlt.

## 6. Dem Builder überlassen
- Genaue Liste der Bank-Transaktionscodes/Buchungstexte für Rückbuchungen (Konstante, „gegen echte Datei prüfen“).
- Hash-Funktion (synchron, rein; z. B. FNV-1a 64 bit als Hex), Form der Vorschau, Texte im Detail.
- Ob CSV-MT940 mitkommt (nur wenn ohne Mehraufwand).
