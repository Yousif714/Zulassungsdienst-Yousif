@AGENTS.md

# Nexus-Assistent – Arbeitsregeln

**Zuerst lesen:** `docs/PROJEKT-STAND.md` (Ziel, Architektur, Stand, nächste Schritte). Spec: `docs/superpowers/specs/2026-11-12-nexus-assistent-design.md` (verbindlich, besonders 4a), Phase 2: `docs/superpowers/specs/2026-11-12-phase2-design.md`. Offene Punkte: `docs/phase2-backlog.md`.

## Sprache und Ton
- Antworten an den Inhaber auf Deutsch, kurz und direkt, ohne Moralpredigt. UI-Texte Deutsch.

## Code-Regeln
- `src/domain/` ist rein: kein React, keine Imports aus `src/data`, `src/app` oder `src/components`.
- Geldbeträge nur in Cent und nur über Ledger- und Domain-Funktionen. In Komponenten wird nicht gerechnet. Kalendertage in Europe/Berlin über `src/domain/clock.ts`, nie `new Date()` direkt (Demo-Uhr: `now()`).
- Wiederverwenden statt duplizieren. Das gilt besonders für Zuordnungslogik (`matching/`), Hinweis-Hrefs (`detectors/refs.ts`) und die Design-Bausteine in `src/components`.
- Ein Kontakt kann mehrere Verträge haben (`kind` fehlt = Mitgliedschaft). Kontakt → Vertrag nur über `membershipContractOf`/`contractsOfContact` (`ledger/contracts.ts`), nie `contracts.find(c => c.contactId === …)`.
- TDD: erst der fehlschlagende Test, dann der Code. Vor jedem Commit `npm test` und `npx tsc --noEmit`, bei UI-Änderungen zusätzlich die betroffene E2E-Spec.
- Nichts an Zugangsdaten oder echten Integrationen ändern und nichts nach außen senden ohne ausdrückliche Freigabe.
- Das Repo ist öffentlich: keine echten Personen-, Mitglieder- oder Bankdaten committen. Tests nutzen nur erfundene Fixtures (`@example.de`).
- Neue Tabellen nur per idempotenter Migration in `supabase/migrations/`. Claude spielt sie selbst über das Supabase-MCP (`apply_migration`, Projekt `nexus-assistent`) ein, prüft danach mit `list_tables`/`execute_sql` und merged erst dann. Destruktive Änderungen (DROP, Daten löschen) nur nach Rückfrage.

## Effizienz (Kontext sparen)
- Dateien gezielt lesen (Grep, `offset`/`limit`), keine kompletten Großdateien (`globals.css`, `seed.ts`, `store.tsx`, `package-lock.json`, Diffs) in den Hauptkontext holen.
- Testausgaben kürzen, z. B. `npm test 2>&1 | grep -E "Test Files|Tests |FAIL"` und `npm run e2e 2>&1 | tail -15`.
- Breite Recherchen, Codeanalysen, Reviews und lange Testläufe an Subagents geben. Nur deren Ergebnis zurückholen, Briefs und Berichte als Dateien übergeben.
- Modellwahl für Subagents:
  - `haiku` oder `sonnet` für mechanische Aufgaben, Suchen und kleine Reviews
  - `sonnet` für normale Implementierung und Task-Reviews
  - `opus` für Architektur, UI-Design-Entscheidungen und das abschließende Gesamtreview

## Agenten-Team (immer nutzen)
Rollen liegen in `.claude/agents/`. Die Hauptsession ist der Lead: Sie plant, verteilt, prüft Berichte gegen echte Tool-Ausgaben und baut nicht selbst mit, sobald eine Aufgabe mehr als eine Kleinigkeit ist.
- `architekt` (opus, liest nur): ein Plan, Modulgrenzen, Datei-Zuständigkeiten, Aufgaben mit Abhängigkeiten
- `domain-builder` (sonnet): `src/domain`, `src/data`, `src/server`, `src/ai`, `supabase/migrations`
- `ui-builder` (sonnet): `src/app`, `src/components`
- `test-engineer` (sonnet): nur `tests/`, schwächt nie einen Test ab
- `reviewer` (opus, liest nur, frischer Kontext): jede fertige Aufgabe gegen Spec und Diff, dazu das Gesamtreview

Ablauf: architekt → Builder und test-engineer parallel, jeder in seinen eigenen Dateien → reviewer → Lead führt zusammen, lässt `npm test` und `npx tsc --noEmit` laufen, committet. Kleinigkeiten (ein Tippfehler, eine Zeile, eine Frage) macht der Lead direkt.
Freigabe des Inhabers vor: Veröffentlichen, Senden, Löschen, Geld ausgeben, unumkehrbaren Änderungen. Keine Passwörter oder Secrets im Chat erfragen.

## Workflow
- Neue Features: Brainstorming → Spec → Plan → Umsetzung mit Subagents → Review.
- Branch: `claude/cool-hopper-hcnb9d`. Nach jedem Commit pushen.
- **Session-Übergabe:** `/uebergabe` ausführen. Das aktualisiert den Abschnitt „Stand & nächste Schritte“ in `docs/PROJEKT-STAND.md`, trägt neue Entscheidungen in Spec oder Backlog ein und committet. Danach `/clear`.
