# Projektstand – Nexus-Assistent

> Einstiegspunkt für jede neue Session. Kurz halten. Bei Übergabe den Abschnitt „Stand & nächste Schritte“ aktualisieren (Befehl `/uebergabe`).

## Ziel
Persönlicher KI-Assistent (PWA, Deutsch, Apple-Stil) für den Inhaber von **NEXUS** (≈40–45 Mitglieder, Ratenzahlung seit August, Wechsel auf Stripe) und **Zulassungsdienst Bundesweit** (Bottrop/Essen, fast alles per WhatsApp). Nur 1 Nutzer.

Kernziele:
1. Wer schuldet wie viel? (inkl. Bestandsmitglieder seit August)
2. Nichts rutscht durch (Raten, offene Rechnungen, erledigt aber nicht abgerechnet)
3. Kein Kunde wartet unbemerkt, Zusagen werden erkannt
4. Morgenbriefing in 30 s
5. Assistent schreibt per WhatsApp wie ein Mitarbeiter
6. Nur noch „Senden“ tippen
7. Coach-Tipps
8. Nichts geht ohne Freigabe raus, alles im Protokoll

**Nicht im Umfang:** Zulassungsportale (i-Kfz, GKS, MyDigitalCar, Nextoz), Portalstatistik, Routen, Mitarbeiter-Logins.

## Dokumente (Quelle der Wahrheit)
| Datei | Inhalt |
|---|---|
| `docs/superpowers/specs/2026-11-12-nexus-assistent-design.md` | **Spec**: Architektur, Datenmodell, Rechenregeln (Abschnitt 4a), Abnahme (10) |
| `docs/superpowers/plans/2026-11-12-nexus-phase1-vorschau.md` | Bauplan Phase 1 (abgeschlossen) |
| `docs/superpowers/specs/2026-11-12-phase2-design.md` | **Spec Phase 2** (Pakete 2a–2f, Fundament-Architektur) |
| `docs/phase2-backlog.md` | Offene Punkte und verschobene Befunde für Phase 2 |
| `docs/setup-phase2a.md` | **Inhaber-Checkliste** Paket 2a: Supabase, Vercel, Variablen, erste Anmeldung |
| `docs/setup-phase2b.md` | **Inhaber-Checkliste** Paket 2b-1: Stripe-Key und Webhook, Lexware-Schlüssel, Vercel, Migration |
| `docs/superpowers/plans/2026-11-12-phase2b1-vertraege.md` | Bauplan Paket 2b-1 (Verträge aus Stripe und Lexware) |
| `docs/setup-phase2b2.md` | **Inhaber-Checkliste** Paket 2b-2: Migration, Qonto-Schlüssel, Vercel-Variablen |
| `docs/superpowers/plans/2026-11-13-phase2b2-qonto.md` | Bauplan Paket 2b-2 (Qonto, Forderungen, Zuordnungs-Härtung) |
| `docs/NEXUS-Assistent-Prompt.md` | Fachliche Anforderungen (Prompt-Form) |
| `docs/Codex-Vergleich-Prompt.md` | Zweitmeinungs-Prompt für Codex |
| `docs/vorschau/README.md` | Anleitung für den Inhaber, Vercel/iPhone |

## Architektur (Kurzfassung)
- Next.js 16 PWA (App Router, TS, Tailwind). **Phase 1:** reine Client-App, Demo-Daten in localStorage, Demo-Uhr 12.11.2026 09:30 (`?now=` überschreibt, `?reset=1` setzt zurück).
- `src/domain/` = reine Fachlogik, kein React, **kein Import aus `src/data`** (Ausnahme bekannt: `assistant.ts` → `src/ai`, siehe Backlog).
  - `ledger/` Raten, Verteilung, Status, Übernahme, Vorschau
  - `matching/` Zahlungen + Nachrichten
  - `detectors/` Hinweise + Lebenszyklus
  - `actions/` Freigabe-Zustandsmaschine
  - `scheduler.ts`, `briefing.ts`, `coach.ts`, `commitments.ts`, `billing.ts`, `assistant.ts` (WhatsApp-Logik)
- `src/ai/` `AIProvider` + regelbasierte `DemoAI` (Phase 2: Claude, Opus 5.5 Hauptmodell).
- `src/data/` `seed.ts` (deterministisch, 40 Verträge), `store.tsx` (Reducer + `refresh`), `selectors.ts`.
- `src/components/` Design-System (iOS-Tokens in `globals.css`), `src/app/` Seiten.

## Feste Regeln (Auszug aus Spec 4a)
- Beträge in Cent, Kalendertage Europe/Berlin. Geld nur aus Ledger-Funktionen.
- Zahlungen gehen auf die älteste offene Rate zuerst. Referenz: 1.200 € = 4 × 300 €, 450 € gezahlt → 150 Rückstand / 600 künftig / 750 offen.
- Ampel: grün = 0 Rückstand, gelb = bis 7 Tage, rot = über 7 Tage.
- Gutschriften nur aus Zahlungen (Bank/Stripe/manuell). Stripe-Auszahlung nie gutschreiben. Importschlüssel = Verbindung + externe ID.
- Zuordnung hoch = bestätigte IBAN + passender Betrag. Mittel = Vorschlag. Niedrig = manuell.
- Antwort zählt nur im selben Kanal und Thread. Veraltete Quelle (> 45 Min.) → „Datenstand zu alt“.
- Aktionen: Freigabe an Version gebunden. WhatsApp-Knopf max. 24 Std. Timeout → „Ausgang unklar“ statt Neusenden.

## Befehle
`npm test` (Vitest, ~406) · `npm run test:integration` (Supabase-Testprojekt) · `npx tsc --noEmit` · `npm run lint` · `npm run contrast` · `npm run e2e` (Playwright, vorher `fuser -k 3100/tcp`) · Screenshots: `SCREENSHOTS=1 npm run e2e -- tests/e2e/screenshots.spec.ts`

## Stand & nächste Schritte
- **Paket 2a live** (PR #3, Fix #4): Produktion `https://nexus-iota-gold-96.vercel.app` (Vercel-Projekt `nexus`, Team NEXUS, Pro), Supabase `nexus-assistent` (Frankfurt, Free), Migration ausgeführt, alle Variablen nur für Production gesetzt, Inhaber mit Passkey angemeldet, Echtmodus zeigt „Noch nichts verbunden“.
- Die Session-Umgebung „NEXUS Video“ hat einen Vercel-Token (30 Tage) für `api.vercel.com`: Variablen, Deployments und Logs lassen sich darüber selbst prüfen.
- **Paket 2b-1 live** (PRs #5–#9): Lexware NEXUS + Zulassung verbunden (Schlüssel mit allen Rechten, Belegliste mit `voucherStatus=any`, 429 → Fortsetzung im nächsten Lauf). Vertragsvorschläge unter NEXUS › Mitglieder › Vorschläge; Gesamtrechnung ohne Tag = „zum Monatsende“. Stripe noch ohne Schlüssel. App lädt beim Zurückkehren neu, Herunterziehen, „Jetzt abgleichen“ (Verbindungen, oben).
- Nur ~19 Vorschläge bei ~45 Mitgliedern: Ursachen offen (Rechnungstext ohne „Mitgliedschaft“, Rechnung vor 01.08., Entwürfe, fehlende Rechnungen). Klärung über Portal-Abgleich (siehe unten).
- **Paket 2b-2 live** (PR #10, 13.11.): Qonto verbunden (`QONTO_LOGIN`/`QONTO_SECRET_KEY`), NEXUS › Offen, NEXUS › Zuordnen mit „Ja, gehört zu …“. `ANTHROPIC_API_KEY` ist gesetzt (Max-Plan: 100 $ API-Guthaben/Monat), wird erst von „Rechnungen lesen“ genutzt.
- **Portal-Abgleich gebaut, PR offen, NICHT gemergt** (Spec `docs/superpowers/specs/2026-11-13-portal-abgleich-design.md`, Plan `docs/superpowers/plans/2026-11-13-portal-abgleich.md`): Inhaber lädt die Excel-Mitgliederliste aus dem Portal hoch (NEXUS › Portal-Mitglieder; Spalten Mitglied/E-Mail-Adresse(n)/Beigetreten/Zuletzt aktiv; echte Liste mit 43 Mitgliedern lokal geprüft, nie im Repo). Status je Mitglied (Vertrag / Vorschlag / Rechnung ohne Mitgliedschaft / keine Rechnung / ausgeblendet), „Vertrag anlegen“, „Kein zahlendes Mitglied“ + „Wieder einblenden“, Hinweis „N Mitglieder ohne Rechnung“. Portal-Supabase-Schlüssel liegen bei der Agentur → API-Abgleich später.
- **Als Nächstes (Inhaber):** 1) SQL `supabase/migrations/20261115000000_portal.sql` im Supabase-SQL-Editor ausführen, 2) PR mergen lassen, 3) Excel-Liste hochladen, „Vertrag anlegen“ für Mitglieder ohne Rechnung, Zahlungen zuordnen. Checkliste `docs/setup-portal.md`.
- **Danach:** „Rechnungen lesen“ mit Claude (Entscheidung (a): Plan gilt sofort, markiert, korrigierbar; unsicher → Vorschlag) → Sparkasse-Upload → 2b-3 Umstellung auf Stripe.
- Weiter offen: Supabase auf Pro vor echten Bankdaten; überzählige Vercel-Projekte löschen; `npm run test:integration` gegen Testprojekt.
- Zugänge des Inhabers: alles vorhanden außer einer zweiten WhatsApp-Nummer (erst 2e). Banken: Qonto (NEXUS, API) und Sparkasse Essen (Zulassung, CAMT-Upload). info@ beim Team, IMAP-Daten auf Anfrage. Kalender: Google und iCloud.
- Offen: Codex-Zweitmeinung; Gefühl der Wischgesten am iPhone.
