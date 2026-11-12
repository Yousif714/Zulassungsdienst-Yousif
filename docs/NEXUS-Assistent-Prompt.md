# Prompt: Persönliche Assistenz-App für NEXUS & Zulassungsdienst Bundesweit

> Diesen gesamten Text in Codex (oder ein anderes Coding-Tool) einfügen.

---

## 0. Bevor du baust

Lies den kompletten Prompt. **Antworte zuerst nur mit:**

1. deiner Einschätzung: Was ist gut, was ist riskant, was würdest du anders machen und warum?
2. deinem Umsetzungsplan in Phasen (mit grober Dauer).
3. maximal 5 offenen Fragen, die du wirklich beantwortet brauchst.

Fang erst mit dem Bauen an, wenn ich deinen Plan bestätigt habe.

---

## 1. Worum es geht

Ich bin Inhaber von zwei Firmen und verliere den Überblick:

- **NEXUS**: ein Mitglieder-Netzwerk mit ca. **40–45 zahlenden Mitgliedern**, regelmäßigen Calls (z. B. „SEELE“, „Finance“) und Content (Reels/Videos).
- **Zulassungsdienst Bundesweit** (zulassung-bundesweit.de): Kfz-Zulassungen für Privatkunden und Autohäuser. Zwei Büros in **Bottrop** und **Essen**. Das meiste läuft aber **online** (i-Kfz) und über **WhatsApp** am Handy. Gegen Aufpreis fahren wir auch zu Kunden und Autohäusern (**Vor-Ort-Service**).

Ich will eine **eigene, deutschsprachige Web-App (PWA)** fürs iPhone und den Desktop. Auf dem iPhone soll sie sich zum Homescreen hinzufügen lassen. **In 30 Sekunden** will ich sehen, was heute ansteht, wer noch zahlen muss, auf welche Nachrichten wir antworten müssen und welche Zulassungen durch sind.

Die App ist **mein persönlicher Assistent**. Sie beobachtet alle meine Konten, erkennt selbst, was durchrutscht, und sagt mir aktiv, was ich besser machen oder automatisieren kann.

**Nutzer:** nur ich. Keine Mitarbeiter-Logins, keine Rollen. Login per **Passkey / Face ID**.

---

## 2. Technik (Vorschlag; begründe Abweichungen)

| Baustein | Wahl |
|---|---|
| App | **Next.js (TypeScript), als PWA** (Manifest, Homescreen-Icon, Web-Push ab iOS 16.4) |
| Datenbank, Auth, Dateien, Jobs | **Supabase**, Region EU (Frankfurt) |
| Hosting | **Vercel** (Vorschau-Link fürs iPhone) |
| KI | **Claude API** über das offizielle Anthropic-SDK für TypeScript (`@anthropic-ai/sdk`) |
| Tests | **Playwright** (Chromium + WebKit mit iPhone-Profil) |

**KI-Modelle:**
- `claude-opus-5-5` als Hauptmodell: Chat-Assistent, Coach-Analysen, Folientexte, schwierige Zuordnungen, Dokumente auslesen.
- `claude-haiku-5-5` optional für die Massen-Vorsortierung eingehender Nachrichten (Rückfrage? Welche Akte? Dringend?). Das soll per Konfiguration umschaltbar sein.
- **Grundregel:** Die KI rechnet nie selbst. Beträge, Fristen und Statistiken kommen immer aus der Datenbank, die KI ruft sie über Tools ab und verlinkt die Quelle.
- Prompt-Caching für die festen Systemanweisungen nutzen. Den Verbrauch pro Monat in der App anzeigen und ein Monatslimit konfigurierbar machen.

**Grobe erwartete Betriebskosten:** KI ca. 60–110 $/Monat, Vercel Pro ca. 20 $, Supabase Pro ca. 25 $, WhatsApp-Anbieter ca. 50 €, Bank-API 0–50 €. Weise mich auf günstigere gleichwertige Optionen hin.

---

## 3. Grundprinzipien

1. **Zwei Firmen strikt getrennt.** Daten von NEXUS und vom Zulassungsdienst werden nie vermischt. Nur auf „Heute“ stehen sie nebeneinander, klar gekennzeichnet.
2. **Erste Ausbaustufe nur lesend.** Die App ändert nichts in Lexware, Stripe, Bank oder Postfächern.
3. **Der Assistent schlägt vor, ich entscheide.** Er verschickt nichts von selbst an Kunden oder Mitglieder. Später kann ich einzelne Abläufe gezielt freigeben, z. B. automatische Zahlungserinnerungen.
4. **Jede Zahl und jede wichtige Zeile ist antippbar** und führt zur passenden, gefilterten Liste, Rechnung, Nachricht, Akte oder Call-Seite.
5. **Datenschutz pragmatisch:** EU-Server, Dokumente (Ausweise, Fahrzeugscheine) verschlüsselt ablegen und nach einer konfigurierbaren Frist automatisch löschen. Zugangsdaten nur in der sicheren Server-Konfiguration, nie im Client.

---

## 4. NEXUS: Mitglieder und Zahlungen (das Herzstück)

### 4.1 Ausgangslage
- Die meisten Mitglieder sind **seit August** dabei und zahlen eine **Gesamtsumme in Monatsraten** (z. B. 6 oder 12 Raten), bisher **fast alle per Überweisung** aufs Geschäftskonto.
- Abgerechnet wurde bisher über **Lexware Office (NEXUS-Konto)**.
- **Stripe** nutze ich erst seit wenigen Tagen. Künftig soll alles über Stripe laufen, inklusive Ratenplan auf der Rechnung.
- Einige Mitglieder haben **Sonderkonditionen** (Rabatte, andere Raten, andere Fälligkeiten).
- **Problem:** Ich kann in Stripe nicht rückwirkend ab August Rechnungen bzw. Raten anlegen.

### 4.2 Lösung: Der Mitgliedsvertrag lebt in der App
Pro Mitglied gibt es einen **Vertrag** als Quelle der Wahrheit dafür, wer was schuldet:
- Gesamtsumme, Rabatt/Sonderkondition, Anzahl Raten, Ratenbetrag, Fälligkeitstag, Startdatum
- Ausnahmen: Stundung, verschobene Fälligkeit („zahlt immer am 15.“), Pausen
- Notizfeld für Absprachen

Daraus berechnet die App täglich:
- **Soll bis heute, Ist bis heute, Rückstand**, Restbetrag gesamt, nächste Fälligkeit
- Ampel: 🟢 im Plan · 🟡 bis 7 Tage drüber · 🔴 überfällig
- Zahlungsverlauf (z. B. „zum dritten Mal spät“)

Die Zahlungsquelle (Überweisung, Stripe, bar) ist für die Berechnung egal.

### 4.3 Bestandsmitglieder übernehmen (Assistent „Mitglied übernehmen“)
1. Alte Zahlungen seit August werden **vorgeschlagen** (aus Lexware und Bankumsätzen). Ich bestätige oder korrigiere.
2. Die App berechnet den Restbetrag. Beispiel: 3.000 € gebucht, 4 × 250 € bezahlt, also 2.000 € offen in 8 Raten.
3. Für Stripe wird **nur der Rest** als Ratenplan ab der nächsten Fälligkeit vorgesehen. Auf der Rechnung steht „bereits gezahlt: X €“. Anlegen in Stripe erst in einer späteren, schreibenden Ausbaustufe; bis dahin gibt es eine Anleitung bzw. vorbereitete Daten.
4. Verpasste Raten werden als **Nachzahlung** behandelt: entweder zur ersten Stripe-Rate addiert oder auf die Restraten verteilt, wählbar pro Mitglied.

Neue Mitglieder werden direkt mit Stripe-Ratenplan angelegt, die App liest ihn nur aus.

### 4.4 Zahlungsabgleich
- **Stripe-Zahlungen** sind eindeutig dem Mitglied zugeordnet.
- **Banküberweisungen** werden über IBAN, Name, Betrag und Verwendungszweck zugeordnet. Bei hoher Sicherheit automatisch, sonst als Vorschlag in der Liste **„Zuordnen“** (ein Tipp auf ✓).
- **Lernen:** Eine einmal bestätigte IBAN gehört künftig automatisch zu diesem Mitglied, auch wenn ein Dritter zahlt (Bruder, Firma).

### 4.5 Automatische Hinweise
- „3 Mitglieder überfällig, zusammen 1.150 €“, mit Liste und fertigem Erinnerungstext (freundlich/bestimmt, WhatsApp oder Mail, inkl. Stripe-Zahlungslink).
- „Zahlung eingegangen, keinem Mitglied zuordenbar.“
- „Stripe meldet bezahlt, Lexware zeigt noch offen.“ Das ergibt eine Aufgabe zur Zuordnung.
- **Doppelrechnung-Warnung:** Für dasselbe Mitglied existiert eine Rechnung in Lexware **und** in Stripe.
- **Monatsvorschau:** „Im Dezember erwartest du noch 9.750 €, davon 1.250 € von Wackelkandidaten.“
- Hinweis zur Buchhaltung: Wenn Stripe die Rechnungen stellt, bekommt Lexware nur die Zahlungen bzw. Auszahlungen zum Verbuchen. Prüfe und beschreibe den sauberen Weg (z. B. Stripe als Zahlungskonto in Lexware).

### 4.6 Calls
- Liste mit Datum, Uhrzeit, Thema und Stand: **Folientexte vorbereiten → prüfen → für Gamma kopieren**.
- **SEELE** hat standardmäßig **10 fertige Folientexte**, bei **Finance** ist die Anzahl pro Call einstellbar.
- Die KI liefert den vollständigen Folientext. Gamma übernimmt die visuelle Umsetzung. Ein Tipp kopiert alles im Gamma-tauglichen Format.
- Optional: Der Entwurf ist automatisch 2 Tage vor dem Call fertig.

### 4.7 Content
Board: **Idee → Rohmaterial → Schnitt → Freigabe → veröffentlicht**.

---

## 5. Zulassungsdienst Bundesweit

### 5.1 Datenmodell
```
Kunde (Privat oder Autohaus)
 └─ Fahrzeuge (FIN, Kennzeichen, Modell)
     └─ Vorgänge (Neuzulassung, Umschreibung, Abmeldung, Wunschkennzeichen …, Option „Express“)
         ├─ Unterlagen-Checkliste
         ├─ Nachrichten (Mail/WhatsApp)
         ├─ Portal-Verlauf (Ereignisse)
         ├─ Standort: Bottrop | Essen | Online | Vor-Ort-Service
         └─ Rechnung (Lexware Zulassungsdienst)
```

### 5.2 Unterlagen-Checkliste je Leistung
Jede Leistung hat ihre Pflichtunterlagen, z. B. bei der Umschreibung ZB I + II, eVB, Ausweis, Vollmacht, SEPA-Mandat für die Kfz-Steuer. Eingehende Unterlagen per Mail/WhatsApp werden der Akte zugeordnet und abgehakt. Die KI liest FIN und Name aus dem Foto und gleicht sie mit der Akte ab. Fehlendes steht sichtbar in der Akte: „Fehlt: eVB · Kunde seit 2 Tagen gefragt“.

### 5.3 Status
```
Angelegt → Unterlagen vollständig → Eingereicht (Portal) → Bestätigt
                                         ↘ Abgelehnt → korrigiert → neu eingereicht
→ Abgerechnet → Bezahlt
```
Zusätzlich ein Etikett, wer am Zug ist: **„Wir sind dran“** oder **„Wartet auf Kunde“**. Auf „Heute“ erscheint nur, was ich tun muss.

### 5.4 Portale (MyDigitalCar, Nextoz, i-Kfz/GKS)
- **Stufe 1:** Aus der Akte direkt ins richtige Portal springen. „Eingereicht“ und „Bestätigt“ setze ich mit einem Tipp.
- **Stufe 1b:** Portal-Bestätigungs- und Ablehnungsmails im Postfach erkennen (FIN/Vorgangsnummer) und den Status **automatisch** setzen.
- **Stufe 2:** Echte API nur, wo offiziell verfügbar. Prüfe je Portal, ob es offizielle Schnittstellen für Übermittlung und Status gibt (GKS setzt eine Zulassung als Großkunde voraus). Berichte mir das Ergebnis.
- In der Vorschau wird der Ablauf simuliert.

### 5.5 Nachrichten zuordnen
Mails und WhatsApp werden über Telefonnummer, Mailadresse, Kennzeichen oder FIN im Text der richtigen Akte zugeordnet. Klappt das nicht, landen sie in „Zuordnen“.

### 5.6 Tagesstatistik
- Bestätigte Online-Zulassungen, eingereichte Vorgänge, Ablehnungen, fehlende Unterlagen, Schaltervorgänge.
- **Zählregel:** Gezählt werden **Vorgänge, nicht Ereignisse**. Eine Bestätigung zählt **genau einmal pro Vorgang am Bestätigungsdatum in Europe/Berlin**. Eine erneute Einreichung erhöht die Einreichungen, erzeugt aber **keinen** zweiten bestätigten Vorgang. Das muss technisch erzwungen sein (z. B. eindeutiger Index) und getestet werden.
- Filter: Datum, Portal, Standort, Händler, Leistung. Jede Zahl öffnet ihre Vorgangsliste.

### 5.7 Rechnungen
Das **zweite Lexware-Konto** wird ausschließlich für den Zulassungsdienst genutzt. Rechnungen werden über den Kunden plus Kennzeichen/FIN im Rechnungstext dem Vorgang zugeordnet. Hinweise:
- „Bestätigt, aber noch nicht abgerechnet“
- Offene und überfällige Rechnungen pro Autohaus
- Vor-Ort-Service ohne Aufpreis auf der Rechnung

---

## 6. Heute (Startseite)

1. **Oben höchstens 3 Aufgaben**, die jetzt meine Aufmerksamkeit brauchen, jeweils mit dem nächsten konkreten Schritt. Beispiele: „SEELE heute 20:00 Uhr · Folientexte vorbereiten“, „Autohaus Schmidt wartet seit 3 Std. auf Antwort“.
2. Heutige Termine
3. Offene und überfällige Beträge **pro Firma**
4. Nachrichten mit Antwortbedarf
5. Heute bestätigte Online-Zulassungen
6. Content, der auf Schnitt, Freigabe oder Veröffentlichung wartet

---

## 7. Assistent (drei Rollen)

### 7.1 Chat
Ein Chat in der App, mit Tool-Zugriff auf die Datenbank. Die Antworten sind mit ihrer Quelle verlinkt. Diese Fragen müssen in der Vorschau funktionieren:
- „Was fehlt für SEELE?“
- „Warum hängt der Expressauftrag?“
- „Wer ist bei NEXUS überfällig?“

### 7.2 Wachposten (laufend)
Meldet sofort, was durchrutscht:
- unbeantwortete Kundennachrichten (mit Wartezeit)
- nicht zuordenbare Zahlungen
- bestätigte, aber nicht abgerechnete Zulassungen
- Zusagen aus Chats, die nicht eingehalten wurden („Rechnung versprochen, existiert nicht“)

### 7.3 Coach (abends täglich, sonntags Wochenrückblick)
Konkrete Verbesserungs- und Automatisierungsvorschläge auf Basis meiner echten Daten, keine Allgemeinplätze. Beispiele:
- „9-mal diese Woche dieselbe Unterlagen-Erklärung per WhatsApp. Hier ist eine fertige Schnellantwort.“
- „Bei Autohaus Müller vergehen im Schnitt 2 Tage zwischen Bestätigung und Rechnung. Soll ich direkt nach jeder Bestätigung erinnern?“
- „Mitglied Y zahlt seit 4 Monaten am 6. statt am 1. Fälligkeit auf den 5. legen?“
- „3 Vor-Ort-Termine ohne Aufpreis, zusammen 105 €.“
- „SEELE-Folien immer am selben Tag. Entwurf automatisch 2 Tage vorher?“

Jeder Vorschlag hat die Knöpfe „Übernehmen“, „Später“ und „Nicht mehr vorschlagen“.

### 7.4 Push-Mitteilungen
- **7:00 Morgenbriefing**
- **19:00 Abendstatistik + Coach-Tipps**
- sofort nur bei echten Problemen

Die Architektur muss so vorbereitet sein, dass ein **Hintergrunddienst auch bei geschlossener App** synchronisiert (z. B. alle 15 Minuten) und erinnert.

---

## 8. Verbindungen

Eine Seite **„Verbindungen“** zeigt pro Verbindung: Firma, Status (verbunden / fehlt / Fehler), letzten Datenstand, nächsten Schritt.

| Verbindung | Firma | Weg |
|---|---|---|
| Lexware Office NEXUS | NEXUS | Lexware Public API (API-Schlüssel). Prüfen, ob der API-Zugang im Tarif enthalten ist. |
| Lexware Office Zulassungsdienst | Zulassungsdienst | eigenes Konto, eigener Schlüssel |
| Stripe NEXUS | NEXUS | Stripe API + Webhooks (zunächst Restricted Key, nur lesend) |
| Geschäftskonto | beide, je nach Konto | **Einmalig:** CSV/CAMT-Import der Umsätze seit 1. August. **Laufend:** PSD2-Anbieter (z. B. finAPI oder Tink, prüfen), Freigabe alle 180 Tage erneuern. |
| Gmail | — | Gmail API (OAuth) |
| iCloud Mail | — | IMAP mit App-spezifischem Passwort |
| info@nexusnetzwerk.de | NEXUS | Anbieter ermitteln (Google Workspace, Microsoft 365 oder IMAP beim Hoster) |
| Kalender | — | Google Calendar API bzw. CalDAV (iCloud) |
| WhatsApp Business | v. a. Zulassungsdienst | **WhatsApp Business Platform (Cloud API)**, bevorzugt im **Coexistence-Modus**, damit ich die WhatsApp-Business-App auf dem Handy weiter normal nutze und die Chats inkl. Verlauf trotzdem synchronisiert werden. Prüfen, ob das für meine Nummer geht und über welchen Anbieter (z. B. 360dialog). |
| Zulassungsportale | Zulassungsdienst | siehe 5.4 |

Für jede Verbindung, die einen Login, eine Freigabe oder einen Schlüssel von mir braucht: **eine kurze Klickanleitung** in der App. Fehlt eine Verbindung, arbeite an den übrigen weiter.

**Priorität nach der Vorschau:** lesender Anschluss von beiden Lexware-Konten, NEXUS-Stripe, Bank (CSV-Import), Kalender und E-Mail. WhatsApp danach.

---

## 9. Design

- Vorbilder: **Apple Erinnerungen** für Aufgaben, **Apple Wallet** für Beträge, **iOS-Einstellungen** für Details.
- Große Touch-Flächen, ruhige Farben, klare Typografie (System-Schrift / SF), kompakte Listen, **Dark Mode**.
- **iPhone:** unten drei Tabs **Heute · NEXUS · Zulassungsdienst** plus ein schwebender Knopf für den Assistenten.
- **Desktop:** Seitenleiste.
- Jede wichtige Zeile führt mit einem Tipp zum passenden Eintrag.
- Prüfe die UI gegen die Web-Interface-Guidelines (falls verfügbar: `npx skills add vercel-labs/agent-skills --skill web-design-guidelines`).
- Nutze Figma, wenn verfügbar, für einen schnellen ersten „Heute“-Entwurf. Sonst direkt im Code.

---

## 10. Vorschau mit Demo-Daten

- Realistische **fiktive** Daten: ca. 40 NEXUS-Mitglieder mit verschiedenen Ratenplänen (inkl. Sonderkonditionen, Bestandsmitglieder seit August, einige überfällig), ca. 10 Autohäuser + Privatkunden mit Fahrzeugen und Vorgängen in allen Status, Nachrichten, Calls, Content.
- **Demo-Aktionen sichtbar kennzeichnen.**
- Morgenbriefing, Abendstatistik und Coach-Hinweise beispielhaft zeigen.

---

## 11. Abnahme

Starte die App und prüfe diese Abläufe automatisiert (Playwright) auf **iPhone-Breite (WebKit mit iPhone-Profil, falls verfügbar)** und am **Desktop**:

1. Heute → SEELE-Call → fertige Beispiel-Folientexte für Gamma kopieren.
2. Heute → offene WhatsApp-Rückfrage → Fahrzeugakte → fehlende Unterlage → Portalbestätigung und Rechnung.
3. NEXUS → offene Lexware-Rechnung → bestätigte Stripe-Zahlung → Aufgabe zur Zuordnung.
4. Zulassungsdienst → Tagesstatistik filtern → bestätigte Vorgänge öffnen → prüfen, dass eine erneute Einreichung **keinen Doppelzähler** erzeugt.
5. NEXUS → „Mitglied übernehmen“ für ein Bestandsmitglied seit August → Restbetrag und Nachzahlung korrekt berechnet.
6. NEXUS → unbekannte Überweisung → „Zuordnen“ → bestätigen → nächste Zahlung derselben IBAN wird automatisch zugeordnet.
7. Chat: Die drei Pflichtfragen aus 7.1 liefern korrekte, verlinkte Antworten.

Zusätzlich **Unit-Tests** für die Ratenplan-Berechnung (Soll/Ist/Rückstand inkl. Sonderkonditionen und Stundungen) und die Zählregel der Tagesstatistik.

---

## 12. Lieferung

- klickbare Vorschau (Link, den ich **auf dem iPhone** öffnen kann, oder der konkrete nächste Schritt dafür)
- Screenshots (iPhone + Desktop)
- kurze Liste:
  - Was funktioniert?
  - Was läuft mit Beispieldaten?
  - Für welche Live-Verbindung brauche ich noch einen Klick, Schlüssel oder eine Freigabe (mit Klickanleitung)?
  - Ergebnis der Portal-Prüfung (MyDigitalCar, Nextoz, i-Kfz/GKS) und der WhatsApp-Coexistence-Prüfung
