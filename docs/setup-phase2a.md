# Einrichtung Paket 2a (Inhaber-Checkliste)

Einmalige Einrichtung von Supabase und Vercel. Keine echten Werte in dieses Dokument oder ins Repository schreiben.

1. **Supabase-Projekt anlegen:** supabase.com → Dashboard → „New project“ → Name `nexus-assistent`, Region **Central EU (Frankfurt)**, starkes Datenbank-Passwort im Passwort-Manager speichern.
2. **Migration ausführen:** Projekt → „SQL Editor“ → „New query“ → Inhalt von `supabase/migrations/20261112000000_fundament.sql` einfügen → „Run“. Prüfen: „Table Editor“ zeigt die Tabellen, jede mit „RLS enabled“. (Alternative mit CLI: `npx supabase link --project-ref <ref>` und `npx supabase db push`.)
3. **Schlüssel holen:** Project Settings → „API“ (bzw. „API Keys“) → Project URL = `SUPABASE_URL`, `service_role`-Schlüssel = `SUPABASE_SERVICE_ROLE_KEY`. Nie weitergeben, nie in den Browser.
4. **Vercel Pro:** vercel.com → Team „NEXUS“ → Settings → Billing → „Upgrade to Pro“ (nötig für den Cron alle 5 Minuten).
5. **Umgebungsvariablen:** Projekt → Settings → „Environment Variables“ → für „Production“ (und „Preview“, falls gewünscht) anlegen:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SESSION_SECRET` (mindestens 32 Zeichen, z. B. `openssl rand -base64 48`)
   - `OWNER_SETUP_TOKEN` (zufällig, nur einmal gebraucht)
   - `CRON_SECRET` (zufällig)
   - `APP_ORIGIN` (z. B. `https://<deine-domain>`, ohne Schrägstrich am Ende, genau die Adresse, unter der du die App öffnest)

   Danach „Deployments“ → letztes Deployment → „Redeploy“.
6. **Cron prüfen:** Projekt → Settings → „Cron Jobs“ zeigt `/api/cron/tick` alle 5 Minuten.
7. **Erste Anmeldung:** auf dem iPhone in Safari `APP_ORIGIN/anmelden` öffnen → `OWNER_SETUP_TOKEN` eingeben → „Passkey anlegen“ → Face ID bestätigen.
8. **Wiederherstellungscodes sichern:** die 10 Codes sofort im Passwort-Manager speichern (z. B. iCloud-Schlüsselbund, Notiz). Jeder Code gilt nur einmal. Neue Codes später unter Einstellungen → Konto → „Neue Wiederherstellungscodes“.
9. **Optional:** `OWNER_SETUP_TOKEN` in Vercel löschen (die Einrichtung ist ohnehin gesperrt). Zweites Gerät: angemeldet unter Einstellungen → Konto → „Passkey hinzufügen“. Dort stehen auch „Demo-Modus“ und „Abmelden“.
10. **Integrationstest (für Entwickler):** zweites Projekt `nexus-test` in Frankfurt, Schritt 2 dort wiederholen, lokal `SUPABASE_TEST_URL` und `SUPABASE_TEST_SERVICE_ROLE_KEY` setzen (optional `SUPABASE_TEST_ANON_KEY`), dann `npm run test:integration`. Diese Variablen nicht auf Vercel anlegen.
11. **Was 2a noch nicht tut:** keine echten Verbindungen, nichts wird gesendet, die KI ist die Demo-KI (Spec Abschnitt 6).
