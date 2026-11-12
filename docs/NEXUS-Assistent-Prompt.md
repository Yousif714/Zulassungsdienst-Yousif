# Prompt: Mein persönlicher KI-Assistent für NEXUS & Zulassungsdienst Bundesweit

> Diesen gesamten Text in Codex (oder ein anderes Coding-Tool) einfügen.

---

## 0. Bevor du baust

Lies den kompletten Prompt. **Antworte zuerst nur mit:**

1. deiner Einschätzung: Was ist gut, was ist riskant, was würdest du anders machen und warum?
2. deinem Umsetzungsplan in Phasen.
3. maximal 5 offenen Fragen, die du wirklich beantwortet brauchst.

Fang erst mit dem Bauen an, wenn ich deinen Plan bestätigt habe.

---

## 1. Worum es geht: ein Assistent, kein Dashboard

Ich bin Inhaber von zwei Firmen:

- **NEXUS**: ein Mitglieder-Netzwerk mit ca. **40–45 zahlenden Mitgliedern**, regelmäßigen Calls (z. B. „SEELE“, „Finance“) und Content.
- **Zulassungsdienst Bundesweit**: Kfz-Zulassungen für Privatkunden und Autohäuser. Fast alles läuft über **WhatsApp** und das Handy.

**Das Ziel ist ein persönlicher KI-Assistent**, der wie ein sehr guter Büroleiter arbeitet:

- Er ist mit **allen meinen Konten** verbunden: WhatsApp Business, E-Mail, Kalender, Stripe, beide Lexware-Konten, Geschäftskonto.
- Er **beobachtet laufend**, was passiert, und merkt, was durchrutscht.
- Er **meldet sich von selbst**: „Hey, diese 3 Mails sind offen“, „Kunde X hat nicht bezahlt“, „Das kannst du noch abrechnen“, „Das hast du übersehen“.
- Er **coacht mich**: „Das kannst du besser machen“, „Das kannst du automatisieren“.
- Er **erledigt Dinge**: Er bereitet Antworten, Erinnerungen und Zahlungslinks fertig vor, und ich muss nur noch freigeben.

Die App ist die Oberfläche für diesen Assistenten. Die wichtigste Seite ist der **Feed des Assistenten**, keine Sammlung von Statistiken.

**Bewusst NICHT im Umfang:** Anbindung von Zulassungsportalen (i-Kfz, GKS, MyDigitalCar, Nextoz), Portal-Statistiken, Routenplanung. Den Status einer Zulassung setze ich selbst mit einem Tipp oder er wird aus meinen Nachrichten erkannt.

**Nutzer:** nur ich. Web-App (PWA) für iPhone (Homescreen) und Desktop, auf Deutsch, im Apple-Stil.

---

## 2. Aufbau: der Assistent im Zentrum

```
 WhatsApp Business ─┐
 E-Mail (mehrere) ──┤                    ┌───────────────────────────┐
 Kalender ──────────┤   Sync (15 Min.,   │  ASSISTENT                │
 Stripe NEXUS ──────┼─▶ Webhooks) ─────▶ │  1. Regeln & Berechnungen │ ─▶  Feed in der App
 Lexware NEXUS ─────┤   in eine          │     (deterministisch)     │ ─▶  Push 7:00 / 19:00 / sofort
 Lexware Zulassung ─┤   Datenbank        │  2. KI (Claude): verstehen,│ ─▶  Chat
 Geschäftskonto ────┘                    │     formulieren, coachen  │ ─▶  vorbereitete Aktionen
                                          └───────────────────────────┘        (ich gebe frei)
```

**Strikte Arbeitsteilung:**
- **Zahlen rechnet immer Code nach festen Regeln**, nie die KI: Raten, Rückstände, Zuordnungen, Summen, Fristen. Jede Zahl hat einen Rechenweg und eine Quelle.
- **Die KI versteht und formuliert:** Nachrichten lesen und einordnen („Kunde fragt nach Rechnung“, „Kunde schickt eVB“, „Zusage von mir“), Antworten und Erinnerungen entwerfen, Muster erkennen, coachen, Fragen im Chat beantworten. Für Zahlen ruft sie die Daten über Tools ab und verlinkt die Belege.

---

## 3. Was der Assistent können muss

### 3.1 Beobachten und melden (Wachposten)
Er erzeugt **Hinweise** mit Priorität, Begründung, Quelle und einem **vorbereiteten nächsten Schritt**. Beispiele:

**Kommunikation**
- „Autohaus Schmidt wartet seit 3 Std. auf eine Antwort (WhatsApp).“ → Antwortentwurf
- „4 Mails seit gestern unbeantwortet, 2 davon wichtig.“ → Liste mit Entwürfen
- „Du hast Herrn Kaya am Dienstag eine Rechnung versprochen, es gibt noch keine.“ → Rechnungsentwurf
- „Kunde hat Unterlagen geschickt, der Auftrag kann weiter.“

**Geld**
- „3 NEXUS-Mitglieder überfällig, zusammen 1.150 €.“ → Erinnerungen (freundlich/bestimmt) inkl. Stripe-Zahlungslink
- „Überweisung über 250 € eingegangen, gehört wahrscheinlich zu M. Kaya.“ → bestätigen
- „Stripe meldet bezahlt, in Lexware ist die Rechnung noch offen.“
- „Für Mitglied X gibt es eine Rechnung in Lexware **und** in Stripe, mögliche Doppelrechnung.“
- „Zulassung für Autohaus Müller erledigt, aber noch nicht abgerechnet.“ → Rechnungsentwurf
- „Autohaus Müller hat 2 überfällige Rechnungen, zusammen 640 €.“

**Termine & Aufgaben**
- „SEELE heute 20:00, Folientexte noch nicht vorbereitet.“ → Entwurf liegt bereit
- „Morgen 3 Termine, bei einem fehlt die Adresse.“

### 3.2 Coachen
Abends ein kurzer Tagesrückblick, sonntags ein Wochenrückblick. Er macht **konkrete Vorschläge auf Basis meiner echten Daten**, keine Allgemeinplätze. Beispiele:
- „9-mal diese Woche dieselbe Unterlagen-Erklärung per WhatsApp geschrieben. Hier ist eine fertige Schnellantwort.“
- „Zwischen erledigter Zulassung und Rechnung vergehen im Schnitt 2 Tage. Soll ich dich direkt danach erinnern?“
- „Mitglied Y zahlt seit 4 Monaten am 6. statt am 1. Fälligkeit auf den 5. legen?“
- „Deine Antwortzeit auf WhatsApp war heute im Schnitt 2,5 Std., gestern 40 Min.“
- „3 Vor-Ort-Termine ohne Aufpreis berechnet, zusammen 105 €.“
- „Die SEELE-Folien machst du immer am Call-Tag. Soll der Entwurf 2 Tage vorher fertig sein?“

Jeder Vorschlag hat die Knöpfe **Übernehmen · Später · Nicht mehr vorschlagen**. Der Assistent merkt sich meine Entscheidungen.

### 3.3 Chat
Ich kann alles fragen, per Text oder Diktat. Die Antworten sind mit Belegen verlinkt. Diese Fragen müssen in der Vorschau funktionieren:
- „Wer ist bei NEXUS überfällig?“
- „Was ist heute noch offen?“
- „Was fehlt für SEELE?“
- „Was ist mit dem Auftrag von Autohaus Schmidt?“
- „Wie viel Geld kommt diesen Monat noch rein?“

### 3.4 Erledigen (mit Freigabe)
Der Assistent bereitet Aktionen fertig vor. Ich prüfe und tippe auf **Senden/Anlegen**:
- WhatsApp- oder Mail-Antwort senden
- Zahlungserinnerung mit Stripe-Link senden
- Rechnungsentwurf in Lexware anlegen
- Termin im Kalender anlegen
- Folientexte für Gamma kopieren

**Grundregel:** Ohne meine Freigabe wird nichts verschickt oder angelegt. Später kann ich einzelne Abläufe gezielt auf „automatisch“ stellen (z. B. die erste freundliche Zahlungserinnerung). Jede ausgeführte Aktion steht in einem Protokoll.

**Ausbaustufen:** Zuerst nur lesen und Entwürfe zeigen. Danach Senden/Anlegen mit Freigabe. Danach einzelne Automatiken.

### 3.5 Push-Mitteilungen
- **7:00 Morgenbriefing:** die 3 wichtigsten Dinge, Termine, Geld, offene Nachrichten
- **19:00 Abendrückblick:** was erledigt wurde, was offen bleibt, Coach-Tipps
- **Sofort** nur bei echten Problemen (z. B. wichtiger Kunde wartet lange, große Zahlung unklar)

Die Architektur muss einen **Hintergrunddienst** haben, der auch bei geschlossener App synchronisiert, Hinweise erzeugt und Push verschickt.

### 3.6 Der Assistent schreibt mir per WhatsApp (Hauptkanal)
Ich bin den ganzen Tag in WhatsApp. Deshalb meldet sich der Assistent **wie ein Mitarbeiter per WhatsApp bei mir**, und ich kann ihm dort auch antworten und Aufträge geben.

- **Eigene Nummer für den Assistenten:** Der Assistent bekommt eine **separate WhatsApp-Business-Nummer** (Cloud API), zum Beispiel als Kontakt „Nexus Assistent“. Meine Kunden-Nummer bleibt davon getrennt.
- **Was er schickt:** Morgenbriefing (7:00), Abendrückblick (19:00), dringende Hinweise sofort, Coach-Tipps. Kurz und klar, mit Link in die App für Details.
- **Interaktive Knöpfe:** Bei vorbereiteten Aktionen gibt es WhatsApp-Antwortknöpfe, z. B. **Senden · Ändern · Später**. Beispiel:
  > „Autohaus Schmidt wartet seit 3 Std. Entwurf: ‚Hallo Herr Schmidt, die Unterlagen sind da, Zulassung läuft heute.‘“ [Senden] [Ändern] [Später]
- **Ich kann ihm schreiben**, wie im Chat in der App:
  - „Wer ist überfällig?“
  - „Schick Kaya die Erinnerung.“
  - „Erinnere mich morgen um 9 an Müller.“
  - „Mach die SEELE-Folien fertig.“
- **Sprachnachrichten:** Ich will ihm auch Sprachnachrichten schicken können. Dafür braucht es einen Speech-to-Text-Dienst. Schlag einen passenden vor (EU-Datenschutz beachten).
- **Sicherheit:**
  - Der Assistent nimmt Befehle **nur von meiner eigenen Nummer** an. Alles andere wird ignoriert und protokolliert.
  - Aktionen, die etwas an Kunden oder Mitglieder verschicken oder anlegen, brauchen **immer eine ausdrückliche Bestätigung** (Knopf oder „Ja“). Ausnahme sind nur Abläufe, die ich in der App ausdrücklich auf automatisch gestellt habe.
  - Jede Aktion steht im Protokoll in der App.
- **WhatsApp-Regeln beachten:** Frei formulierte Nachrichten sind nur innerhalb von 24 Stunden nach meiner letzten Nachricht an den Assistenten erlaubt. Außerhalb dieses Fensters, etwa beim Morgenbriefing nach einem ruhigen Tag, muss eine **freigegebene Vorlagen-Nachricht (Kategorie Utility)** genutzt werden, z. B. „Dein Briefing für heute ist da“ mit den wichtigsten Punkten als Variablen. Lege die nötigen Vorlagen an und beschreibe den Freigabeprozess bei Meta.
- **Fallback:** Wenn WhatsApp nicht erreichbar ist, kommt dieselbe Meldung als Push in der App.

---

## 4. NEXUS: Mitgliedsbeiträge (wichtigste Datenlogik)

### 4.1 Ausgangslage
- Die meisten Mitglieder sind **seit August** dabei und zahlen eine **Gesamtsumme in Monatsraten** (z. B. 6 oder 12 Raten), bisher **fast alle per Überweisung**.
- Abgerechnet wurde bisher über **Lexware Office (NEXUS-Konto)**. **Stripe** nutze ich erst seit Kurzem, künftig soll alles darüber laufen.
- Einige Mitglieder haben **Sonderkonditionen**.
- In Stripe kann ich nicht rückwirkend ab August Raten anlegen.

### 4.2 Mitgliedsvertrag in der App
Pro Mitglied: Gesamtsumme, Sonderkondition, Anzahl Raten, Ratenbetrag, Fälligkeitstag, Startdatum, Ausnahmen (Stundung, verschobene Fälligkeit, Pause), Notiz.

Daraus berechnet der Code täglich **getrennt**:
- **bereits fällige Raten:** bezahlt / unbezahlt → **Rückstand**
- **künftig fällige Raten** → **Restbetrag nach Plan**
- Ampel: 🟢 im Plan · 🟡 bis 7 Tage drüber · 🔴 überfällig
- Zahlungsverlauf

**Regeln (Standard, später pro Mitglied änderbar):**
- Teilzahlungen werden auf die **älteste offene Rate zuerst** verteilt.
- Bei widersprüchlichen Ständen gilt: **tatsächlicher Geldeingang (Bank/Stripe)** vor **Rechnungsstatus in Lexware**. Widersprüche werden als Hinweis gemeldet, nicht still aufgelöst.

### 4.3 Bestandsmitglieder übernehmen
Ein Assistent führt mich durch jedes Mitglied:
1. Bisherige Zahlungen seit August werden aus Bank und Lexware **vorgeschlagen**, ich bestätige oder korrigiere.
2. Die Vorschau zeigt mit Rechenweg: **Rückstand** (fällig, unbezahlt) und **künftige Raten**, getrennt, sodass keine Rate doppelt auftaucht.
3. Ich wähle: Rückstand als Nachzahlung zur ersten Stripe-Rate **oder** auf die Restraten verteilt.
4. Ergebnis: vorbereiteter Stripe-Ratenplan nur für den Rest. Das Anlegen in Stripe ist eine eigene, ausdrücklich freigegebene Aktion.

### 4.4 Zahlungen zuordnen
- **Stripe** ordnet eindeutig zu.
- **Banküberweisungen:** Eine bestätigte IBAN ist ein **Hinweis auf den Zahler**. Für die Zuordnung zur konkreten Rate zählen zusätzlich Betrag, Datum und Verwendungszweck. Bei hoher Sicherheit automatisch, sonst kommt sie in die Liste **„Zuordnen“**. Sammelzahlungen und Zahlungen durch Dritte gehen immer in die Prüfung.
- **Lexware ↔ Stripe:** Der Abgleich unterscheidet, ob es zwei Rechnungen sind (→ Warnung) oder ob die Stripe-Zahlung eine Lexware-Rechnung begleicht (→ Hinweis zur Verbuchung).

### 4.5 Calls & Content
- Calls mit Datum, Thema und Stand der Folientexte: **vorbereiten → prüfen → für Gamma kopieren**. SEELE hat standardmäßig 10 Folien, bei Finance ist die Anzahl einstellbar. Die KI schreibt den vollständigen Folientext, Gamma macht das Design.
- Content-Board: **Idee → Rohmaterial → Schnitt → Freigabe → veröffentlicht**.

---

## 5. Zulassungsdienst (schlank)

- **Kunden** (Privat/Autohaus) → **Fahrzeuge** (FIN, Kennzeichen) → **Aufträge** (Leistung, Status, Standort Bottrop/Essen/Online/Vor-Ort, Notiz).
- Status einfach: **offen → wartet auf Kunde → erledigt → abgerechnet → bezahlt**. Ich setze ihn mit einem Tipp, oder der Assistent schlägt ihn aus Nachrichten vor („Kunde hat eVB geschickt“).
- Nachrichten (WhatsApp/Mail) werden dem Kunden und Auftrag zugeordnet (Telefonnummer, Mail, Kennzeichen/FIN im Text). Nicht zuordenbare kommen in „Zuordnen“.
- Rechnungen kommen aus dem **zweiten Lexware-Konto** (nur Zulassungsdienst). Der wichtigste Hinweis ist „erledigt, aber nicht abgerechnet“, dazu überfällige Rechnungen pro Kunde.
- Einfache Zahlen: heute erledigt, offen, wartet auf Kunde, nicht abgerechnet.

---

## 6. App-Oberfläche

- **iPhone:** unten drei Tabs **Heute · NEXUS · Zulassungsdienst** plus ein Assistenten-Knopf (Chat, auch per Diktat).
- **Desktop:** Seitenleiste.
- **Heute = Feed des Assistenten:**
  1. **Höchstens 3 Dinge, die jetzt zählen**, jeweils mit vorbereitetem Schritt
  2. Termine heute
  3. Geld: offen und überfällig pro Firma (Wallet-Stil)
  4. Nachrichten mit Antwortbedarf
  5. Coach-Tipp des Tages
- Jede Zeile führt mit einem Tipp zur Quelle (Nachricht, Rechnung, Mitglied, Auftrag, Call).
- **Stil:** Apple Erinnerungen (Aufgaben), Apple Wallet (Beträge), iOS-Einstellungen (Details). Große Touch-Flächen, ruhige Farben, System-Schrift, kompakte Listen, Dark Mode.
- Prüfe die UI gegen Web-Interface-Guidelines (falls verfügbar: `npx skills add vercel-labs/agent-skills --skill web-design-guidelines`).

---

## 7. Verbindungen

Eine Seite **„Verbindungen“** zeigt pro Verbindung: Firma, Status, letzter erfolgreicher Abruf, nächster Schritt mit kurzer Klickanleitung.

| Verbindung | Weg | Priorität |
|---|---|---|
| WhatsApp Assistent (an mich) | **eigene, zweite Nummer** über die WhatsApp Cloud API. Der Assistent schreibt mir und nimmt meine Befehle entgegen (siehe 3.6). Vorlagen-Nachrichten bei Meta freigeben lassen. | **hoch** |
| WhatsApp Business (Kunden) | WhatsApp Business Platform (Cloud API), bevorzugt im **Coexistence-Modus**, damit ich die Business-App am Handy weiter normal nutze. Prüfen, ob das mit meiner Nummer geht und über welchen Anbieter. | **hoch** |
| E-Mail | Gmail API; iCloud über IMAP (App-Passwort); info@nexusnetzwerk.de: Anbieter ermitteln | **hoch** |
| Stripe NEXUS | Stripe API + Webhooks (zunächst lesender Restricted Key) | **hoch** |
| Lexware NEXUS | Lexware Office Public API (prüfen, ob der API-Zugang im Tarif enthalten ist) | **hoch** |
| Lexware Zulassungsdienst | eigenes Konto, eigener Schlüssel | **hoch** |
| Geschäftskonto | erst **CSV/CAMT-Import** seit 1. August, danach laufend über einen PSD2-Anbieter (z. B. finAPI/Tink, prüfen) | **hoch** |
| Kalender | Google Calendar API bzw. CalDAV (iCloud) | mittel |

Fehlt eine Verbindung, arbeite an den übrigen weiter. Zugangsdaten nur serverseitig in der sicheren Konfiguration, nie im Client. Privilegierte Supabase-Schlüssel nur auf dem Server.

---

## 8. Technik

| Baustein | Wahl |
|---|---|
| App | **Next.js (TypeScript), PWA** (Homescreen, Web-Push ab iOS 16.4) |
| Datenbank, Auth, Dateien, Jobs | **Supabase**, Region EU (Frankfurt) |
| Hosting | **Vercel** |
| KI | **Claude API** über das offizielle Anthropic-SDK (`@anthropic-ai/sdk`), Hauptmodell `claude-opus-5-5`. `claude-haiku-5-5` erst zuschalten, wenn es für die Vorsortierung messbar Zeit oder Geld spart. |
| Tests | **Playwright** (iPhone-Profil + Desktop) und Unit-Tests |

- **Login:** Passkey (Face ID auf dem iPhone) plus Wiederherstellungsweg.
- **Datentrennung:** Jeder Datensatz gehört eindeutig zu NEXUS oder zum Zulassungsdienst.
- **KI-Verbrauch** pro Monat in der App anzeigen, Monatslimit konfigurierbar. Prompt-Caching nutzen.
- **Datenschutz:** EU-Server, Dokumente verschlüsselt, automatische Löschfrist konfigurierbar.

---

## 9. Vorschau mit Demo-Daten

- Realistische **fiktive** Daten: ca. 40 Mitglieder mit verschiedenen Ratenplänen (Sonderkonditionen, Bestandsmitglieder seit August, einige überfällig), ca. 10 Autohäuser und Privatkunden mit Aufträgen, WhatsApp- und Mail-Verläufe (inkl. einer gebrochenen Zusage), Termine, Calls, Content.
- Demo-Aktionen sind sichtbar gekennzeichnet.
- Morgenbriefing, Abendrückblick und Coach-Tipps beispielhaft zeigen.

---

## 10. Abnahme

Automatisiert (Playwright) auf **iPhone-Breite** und **Desktop**:

1. **Heute** zeigt die 3 wichtigsten Hinweise. Ein Tipp auf „Kunde wartet seit 3 Std.“ öffnet den Verlauf mit Antwortentwurf, und „Senden“ ist als Demo-Aktion markiert.
2. **NEXUS** → überfälliges Mitglied → Rechenweg (Rückstand vs. künftige Raten) → Erinnerung mit Stripe-Link vorbereitet.
3. **NEXUS** → „Mitglied übernehmen“ für ein Bestandsmitglied seit August → Rückstand und künftige Raten korrekt getrennt, keine Rate doppelt.
4. **NEXUS** → unbekannte Überweisung → „Zuordnen“ → bestätigen → nächste passende Zahlung derselben IBAN wird automatisch vorgeschlagen.
5. **NEXUS** → Lexware-Rechnung offen + Stripe bezahlt → Hinweis zur Zuordnung.
6. **Heute** → SEELE-Call → fertige Folientexte für Gamma kopieren.
7. **Zulassungsdienst** → erledigter, nicht abgerechneter Auftrag → Rechnungsentwurf vorbereitet.
8. **Chat:** die 5 Fragen aus 3.3 liefern korrekte, verlinkte Antworten.
9. **Gebrochene Zusage** aus dem Chatverlauf wird als Hinweis erkannt.
10. **WhatsApp-Assistent (simuliert):** Morgenbriefing kommt an. Ich antworte „Wer ist überfällig?“ und bekomme die korrekte Liste. Ich tippe bei einer Erinnerung auf [Senden], und sie ist im Protokoll als Demo-Aktion erfasst. Eine Nachricht von einer fremden Nummer wird ignoriert.

**Unit-Tests** für: Ratenplan (Soll, Ist, Rückstand, künftige Raten, Sonderkonditionen, Stundung), Teilzahlungsverteilung (älteste Rate zuerst), Übernahmeberechnung, Zahlungszuordnung.

---

## 11. Lieferung

- klickbare Vorschau, die ich **auf dem iPhone** öffnen kann (oder der konkrete nächste Schritt dafür)
- Screenshots (iPhone + Desktop)
- kurze Liste:
  - Was funktioniert?
  - Was läuft mit Beispieldaten?
  - Für welche Live-Verbindung brauche ich noch einen Klick, Schlüssel oder eine Freigabe (mit Klickanleitung)?
  - Ergebnis der WhatsApp-Coexistence- und Lexware-Tarif-Prüfung
