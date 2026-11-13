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
- **Paket 2b-1 gebaut** (Branch `claude/cool-hopper-hcnb9d`, noch kein PR/Merge): Verträge aus Stripe und Lexware. Import alle 15 Min. + Stripe-Webhook, Vertragsvorschläge („NEXUS-Mitgliedschaft, N Monate“) zum Bestätigen unter Mitglieder › Vorschläge, Stripe-Zahlungen sicher über das Abo zugeordnet, Legacy ohne Bank zeigt „Bank nicht verbunden“. Spec `docs/superpowers/specs/2026-11-12-phase2b-design.md`, Plan `docs/superpowers/plans/2026-11-12-phase2b1-vertraege.md`. 603 Unit-Tests, E2E grün.
- **Als Nächstes:** PR für 2b-1 und Merge; dann Inhaber-Checkliste `docs/setup-phase2b.md` (Stripe-Lese-Schlüssel, Webhook, 2 Lexware-Schlüssel, 4 Vercel-Variablen, Migration). Vor echtem Betrieb Stripe-/Lexware-Feldnamen gegen die Doku prüfen (Backlog). Danach 2b-2 (Qonto API, Sparkasse CAMT, Zuordnungs-Härtung), dann 2b-3 (Umstellung der Bestandsmitglieder auf Stripe per Checkout-Link, Backlog „Vor 2b-3“ zuerst). Weiter offen: Supabase auf Pro vor echten Bankdaten; überzählige Vercel-Projekte löschen; `npm run test:integration` gegen Testprojekt.
- Zugänge des Inhabers: alles vorhanden außer einer zweiten WhatsApp-Nummer (erst 2e). Banken: Qonto (NEXUS, API) und Sparkasse Essen (Zulassung, CAMT-Upload). info@ beim Team, IMAP-Daten auf Anfrage. Kalender: Google und iCloud.
- Offen: Codex-Zweitmeinung; Gefühl der Wischgesten am iPhone.
