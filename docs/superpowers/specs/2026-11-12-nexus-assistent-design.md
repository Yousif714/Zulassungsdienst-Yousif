# Design-Spec: Nexus-Assistent

**Stand:** 12.11.2026 · **Status:** zur Prüfung durch Yousif
**Grundlage:** `docs/NEXUS-Assistent-Prompt.md` (fachliche Anforderungen). Diese Spec beschreibt, **wie** es gebaut wird.

---

## 1. Ziel und Erfolgskriterien

Ein persönlicher KI-Assistent für einen Inhaber mit zwei Firmen (NEXUS, Zulassungsdienst Bundesweit). Er beobachtet alle Konten, meldet von selbst, was durchrutscht, coacht und bereitet Aktionen zur Freigabe vor. Er spricht mit dem Inhaber **per WhatsApp** und über eine **PWA**.

**Erfolg heißt:**
1. Der Inhaber sieht jederzeit korrekt, **welches NEXUS-Mitglied wie viel im Rückstand ist** (Rechenweg nachvollziehbar).
2. **Keine Kundennachricht** bleibt unbemerkt länger als eine konfigurierbare Zeit unbeantwortet.
3. **Kein erledigter Auftrag** bleibt unbemerkt unabgerechnet.
4. Das Morgenbriefing kommt um 7:00 per WhatsApp und ist in 30 Sekunden gelesen.
5. Jede Aktion nach außen geschieht nur mit Freigabe und ist protokolliert.

**Nicht im Umfang:** Zulassungsportale (i-Kfz, GKS, MyDigitalCar, Nextoz), Portalstatistik, Routenplanung, Mehrbenutzer.

---

## 2. Architektur

```
┌────────────── Quellen ──────────────┐
│ WhatsApp Kunden (Coexistence)       │
│ WhatsApp Assistent (2. Nummer)      │──┐
│ Gmail · iCloud IMAP · info@         │  │  Webhooks + Polling (15 Min.)
│ Kalender                            │  │
│ Stripe NEXUS                        │  ▼
│ Lexware NEXUS · Lexware Zulassung   │ ┌──────────────────────────────────────────┐
│ Bank (CSV/CAMT, später PSD2)        │ │ Backend (Next.js API-Routen + Jobs)      │
└─────────────────────────────────────┘ │                                          │
                                         │ connectors/  → normalisieren, upsert     │
                                         │ matching/    → Zahlungen, Nachrichten    │
                                         │ ledger/      → Ratenplan, Rückstand      │
                                         │ detectors/   → Hinweise (Regeln)         │
                                         │ ai/          → Claude: verstehen, Texte  │
                                         │ actions/     → Freigabe, Ausführung      │
                                         │ notify/      → WhatsApp an Inhaber, Push │
                                         └──────────────┬───────────────────────────┘
                                                        │ Supabase Postgres (EU)
                                                        ▼
                                         ┌──────────────────────────────────────────┐
                                         │ PWA: Heute · NEXUS · Zulassungsdienst    │
                                         │       + Chat + Verbindungen + Protokoll  │
                                         └──────────────────────────────────────────┘
```

**Stack:** Next.js (TypeScript, App Router) als PWA · Supabase (Postgres, Auth mit Passkey, Storage, `pg_cron`) · Vercel (Hosting + Cron) · `@anthropic-ai/sdk` · Playwright + Vitest.

**Leitregel:** Zahlen rechnet `ledger/` als reine, getestete Funktionen. Die KI (`ai/`) liest Daten nur über Tools und formuliert. Sie erfindet keine Beträge.

---

## 3. Module (je eine klare Aufgabe)

| Modul | Aufgabe | Abhängig von |
|---|---|---|
| `connectors/<quelle>` | Daten abrufen, in einheitliche Tabellen schreiben, idempotent über `external_id`. Verbindungsstatus pflegen. | Quelle, DB |
| `ledger/` | **Reine Funktionen:** Ratenplan aus Vertrag erzeugen, Zahlungen verteilen (älteste Rate zuerst), Soll/Ist/Rückstand/künftige Raten, Monatsvorschau, Übernahme-Berechnung. Keine DB-Zugriffe. | nichts |
| `matching/` | Zahlung → Mitglied/Rate (IBAN-Hinweis + Betrag + Datum + Verwendungszweck → Konfidenz). Nachricht → Kontakt/Auftrag (Telefon, Mail, Kennzeichen, FIN). Unsicheres → „Zuordnen“. | DB, `ledger/` |
| `detectors/` | Deterministische Regeln, die **Hinweise** erzeugen (z. B. „Antwort fehlt seit X Std.“, „erledigt, nicht abgerechnet“, „Stripe bezahlt / Lexware offen“, „Doppelrechnung“). Jeder Hinweis hat einen `dedupe_key`, damit nichts doppelt gemeldet wird. | DB |
| `ai/` | Claude-Aufrufe: Nachricht einordnen (Antwortbedarf, Thema, **Zusagen** erkennen), Antwort-/Erinnerungsentwürfe, Folientexte, Coach-Analyse, Chat mit Tools. Strukturierte Ausgaben, wo möglich. | Claude API, DB (über Tools) |
| `actions/` | Aktionen als Datensätze: `entwurf → freigegeben → ausgeführt / fehlgeschlagen`. Ausführung nur nach Freigabe (App-Knopf oder WhatsApp-Knopf) oder bei ausdrücklich automatisierten Abläufen. Demo-Modus führt nichts aus. Alles ins Protokoll. | Connectors (schreibend, spätere Stufe) |
| `notify/` | WhatsApp an den Inhaber (2. Nummer, 24-Std.-Fenster, sonst Utility-Vorlage), Web-Push als Fallback. Eingehende Befehle des Inhabers an `ai/` (Chat) weiterreichen, nur von der hinterlegten Inhaber-Nummer. | WhatsApp Cloud API, Web Push |
| `app/` (UI) | PWA-Oberfläche. Liest nur über API-Routen. | Backend |

---

## 4. Datenmodell (Kern)

Alle fachlichen Tabellen haben `company` (`nexus` | `zulassung`), wo zutreffend.

**Gemeinsam**
- `connection` (company, provider, status, last_success_at, last_error)
- `contact` (company, kind `member|private|dealer`, name, phones[], emails[], notes)
- `message` (channel `whatsapp|email`, account, thread_id, direction, from, to, body, sent_at, contact_id?, order_id?, needs_reply, ai_labels jsonb, external_id **unique**)
- `commitment` (message_id, contact_id, text, due_at?, status `open|kept|broken`): von der KI erkannte Zusage des Inhabers
- `calendar_event` (source, title, start_at, end_at, location, external_id unique)
- `invoice` (company, source `lexware|stripe`, external_id **unique**, contact_id?, number, total_cents, open_cents, due_date, status)
- `payment` (company, source `bank|stripe|manual`, external_id **unique**, amount_cents, booked_on, payer_name, iban?, reference)
- `insight` (company?, type, priority, title, body, source_refs jsonb, action_id?, status `open|done|snoozed|dismissed`, dedupe_key **unique**, created_at)
- `action` (type, payload jsonb, status, approved_via `app|whatsapp|auto`, approved_at, executed_at, error, is_demo)
- `audit_log` (at, actor, what, refs)
- `preference` (key, value): u. a. unterdrückte Coach-Vorschläge, Automatik-Freigaben, Antwortzeit-Schwelle
- `llm_usage` (at, route, model, input_tokens, output_tokens, cost_cents)

**NEXUS**
- `member_contract` (contact_id, total_cents, installments, installment_cents, due_day, start_date, special_terms, catch_up_mode `first_rate|spread`, status)
- `contract_exception` (contract_id, kind `deferral|due_day_shift|pause`, from, to, new_due_day?, note)
- `payment_allocation` (payment_id, contract_id, installment_no, amount_cents, method `auto|confirmed|manual`, confidence)
- `iban_link` (iban, contact_id, confirmed_at): nur **Zahler-Hinweis**
- `call` (series `SEELE|Finance|…`, starts_at, topic, slide_count, slides_status `todo|draft|reviewed|copied`)
- `call_slide` (call_id, position, title, body)
- `content_item` (title, stage `idea|raw|edit|approval|published`, due?)

**Zulassungsdienst**
- `vehicle` (contact_id, vin, plate, model)
- `job` (vehicle_id, service, location `bottrop|essen|online|onsite`, status `open|waiting_customer|done|invoiced|paid`, done_at, invoice_id?, notes)

Raten werden **nicht gespeichert**, sondern von `ledger/` aus Vertrag, Ausnahmen und Zuordnungen berechnet. So gibt es nur eine Wahrheit.

---

## 5. Abläufe

**Sync (alle 15 Min. + Webhooks):** Connector → upsert → `matching/` → `ledger/` neu berechnen → `detectors/` → neue/aufgelöste Hinweise → `ai/` ergänzt Entwürfe → `notify/` nur bei „sofort“-Priorität.

**Eingehende Kundennachricht:** speichern → Kontakt/Auftrag zuordnen → `ai/` einordnen (Antwortbedarf, Thema, Zusagen) → Detektor startet Antwortzeit-Uhr.

**Morgenbriefing 7:00 / Abend 19:00 (Europe/Berlin):** offene Hinweise nach Priorität → Top 3 + Termine + Geld + Nachrichten → `ai/` formuliert kurz → WhatsApp (bzw. Vorlage außerhalb 24 Std.) + Push. Abends zusätzlich Coach-Analyse des Tages, sonntags der Woche.

**Befehl per WhatsApp vom Inhaber:** Absender prüfen → Chat mit Tools → Antwort. Will der Befehl etwas nach außen tun, wird eine `action` als Entwurf erzeugt und mit Knöpfen [Senden] [Ändern] [Später] zur Bestätigung geschickt.

**Mitglied übernehmen:** Vorschläge aus Bank/Lexware → Inhaber bestätigt Zahlungen → `ledger/` zeigt Rückstand und künftige Raten getrennt mit Rechenweg → Nachzahlungsmodus wählen → vorbereiteter Stripe-Plan (Anlegen = eigene freigegebene Aktion).

---

## 6. Fehlerbehandlung

- **Quelle fällt aus:** Verbindung auf „Fehler“, letzter Datenstand bleibt sichtbar mit Alter („Stand vor 3 Std.“), andere Quellen laufen weiter. Nach 3 Fehlversuchen ein Hinweis an den Inhaber.
- **Doppelte Daten:** `external_id`- und `dedupe_key`-Unique-Constraints. Erneutes Verarbeiten ist harmlos.
- **KI fällt aus oder lehnt ab:** Hinweis erscheint trotzdem, nur ohne Entwurf. Chat antwortet „gerade nicht verfügbar“. Kein Rechenergebnis hängt an der KI.
- **Aktion schlägt fehl:** Status `fehlgeschlagen`, Hinweis mit Grund, erneut versuchen per Knopf. Nie automatisch mehrfach an Kunden senden.
- **Unsichere Zuordnung:** immer „Zuordnen“, nie raten.
- **Fremde WhatsApp-Nummer** am Assistenten: ignorieren, protokollieren.

---

## 7. Sicherheit und Datenschutz

- Login per Passkey (Face ID) + Wiederherstellungscodes.
- Alle API-Schlüssel nur serverseitig (Vercel-Umgebungsvariablen / Supabase Vault). Supabase-Service-Key nie im Client. Row-Level-Security an.
- EU-Region. Dokumente verschlüsselt im Storage, Löschfrist konfigurierbar.
- Erste Ausbaustufe: alle Quellen-Schlüssel **nur lesend**, wo der Anbieter das erlaubt (Stripe Restricted Key).

---

## 8. KI-Einsatz

| Route | Modell | Effort | Hinweis |
|---|---|---|---|
| Nachricht einordnen + Zusagen erkennen | `claude-opus-5-5` (später ggf. `claude-haiku-5-5`, wenn messbar gleich gut) | low | strukturierte Ausgabe |
| Antwort-/Erinnerungsentwurf | `claude-opus-5-5` | low | |
| Chat (App + WhatsApp) mit Tools | `claude-opus-5-5` | medium | Tool Runner, Beleglinks |
| Briefing formulieren | `claude-opus-5-5` | low | |
| Coach Tag/Woche | `claude-opus-5-5` | high | |
| Folientexte | `claude-opus-5-5` | high | |
| Dokument/Foto auslesen | `claude-opus-5-5` | medium | |

Prompt-Caching für feste Systemanweisungen. Verbrauch in `llm_usage`, Monatslimit über `preference`. Sprachnachrichten: separater Speech-to-Text-Dienst (Auswahl in Phase 3, EU-Datenschutz).

---

## 9. Phasen

1. **Vorschau (Demo-Daten):** komplette UI, `ledger/` + `matching/` + `detectors/` echt, Demo-Seed, WhatsApp-Assistent **simuliert** (Chat-Fenster in der App), Aktionen im Demo-Modus. Abnahme 1–10 aus dem Prompt.
2. **Lesend live:** Lexware ×2, Stripe, Bank-CSV, Gmail/iCloud/info@, Kalender. „Mitglied übernehmen“ mit echten Daten.
3. **WhatsApp live:** Assistenten-Nummer (Briefing, Befehle, Knöpfe), Kunden-WhatsApp per Coexistence, Sprachnachrichten.
4. **Aktionen mit Freigabe:** senden/anlegen über WhatsApp, Mail, Stripe, Lexware.
5. **Automatiken:** vom Inhaber einzeln freigegebene Abläufe.

---

## 10. Tests

- **Unit (Vitest):** `ledger/` (Ratenplan, Ausnahmen, Teilzahlung älteste zuerst, Rückstand vs. künftig, Übernahme ohne Doppelrate, Monatsvorschau), `matching/` (Konfidenzstufen, IBAN-Lernen, Sammelzahlung → Prüfung), `detectors/` (Auslösen, Dedupe, Auflösen).
- **Integration:** Connector-Normalisierung gegen gespeicherte Beispielantworten (Fixtures).
- **E2E (Playwright, iPhone-Profil + Desktop):** Abnahme 1–10 aus dem Prompt.
- **KI-Stichprobe:** 30 anonymisierte Beispielnachrichten mit erwarteter Einordnung (Antwortbedarf, Zusage ja/nein), vor jedem Modell- oder Prompt-Wechsel prüfen.
