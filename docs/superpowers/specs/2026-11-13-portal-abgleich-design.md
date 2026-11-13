# Design-Spec: Portal-Abgleich (Mitgliederliste aus dem NEXUS-Portal)

**Stand:** 13.11.2026 · **Status:** vom Inhaber gewünscht („Portalzugriff ist so wichtig“), Calls von Claude unten. Danach folgt „Rechnungen lesen“ (Claude), Entscheidung (a): Pläne gelten sofort und sind markiert.

## 1. Warum
In der App fehlen Mitglieder. Vertragsvorschläge gibt es nur aus Rechnungen mit „Mitgliedschaft“ (ca. 19 bei ca. 45 Mitgliedern). Der Inhaber will sehen:
- wer alles Mitglied ist,
- wer gezahlt hat und wer nicht,
- wem eine Rechnung fehlt.

Er will außerdem Zahlungen auch Mitgliedern ohne Rechnung zuordnen können.

## 2. Ziele / Nicht-Ziele / Anti-Ziele
**Ziele**
- Die Mitgliederliste des Portals (`portal.nexusnetzwerk.de`, eigene Supabase) wird lesend abgeglichen, alle 15 Min. und über „Jetzt abgleichen“.
- Jedes Portal-Mitglied erscheint unter NEXUS → Mitglieder mit Status: Vertrag / Vorschlag offen / keine Rechnung.
- „Vertrag anlegen“ für Mitglieder ohne Rechnung. Danach lassen sich ihre Zahlungen zuordnen.
- „Kein zahlendes Mitglied“ blendet Team-, Test- und Gratis-Zugänge dauerhaft aus.

**Nicht-Ziele**
- Schreiben ins Portal.
- Portal-Inhalte wie Videos und Fortschritt.
- Rechnungen in Lexware anlegen (kommt mit Paket 2f).

**Anti-Ziele**
- Der service_role-Schlüssel landet in State, Client oder Log.
- Kontakte werden über unsichere Namenstreffer automatisch zusammengeführt.
- Ein Vertrag entsteht ohne Inhaber.

## 3. Ansätze
| Weg | Bewertung |
|---|---|
| **A – Lesend direkt aus der Portal-Supabase** (Auth-Admin-API für E-Mails + Tabelle `profiles`) | **Gewählt.** Immer aktuell, nichts muss exportiert werden. Der Code des Portals liegt in keinem zugänglichen Repo, aber die öffentliche App zeigt `profiles(id, display_name, avatar_url, created_at)` und Supabase-Auth. |
| B – CSV-Export hochladen | Veraltet sofort, Handarbeit. |
| C – Eigener Endpunkt im Portal | Braucht Änderungen am Portal-Code, auf den kein Zugriff besteht. |

## 4. Festlegungen (Calls von Claude, korrigierbar)
- **Variablen** (nur Production, optional): `PORTAL_SUPABASE_URL`, `PORTAL_SUPABASE_SERVICE_KEY`. Neue Verbindung `portal_nexus` (Firma nexus, Label „NEXUS-Portal“).
- **Abruf:**
  - Konten: `GET {url}/auth/v1/admin/users?page=N&per_page=200` mit den Headern `apikey` und `Authorization: Bearer <service key>`. Daraus `id`, `email`, `created_at`, `last_sign_in_at`, `banned_until`.
  - Namen: `GET {url}/rest/v1/profiles?select=id,display_name,created_at`.
  - Feldnamen gegen die Doku bzw. die erste echte Antwort prüfen.
- **Import:** `PortalMember { externalId (auth id), email (lowercase), name (display_name, sonst Teil vor @), joinedOn, lastSignInAt, blocked }` in einer neuen State-Liste `portalMembers` (Tabelle per Migration, wie `subscriptions`).
- **Zuordnung Portal ↔ Kontakt:**
  1. Kontakt mit `externalRefs` `portal_nexus:<id>`.
  2. Sonst Kontakt der Firma nexus mit exakt gleicher E-Mail (kleingeschrieben).
  3. Sonst nur Vorschlag „Ist das …?“ bei strengem Namenstreffer.
  4. Sonst bleibt das Mitglied ohne Kontakt.
- **Status je Portal-Mitglied** (rein abgeleitet in `src/domain/portal.ts`):
  - `contract`: Kontakt hat einen bestätigten Vertrag. Ampel und Rückstand wie bisher.
  - `proposal`: Es gibt einen offenen Vertragsvorschlag für den Kontakt oder die E-Mail.
  - `invoice_only`: Es gibt Lexware-NEXUS-Rechnungen, aber keine Mitgliedschaft (z. B. anderer Text). Zeigt die Rechnungen.
  - `no_invoice`: weder Vertrag noch Vorschlag noch Rechnung. Das ist der Hinweis „Rechnung fehlt?“.
  - `ignored`: vom Inhaber als „kein zahlendes Mitglied“ markiert.
- **Vertrag anlegen** (Mitglied ohne Rechnung):
  - Gleiche Felder und Prüfung wie bei Vertragsvorschlägen (`contract-draft.ts`).
  - Herkunft `origin: [{ connectionId: 'portal_nexus', externalId }]`.
  - Legt den Kontakt an (Name und E-Mail aus dem Portal, `externalRefs` portal) oder nutzt den gefundenen.
  - `billing: 'legacy'`.
- **Hinweis auf Heute:** „N Mitglieder ohne Rechnung“ als Sammelhinweis (Key `portal-no-invoice`, ohne Datum).
- **Ausgeblendet:** `ignoredPortalMembers: string[]`, bleibt bei jedem Abgleich ausgeblendet.

## 5. Oberfläche
- **NEXUS → Mitglieder:**
  - Oben eine Zusammenfassung: „45 im Portal · 30 mit Vertrag · 8 Vorschlag offen · 7 ohne Rechnung“.
  - Filter-Segmente (Alle / Ohne Rechnung / Vorschlag / Vertrag).
  - Zeilen mit Name, E-Mail, Status und Ampel bzw. Badge.
- **Zeile „ohne Rechnung“:** Aktionen „Vertrag anlegen“ (öffnet dieselbe Karte wie bei den Vorschlägen) und „Kein zahlendes Mitglied“.
- **Zeile „Rechnung ohne Mitgliedschaft“:** zeigt die Rechnungsnummern. „Vertrag anlegen“ nutzt die Werte der Rechnung vor.
- **Verbindungen:** „NEXUS-Portal“ mit Status und „Stand vor …“.
- Design-Bausteine wiederverwenden, Texte auf Deutsch, aria-labels enthalten den sichtbaren Text.

## 6. Tests
- Mapper mit Fixtures (Auth-User-Seiten, `profiles`, fehlender `display_name`, gesperrtes Konto).
- Connector:
  - Blättern
  - Fehler ohne Schlüssel
  - 401 → „Schlüssel prüfen“
- Status-Ableitung, alle fünf Fälle:
  - E-Mail-Match mit Groß- und Kleinschreibung
  - Namenstreffer nur als Vorschlag
  - ausgeblendet bleibt ausgeblendet
- Vertrag anlegen:
  - doppelter Tipp ergibt einen Vertrag
  - Validierung
  - Zahlung danach zuordenbar
- E2E (Echtmodus, Memory-DB, Test-Import mit `portal: true`): Liste mit Status, „Vertrag anlegen“, „Kein zahlendes Mitglied“.

## 7. Dem Bauenden überlassen
Tabellenschnitt, genaue Parameter der Auth-Admin-API (mit Fehlertext bei 400/404 wie bei Lexware).
