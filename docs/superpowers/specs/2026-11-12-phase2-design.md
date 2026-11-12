# Design-Spec Phase 2: echte Verbindungen

**Stand:** 12.11.2026 · **Status:** vom Inhaber im Chat freigegeben (Abschnitte 1–4 + Reihenfolge)
**Baut auf:** `2026-11-12-nexus-assistent-design.md`. Die Regeln aus Abschnitt 4a gelten unverändert. `docs/phase2-backlog.md` enthält die verschobenen Befunde.

## 0. Ausgangslage
- Phase 1 ist live auf Vercel (Team „NEXUS“): reine Client-App, Demo-Daten in localStorage, DemoAI.
- Zugänge des Inhabers:
  - vorhanden: Supabase, Lexware NEXUS und Zulassung (API-Tarif), Stripe NEXUS, Qonto (NEXUS-Bank), Sparkasse Essen (Zulassungs-Bank), Anthropic, Gmail, iCloud (Mail + Kalender), Google Kalender
  - info@nexusnetzwerk.de liegt beim Team des Inhabers (IMAP-Daten auf Anfrage)
  - fehlt: zweite WhatsApp-Nummer (erst Paket 2e)

## 1. Pakete (je ein PR, in dieser Reihenfolge)
| Paket | Inhalt | Braucht vom Inhaber |
|---|---|---|
| **2a Fundament** | Supabase-Speicher, Passkey-Login, Server-Event-Endpunkt, Server-Ausführer für Aktionen, AIProvider-Injektion, Cron-Takt mit `job_run`, Demo-Schalter | Supabase-Projekt, Vercel Pro |
| **2b Geld** | Qonto-API, Lexware ×2, Stripe (Restricted Key + Webhooks), Sparkasse CAMT/CSV-Upload, echtes „Mitglied übernehmen“, Zuordnungs-Härtung aus dem Backlog | 4 Schlüssel, Sparkasse-Export |
| **2c Mails und Kalender** | Gmail (OAuth, lesend), iCloud IMAP, info@ IMAP, Google-Kalender (OAuth), iCloud CalDAV | Google-Login, App-Passwort, IMAP-Daten |
| **2d Claude** | `ClaudeProvider` (Opus 5.5) mit Tools statt Vollzugriff auf den State: Einordnen, Entwürfe, Chat, Coach, Folien; Verbrauch und Monatslimit (Standard 100 €), Rückfall auf DemoAI | Anthropic-Schlüssel |
| **2e WhatsApp** | Assistenten-Nummer (Cloud API), Webhook mit Signaturprüfung, Vorlagen; Kunden-Nummer per Coexistence | zweite Nummer, Meta-Freigabe |
| **2f Senden** | echte `ActionProvider` (WhatsApp, Mail, Lexware-Entwurf), danach einzelne Automatiken | – |

## 2. Fundament (Paket 2a) – Architektur

**Laufzeit:** Next.js auf Vercel Pro mit Route Handlers und Server Actions im Node-Runtime. Supabase Postgres in der EU (Frankfurt).

**Datenzugriff:**
- Nur der Server greift auf die Datenbank zu, mit dem Service-Role-Key aus einer Umgebungsvariablen.
- RLS ist an, Policies verweigern `anon` und `authenticated` alles. Der Browser spricht nie direkt mit Supabase.

**Gemeinsame Engine:**
- `refresh`, `reducer` und die Mutationen ziehen aus `src/data/store.tsx` (Client) in ein React-freies Modul `src/data/engine.ts`.
- Client-Store (Demo-Modus) und Server nutzen dieselbe Engine. So gibt es keine doppelte Logik.

**Echtmodus, Ablauf:**
1. Der Client lädt den Zustand über `GET /api/state` (nur angemeldet).
2. Änderungen gehen als `StoreEvent` an `POST /api/events`.
3. Der Server lädt den Zustand, wendet die Engine an und speichert die Änderungen in einer Transaktion. Der neue Zustand geht zurück an den Client.
4. Bei einem Nutzer und wenigen tausend Datensätzen reicht „ganzer Zustand pro Event“. Eine Optimierung kommt erst bei Bedarf.

**Speicher-Schema:**
- Eine Tabelle pro Entität (`contacts`, `contracts`, `payments`, `allocations`, `invoices`, `messages`, `commitments`, `events`, `calls`, `content`, `vehicles`, `jobs`, `insights`, `actions`, `audit`, `assistant_messages`, `connections`, `settings`).
- Spalten: `id text pk`, `data jsonb`, dazu die Schlüsselspalten für Eindeutigkeit.
- **Unique:**
  - `payments`, `invoices`, `messages`, `events`: (`connection_id`, `external_id`)
  - `insights`: `dedupe_key`
  - `job_runs`: `key`
- Tabelle `meta`: `schema_version`.
- Migrationen liegen als SQL-Dateien in `supabase/migrations/`.

**IDs:**
- Neue Datensätze bekommen `crypto.randomUUID()`. Damit verschwinden die Zähler-IDs `p-sim-n`/`am-n`.
- Seiten erraten keine IDs mehr; der Server gibt die ID zurück.

**Login (Passkey):**
- `@simplewebauthn/server` und `@simplewebauthn/browser`.
- **Erstregistrierung** nur mit dem einmaligen Token `OWNER_SETUP_TOKEN` (Umgebungsvariable). Danach ist die Registrierung gesperrt, weitere Passkeys nur angemeldet.
- **Sitzung:** httpOnly-, Secure-, SameSite=Lax-Cookie, signiert mit `SESSION_SECRET` (jose, JWT HS256), 30 Tage gültig.
- **Wiederherstellung:** 10 Einmal-Codes, gespeichert als Hash.
- Alle `/api/*`-Routen außer Login, Cron und (später) Webhooks prüfen die Sitzung.

**Server-Ausführer:**
- Seiten senden nur noch `approveAction`. Der Server führt freigegebene Aktionen über einen `ActionProvider` mit `idempotencyKey(a)` aus und speichert das Ergebnis.
- Dazu gehören `uncertain` → Abgleich (`lookup`) und Erneut-Versuchen aus `failed`.
- In 2a ist nur `DemoProvider` aktiv: nichts verlässt die App, alles wird protokolliert. Die echten Provider kommen in 2f.
- Die Oberfläche bekommt Zustände für „fehlgeschlagen“ und „Ausgang unklar“ mit Knopf „Erneut versuchen“ bzw. „Prüfen“.

**Aktions-Fabrik:** `src/domain/action-factory.ts` mit `reminderAction(...)` und `replyAction(...)`. Die einzige Quelle für ID-Schema und Payload, genutzt von Seiten und WhatsApp-Logik.

**AIProvider-Injektion:**
- Die Schnittstelle wird asynchron und toolbasiert.
- Server-seitig sitzt ein Provider-Register (`getAI()`): in 2a Demo, ab 2d Claude.
- Die Seiten rufen KI-Funktionen über Server Actions bzw. `/api/ai/*` auf, nie direkt `demoAI`.
- Im Demo-Modus nutzt der Client weiter DemoAI lokal.
- `src/domain` importiert nichts aus `src/ai` mehr; `demoPaymentLink` zieht in die Domain als `paymentLinkFor()`.

**Cron:**
- `vercel.json` ruft alle 5 Minuten `GET /api/cron/tick` auf, geschützt mit `Authorization: Bearer ${CRON_SECRET}`.
- `tick` berechnet mit `dueRuns` die fälligen Läufe und legt je Lauf **zuerst** atomar `job_runs.key` an (insert … on conflict do nothing). Nur wer den Insert gewinnt, führt aus.
- In 2a gibt es:
  - `sync`: ruft registrierte Connectoren auf; in 2a keine, nur Freshness- und Refresh-Lauf
  - `briefing_morning`, `review_evening`, `review_weekly`: erzeugen Briefing bzw. Rückblick, speichern ihn als Assistenten-Nachricht und markieren den Zustellweg. Echte Zustellung kommt in 2e.

**Demo-Schalter:**
- In den Einstellungen gibt es „Demo-Modus“ (Standard: aus, sobald angemeldet).
- Im Demo-Modus nutzt die App den lokalen Store wie in Phase 1, mit sichtbarem Badge „Demo“.
- Echt- und Demo-Daten mischen sich nie.
- Ohne Login sieht man nur die Demo, mit dem Hinweis „Anmelden für echte Daten“.

**Leerer Echt-Start:**
- Ohne Verbindungen zeigt die App einen Einrichtungs-Zustand: „Verbindungen“ mit Checkliste und Klickanleitungen, statt leerer Karten.
- Die Bereiche zeigen „Noch nicht verbunden“ (die Regel „Datenstand zu alt“ gilt weiter).

**Umgebungsvariablen (2a):** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET`, `OWNER_SETUP_TOKEN`, `CRON_SECRET`, `APP_ORIGIN` (für WebAuthn rpID/origin). Keine davon mit `NEXT_PUBLIC_`.

## 3. Verbindungen (2b–2c) – Festlegungen
- **Qonto:** API-Schlüssel (Login + Secret Key). Transaktionen werden mit `external_id` = Qonto-Transaktions-ID importiert.
- **Sparkasse:** Upload CAMT.053 (bevorzugt) oder CSV in „Verbindungen“. Der Import geht über `mergeImported` mit `external_id` aus der Bank-Referenz (bzw. einem Hash aus Datum, Betrag, IBAN und Verwendungszweck). finAPI erst, wenn der Upload lästig wird.
- **Lexware:** zwei Schlüssel, `connection_id` `lexware_nexus` / `lexware_zulassung`. Gelesen werden Rechnungen, Kontakte und Zahlungsstatus.
- **Stripe:** Restricted Key nur lesend, Webhook-Secret. Zuordnung Stripe-Kunde → Vertrag über Metadaten oder einmalige Bestätigung in „Zuordnen“.
- **Mail:** Gmail per OAuth (Scope `gmail.readonly`). iCloud und info@ per IMAP mit App-Passwort, nur lesen.
- **Kalender:** Google per OAuth (Scope `calendar.readonly`). iCloud per CalDAV. Die Termine werden auf „Heute“ zusammengeführt.
- **Vor echten Bankdaten** werden diese Backlog-Punkte erledigt (Teil von 2b):
  - IBAN normalisieren
  - Rückbuchungen bzw. Beträge ≤ 0
  - Stripe-Erkennung enger fassen
  - Namen mit NFD, türkischen Buchstaben und Titeln
  - Mehrdeutigkeit wird nicht automatisch zugeordnet
  - Verträge beim Import prüfen

## 4. Claude (2d) und WhatsApp (2e) – Festlegungen
- Opus 5.5, Effort pro Route wie in Spec 8 (Einordnen low, Chat medium, Coach und Folien high).
- Tools statt State-Übergabe, Prompt-Caching, Verbrauch in `llm_usage`, Monatslimit mit Rückfall auf DemoAI und Hinweis.
- WhatsApp:
  - Prüfung der Meta-Signatur (`X-Hub-Signature-256`).
  - Knopf-Rückrufe werden gegen Absender und Inhaber-Nummer geprüft.
  - Der 24-Std.-Knopf wird gegen die Server-Uhr und die gespeicherte Ausstellungszeit geprüft, mit 2 Min. Toleranz.
  - Utility-Vorlagen werden bei Meta zur Freigabe eingereicht.

## 5. Tests
- Unit:
  - Engine-Extraktion verhaltensgleich (bestehende Store-Tests laufen gegen `engine.ts`)
  - Repository gegen echtes Postgres (lokal per `supabase start` oder Testcontainer, sonst gegen ein Supabase-Testprojekt)
  - Auth: Token einmalig, Sitzung prüfen, Recovery
  - Cron-Atomarität: zwei parallele Ticks ergeben genau einen Lauf
  - Executor: Idempotenz, `uncertain` → Abgleich
- E2E:
  - bestehende Suite im Demo-Modus unverändert grün
  - neuer Ablauf: Erst-Login per virtuellem Authenticator (Playwright WebAuthn) → leerer Einrichtungs-Zustand → Demo-Schalter

## 6. Nicht in 2a
Echte Connectoren, Claude, WhatsApp-Versand, Push-Benachrichtigungen, Automatiken.
