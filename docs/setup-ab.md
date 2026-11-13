# Einrichtung Auftragsbestätigungen und Import ab Juni (Inhaber-Checkliste)

Spec: `docs/superpowers/specs/2026-11-13-auftragsbestaetigungen-design.md`. Keine neuen Schlüssel, keine Vercel-Variablen. Der vorhandene Lexware-Schlüssel braucht Leserechte für Auftragsbestätigungen (bei „alle Rechte“ erfüllt).

1. **Supabase zuerst, vor dem Merge:** SQL Editor der App-Supabase → „New query“ → Inhalt von `supabase/migrations/20261116000000_auftragsbestaetigungen.sql` einfügen → „Run“. Die Datei legt die Tabelle `order_confirmations` an und erweitert `apply_changes`. Sie ist beliebig oft ausführbar. Ohne sie lädt die App zwar, kann aber keine Auftragsbestätigungen speichern: der Lexware-Abgleich meldet dann einen Fehler.
2. **PR mergen lassen.** Danach holt der Import Daten ab **01.06.2026** statt ab 01.08. (Lexware, Stripe, Qonto). Jede Verbindung beginnt dafür einmal von vorn. Doppelte Einträge entstehen nicht.
3. **Verbindungen → „Jetzt abgleichen“, mehrmals:** Der Nachimport ab Juni läuft in Teilstücken (Zeitbudget je Lauf, Lexware höchstens 2 Anfragen pro Sekunde). Nach jedem Klick eine Minute warten und erneut klicken, bis alle Verbindungen „Verbunden“ ohne Teilstand zeigen. Der automatische Abgleich (alle 15 Minuten) macht sonst von allein weiter.
4. **Prüfen, was du dann siehst:**
   - Mitglieder › Vorschläge: zusätzliche Vorschläge mit Quelle „Lexware (AB)“ und Referenz „Auftragsbestätigung AB-…“. Hat derselbe Kontakt eine Mitgliedschafts-Rechnung, gilt die Rechnung.
   - Portal-Mitglieder: Zeilen mit „AB AB-… vorhanden, Rechnung fehlt“.
   - Heute: „N Mitglieder mit Auftragsbestätigung, aber ohne Rechnung“.
   - Offen und Zuordnen: **keine** Auftragsbestätigungen. Eine AB ist keine Forderung.
5. **Wenn Lexware einen Fehler meldet** (Verbindungen, rote Zeile): Der Grund steht in Klammern, z. B. bei einer abgelehnten Belegliste. Dann Bescheid geben.
