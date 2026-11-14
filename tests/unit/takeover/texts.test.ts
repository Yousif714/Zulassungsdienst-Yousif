import { describe, expect, test } from 'vitest';
import { linkNudgeText, shareText, upcomingReminderText } from '@/domain/takeover/texts';

const link = 'https://nexus.example.de/zahlung/abc';

describe('Umstellungs-Texte', () => {
  test('shareText exakt, mit Dauerauftrag und Link', () => {
    const t = shareText({ name: 'Erika Mustermann', link, rates: [{ no: 1, dueDate: '2026-12-01', amountCents: 45000 }, { no: 2, dueDate: '2027-01-01', amountCents: 30000 }] });
    expect(t).toBe(`Hallo Erika, ab sofort kannst du deine NEXUS-Raten automatisch abbuchen lassen (Karte oder SEPA-Lastschrift). 2 Raten, erste am 01.12.2026. Hier hinterlegst du dein Zahlungsmittel: ${link}\nWichtig: Bitte lösche danach deinen Dauerauftrag für NEXUS, damit nichts doppelt abgeht. Danke!`);
    expect(t).toContain('Dauerauftrag');
    expect(t).toContain(link);
  });
  test('upcomingReminderText mit Link', () => {
    expect(upcomingReminderText({ name: 'Erika Mustermann', amountCents: 30000, dueDate: '2026-12-01', link }))
      .toBe(`Hallo Erika, kurze Erinnerung: Am 01.12.2026 ist deine NEXUS-Rate über 300,00 € fällig. Bequemer geht es mit automatischer Abbuchung: ${link}`);
  });
  test('upcomingReminderText ohne Link', () => {
    expect(upcomingReminderText({ name: 'Erika Mustermann', amountCents: 30000, dueDate: '2026-12-01', link: null }))
      .toBe('Hallo Erika, kurze Erinnerung: Am 01.12.2026 ist deine NEXUS-Rate über 300,00 € fällig.');
  });
  test('linkNudgeText', () => {
    expect(linkNudgeText({ name: 'Erika Mustermann', link }))
      .toBe(`Hallo Erika, hast du meinen Link schon gesehen? Dort kannst du deine NEXUS-Raten automatisch abbuchen lassen: ${link}`);
  });
});
