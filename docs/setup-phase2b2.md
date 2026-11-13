# Einrichtung Paket 2b-2 (Inhaber-Checkliste)

Qonto lesend anbinden (nur Eingänge). Es wird nichts geschrieben oder gesendet. Keine echten Werte in dieses Dokument oder ins Repository schreiben.

1. **Supabase zuerst, vor Merge und Deploy:** SQL Editor → „New query“ → Inhalt von `supabase/migrations/20261114000000_qonto.sql` einfügen → „Run“. Benennt die Verbindung `bank` in `bank_qonto` um, ohne Datenverlust, beliebig oft ausführbar.
2. **Qonto:** Web-App → Einstellungen → „Integrationen & Partner“ → „API-Schlüssel“: **Login** und **Secret Key** kopieren (nur Lesen) und in den Passwort-Manager. Menüpfad ggf. gegen die Qonto-Hilfe prüfen.
3. **Vercel:** Projekt → Settings → „Environment Variables“ → nur für **Production**, jeweils als „Secret“: `QONTO_LOGIN`, `QONTO_SECRET_KEY`. Danach „Deployments“ → letztes Deployment → „Redeploy“.
4. **Prüfen, was du dann siehst:**
   - Verbindungen: „Qonto (NEXUS)“ zeigt „Verbunden · Stand vor … Min.“, „Sparkasse (Zulassung)“ zeigt „Kommt als Upload“.
   - NEXUS → Zuordnen: Eingänge ohne sicheren Treffer als Vorschläge. Je Mitglied einmal „Ja, gehört zu …“, danach ordnet NEXUS Zahlungen derselben IBAN automatisch zu.
   - NEXUS → Offen: alle offenen Forderungen, ohne Doppelzählung mit Verträgen.
   - Stripe-Auszahlungen erscheinen nirgends als Mitgliedszahlung.
5. **Fehlerfall:** Wie bei 2b-1: Die bisherigen Daten bleiben stehen, nach drei Fehlern in Folge erscheint ein Hinweis. Der Grund steht ohne Schlüssel bei der Verbindung.
