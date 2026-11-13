# Paket 2b-3: Umstellung der Bestandsmitglieder auf Stripe

Stand: 13.11.2026. Löst Spec `2026-11-12-phase2b-design.md` Abschnitt 11b ab. Basis-Regeln: `2026-11-12-nexus-assistent-design.md` Abschnitt 4a.

## 1. Warum
Die Bestandsmitglieder haben in Lexware eine **einzige Gesamtrechnung** und überweisen ihre Raten selbst. Ob gezahlt wird, hängt am Mitglied. Ziel des Inhabers: Die Raten werden **automatisch abgebucht**. Wer das nicht nutzt, wird **vor jeder Rate erinnert**, damit er nicht vergisst.

## 2. Ziele
1. Jedes Bestandsmitglied (`billing: 'legacy'`, offener Betrag > 0) bekommt einen Stripe-Link. Dort hinterlegt es Karte oder SEPA selbst.
2. Danach legt der Server ein Stripe-Abo an, das **genau dem Restplan** von der Übernahme-Seite entspricht (`planTakeover`): Beträge je Rate, Fälligkeiten und Ende nach der letzten Rate.
3. Das Abo hängt automatisch am **bestehenden** Vertrag, und `billing` wechselt auf `stripe`. Es entsteht kein zweiter Vertrag.
4. **Auffangnetz für alle:** Wer weiter überweist (Link nicht genutzt), bekommt vor jeder Rate einen Erinnerungsentwurf zur Freigabe. Die Erinnerung enthält den Stripe-Link.
5. „Alle umstellen“ bereitet die Umstellung für alle passenden Mitglieder vor. Freigegeben wird einzeln oder gesammelt.

## 3. Nicht-Ziele
- Kein Schreiben nach Lexware. Die Gesamtrechnung bleibt, wie sie ist. Wie Stripe-Auszahlungen gegen sie verbucht werden, klärt der Buchhalter.
- Kein direkter Versand per WhatsApp oder Mail. „Senden“ ist bis 2e/2f Demo, der Inhaber kopiert Link bzw. Text.
- Keine Neumitglieder (die bekommen weiter Stripe-Abos wie bisher).
- Keine Änderung laufender Stripe-Abos von Mitgliedern, die schon auf Stripe sind.

## 4. Anti-Ziele (wäre ein Fehlschlag, auch wenn es technisch läuft)
- Ein Mitglied zahlt **doppelt** (Abo plus Erinnerung, oder zwei Abos) oder mehr als den offenen Betrag.
- Stripe bucht etwas ab, das der Inhaber nicht freigegeben hat (anderer Betrag, anderes Datum).
- Nach der Umstellung meldet die App falsche Hinweise: „Preis geändert“ bei jedem Ratenwechsel, „Lexware offen, obwohl bezahlt“ oder „Abo gekündigt“ beim regulären Ende.
- Echte Mitgliederdaten landen im Repo.

## 5. Ansätze (Inhaber hat **A** gewählt)
| Ansatz | Kurz | Bewertung |
|---|---|---|
| **A – Zahlungsmittel hinterlegen, dann Abo nach Plan** | Checkout im Setup-Modus (nur Zahlungsmittel). Nach Abschluss legt der Server einen Abo-Zeitplan an, mit genau den Raten und Fälligkeiten des Restplans. | **Gewählt.** Jeder Plan passt 1:1, Abbuchung am bisherigen Fälligkeitstag. Etwas mehr Bauaufwand. |
| B – Normales Abo mit gleicher Rate | Checkout im Abo-Modus, Abweichung als Einmalposten auf der ersten Abbuchung, Enddatum danach. | Erste Abbuchung sofort statt am Fälligkeitstag. Pläne mit ungleichen Raten in der Mitte passen nicht. |
| C – Monatliche Stripe-Rechnung | Kein Abo, jeden Monat eine Zahlungsaufforderung. | Zieht nicht automatisch ab, verfehlt das Ziel. |

## 6. Ablauf
1. **Vorbereiten:** Auf der Übernahme-Seite wird aus „Stripe-Plan vorbereiten (Demo)“ der Knopf **„Auf Stripe umstellen“**. Er erzeugt eine Aktion zur Freigabe (neuer Typ, z. B. `stripe_takeover`) mit Payload `{contractId, contactId, mode, rates, openCents}`. Nachzahlungsart wie bisher über `CATCH_UP_OPTIONS`.
   - Voraussetzungen: `billing === 'legacy'`, offener Betrag > 0, Bank verbunden. Sonst ist der Knopf gesperrt, mit Grund (die Bankdaten bestimmen den Restbetrag).
   - Pro Vertrag gibt es höchstens eine offene Umstellung. Ändert sich der Plan vor der Freigabe, wird die Aktion als neue Version überschrieben.
2. **Freigabe:** Der Inhaber gibt frei, einzeln oder per Sammelfreigabe. Bei der Ausführung passiert:
   - Stripe-Kunde anlegen oder wiederfinden (Metadaten `contractId`, Name, E-Mail aus dem Kontakt).
   - Einen **eigenen, stabilen Link** erzeugen: `/zahlung/<token>` auf der App-Domain, mit langem Zufallstoken.
   - Den freigegebenen Plan zusammen mit der Aktions-ID und dem Token am Vertrag speichern (Umstellungs-Status, siehe 7).
   - Grund für den eigenen Link: Stripe-Checkout-Sitzungen verfallen nach höchstens 24 Std. Das Mitglied soll den Link auch Tage später öffnen können.
3. **Link teilen:** Die Aktion zeigt nach der Ausführung den Link und einen fertigen Nachrichtentext mit **„Kopieren“**. Der Inhaber verschickt ihn selbst (WhatsApp folgt mit 2e). Der Text bittet ausdrücklich darum, einen bestehenden **Dauerauftrag zu löschen** (Inhaber, 13.11.).
   - Domain: vorerst die Vercel-Adresse der App (Inhaber, 13.11.). Der Link wird aus einer Einstellung bzw. Umgebungsvariable für die Basis-URL gebaut, damit eine spätere eigene Domain nur neue Links betrifft. Alte Links bleiben gültig, solange die Vercel-Adresse besteht.
4. **Mitglied öffnet den Link:** Die öffentliche Seite `/zahlung/<token>` legt bei jedem Aufruf eine frische Checkout-Sitzung im **Setup-Modus** an (Karte und SEPA-Lastschrift, Kunde aus Schritt 2) und leitet dorthin weiter.
   - Davor zeigt die Seite kurz den Plan: Anzahl Raten, Beträge, erste Abbuchung, letzte Abbuchung. Das Mitglied soll wissen, wozu es zustimmt.
   - Ungültiger, erledigter oder zurückgezogener Token → neutrale Seite „Link nicht mehr gültig, bitte melde dich bei NEXUS“, ohne Daten.
   - Erfolgs- und Abbruch-URL führen auf eigene, schlichte Danke- bzw. Abbruch-Seiten.
5. **Abschluss (Webhook `checkout.session.completed`, Modus setup):**
   - Der Server prüft, ob der aktuelle Restplan noch dem freigegebenen entspricht (gleiche Raten und Beträge; Fälligkeiten in der Vergangenheit siehe Punkt 8).
   - **Gleich:** Zahlungsmittel als Standard am Kunden setzen. Abo-Zeitplan anlegen: eine Phase je Rate oder gleich hohe Folgeraten zusammengefasst, Start am Fälligkeitstag der ersten offenen Rate, Ende nach der letzten Rate (danach kündigen), automatischer Einzug. Metadaten `contractId` und Aktions-ID.
   - **Abweichend** (das Mitglied hat inzwischen überwiesen o. Ä.): kein Abo anlegen. Hinweis „Plan hat sich geändert, Umstellung neu freigeben“. Das Zahlungsmittel bleibt am Kunden, eine neue Freigabe nutzt es ohne neuen Link.
   - Dieser Schritt ist ein **ausdrücklich automatisierter Ablauf** der freigegebenen Aktion (Spec 4a): Der Inhaber hat Plan und Beträge freigegeben, das Mitglied hat zugestimmt. Alles kommt ins Protokoll.
6. **Verknüpfen:** Schon beim Anlegen des Zeitplans (Schritt 5) speichert der Server die Zeitplan-ID am Vertrag. Der Vertrag wechselt sofort auf `billing: 'stripe'`, Status `eingerichtet`. Grund: Ein Zeitplan mit Start in der Zukunft hat bis zum Starttag kein Abo-Objekt. Der Import sähe wochenlang nichts, und das Mitglied bekäme sonst Erinnerungen für Raten, die Stripe abbucht *(Call)*. Sobald der Import das Abo mit `metadata.contractId` sieht, wird es **automatisch** mit dem bestehenden Vertrag verknüpft, ohne Vorschlag und ohne neuen Vertrag. Bestätigt gelten Raten und Enddatum des freigegebenen Plans.
   - Stripe-Produkt: ein eigenes Produkt **„NEXUS-Mitgliedschaft (Ratenplan)“** für alle Umstellungs-Preise (`price_data`). Abos mit `metadata.contractId` erzeugen nie einen Vertragsvorschlag (`proposals.ts`) *(Call)*.
7. **Umstellungs-Status je Vertrag** (sichtbar auf Übernahme-Seite und Mitgliedsseite):
   `vorbereitet` (Aktion offen) → `Link verschickt` (ausgeführt) → `eingerichtet` (Zahlungsmittel hinterlegt, Zeitplan angelegt, `billing: 'stripe'`) → `aktiv` (Abo verknüpft) · Nebenzweige `Plan geändert`, `zurückgezogen` und `abgebrochen` (siehe 7a).
   „Zurückziehen“ macht den Token ungültig, solange noch kein Abo existiert.
8. **Fälligkeiten in der Vergangenheit:** Wird der Link erst nach dem Fälligkeitstag der ersten Plan-Rate genutzt, ist diese Rate zum Rückstand geworden. Der Restplan wird beim Abschluss neu gerechnet. Ändern sich dabei nur die Daten, nicht Summe und Ratenzahl, beginnt das Abo mit der nächsten Fälligkeit, und die überfällige Rate wird sofort beim Start eingezogen. Ändert sich mehr → „Plan geändert“ (Punkt 5). *(Call des Bauenden: so wenig Neu-Freigaben wie möglich, ohne Beträge zu ändern.)*

## 7. Erinnerungen (Auffangnetz)
- Für jeden Vertrag mit `billing: 'legacy'`, offener Rate und **ohne aktives Stripe-Abo**: **3 Tage vor** jeder Fälligkeit ein Erinnerungsentwurf (`send_reminder`) im Briefing.
  - Inhalt: Betrag, Fälligkeit, Hinweis auf bequeme Abbuchung mit dem Stripe-Link (falls schon erzeugt).
  - Freigabe einzeln oder gesammelt. Versand bis 2e als Demo bzw. „Kopieren“.
- Überfällige Raten: bestehender Hinweis „Mitglied im Rückstand“ (`detectMemberOverdue`), keine zweite Logik.
- **Link 7 Tage nicht genutzt** (Status `Link verschickt`): Hinweis an den Inhaber mit Entwurf „Erinnerung an den Link“.
- Ab Status `eingerichtet` gibt es keine Erinnerungen mehr (Anti-Ziel Doppelzahlung).
- Die Werte 3 und 7 Tage sind Vorschläge des Bauenden und stehen als Einstellung bereit.

## 7a. Doppelzahlung und Störungen
- **Überweisung trotz Stripe** (z. B. alter Dauerauftrag): Geht nach `eingerichtet` eine Banküberweisung des Mitglieds ein, meldet die App **„Doppelzahlung“** mit Betrag und Mitglied. Der Inhaber erstattet von Hand. Die App ändert das Abo deswegen nicht (Inhaber, 13.11.). Die Überweisung wird wie bisher dem Vertrag zugeordnet. Eine Überzahlung zeigt das Ledger als Guthaben.
- **Abbuchung fehlgeschlagen** (Rücklastschrift, Karte abgelehnt): Es kommt der bestehende Hinweis „Stripe-Zahlung fehlgeschlagen“ (`past_due`/`unpaid`). Der Vertrag bleibt auf Stripe *(Call)*. Die App hängt nicht von der Stripe-Kontoeinstellung für Wiederholungen ab.
- **Abo endet vor der letzten Rate** (gekündigt, von Stripe beendet): Der Hinweis „Abo gekündigt“ bleibt. Der Vertrag fällt zurück auf `billing: 'legacy'`, Status `abgebrochen`, und die Erinnerungen laufen wieder *(Call)*. Eine neue Umstellung ist möglich.

## 8. Folgen in bestehender Logik (müssen angepasst werden)
- **Plan im Vertrag:** Die künftigen Raten des Vertrags müssen nach der Umstellung dem freigegebenen Plan entsprechen. Sonst stimmen Rückstand und Zuordnung der Stripe-Zahlungen nicht. Der Weg dahin (Ausnahmen, `catchUpMode`, eigene Plan-Raten) ist Sache des Bauenden, aber `buildSchedule` muss den Plan liefern.
- **Abo-Hinweise** (`detectors/subscriptions.ts`): Preis und Ende werden gegen den **Plan** geprüft, nicht gegen einen Einzelpreis. Ratenwechsel laut Plan sind kein „Preis geändert“. Das reguläre Ende ist bereits abgesichert (PR #15).
- **Lexware-Gesamtrechnung:** Gilt als „läuft über Stripe“. `detectStripePaidLexwareOpen` und die Überfällig-Logik für Rechnungen schweigen für diesen Vertrag. In der Rechnungsliste steht eine Plakette „läuft über Stripe“.
- **Webhook:** `checkout.session.completed` zusätzlich verarbeiten (nicht nur Sync anstoßen). Die Duplikatprüfung `claimJobRun` gilt wie bisher.

## 9. Zugang
- Neuer **Schreib-Schlüssel** `STRIPE_WRITE_KEY` (Vercel-Umgebungsvariable). Eingeschränkter Schlüssel mit Schreibrecht nur für: Kunden, Checkout-Sitzungen, Setup-Intents (lesen), Zahlungsmethoden (anhängen), Abo-Zeitpläne, Abos, Produkte, Preise. Er bleibt getrennt vom Lese-Schlüssel `STRIPE_RESTRICTED_KEY`.
- Den Schlüssel legt der **Inhaber** in Stripe an und trägt ihn in Vercel ein. Erst im **Testmodus**, dann live.
- **Testlauf (Inhaber, 13.11.):** Nur die Vercel-Umgebung **Preview** bekommt einen kompletten Stripe-Testsatz: `STRIPE_RESTRICTED_KEY` (Test), `STRIPE_WRITE_KEY` (Test) und `STRIPE_WEBHOOK_SECRET` (Test-Webhook auf die Preview-Adresse). Production bleibt live und unberührt. Getestet wird von Anfang bis Ende mit Testkarte bzw. Test-IBAN auf einer Preview mit eigener Datenbasis.
  - Der Plan liefert dem Inhaber eine Klick-Anleitung (`docs/setup-phase2b3.md`).
  - Ob die Preview eine eigene Supabase-Datenbasis braucht, klärt der Bauende vorher, damit Testdaten nicht in den Live-Stand laufen.
- Ohne Schreib-Schlüssel bleibt alles im Demo-Modus: Die Aktion wird simuliert, der Link ist ein Demo-Link, die Seite zeigt „Demo“.
- `createApiClient` bekommt POST (form-encoded, Idempotenz-Header aus `idempotencyKey` der Aktion).

## 10. Randbedingungen
- Domain-Regeln aus CLAUDE.md: Cent-Beträge nur über Ledger und Domain, Kalendertage über `clock.ts`, Vertrag nur über `membershipContractOf`/`contractsOfContact`, `src/domain` rein.
- Neue Tabellen oder Spalten nur per idempotenter Migration, eingespielt per Supabase-MCP.
- Stripe-API-Felder (Setup-Checkout, Abo-Zeitpläne mit `price_data`, Metadaten, Webhook-Objekt) **vor** dem Bau gegen die aktuelle Stripe-Doku prüfen, API-Version `2025-09-30.clover`.
- Tests nur mit erfundenen Fixtures. E2E im Demo-Modus und mit Fixture-Stripe.
- Der öffentliche Pfad `/zahlung/<token>` ist der einzige Teil ohne Login. Er gibt außer dem Plan des Tokens nichts preis, ist ratenbegrenzt und schreibt nichts außer der Checkout-Sitzung.

## 11. Dem Bauenden überlassen
- Genaue Stripe-Endpunkte und Felder (nach Doku-Prüfung).
- Tabellen- bzw. Feldschnitt für Umstellungs-Status und Token.
- Gruppierung der Raten zu Abo-Phasen.
- Texte der Nachrichten (Deutsch, kurz, du-Form wie bestehende Entwürfe).
- Reihenfolge der Tasks.
