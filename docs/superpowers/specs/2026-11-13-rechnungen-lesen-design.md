# Rechnungen lesen (Claude) – Design

**Stand:** 13.11.2026 · **Status:** freigegeben, umgesetzt und live (PR #13).
Basis: Spec `2026-11-12-nexus-assistent-design.md` (4a), Phase 2 `2026-11-12-phase2-design.md` (2d Claude), 2b-2 `2026-11-13-phase2b2-design.md` (Abschnitt 4, „Nicht in 2b-2“).

## 1. Warum
In NEXUS-Rechnungen steht oft die Gesamtsumme und irgendwo ein, zwei Sätze, dass sie in 6 oder 12 Monatsraten bezahlt wird. Bei manchen Event-Tickets steht ebenso, dass das Ticket in Raten bezahlt wird (Inhaber, 13.11.). Heute gilt dafür die Lexware-Fälligkeit: Die ganze Summe ist ab Rechnungsdatum offen und wird schnell „überfällig“. Das verfälscht NEXUS › Offen, die Ampel und die Hinweise auf Heute. Eine einfache Textsuche erkennt nur Mitgliedschaften mit festen Formulierungen.

## 2. Ziele, Nicht-Ziele, Anti-Ziele
**Ziele**
- Claude liest jede offene NEXUS-Rechnung einmal und erkennt eine Ratenvereinbarung: Anzahl Raten, Ratenbetrag, erste Fälligkeit, Fälligkeitstag, mit Rechenweg und dem Satz aus der Rechnung als Beleg.
- **Entscheidung (a), Inhaber:** Ist Claude sicher und geht der Plan exakt in der Rechnungssumme auf, gilt er sofort als Vertrag, markiert „von Claude gelesen“, korrigierbar. Sonst entsteht ein Vorschlag unter „Verträge zum Bestätigen“.
- Danach rechnen Offen, Ampel, Überfällig-Hinweis und Zahlungszuordnung pro Rate, mit der vorhandenen Vertragslogik.

**Nicht-Ziele**
- Raten mit freien Terminen oder ungleichen Beträgen (außer Rundungsrest in der letzten Rate). Erkennt Claude so etwas, wird es ein Vorschlag mit Hinweis „Plan passt nicht ins Monatsraten-Schema“.
- Zulassungs-Rechnungen, Auftragsbestätigungen (bleiben bei der Textsuche), Stripe.
- Chat, Entwürfe, Coach mit Claude (eigenes Paket 2d).

**Anti-Ziele (Fehlschlag, auch wenn es technisch läuft)**
- Ein Betrag wird doppelt als offen gezählt (Rechnung und Vertrag gleichzeitig).
- Claude überschreibt etwas, das der Inhaber korrigiert oder gelöscht hat.
- Ein Rechenfehler oder geratener Wert wird still zum Vertrag. Beträge rechnet nur die Domain, nie Claude allein.
- Kosten laufen unbemerkt hoch.

## 3. Ansätze
- **A, gewählt:** Claudes Ergebnis füllt einen Vertragsvorschlag (`ContractProposal`). Sicher und Summe passt: Vertrag wird automatisch angelegt (`MemberContract`), die Rechnung gilt dann als vom Vertrag abgedeckt. Vorteil: Ratenplan, Ampel, Offen, Überfällig-Hinweis und Zuordnung von Qonto-Zahlungen (Rate, Vielfaches der Rate) gibt es schon.
- **B, verworfen:** Plan nur an der Rechnung. Ratenlogik und Teilzahlungs-Zuordnung müssten ein zweites Mal gebaut werden (verstößt gegen „Wiederverwenden statt duplizieren“).

## 4. Ablauf
1. **Auslöser:** In `syncConnections` (`src/server/sync.ts`) nach dem Import von `lexware_nexus`, also bei „Jetzt abgleichen“ und im 5-Minuten-Takt. Eigener Schritt `readInvoices`, eigenes Zeitbudget (Call: höchstens 15 s und höchstens 5 Rechnungen pro Lauf). Der Rest kommt im nächsten Lauf.
2. **Auswahl (reine Domain-Funktion `invoicesToRead`):** Rechnungen mit `connectionId = 'lexware_nexus'`, Status nicht `paid`/`void`, offener Betrag > 0, `text` vorhanden, nicht schon von einem Vertrag abgedeckt, keine Lesung für denselben `sourceUpdatedAt`, nicht vom Inhaber verworfen. Älteste zuerst.
3. **Lesen (Server, `src/ai/`):** Ein Aufruf pro Rechnung an Claude mit Rechnungstext, Rechnungsnummer, Gesamtbetrag, Rechnungsdatum und Lexware-Fälligkeit. Kein Kontaktname, keine E-Mail extra (der Text kann Namen enthalten, das ist in Ordnung). Ausgabe strukturiert (JSON-Schema / Tool-Ausgabe):
   - `hasPlan: boolean`. Nur `true`, wenn die **Summe dieser Rechnung** in Raten bezahlt wird. Ist die Rechnung selbst eine Monatsrate („Rate 3 von 12“, Monatsbeitrag), ist das `false`. Dafür gibt es die vorhandene Mustererkennung über mehrere Rechnungen.
   - `kind: 'membership' | 'ticket' | 'other'`
   - `installments`, `installmentCents`, `firstDueDate`, `dueDay` (1–31, 31 = Monatsende), jeweils oder `null`
   - `quote`: der Satz bzw. die Sätze aus dem Text, auf die sich der Plan stützt (wörtlich)
   - `certain: boolean` und `note` (kurz, warum unsicher)
   - Wenn kein Fälligkeitstag im Text steht: `dueDay = null`. Die Domain setzt dann wie heute Monatsende (`MONTH_END`) und Start im Rechnungsmonat.
4. **Prüfen (reine Domain-Funktion `planFromReading`):** baut aus Lesung und Rechnung `ProposalValues` plus Rechenweg (`steps`). Gültig für „sofort“ nur, wenn alles zutrifft:
   - `hasPlan` und `certain`
   - 2 ≤ Raten ≤ 36, Fälligkeitstag 1–31, erste Fälligkeit nicht mehr als 60 Tage vor dem Rechnungsdatum und nicht mehr als 365 Tage danach
   - Summe passt nach Ledger-Regel: letzte Rate = Rechnungssumme − Rate × (Raten − 1), und |letzte Rate − Rate| < Anzahl Raten Cent (Rundungsrest). Sonst keine Toleranz.
   - Die Rechnung hat einen NEXUS-Kontakt (`contactId`)
   - Kein bestehender Vertrag für denselben Kontakt mit derselben Art „Mitgliedschaft“ (dann Vorschlag mit Hinweis „Kontakt hat schon einen Mitgliedsvertrag“)
   - Sonst: Vorschlag (bei `hasPlan`), oder nichts (bei `hasPlan = false`).
5. **Anwenden:** Ein neues Ereignis `invoicesRead` mit den Lesungen. Der Reducer:
   - speichert jede Lesung,
   - legt bei „sofort“ den Vertrag an (gleicher Weg wie „Übernehmen“: `catchUpMode` wie Standard bei Übernahme, `billing: 'legacy'`, Zahlungen rückwirkend verrechnet),
   - Vorschläge entstehen nicht als gespeicherte Objekte, sondern `deriveProposals` liest die gespeicherten Lesungen (wie heute Rechnungen und ABs).

## 5. Datenmodell
- **Neue Tabelle `invoice_readings`** (idempotente Migration `supabase/migrations/20261117000000_rechnungen_lesen.sql`, gleiches Muster `{id, ord, data jsonb, …}`, Eintrag in `server/db/tables.ts` und in der Whitelist von `apply_changes`). Der Inhaber führt sie im SQL-Editor aus, erst danach wird gemergt.
- `InvoiceReading` (in `src/domain/types.ts`): `id`, `invoiceId`, `sourceUpdatedAt`, `readAt`, `model`, Ergebnisfelder aus 4.3, `outcome: 'applied' | 'proposal' | 'none' | 'error'`, `error?`, `costMicroCents` (bzw. Token-Zahlen, siehe 7).
- **Vertrag:** `MemberContract` bekommt
  - `kind?: 'membership' | 'ticket' | 'other'` (fehlt = Mitgliedschaft, alte Daten bleiben gültig). Anzeige: „Mitgliedschaft“, „Ticket-Raten“, „Ratenzahlung“. `Receivable.label` nutzt das.
  - `readBy?: { invoiceId: string; invoiceNumber: string; quote: string; confirmed: boolean }` als Markierung.
  - `origin` enthält zusätzlich die Rechnung: `{ connectionId: 'lexware_nexus', externalId: 'invoice:<externalId>' }`. Bei `kind = 'membership'` außerdem die Kontakt-Referenz wie heute, damit der Textsuche-Vorschlag desselben Kontakts verschwindet.
- **Abdeckung:** `coveringContract` (`ledger/receivables.ts`) erkennt zusätzlich Verträge mit `origin` = diese Rechnung. Damit zählt die Rechnung nicht doppelt (Anti-Ziel 1). Der heutige Weg (Mitgliedschaft per Kontakt) bleibt.
- **Vorschlags-ID** für Lesungen: `proposalId([{ connectionId: 'lexware_nexus', externalId: 'invoice:<externalId>' }])`. „Verwerfen“ nutzt die vorhandenen `dismissedProposals`; verworfene Rechnungen werden nicht erneut gelesen.

## 6. Oberfläche
- **Verträge zum Bestätigen:** Vorschläge aus Lesungen erscheinen dort wie heute, Quelle „Lexware (Claude)“, Referenz „Rechnung RE-…“, Rechenweg plus Zitat aus der Rechnung, Grund der Unsicherheit.
- **Markierung:** Automatisch angelegte Verträge zeigen in Mitglieder/Vertragsdetail eine Plakette „Von Claude gelesen“ mit Zitat und Rechenweg, dazu „Passt“ (setzt `confirmed`, Plakette weg) und „Korrigieren“ (öffnet das vorhandene Vertragsformular). Korrigieren setzt ebenfalls `confirmed`.
- **Heute:** ein Hinweis „N Ratenpläne von Claude gelesen – kurz prüfen“, solange unbestätigte markierte Verträge existieren (neuer Detektor, Href über `detectors/refs.ts`). Der Hinweis „Verträge zum Bestätigen“ gibt es schon.
- **Verbindungen:** Zeile „Claude (Rechnungen lesen)“: Status, zuletzt gelesen, Kosten diesen Monat / Limit, letzter Fehler.
- **Löschen** eines automatisch angelegten Vertrags trägt seine Vorschlags-ID in `dismissedProposals` ein. Claude legt ihn nicht wieder an (Anti-Ziel 2).

## 7. Claude-Anbindung
- Paket `@anthropic-ai/sdk`, Schlüssel `ANTHROPIC_API_KEY` über `readEnv` (optional; fehlt er, wird der Schritt übersprungen, Verbindungen zeigt „nicht eingerichtet“).
- Modell `claude-opus-5-5` (Phase-2-Spec), niedriger Aufwand (Einordnen = low). Strukturierte Ausgabe per JSON-Schema.
- Schnittstelle `InvoiceReader` im Domain-Port (`ai-port.ts`), echte Umsetzung in `src/ai/`, Demo-Umsetzung regelbasiert für Tests, Demo-Modus und E2E (erkennt „in N Raten“/„N Monatsraten“).
- **Kosten:** Token aus der Antwort mal Preis (Konstante im Code, vor dem Bauen per `claude-api`-Skill prüfen). Monatslimit Standard 100 € (Phase-2-Spec). Ist es erreicht, wird nicht mehr gelesen, Verbindungen zeigt „Limit erreicht“.
- **Fehler:** 429/5xx → Lesung `error`, nächster Lauf versucht es erneut (höchstens 3 Versuche pro `sourceUpdatedAt`, danach `none` mit Hinweis). Fehlertexte ohne Schlüssel (wie `sanitizeError`).
- Ändert sich die Rechnung in Lexware (`sourceUpdatedAt`) und es gibt schon einen Vertrag aus ihr: nicht neu lesen, nichts ändern (Call). Gibt es nur einen Vorschlag: neu lesen.

## 8. Tests (TDD)
- Domain: `invoicesToRead` (Status, abgedeckt, schon gelesen, verworfen, Reihenfolge), `planFromReading` (Summe passt, Rundungsrest, Summe passt nicht → Vorschlag, unsicher → Vorschlag, `hasPlan=false` → nichts, Monatsende ohne Tag, Grenzen 2/36, Kontakt hat Mitgliedsvertrag), `coveringContract` mit Rechnungs-Origin, Reducer `invoicesRead` (legt Vertrag an, nicht doppelt, verworfen bleibt verworfen), Label „Ticket-Raten“ in Offen.
- AI: Reader mit gestubbtem `fetch`/SDK: Schema-Mapping, Fehler, Kostenrechnung, Limit.
- Sync: Budget und Höchstzahl pro Lauf, ohne Schlüssel übersprungen.
- E2E (Echtmodus, Memory-DB, Demo-Reader): Rechnung „zahlbar in 6 Monatsraten“ → nach Abgleich Vertrag mit Plakette, Offen zeigt Rate statt Gesamtsumme → „Passt“ → Plakette weg. Unsichere Rechnung → Vorschlag.
- Fixtures nur erfunden (`@example.de`).

## 9. Calls von Claude (korrigierbar)
- Nur NEXUS-Rechnungen, keine ABs, keine Zulassung.
- 5 Rechnungen und 15 s pro Lauf.
- Höchstens 36 Raten, erste Fälligkeit −60 bis +365 Tage zum Rechnungsdatum.
- Nach Vertragsanlage wird die Rechnung nicht neu gelesen.
- Markierung bleibt, bis „Passt“ oder „Korrigieren“.
- Mitgliedschafts-Rechnungen mit schon vorhandenem Vertrag: Vorschlag statt automatisch.

## 9a. Nach Builder-Check festgelegt (Calls von Claude, korrigierbar)
- **Mehrere Verträge pro Kontakt sind erlaubt** (Mitgliedschaft plus Ticket-Raten, zwei Tickets). Stellen, die heute „den“ Vertrag eines Kontakts mit `contracts.find(c => c.contactId === …)` holen (u. a. `assistant.ts`, `portal.ts`), werden umgestellt: Portal und Mitgliedsstatus nehmen den Vertrag mit `kind` Mitgliedschaft (fehlt = Mitgliedschaft), Assistent und Rückstand summieren über alle Verträge des Kontakts. Die Zahlungszuordnung behandelt jeden Vertrag als eigenen Kandidaten; mehrdeutig → Vorschlag mit Auswahl (vorhandene Regel). Der Bauende listet alle solchen Stellen per Grep auf und deckt sie mit Tests ab.
- **Summe:** Der Plan muss die **Rechnungssumme** (`totalCents`) treffen. Ist `openCents < totalCents` und erklären die in der App zugeordneten Zahlungen die Differenz nicht vollständig (Teilzahlung nur in Lexware ausgeglichen), wird es ein Vorschlag mit Hinweis statt „sofort“. Beim Anlegen werden zugeordnete Zahlungen der Rechnung wie bei „Übernehmen“ rückwirkend auf die Raten verrechnet.
- **Rechnung später `void` oder `paid` in Lexware, Vertrag aus ihr existiert:** Der Vertrag bleibt unverändert; Heute zeigt den Hinweis „Rechnung RE-… storniert/als bezahlt markiert – Ratenvertrag prüfen“ mit Link zum Vertrag. Bei `void` zählt der Vertrag bis zur Entscheidung des Inhabers trotzdem nicht als überfällig (Ampel grau, nicht in Offen).
- **Start und Fälligkeitstag:** Der Ledger legt Rate 1 in den Monat von `startDate` auf `dueDay` (`ledger/schedule.ts`). Abbildung: `startDate = firstDueDate`; `dueDay` = gelesener Tag, sonst Tag von `firstDueDate`, sonst Monatsende (31) und Start im Rechnungsmonat (wie `fromSingleDocument`).
- **Rundungsrest:** Der Ledger gleicht schon aus (letzte Rate = Summe − Rate × (Raten − 1)). Gültig, wenn |letzte Rate − Rate| < Anzahl Raten (Cent).
- **Kosten:** Limit pro Kalendermonat Europe/Berlin über `clock.ts`, Konstante 100 €, in diesem Paket nicht in der Oberfläche änderbar.
- **Datenschutz:** Der Inhaber hat das Lesen der Rechnungen durch Claude ausdrücklich beauftragt (13.11.). Gesendet wird nur, was 4.3 nennt. Kein zusätzlicher Schalter; ohne `ANTHROPIC_API_KEY` passiert nichts.

## 9b. Nach dem Gesamtreview festgelegt (umgesetzt)
- Ein von Claude gelieferter, aber ungültiger Einzelwert (Tag außerhalb 1–31, ungültiges Datum, nicht ganzzahlige Raten/Rate) wird nie ersetzt: höchstens Vorschlag.
- Ohne erste Fälligkeit, aber mit Tag: Start wie `fromSingleDocument` (`firstDueOnOrAfter`), nie vor dem Rechnungsdatum.
- Hat ein Ratenvertrag die Rechnung als `origin`, erzeugt die Textsuche für diese Rechnung keinen Vorschlag mehr. Ist der Textsuche-Vorschlag einer Mitgliedsrechnung verworfen, liest Claude sie nicht.
- Lesen hat eigenen Fehlerbereich (`claude_invoices`), nie Lexware. Speichern scheitert → Störung an `claude_invoices`; nach 3 Fehlschlägen in Folge nur noch in den ersten 5 Minuten jeder Stunde.
- Aufruf nur mit ≥ 10 s Restzeit; zu knapp = nächster Lauf, kein Fehlversuch.
- Assistent („Schick … Erinnerung“): Vertrag des Kontakts mit dem höchsten Rückstand; Text nennt dessen Betrag.

## 10. Dem Bauenden überlassen
- Prompt-Wortlaut und Schema-Details, solange 4.3 erfüllt ist.
- Wo genau die Plakette im Vertragsdetail sitzt (vorhandene Bausteine aus `src/components`).
- Ob die Lesungen über `importBatch`-ähnliches Event oder eigenes Event gespeichert werden, solange Reducer und Persistenz dem bisherigen Muster folgen.
