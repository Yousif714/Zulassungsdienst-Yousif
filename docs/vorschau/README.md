# Nexus-Assistent – Vorschau (Phase 1)

Diese Vorschau zeigt, wie der Assistent für **NEXUS** und den **Zulassungsdienst** aussieht und arbeitet.
Alles läuft im Browser, auf dem iPhone genauso wie am Computer. Bilder findest du im Ordner
[`screenshots`](screenshots/) (jeweils `iphone-…` und `desktop-…`).

## Was funktioniert

Die Rechenlogik ist echt, nur die Daten sind Beispiele. Diese Abläufe kannst du ganz durchspielen:

- **Heute:** höchstens drei wichtige Hinweise, Termine, wartende Kunden und ein Tipp für den Tag.
- **Kunden antworten:** Ein Kunde wartet seit 3 Stunden → Verlauf öffnen → fertigen Entwurf ansehen, ändern oder senden.
- **NEXUS-Mitglieder:** Wer ist überfällig? Der Rechenweg zeigt Rückstand und künftige Raten getrennt. Eine Erinnerung mit Stripe-Zahlungslink wird vorbereitet.
- **Übernahme in Stripe:** Das Beispiel Mehmet Kaya ergibt 150 € Rückstand, 600 € künftige Raten, 750 € offen. Wahlweise „mit erster Rate nachzahlen“ (450 € + 300 €) oder „verteilen“ (375 € + 375 €).
- **Zahlungen zuordnen:** Eine unbekannte Überweisung einem Mitglied zuordnen. Danach erkennt die App die IBAN und ordnet die nächste Zahlung selbst zu.
- **Stripe und Lexware abgleichen:** Rechnung in Lexware noch offen, aber in Stripe bezahlt → mit einem Tipp erledigen.
- **SEELE-Call:** 10 Folientexte vorbereiten, bearbeiten und für Gamma kopieren.
- **Zulassungsdienst:** Tageszahlen, Aufträge nach Status, Kunden. Erledigte, aber nicht abgerechnete Aufträge werden erkannt; die passende Rechnung lässt sich zuordnen.
- **Zusagen:** Schreibst du „Rechnung schicke ich morgen“ und es passiert nichts, erinnert dich die App.
- **Chat:** Fragen wie „Wer ist bei NEXUS überfällig?“ oder „Wie viel Geld kommt diesen Monat noch rein?“ mit Links zu den passenden Seiten.
- **WhatsApp-Assistent (nachgestellt):** Morgenbriefing, Fragen, Knopf „Senden“. Alte Knöpfe und fremde Nummern werden abgelehnt.
- **Datenstand:** Ist eine Verbindung gestört, steht bei den betroffenen Zahlen „Datenstand zu alt“.
- **Protokoll:** Alles, was die App „ausführt“, steht mit Uhrzeit im Protokoll.

## Was läuft mit Beispieldaten

**Alles.** Es sind keine echten Konten verbunden – kein Lexware, kein Stripe, keine Bank, keine E-Mail, kein WhatsApp.
Mitglieder, Kunden, Zahlungen und Nachrichten sind erfunden. Die App rechnet so, als wäre heute
Donnerstag, der 12. November 2026, 9:30 Uhr.

„Senden“ verschickt nichts. Jede solche Aktion trägt das Etikett **Demo** und meldet „Gesendet (Demo)“.
Deine Klicks werden nur in deinem Browser gespeichert.

## So probierst du es aus

1. Auf **Heute** den Hinweis „Autohaus Schmidt wartet seit 3 Std.“ antippen und die Antwort **Senden**. Danach ist der Hinweis weg und steht im **Protokoll**.
2. **NEXUS** → **Mehmet Kaya** antippen → Rechenweg ansehen → **Erinnerung vorbereiten**.
3. Bei Mehmet Kaya **Übernahme** öffnen und zwischen den beiden Nachzahl-Arten umschalten.
4. **NEXUS** → **Zuordnen**: die Zahlung von S. Yilmaz **bestätigen**. Dann **Überweisung simulieren** mit derselben IBAN und 300 € – sie wird automatisch zugeordnet.
5. **SEELE-Call** öffnen → **Folientexte vorbereiten** → **Für Gamma kopieren**.
6. **Zulassungsdienst** → Auftrag von Müller → passende Rechnung **zuordnen**.
7. Unten rechts auf den Assistenten-Knopf tippen und **„Wer ist bei NEXUS überfällig?“** fragen.
8. **Assistent (WhatsApp)** → **Morgenbriefing auslösen**, dann „Schick Kaya die Erinnerung“ schreiben und **Senden** tippen.

**Alles wieder auf Anfang:** `?reset=1` an die Adresse hängen (zum Beispiel `…vercel.app/?reset=1`)
oder **Einstellungen → Demo zurücksetzen**.

## So öffnest du die Vorschau auf dem iPhone

1. Auf [vercel.com](https://vercel.com) anmelden (am einfachsten mit deinem GitHub-Konto).
2. **Add New Project** wählen.
3. Das GitHub-Repo **Zulassungsdienst-Yousif** auswählen (**Import**).
4. Als Branch **`claude/cool-hopper-hcnb9d`** einstellen. Alle anderen Einstellungen so lassen.
5. **Deploy** tippen und etwa zwei Minuten warten.
6. Den Link, den Vercel anzeigt, auf dem iPhone in **Safari** öffnen.
7. Unten auf **Teilen** (Quadrat mit Pfeil) tippen → **Zum Home-Bildschirm**.

Jetzt liegt die App wie eine normale App auf deinem Home-Bildschirm.

## Was Phase 2 von dir braucht

Pro Verbindung genau eine Sache von dir:

- **Lexware NEXUS:** einen API-Schlüssel aus dem Lexware-Konto von NEXUS.
- **Lexware Zulassungsdienst:** einen API-Schlüssel aus dem Lexware-Konto des Zulassungsdienstes.
- **Stripe (NEXUS):** einen eingeschränkten Lese-Schlüssel aus Stripe.
- **Bank:** einen Kontoauszug-Export (CSV oder CAMT) seit 1. August, später die Freigabe bei der Bank.
- **Gmail:** einmal mit deinem Google-Login zustimmen.
- **iCloud-Mail:** ein app-spezifisches Passwort aus deiner Apple-ID.
- **info@-Postfach:** wer der Anbieter ist und wie man sich dort anmeldet.
- **Kalender:** Freigabe deines Google- oder iCloud-Kalenders.
- **WhatsApp Kunden:** Zustimmung zur Anbindung über einen Anbieter; die WhatsApp-Business-App bleibt nutzbar.
- **WhatsApp-Assistent:** eine zweite Handynummer für den Assistenten und die Freigabe der Briefing-Vorlagen bei Meta.
- **KI (Claude):** einen API-Schlüssel von Anthropic, damit Entwürfe und Antworten von der KI kommen.
- **Anmeldung:** welche Personen die App öffnen dürfen.
