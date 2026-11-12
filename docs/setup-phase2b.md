# Einrichtung Paket 2b-1 (Inhaber-Checkliste)

Stripe und Lexware lesend anbinden. Es wird nichts geschrieben oder gesendet. Keine echten Werte in dieses Dokument oder ins Repository schreiben.

1. **Stripe, Restricted Key:** dashboard.stripe.com → Entwickler → „API-Schlüssel“ → „Eingeschränkten Schlüssel erstellen“. Nur **Lesen** für: Customers, Subscriptions, Invoices, Charges und Refunds, Disputes, Products und Prices. Alles andere „Keine“. Schlüssel (`rk_live_…`) sofort in den Passwort-Manager.
2. **Stripe, Webhook:** Entwickler → „Webhooks“ → „Endpunkt hinzufügen“. URL `https://nexus-iota-gold-96.vercel.app/api/webhooks/stripe`. Events:
   - `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`, `.trial_will_end`
   - `invoice.paid`, `invoice.payment_failed`
   - `charge.refunded`, `charge.dispute.created`

   Danach das „Signing Secret“ (`whsec_…`) kopieren.
3. **Lexware:** je Konto (NEXUS und Zulassung) in Lexware Office → Einstellungen → „Öffentliche API“ einen API-Schlüssel erstellen. Zwei getrennte Schlüssel.
4. **Vercel:** Projekt → Settings → „Environment Variables“ → nur für **Production** anlegen:
   - `STRIPE_RESTRICTED_KEY`
   - `STRIPE_WEBHOOK_SECRET`
   - `LEXWARE_NEXUS_API_KEY`
   - `LEXWARE_ZULASSUNG_API_KEY`

   Danach „Deployments“ → letztes Deployment → „Redeploy“.
5. **Supabase:** SQL Editor → „New query“ → Inhalt von `supabase/migrations/20261113000000_vertraege.sql` einfügen → „Run“.
6. **Prüfen, was du dann siehst:**
   - Verbindungen: Stripe und Lexware zeigen „Verbunden · Stand vor … Min.“. Nach dem Webhook-Test von Stripe („Testereignis senden“) bleibt der Endpunkt grün.
   - NEXUS: die Karte „Verträge zum Bestätigen“ führt zu den Vorschlägen. Erst nach „Übernehmen“ (bzw. „Ist das …?“ bei gleichem Namen) entsteht ein Vertrag, mit Zahlungen rückwirkend verrechnet. Lexware-Verträge zeigen „Bank nicht verbunden“, bis die Bankanbindung steht.
7. **Fehlerfall:** Zeigt Verbindungen „Fehler“, bleiben die bisherigen Daten stehen. Nach drei Fehlern in Folge erscheint ein Hinweis.
