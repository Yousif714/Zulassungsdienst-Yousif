# Einrichtung Portal-Abgleich (Inhaber-Checkliste)

Die Mitgliederliste aus dem NEXUS-Portal wird von dir hochgeladen. Es gibt keine Anbindung, keine Zugangsdaten und keine Vercel-Variablen. Keine echte Mitgliederliste in dieses Dokument oder ins Repository legen.

1. **Supabase zuerst, vor Merge und Deploy:** SQL Editor der App-Supabase → „New query“ → Inhalt von `supabase/migrations/20261115000000_portal.sql` einfügen → „Run“. Ohne die neuen Tabellen lädt die App nicht. Die Datei ist beliebig oft ausführbar.
2. **Portal:** Auf `portal.nexusnetzwerk.de/mitglieder` die Mitgliederliste als **Excel** exportieren. Alternativ als CSV, oder die Liste markieren und kopieren.
3. **App:** NEXUS → „Portal-Mitglieder“ → „Mitgliederliste einfügen“ → Excel-, CSV-Datei wählen (oder Text einfügen) → **Vorschau prüfen** (Mitglieder erkannt, doppelt, Zeilen ohne E-Mail) → „N Mitglieder übernehmen“.
4. **Prüfen, was du dann siehst:**
   - Verbindungen: „NEXUS-Portal · Verbunden“.
   - Portal-Mitglieder: oben die Zusammenfassung und „Liste vom …“, je Mitglied Name, E-Mails, Beigetreten, Zuletzt aktiv und Status.
   - Heute: „N Mitglieder ohne Rechnung“.
5. **Was die Status bedeuten:**
   - **Vertrag:** Das Mitglied hat einen Vertrag in der App (Ampel und Rückstand siehe dort).
   - **Vorschlag offen:** Aus Rechnungen oder Stripe gibt es schon einen Vertragsvorschlag zum Bestätigen.
   - **Rechnung ohne Mitgliedschaft:** Es gibt Rechnungen, aber keinen Vertrag. „Vertrag anlegen“ übernimmt die Rate aus der Rechnung.
   - **Keine Rechnung:** Im Portal, aber nirgends abgerechnet. „Vertrag anlegen“ oder „Kein zahlendes Mitglied“ (z. B. Team). Letzteres blendet das Mitglied aus.
   - **nicht mehr in Liste:** Fehlt in der neuesten Liste. Es wird nur markiert.
   - „teilt Kontakt mit …“: Mehrere Portal-Mitglieder treffen denselben Kontakt (z. B. gleiche E-Mail).
6. **Pflege:** Liste spätestens alle 30 Tage neu hochladen, sonst meldet die Verbindung „veraltet“. Ein erneuter Upload **löscht nie etwas**: Neue werden ergänzt, Vorhandene aktualisiert, Fehlende nur markiert. Die zugeordneten Verträge bleiben unberührt.
