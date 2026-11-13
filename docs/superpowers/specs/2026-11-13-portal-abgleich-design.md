# Design-Spec: Portal-Abgleich (Mitgliederliste aus dem NEXUS-Portal)

**Stand:** 13.11.2026 · **Status:** vom Inhaber gewünscht („Portalzugriff ist so wichtig“), Calls von Claude unten. **Änderung 13.11.:** Die Supabase-Schlüssel des Portals liegen bei der Agentur. Deshalb gilt jetzt Weg B (Liste in der App einfügen), Weg A folgt später. Danach kommt „Rechnungen lesen“ (Claude). Entscheidung (a): Pläne gelten sofort und sind markiert.

## 1. Warum
In der App fehlen Mitglieder. Vertragsvorschläge gibt es nur aus Rechnungen mit „Mitgliedschaft“ (ca. 19 bei ca. 45 Mitgliedern). Der Inhaber will sehen:
- wer alles Mitglied ist,
- wer gezahlt hat und wer nicht,
- wem eine Rechnung fehlt.

Außerdem will er Zahlungen auch Mitgliedern ohne Rechnung zuordnen können.

## 2. Ziele / Nicht-Ziele / Anti-Ziele
**Ziele**
- Der Inhaber kopiert die Mitgliederliste aus der Portal-Admin-Seite (`portal.nexusnetzwerk.de/mitglieder`, Namen und E-Mails) oder lädt eine CSV hoch. Beides fügt er in der App ein: NEXUS → Portal-Mitglieder → „Mitgliederliste einfügen“, mit Vorschau vor dem Übernehmen.
- Jedes Portal-Mitglied erscheint unter NEXUS → Portal-Mitglieder mit Status: Vertrag / Vorschlag offen / keine Rechnung.
- „Vertrag anlegen“ für Mitglieder ohne Rechnung. Danach lassen sich ihre Zahlungen zuordnen.
- „Kein zahlendes Mitglied“ blendet Team-, Test- und Gratis-Zugänge dauerhaft aus.

**Nicht-Ziele**
- Schreiben ins Portal.
- Automatischer Abruf aus dem Portal. Das ist Weg A und folgt später, wenn die Schlüssel da sind.
- Portal-Inhalte wie Videos und Fortschritt.
- Rechnungen in Lexware anlegen (kommt mit Paket 2f).

**Anti-Ziele**
- Mitglieder verschwinden still, weil sie in einer neuen Liste fehlen.
- Kontakte werden über unsichere Namenstreffer automatisch zusammengeführt.
- Ein Vertrag entsteht ohne Inhaber.

## 3. Ansätze
| Weg | Bewertung |
|---|---|
| A – Lesend direkt aus der Portal-Supabase (Auth-Admin-API für E-Mails und Tabelle `profiles`) | **Später.** Immer aktuell, braucht aber den service_role-Schlüssel des Portals. Den hat die Agentur, nicht der Inhaber. |
| **B – Liste einfügen oder CSV hochladen** | **Jetzt gewählt.** Geht sofort und ohne Schlüssel. Die Liste ist so aktuell wie der letzte Import; die App zeigt das Datum. |
| C – Eigener Endpunkt im Portal | Braucht Änderungen am Portal-Code, auf den kein Zugriff besteht. |

## 4. Festlegungen (Calls von Claude, korrigierbar)
- **Verbindung** `portal_nexus` (Firma nexus, Label „NEXUS-Portal“). Keine Umgebungsvariablen.
  - Status „verbunden“ ab dem ersten Import. „Stand“ = Zeitpunkt des Imports.
  - Veraltet erst nach **30 Tagen** (statt 45 Minuten), als Ausnahme je Verbindung in `src/domain/freshness.ts`.
- **Parser** (rein, `src/domain/import/portal-list.ts`):
  - **Freitext:**
    - Je Zeile werden E-Mails per Regex erkannt.
    - Name ist der Text vor der E-Mail in derselben Zeile. Fehlt er, gilt die direkt vorangehende Zeile ohne E-Mail.
    - Sonst ist der Name der Teil der E-Mail vor dem @.
  - **CSV** mit Kopfzeile: Spalten `name`/`Name` (oder `Vorname` + `Nachname`) und `email`/`E-Mail`, getrennt durch `;`, `,` oder Tab.
  - Duplikate werden per E-Mail (kleingeschrieben) zusammengeführt.
  - Vorschau: Anzahl erkannt, Anzahl doppelt, Zeilen ohne E-Mail.
- **Übernehmen** = Client-Event `importPortalList`:
  - Upsert nach E-Mail in `portalMembers` (`externalId` = E-Mail kleingeschrieben).
  - Wer in einer neuen Liste fehlt, wird **nicht** gelöscht. Er behält sein altes `lastSeenInListAt` und erscheint als „nicht mehr in Liste“. Der Inhaber entscheidet.
  - Eine leere Liste wird abgelehnt.
- **Datenform:** `PortalMember { externalId, email, name, firstSeenAt, lastSeenInListAt }` in der State-Liste `portalMembers` (Tabelle per Migration, wie `subscriptions`).
- **Zuordnung Portal ↔ Kontakt:**
  1. Kontakt mit `externalRefs` `portal_nexus:<email>`.
  2. Sonst Kontakt der Firma nexus mit exakt gleicher E-Mail (kleingeschrieben).
  3. Sonst nur der Vorschlag „Ist das …?“ bei strengem Namenstreffer.
  4. Sonst bleibt das Mitglied ohne Kontakt.
- **Status je Portal-Mitglied** (rein abgeleitet in `src/domain/portal.ts`):
  - `contract`: Kontakt hat einen bestätigten Vertrag. Ampel und Rückstand wie bisher.
  - `proposal`: Es gibt einen offenen Vertragsvorschlag für den Kontakt oder die E-Mail.
  - `invoice_only`: Es gibt Lexware-NEXUS-Rechnungen, aber keine Mitgliedschaft (z. B. anderer Text). Die Rechnungen werden angezeigt.
  - `no_invoice`: weder Vertrag noch Vorschlag noch Rechnung → „Rechnung fehlt?“.
  - `ignored`: vom Inhaber als „kein zahlendes Mitglied“ markiert.
- **Vertrag anlegen** (Mitglied ohne Rechnung):
  - gleiche Felder und Prüfung wie bei Vertragsvorschlägen (`contract-draft.ts`)
  - `origin: [{ connectionId: 'portal_nexus', externalId }]`
  - legt den Kontakt an (Name und E-Mail aus der Liste, `externalRefs` portal) oder nutzt den gefundenen
  - `billing: 'legacy'`
- **Hinweis auf Heute:** „N Mitglieder ohne Rechnung“ als Sammelhinweis (Key `portal-no-invoice`, ohne Datum). Er zählt nur Mitglieder der aktuellen Liste.
- **Ausgeblendet:** `ignoredPortalMembers: string[]` bleibt bei jedem Import ausgeblendet.

## 5. Oberfläche
- **NEXUS → Portal-Mitglieder:**
  - Bereich „Mitgliederliste einfügen“ mit Textfeld, Datei-Upload (CSV/TXT), Vorschau und „N Mitglieder übernehmen“.
  - Zusammenfassung: „45 im Portal · 30 mit Vertrag · 8 Vorschlag offen · 7 ohne Rechnung“ und „Liste vom …“.
  - Filter-Segmente: Alle / Ohne Rechnung / Vorschlag / Vertrag.
  - Zeilen mit Name, E-Mail, Status und Ampel bzw. Badge, dazu „nicht mehr in Liste“.
- **Zeile „ohne Rechnung“:** „Vertrag anlegen“ (dieselbe Karte wie bei den Vorschlägen) und „Kein zahlendes Mitglied“.
- **Zeile „Rechnung ohne Mitgliedschaft“:** Rechnungsnummern; „Vertrag anlegen“ übernimmt die Werte der Rechnung als Vorschlag.
- **Verbindungen:** „NEXUS-Portal“ mit Status und Stand.
- Design-Bausteine werden wiederverwendet, Texte sind deutsch, aria-labels enthalten den sichtbaren Text.

## 6. Tests
- **Parser:**
  - kopierte Admin-Seite mit Tabs, „Name <mail>“ und Name in der Zeile davor
  - CSV mit `;` und Anführungszeichen
  - CSV mit `,`
  - Duplikate in anderer Schreibweise
  - Zeilen ohne E-Mail
  - Datei in Windows-1252
- **Import:**
  - Upsert
  - Fehlende bleiben als „nicht mehr in Liste“
  - leere Liste wird abgelehnt
  - Verbindung verbunden mit Stand
  - 30-Tage-Frische
- **Status-Ableitung**, alle fünf Fälle:
  - E-Mail-Match mit Groß- und Kleinschreibung
  - Namenstreffer nur als Vorschlag
  - ausgeblendet bleibt ausgeblendet
- **Vertrag anlegen:**
  - doppelter Tipp ergibt einen Vertrag
  - Validierung
  - Zahlung danach zuordenbar
- **E2E** (Echtmodus, Memory-DB):
  - Liste einfügen, Vorschau, Übernehmen
  - Status
  - „Vertrag anlegen“
  - „Kein zahlendes Mitglied“
  - CSV-Upload

## 7. Dem Bauenden überlassen
Tabellenschnitt, genaue Erkennungsheuristik für Kopf- und Füllzeilen der kopierten Admin-Seite (Vorschau zeigt sie).

## 8. Später (Weg A)
Sobald die Agentur die Portal-Schlüssel herausgibt: ein Connector über die Auth-Admin-API (`GET {url}/auth/v1/admin/users`, `profiles`) speist dieselbe Liste über `importPortalList`-Logik.
