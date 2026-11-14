# Einrichtung Paket 2b-3: Umstellung auf Stripe (Testlauf)

Claude führt die Schritte selbst aus (Connectors für Supabase, Vercel-API, sicheres Credential-Formular). Du gibst nur zwei Freigaben. Keine echten Werte in dieses Dokument oder ins Repository schreiben.

## Deine zwei Freigaben
1. **Supabase-Projekt anlegen:** Claude legt über den Supabase-Connector das Projekt `nexus-assistent-preview` an (Organisation NEXUS, Region eu-central-1). Du bestätigst die Rückfrage mit Kosten.
2. **Stripe-Testschlüssel:** Claude fordert über das sichere Credential-Formular einen Schlüssel `sk_test_…` an. Du fügst ihn nur dort ein, nie im Chat. Der Schlüssel braucht Schreibrecht auf Customers, Checkout Sessions, SetupIntents (Lesen), PaymentMethods, Subscription Schedules, Subscriptions, Products, Prices und Leserecht wie der Lese-Schlüssel.

## Was Claude dann tut
1. **Preview-Datenbasis:** Claude spielt alle Migrationen (bis `20261118000000_stripe_umstellung.sql`) ins Preview-Projekt ein und prüft sie mit `list_tables`. Testdaten kommen nie in den Live-Stand.
2. **Schlüssel prüfen:** Vor jedem Schreibzugriff in Stripe prüft Claude, dass der Schlüssel `livemode:false` hat. Bei Live-Schlüsseln wird nichts geschrieben.
3. **Test-Webhook:** Claude legt in Stripe (Test) einen Webhook auf `https://nexus-git-claude-cool-hopper-hcnb9d-nexus-0349.vercel.app/api/webhooks/stripe` an mit den 11 Ereignissen: `checkout.session.completed`, `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`, `.trial_will_end`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`. Das Signaturgeheimnis geht direkt in die Vercel-Variable.
4. **Vercel-Preview-Variablen** (Team `nexus-0349`, Projekt `nexus`, per Vercel-API, nur **Preview**, Branch `claude/cool-hopper-hcnb9d`): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (Preview-Projekt), `OWNER_SETUP_TOKEN` (eigener), `STRIPE_RESTRICTED_KEY`, `STRIPE_WRITE_KEY`, `STRIPE_WEBHOOK_SECRET` (alle Test), `PAYMENT_LINK_BASE_URL` (stabile Preview-Adresse). Production bleibt unverändert.
5. **Deployment Protection:** Steht auf `all_except_custom_domains`, die Preview ist also geschützt und blockiert Stripe und Testmitglieder. Claude lockert den Schutz für den Testlauf per Vercel-API und setzt ihn danach wieder auf den vorherigen Wert zurück.
6. **Testlauf** auf der Preview-Adresse (einmal Passkey neu einrichten, dafür der neue `OWNER_SETUP_TOKEN`): Testmitglied mit erfundenem Namen und verbundener Bank anlegen; „Auf Stripe umstellen“ → „Freigeben“ → Link öffnen → Testkarte `4242 4242 4242 4242` bzw. Test-IBAN `DE89370400440532013000` → Danke-Seite → in der App „eingerichtet“. In Stripe (Test) prüft Claude: Zeitplan mit Beträgen, Startdatum, Ende, Produkt „NEXUS-Mitgliedschaft (Ratenplan)“, Metadaten `contractId` am Abo, Checkout-`url`, `setup_intent`, `schedule.phases[-1].end_date` = `planEndDate`. Mit Stripe Test Clocks wird bis zur ersten Abbuchung vorgespult: Abo erscheint verknüpft, Status „aktiv“. Abweichungen zieht Claude als `fix:` mit Test nach.
7. **Aufräumen:** Schutz zurückdrehen, Test-Webhook und Testdaten nach Absprache entfernen.

## Regel nach Vorfall 14.11.
Ein Live-Stripe-Schlüssel wurde versehentlich als Session-Credential gespeichert (nur Leseabfragen, danach von dir gelöscht). Daher: Stripe-Schreibaktionen aus der Session nur nach `livemode:false`-Prüfung. Live-Schlüssel gehören nie in die Session.

## Live schalten (später, nur mit deiner Freigabe)
Gleiche Schritte mit Live-Schlüsseln in **Production** (Vercel-Variablen von Hand oder nach ausdrücklicher Freigabe), Live-Webhook um `checkout.session.completed` ergänzen. Der Pull Request wird erst nach erfolgreichem Testlauf und auf deine Freigabe erstellt.

## Anhang: Fallback per Klick (nur falls Claude nicht durchkommt)
- Supabase: Dashboard → New project `nexus-assistent-preview` (NEXUS, eu-central-1); Migrationen im SQL Editor der Reihe nach einfügen.
- Stripe (Testmodus): Entwickler → API-Schlüssel → Eingeschränkten Schlüssel „Nexus Assistent schreiben (Test)“ erstellen; Entwickler → Webhooks → Endpoint mit der Preview-URL und den 11 Ereignissen anlegen, Signaturgeheimnis kopieren.
- Vercel: Projekt `nexus` → Settings → Environment Variables → nur Preview die Variablen aus Schritt 4 setzen; Settings → Deployment Protection → für den Test lockern, danach zurückstellen.
