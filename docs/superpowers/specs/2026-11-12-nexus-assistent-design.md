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

**Stack:** Next.js (TypeScript, App Router) als PWA · Supabase (Postgres, Auth mit Passkey, Storage) · Vercel (Hosting + **Vercel Cron als einziger Taktgeber**, kein `pg_cron`) · `@anthropic-ai/sdk` · Playwright + Vitest.

**Phase 1 (Vorschau):** Alle Fachlogik (`ledger/`, `matching/`, `detectors/`, `actions/`, Scheduler) ist reines TypeScript ohne DB-Zugriff. Die Vorschau speichert Demo-Daten im Browser (Repository-Schnittstelle mit `DemoRepository` auf localStorage) und nutzt eine deterministische `DemoAI`. Damit läuft die Vorschau ohne Konten und ohne API-Schlüssel, und die Tests sind reproduzierbar. Ab Phase 2 kommen `SupabaseRepository` und die Claude-Anbindung hinter dieselben Schnittstellen.

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

Importierte Datensätze sind über **(connection_id, external_id) unique**. Alle fachlichen Tabellen haben `company` (`nexus` | `zulassung`), wo zutreffend.

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
- `job_run` (key **unique**, job, scheduled_for, started_at, finished_at, result)

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
- `job` (vehicle_id, service, location `bottrop|essen|online|onsite`, price_cents, status `open|waiting_customer|done|invoiced|paid`, done_at, notes)
- `job_invoice` (job_id, invoice_id): ein Auftrag kann mehrere (Teil-)Rechnungen haben

Raten werden **nicht gespeichert**, sondern von `ledger/` aus Vertrag, Ausnahmen und Zuordnungen berechnet. So gibt es nur eine Wahrheit.

---

## 4a. Festgelegte Rechen- und Zuordnungsregeln

**Beträge** immer in Cent (Ganzzahl). **Datum** als Kalendertag in Europe/Berlin.

**Ratenplan**
- Raten 1 bis n-1 = `installment_cents`, letzte Rate = Gesamtsumme minus Summe der übrigen (fängt Rundung und Sonderkonditionen auf).
- Fälligkeit = `due_day` im jeweiligen Monat ab `start_date`, bei kürzeren Monaten der letzte Tag.
- **Stundung** (von, bis): Raten mit Fälligkeit im Zeitraum werden auf „bis“ verschoben. Betrag bleibt.
- **Pause** (ab, Monate): alle Raten ab „ab“ verschieben sich um die Anzahl Monate.
- **Fälligkeitstag ändern** (ab, neuer Tag): gilt für alle Raten ab „ab“.

**Zahlungen verteilen:** Gutschriften kommen nur aus `payment` (Bank, Stripe, manuell), nie aus dem Lexware-Rechnungsstatus. Sie werden auf die **älteste offene Rate zuerst** verteilt, Überschuss auf die nächste.

**Mitgliedsstatus:** `fällig` = Summe der Raten mit Fälligkeit ≤ heute. `Rückstand` = fällig − gezahlt (min. 0). `künftig` = Summe der Raten mit Fälligkeit > heute, abzüglich Überzahlung. `offen gesamt` = Rückstand + künftig. Ampel: 🟢 kein Rückstand · 🟡 älteste unbezahlte Rate ≤ 7 Tage überfällig · 🔴 > 7 Tage.

**Referenzbeispiel (muss als Test existieren):** 1.200 € Vertrag, 4 × 300 €, zwei Raten fällig, 450 € gezahlt → **150 € Rückstand, 600 € künftig, 750 € offen gesamt.** Übernahme `first_rate` → 450 € + 300 €. `spread` → 375 € + 375 €. Beide ergeben 750 €. Bei `spread` geht ein Rundungsrest in Cent auf die **letzte** Rate.

**Doppelgutschriften vermeiden**
- Import-Schlüssel ist **Verbindung + externe ID**. Erneuter Import ändert nichts.
- Bankbuchungen von Stripe (Auszahlungen) werden als `stripe_payout` erkannt (Gegenpartei enthält „Stripe“ oder Verwendungszweck mit Stripe-Auszahlungskennung) und **nie** einem Mitglied gutgeschrieben. Die Gutschrift kommt nur aus der einzelnen Stripe-Zahlung.

**Zuordnungs-Konfidenz für Überweisungen**
- **hoch** (automatisch): bestätigte IBAN des Mitglieds **und** Betrag = nächste offene Rate oder = gesamter Rückstand.
- **mittel** (Vorschlag in „Zuordnen“): bestätigte IBAN, aber anderer Betrag; **oder** keine IBAN-Verknüpfung, aber Name passt und Betrag passt.
- **niedrig** („Zuordnen“ ohne Vorschlag): alles andere, auch Sammelzahlungen und Zahlungen von unbekannten Dritten.
- Bestätige ich einen Vorschlag, wird die IBAN als Zahler-Hinweis mit dem Mitglied verknüpft.

**Antwortpflicht:** Eine eingehende Nachricht mit `needs_reply` gilt erst als beantwortet, wenn im **selben Kanal und selben Thread** eine ausgehende Nachricht nach ihr kommt oder ich sie manuell erledige. Schwelle für den Hinweis: 2 Std. (einstellbar).

**Nicht abgerechnet:** Auftrag hat `price_cents`. Hinweis, solange Status `erledigt` und die Summe der verknüpften Rechnungen < Preis. Der Hinweis nennt den Restbetrag und schließt, sobald die Summe ≥ Preis ist.

**Datenstand:** Eine Quelle gilt als **veraltet**, wenn der letzte erfolgreiche Abruf älter als 45 Min. ist oder sie im Fehler steht. Bereiche, die von ihr abhängen, zeigen dann **„Datenstand zu alt, um das zu beurteilen“** statt „nichts offen“.

**Aktionen**
- Status: `entwurf → freigegeben → wird ausgeführt → ausgeführt` / `fehlgeschlagen` / `ausgang unklar` / `abgebrochen`. Jede Änderung am Entwurf erhöht die `version`.
- Freigabe ist an **Aktion + Version** gebunden. Ein zweites Tippen auf „Senden“ ändert nichts. Ein alter WhatsApp-Knopf (andere Version, bereits ausgeführt oder älter als 24 Std.) wird abgelehnt, mit Hinweis an mich.
- Idempotenzschlüssel beim Anbieter: `aktion:version`.
- Timeout beim Anbieter → `ausgang unklar`. Vor einem neuen Versuch wird beim Anbieter abgeglichen. Erneut senden geht nur aus `fehlgeschlagen`.

**Zeitgesteuerte Läufe**
- Vercel Cron ruft alle 5 Min. einen Takt-Endpunkt auf. Der Takt berechnet in **Europe/Berlin**, welche Läufe fällig sind (Briefing 7:00, Abend 19:00, sonntags zusätzlich Wochenrückblick, Sync alle 15 Min.).
- Jeder Lauf hat einen eindeutigen Schlüssel `job:Datum:Uhrzeit` (in `job_run`, unique). Doppelte Takte erzeugen keinen zweiten Lauf. Sommer- und Winterzeit sind dadurch korrekt.
- Briefings lassen sich in den Einstellungen ein- und ausschalten. Höchstens ein Briefing pro geplantem Versand. Jedes Briefing zeigt seinen Datenstand.
- Zustellung: WhatsApp frei formuliert, wenn das 24-Std.-Fenster offen ist. Sonst die freigegebene Utility-Vorlage. Ohne nutzbare Vorlage oder ohne WhatsApp kommt es als Push.

**Coach (Phase 1 regelbasiert, Formulierung später durch Claude)**
- Gleiche ausgehende Nachricht (normalisiert, erste 60 Zeichen) ≥ 3-mal in 7 Tagen → Schnellantwort vorschlagen.
- Mitglied zahlt bei ≥ 3 Raten in Folge ≥ 4 Tage nach Fälligkeit → Fälligkeitstag verschieben vorschlagen.
- Vor-Ort-Auftrag ohne Aufpreis-Position auf der Rechnung → Hinweis mit Summe.
- Durchschnittlich > 1 Tag zwischen „erledigt“ und Rechnung → Erinnerung direkt nach „erledigt“ vorschlagen.

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
- **E2E (Playwright, iPhone-Profil + Desktop), Abnahme Phase 1:**
  1. Heute zeigt höchstens 3 Hinweise. „Kunde wartet seit 3 Std.“ → Verlauf → Entwurf → Senden (Demo) → steht im Protokoll, Hinweis schließt.
  2. NEXUS → überfälliges Mitglied → Rechenweg (Rückstand vs. künftige Raten) → Erinnerung mit Stripe-Link vorbereitet.
  3. Übernahme des Referenzbeispiels → 150 / 600 / 750 €. `first_rate` 450 + 300, `spread` 375 + 375.
  4. Unbekannte Überweisung → Zuordnen → bestätigen → die nächste Zahlung derselben IBAN mit passendem Betrag wird automatisch zugeordnet.
  5. Lexware offen + Stripe bezahlt → Hinweis → zuordnen → Hinweis schließt.
  6. SEELE-Call → 10 Folientexte → für Gamma kopieren.
  7. Auftrag erledigt → Hinweis „nicht abgerechnet“ → passende Rechnung zuordnen → Hinweis schließt.
  8. Chat: „Wer ist bei NEXUS überfällig?“, „Was ist heute noch offen?“, „Was fehlt für SEELE?“, „Was ist mit dem Auftrag von Autohaus Schmidt?“, „Wie viel Geld kommt diesen Monat noch rein?“ → korrekte Antworten mit Links.
  9. Gebrochene Zusage („Rechnung schicke ich morgen“) wird als Hinweis erkannt.
  10. WhatsApp-Assistent (simuliert): Briefing kommt an, Frage wird beantwortet, [Senden] führt aus, ein alter Knopf wird abgelehnt, eine fremde Nummer wird ignoriert.
  11. Verbindung im Fehler → betroffene Bereiche zeigen „Datenstand zu alt“.
- **KI-Stichprobe (ab Phase 2):** 30 anonymisierte Beispielnachrichten mit erwarteter Einordnung. **Übersehene Antwortpflichten und übersehene Zusagen werden getrennt gezählt**, weil genau diese Fehler den Wachposten entwerten. Vor jedem Modell- oder Prompt-Wechsel prüfen.
