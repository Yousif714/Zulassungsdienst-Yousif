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
| `docs/setup-ab.md` | **Inhaber-Checkliste** Auftragsbestätigungen und Import ab 01.06. |
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
- **Live** (`https://nexus-iota-gold-96.vercel.app`, Vercel `nexus`, Supabase `nexus-assistent`; alle Migrationen bis `20261116000000_auftragsbestaetigungen.sql` eingespielt; PRs #3–#12 gemergt). Vercel-Token der Session-Umgebung erlaubt Variablen/Deploys prüfen und neu deployen.
- **Verbunden:** Lexware NEXUS + Zulassung, Qonto. Gesetzt: `ANTHROPIC_API_KEY` (noch ungenutzt). Fehlt: Stripe-Schlüssel + Webhook (`docs/setup-phase2b.md`), Portal-Supabase-Schlüssel (bei der Agentur; bis dahin Excel-Upload).
- **Funktionen:** Vertragsvorschläge (Rechnung und Auftragsbestätigung, „zum Monatsende“), NEXUS › Offen, NEXUS › Zuordnen (lernende IBAN), Portal-Mitglieder (Excel-Upload, Status, „Vertrag anlegen“), Import ab 01.06.2026, „Jetzt abgleichen“ + Neuladen beim Zurückkehren.
- **Gerade live (17:05, 13.11.):** ABs + Import ab Juni. Erster echter Lauf noch nicht geprüft: Inhaber tippt mehrmals „Jetzt abgleichen“; bei Hinweis unter Verbindungen › Lexware (AB-Feldnamen ungeprüft) Grund prüfen und anpassen. Dann Portal-Mitglieder durchgehen, Zuordnen bestätigen.
- **Als Nächstes:** „Rechnungen lesen“ mit Claude (Entscheidung (a): Plan gilt sofort, markiert, korrigierbar; unsicher/Summe passt nicht → Vorschlag) → Sparkasse-Upload → 2b-3 Umstellung Bestandsmitglieder auf Stripe (Backlog „Vor 2b-3“ zuerst).
- **Offen:** Qonto-/Lexware-/Stripe-Feldnamen mit echten Daten prüfen (Backlog); Supabase auf Pro; überzählige Vercel-Projekte löschen; `npm run test:integration`; zweite WhatsApp-Nummer (2e); Codex-Zweitmeinung.
- Daten: Echte Mitgliederliste nie ins Repo (öffentlich). Banken: Qonto (NEXUS), Sparkasse Essen (Zulassung, Upload). Kalender Google + iCloud. info@ beim Team.
