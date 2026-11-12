# Prompt für Codex: Vergleich und Zweitmeinung zum Nexus-Assistenten

> Komplett in Codex einfügen. Wenn Codex Zugriff auf das Repo hat: Branch `claude/cool-hopper-hcnb9d`.
> Die ausführlichen Unterlagen liegen dort unter `docs/NEXUS-Assistent-Prompt.md` (Anforderungen),
> `docs/superpowers/specs/2026-11-12-nexus-assistent-design.md` (technische Spec) und
> `docs/superpowers/plans/2026-11-12-nexus-phase1-vorschau.md` (Bauplan).

---

## Deine Aufgabe

Ein anderes KI-Coding-Tool (Claude Code) baut gerade meine App. Ich will eine **unabhängige Zweitmeinung**. Bau nichts. Antworte mit:

1. **Gesamturteil:** Ist der Ansatz richtig für mein Ziel? Was ist stark, was ist riskant?
2. **Wo würdest du anders vorgehen** (Architektur, Technik, Reihenfolge, Datenmodell)? Mit Begründung und was es kostet, wenn man es nicht ändert.
3. **Die 10 wichtigsten Verbesserungen**, sortiert nach Nutzen für meinen Alltag.
4. **Phase 2 (echte Verbindungen):** Wie würdest du Lexware (2 Konten), Stripe, Bank, Gmail/iCloud/info@, Kalender und WhatsApp Business anbinden? Was sind die Stolpersteine?
5. **Blinde Flecken:** Was fehlt komplett, das ich als Inhaber brauche?
6. **Punkte aus der Liste „Bekannte offene Kleinigkeiten“ (unten), die du für gefährlich hältst.**

---

## 1. Worum es geht

Ich habe zwei Firmen:
- **NEXUS:** Mitglieder-Netzwerk, ca. 40–45 zahlende Mitglieder, die eine Gesamtsumme in 6 oder 12 Monatsraten zahlen. Die meisten seit August, bisher per Überweisung, abgerechnet über Lexware. Künftig alles über Stripe. Dazu Calls („SEELE“ mit 10 Folien, „Finance“) mit Folientexten für Gamma und Content.
- **Zulassungsdienst Bundesweit:** Kfz-Zulassungen für Privatkunden und Autohäuser, Büros in Bottrop und Essen, fast alles läuft über WhatsApp und online.

**Ziel:** ein persönlicher KI-Assistent als App, nur für mich. Er beobachtet alles, meldet sich von selbst und coacht mich. Antworten und Erinnerungen bereitet er so vor, dass ich nur noch freigebe. Er schreibt mir per WhatsApp wie ein Mitarbeiter.

**Meine Ziele:**
1. Ich sehe, wer mir Geld schuldet, inklusive der Ratenzahler seit August.
2. Mir rutscht kein Geld durch: Raten, offene Rechnungen, erledigte aber nicht abgerechnete Aufträge.
3. Kein Kunde wartet unbemerkt, und versprochene Dinge werden erkannt.
4. In 30 Sekunden weiß ich, was heute zählt (Morgenbriefing).
5. Der Assistent schreibt mir per WhatsApp, und ich antworte ihm dort.
6. Ich tippe nur noch auf „Senden“.
7. Ich bekomme wöchentlich Coach-Tipps zu Verbesserungen und Automatisierungen.
8. Ohne meine Freigabe geht nichts raus, und alles wird protokolliert.
9. Alles in einer App im Apple-Stil für iPhone und Desktop, beide Firmen getrennt.

**Bewusst nicht im Umfang:** Zulassungsportale (i-Kfz, GKS, MyDigitalCar, Nextoz), Portalstatistik, Routenplanung, Mitarbeiter-Logins.

---

## 2. Technik und Architektur

- **App:** Next.js 16 (TypeScript, App Router) als PWA, Tailwind, Apple-Stil (iOS-Systemfarben, gruppierte Listen, Wallet-Karten, Erinnerungen-Zeilen, Dark Mode). Mobil drei Tabs (Heute · NEXUS · Zulassungsdienst) plus Assistenten-Knopf, am Desktop eine Seitenleiste.
- **Später:** Supabase (Postgres, EU), Vercel (Hosting, Vercel Cron als einziger Taktgeber), Claude API (Hauptmodell Opus 5.5, Haiku 5.5 optional zum Vorsortieren), WhatsApp Cloud API (zweite Nummer für den Assistenten, Kunden-Nummer per Coexistence).
- **Grundregel:** Zahlen rechnet immer Code nach festen Regeln, nie die KI. Die KI versteht Nachrichten, formuliert Texte und ruft Daten über Tools ab.
- **Bausteine:**

| Baustein | Aufgabe |
|---|---|
| `src/domain/ledger` | Ratenplan, Zahlungsverteilung, Status, Übernahme, Monatsvorschau |
| `src/domain/matching` | Zahlungen und Nachrichten zuordnen |
| `src/domain/detectors` | Hinweise erzeugen, Lebenszyklus der Hinweise |
| `src/domain/actions` | Freigabe-Zustandsmaschine |
| `src/domain/scheduler` + `briefing` | Zeitsteuerung, Zustellweg, Briefingtext |
| `src/domain/coach` | Coach-Regeln |
| `src/ai` | `AIProvider`-Schnittstelle. Phase 1: regelbasierte `DemoAI`. Phase 2: Claude |
| `src/data` | Demo-Daten, Store (React Context + localStorage), Selektoren |

- **Phase 1 = klickbare Vorschau ohne echte Konten:** echte Logik auf deterministischen Demo-Daten (40 Mitglieder, Autohäuser, Nachrichten), Demo-Uhr 12.11.2026, 09:30. Alles Senden ist nur Demo und wird protokolliert.

---

## 3. Festgelegte Rechen- und Zuordnungsregeln (das Herzstück)

- Beträge in Cent, Datum als Kalendertag in Europe/Berlin.
- **Ratenplan:**
  - Die letzte Rate fängt den Rest auf.
  - Fälligkeitstag 29–31 wird auf das Monatsende gekürzt.
  - Ausnahmen: Stundung (verschiebt auf „bis“), Pause (verschiebt alle folgenden Raten), Fälligkeitstag ändern.
- **Zahlungen:** Gutschriften kommen nur aus echten Zahlungen (Bank, Stripe, manuell), nie aus dem Lexware-Status. Sie werden auf die älteste offene Rate zuerst verteilt.
- **Status:**
  - Rückstand = fällig − gezahlt. Künftig = noch nicht fällige Raten minus Überzahlung. Offen gesamt = Rückstand + künftig.
  - Ampel: grün ohne Rückstand, gelb bis 7 Tage überfällig, rot ab 8 Tagen.
- **Referenzbeispiel (getestet):** 1.200 € in 4 × 300 €, zwei Raten fällig, 450 € gezahlt → 150 € Rückstand, 600 € künftig, 750 € offen.
- **Übernahme von Bestandsmitgliedern nach Stripe:**
  - Nachzahlung mit der ersten Rate: 450 € + 300 €. Auf die Restraten verteilt: 375 € + 375 €.
  - Ein Rundungscent geht auf die letzte Rate.
  - Ein Stripe-Plan pro Vertrag.
- **Keine Doppelgutschrift:**
  - Importschlüssel ist Verbindung + externe ID.
  - Eine Stripe-Auszahlung auf dem Bankkonto wird nie einem Mitglied gutgeschrieben.
- **Zuordnung von Überweisungen:**
  - **hoch (automatisch):** bestätigte IBAN und Betrag = nächste Rate oder Rückstand.
  - **mittel (Vorschlag):** IBAN passt, aber anderer Betrag; oder Name und Betrag passen.
  - **niedrig:** alles andere, auch Sammelzahlungen und Dritte.
  - Bestätige ich eine Zuordnung, lernt die App die IBAN.
- **Antwortpflicht:** Eine Nachricht gilt erst als beantwortet, wenn im selben Kanal und selben Thread eine Antwort kommt. Hinweis ab 2 Std.; bei Händlern ab 3 Std. mit Priorität „jetzt“.
- **Nicht abgerechnet:** Auftrag erledigt und Summe der Rechnungen kleiner als der Preis. Der Hinweis nennt den Rest.
- **Datenstand:** Eine Quelle gilt nach 45 Min. ohne erfolgreichen Abruf (oder bei Fehler) als veraltet. Die App zeigt dann „Datenstand zu alt“ statt „nichts offen“, und Hinweise werden ausgeblendet, aber nicht als erledigt gemeldet.
- **Aktionen:**
  - Ablauf: Entwurf → freigegeben → ausgeführt / fehlgeschlagen / Ausgang unklar.
  - Die Freigabe ist an die Version gebunden.
  - WhatsApp-Knöpfe sind höchstens 24 Std. gültig. Fehlt der Zeitstempel, ist er kaputt oder liegt er in der Zukunft, gilt der Knopf als abgelaufen.
  - Nach einem Timeout gibt es erst einen Abgleich, kein blindes Neusenden.
- **Zeitsteuerung:**
  - Ein Takt alle 5 Min. Schlüssel je Lauf `job:Datum:Uhrzeit`, damit nichts doppelt läuft.
  - Briefing 7:00, Abend 19:00, sonntags Wochenrückblick. Sommer- und Winterzeit sind getestet.
  - Zustellung: WhatsApp frei formuliert im 24-Std.-Fenster, sonst als Utility-Vorlage, sonst als Push.
- **Coach (regelbasiert):**
  - Gleiche Nachricht 3× in 7 Tagen → Schnellantwort vorschlagen.
  - Mitglied zahlt 3× in Folge ≥ 4 Tage zu spät → Fälligkeit verschieben vorschlagen.
  - Vor-Ort-Auftrag ohne Aufpreis → 35 € pro Auftrag.
  - Im Schnitt > 1 Tag bis zur Rechnung → Erinnerung vorschlagen.

---

## 4. Stand der Umsetzung (Phase 1)

| Schritt | Inhalt | Stand |
|---|---|---|
| 1 | Projekt, Uhr, Geldformat | ✅ |
| 2–4 | Fachtypen, Ratenplan, Zahlungsverteilung, Status, Übernahme, Vorschau | ✅ |
| 5–6 | Zahlungs- und Nachrichtenzuordnung (inkl. Kennzeichen in Kleinbuchstaben) | ✅ |
| 7 | Wachposten / Detektoren, Datenstand, Hinweis-Lebenszyklus | ✅ |
| 8–9 | Freigabe-Zustandsmaschine, Zeitsteuerung, Zustellung, Briefing | ✅ |
| 10 | Demo-Daten, Coach, Store | ✅ |
| 11 | DemoAI (5 Pflichtfragen, Entwürfe, Folien, Zusagen erkennen) | ✅ |
| 12 | App-Gerüst, Design-System, PWA | ✅ |
| 13 | Heute + Nachrichtenverlauf mit Antwortentwurf | ✅ |
| 14 | NEXUS: Mitglieder, Rechenweg, Übernahme, Zuordnen, Calls/Gamma, Content | ✅ |
| 15 | Zulassungsdienst: Tageszahlen, Kunden, Aufträge, Rechnung zuordnen | 🔨 läuft |
| 16 | Chat, simulierter WhatsApp-Assistent, Verbindungen, Protokoll, Einstellungen, Alle Hinweise | ⏳ |
| 17 | Gesamtabnahme, Screenshots, iPhone-Anleitung | ⏳ |

**Arbeitsweise:**
- Jeder Schritt wird testgetrieben gebaut und danach unabhängig geprüft. Gefundene Fehler werden behoben und nachgeprüft.
- Bisher gibt es ca. 190 Unit-Tests und E2E-Tests auf iPhone-Breite und Desktop.
- **11 Abnahme-Abläufe**, darunter:
  - wartender Kunde → Antwort senden → Hinweis schließt;
  - Rechenweg und Erinnerung mit Stripe-Link;
  - Übernahme des Referenzbeispiels;
  - IBAN lernen;
  - Stripe bezahlt / Lexware offen;
  - SEELE-Folien für Gamma kopieren;
  - Rechnung zu einem Auftrag zuordnen;
  - 5 Chatfragen;
  - gebrochene Zusage;
  - WhatsApp-Assistent mit altem Knopf und fremder Nummer;
  - gestörte Verbindung → „Datenstand zu alt“.

**Entscheidungen, die während des Baus getroffen wurden:**
- Ein Hinweis aus einer veralteten Quelle bekommt den Status „stale“ (ausgeblendet, nicht erledigt).
- Der Sammelhinweis „N Mitglieder überfällig“ erscheint erst ab 2 Mitgliedern.
- „Zuordnen“ gilt nur für Bankzahlungen. Stripe-Zahlungen sind über Stripe eindeutig.
- Eine nachträglich eingehaltene Zusage schließt den Hinweis.
- Pro Rückstand eines Mitglieds kann eine eigene Erinnerung erstellt werden.

---

## 5. Bekannte offene Kleinigkeiten (bewusst auf später verschoben)

- Namensabgleich: türkische Sonderzeichen (Çelik), Titel wie „Dr.“ im Kontaktnamen. IBAN-Vergleich nicht leerzeichen- oder großschreibungstolerant (muss vor echten Bankdaten behoben werden).
- Zweite Erinnerung, solange dieselbe Rate weiter offen bleibt, ist noch nicht möglich.
- Rückbuchungen bzw. negative Zahlungen werden nicht behandelt.
- Am Tag der Winterzeit-Umstellung fällt der Sync für ca. 1 Std. aus.
- Kontrast einzelner kleiner Texte (Demo-Badge orange, inaktive Tabs) unter WCAG.
- Das Protokoll fasst Einträge pro Aktion zusammen. Eine Ablehnung kann dabei einen früheren Erfolg verdecken.
- Eingabe von Beträgen: „3€00“ wird akzeptiert, keine Obergrenze.
- `globals.css` ist ca. 1.400 Zeilen groß.

---

## 6. Plan für Phase 2

1. Echte Daten lesend: beide Lexware-Konten, Stripe, Bank-CSV seit 1. August (danach PSD2 über finAPI oder Tink), Gmail/iCloud/info@, Kalender. Supabase statt localStorage, Login per Passkey.
2. Claude statt DemoAI hinter derselben Schnittstelle. Effort pro Aufgabe: Einordnen low, Chat medium, Coach und Folien high.
3. WhatsApp live: eigene Assistenten-Nummer mit Briefing, Befehlen und Knöpfen; Kunden-Nummer per Coexistence; Sprachnachrichten über Speech-to-Text.
4. Aktionen wirklich ausführen, nur mit Freigabe.
5. Einzelne Automatiken, die ich gezielt freigebe.
