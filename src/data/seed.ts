import { CONNECTION_CATALOG } from '@/domain/connections';
import { addDaysIso, berlinLocalToUtc } from '@/domain/clock';
import { buildSchedule } from '@/domain/ledger/schedule';
import type {
  Allocation, AppState, CalendarEvent, Call, Connection, Contact, ContentItem, IbanLink, Invoice, IsoDate, Job,
  MemberContract, Message, Payment, Vehicle,
} from '@/domain/types';

/** Geschäftliche WhatsApp-Nummer und E-Mail des Inhabers (Absender ausgehender Kundennachrichten). */
export const OWNER_WHATSAPP = '+492041700700';
export const OWNER_EMAIL = 'info@zulassungsdienst-bundesweit.de';

const DEMO_TODAY: IsoDate = '2026-11-12';
const SYNCED_AT = '2026-11-12T08:20:00.000Z'; // 09:20 Berlin

/** Deterministischer PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const at = (date: IsoDate, time: string) => berlinLocalToUtc(date, time).toISOString();

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const MEMBER_NAMES = [
  'Ahmet Öztürk', 'Laura Hoffmann', 'Murat Aydın', 'Julia Bauer', 'Emine Şahin', 'Lukas Schneider', 'Fatma Arslan', 'Sophie Fischer',
  'Burak Doğan', 'Katharina Weber', 'Elif Koç', 'Maximilian Meyer', 'Hakan Kılıç', 'Lena Schäfer', 'Zeynep Kaplan', 'Felix Richter',
  'Yusuf Kurt', 'Hannah Wolf', 'Merve Tekin', 'Jan Zimmermann', 'Cem Aksoy', 'Marie Krüger', 'Deniz Polat', 'Tobias Hartmann',
  'Aylin Erdoğan', 'Nina Lange', 'Serkan Güneş', 'Sarah Braun', 'Gökhan Yıldız', 'Anja Neumann', 'Kerem Aslan', 'Lisa Schmitz',
  'Esra Korkmaz', 'Daniel Peters', 'Oğuz Yavuz', 'Miriam Vogel',
];
const TOTALS = [180000, 240000, 300000, 360000, 420000, 480000, 540000, 600000];
const DUE_DAYS = [1, 1, 1, 5, 10, 15, 15, 20, 28];
const MONTHS = ['2026-08', '2026-09', '2026-10', '2026-11'];
const SPECIAL_TERMS: Record<number, string> = {
  3: 'Frühbucher-Rabatt von 300 € ist im Gesamtbetrag berücksichtigt.',
  11: 'Coaching-Paket Plus mit zwei zusätzlichen Einzelcalls.',
  24: 'Ratenhöhe nach Absprache, Restbetrag mit der letzten Rate.',
};
/** Diese generierten Mitglieder haben die zuletzt fällige Rate nicht gezahlt. */
const LATE = new Set([4, 13, 22]);

export function createDemoState(): AppState {
  const rnd = mulberry32(20261112);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const digits = (n: number) => Array.from({ length: n }, () => Math.floor(rnd() * 10)).join('');

  const connections: Connection[] = CONNECTION_CATALOG.map(({ id, company, label }) => (id === 'bank_sparkasse'
    ? { id, company, label, status: 'missing' as const, lastSuccessAt: null }
    : { id, company, label, status: 'connected' as const, lastSuccessAt: SYNCED_AT }));
  const contacts: Contact[] = [];
  const contracts: MemberContract[] = [];
  const payments: Payment[] = [];
  const allocations: Allocation[] = [];
  const ibanLinks: IbanLink[] = [];

  const bankPay = (id: string, contactName: string, iban: string, amountCents: number, bookedOn: IsoDate, reference: string): Payment => ({
    id, company: 'nexus', source: 'bank', connectionId: 'bank_qonto', externalId: `bank-${id}`, amountCents, bookedOn, payerName: contactName, iban, reference, kind: 'incoming',
  });
  const stripePay = (id: string, contactName: string, amountCents: number, bookedOn: IsoDate, reference: string): Payment => ({
    id, company: 'nexus', source: 'stripe', connectionId: 'stripe_nexus', externalId: `ch_${id.replace(/-/g, '_')}`, amountCents, bookedOn, payerName: contactName, reference, kind: 'incoming',
  });
  const member = (id: string, name: string): Contact => {
    const c: Contact = { id, company: 'nexus', kind: 'member', name, phones: [`+4917${digits(8)}`], emails: [`${slug(name).replace(/-/g, '.')}@example.de`] };
    contacts.push(c);
    return c;
  };

  // --- Feste Referenzmitglieder ---
  const kaya = member('m-kaya', 'Mehmet Kaya');
  contracts.push({ id: 'mc-kaya', contactId: kaya.id, totalCents: 120000, installments: 4, installmentCents: 30000, dueDay: 1, startDate: '2026-10-01', billing: 'legacy', catchUpMode: 'first_rate' });
  ibanLinks.push({ iban: 'DE89370400440532013000', contactId: kaya.id, confirmedAt: at('2026-10-02', '12:00') });
  payments.push(bankPay('p-kaya-1', kaya.name, 'DE89370400440532013000', 30000, '2026-10-02', 'NEXUS Rate 1 Kaya'));
  payments.push(bankPay('p-kaya-2', kaya.name, 'DE89370400440532013000', 15000, '2026-11-03', 'NEXUS Teilzahlung Kaya'));
  allocations.push({ paymentId: 'p-kaya-1', contractId: 'mc-kaya', amountCents: 30000, method: 'confirmed' });
  allocations.push({ paymentId: 'p-kaya-2', contractId: 'mc-kaya', amountCents: 15000, method: 'confirmed' });

  const yilmaz = member('m-yilmaz', 'Selin Yilmaz');
  contracts.push({ id: 'mc-yilmaz', contactId: yilmaz.id, totalCents: 360000, installments: 12, installmentCents: 30000, dueDay: 10, startDate: '2026-11-10', billing: 'legacy', catchUpMode: 'first_rate' });
  payments.push({ ...bankPay('p-yilmaz-1', 'S. Yilmaz', 'DE02120300000000202051', 30000, '2026-11-11', 'NEXUS November'), externalId: 'bank-yilmaz-20261111' });

  const schulz = member('m-schulz', 'Anna Schulz');
  contracts.push({ id: 'mc-schulz', contactId: schulz.id, totalCents: 300000, installments: 12, installmentCents: 25000, dueDay: 1, startDate: '2026-11-01', billing: 'stripe', catchUpMode: 'first_rate' });
  payments.push(stripePay('p-stripe-118', schulz.name, 25000, '2026-11-01', 'RE-2026-118'));
  allocations.push({ paymentId: 'p-stripe-118', contractId: 'mc-schulz', amountCents: 25000, method: 'auto' });

  const becker = member('m-becker', 'Thomas Becker');
  contracts.push({ id: 'mc-becker', contactId: becker.id, totalCents: 300000, installments: 12, installmentCents: 25000, dueDay: 1, startDate: '2026-09-01', billing: 'legacy', catchUpMode: 'first_rate' });
  const beckerIban = `DE${digits(20)}`;
  ibanLinks.push({ iban: beckerIban, contactId: becker.id, confirmedAt: at('2026-09-06', '12:00') });
  ['2026-09-06', '2026-10-06', '2026-11-06'].forEach((d, i) => {
    payments.push(bankPay(`p-becker-${i + 1}`, becker.name, beckerIban, 25000, d, `NEXUS Rate ${i + 1} Becker`));
    allocations.push({ paymentId: `p-becker-${i + 1}`, contractId: 'mc-becker', amountCents: 25000, method: 'confirmed' });
  });

  // --- 36 generierte Mitglieder ---
  MEMBER_NAMES.forEach((name, idx) => {
    const c = member(`m-${slug(name)}`, name);
    const installments = rnd() < 0.5 ? 6 : 12;
    const totalCents = pick(TOTALS);
    const dueDay = pick(DUE_DAYS);
    const month = LATE.has(idx) ? '2026-09' : pick(MONTHS);
    const contract: MemberContract = {
      id: `mc-${slug(name)}`, contactId: c.id, totalCents, installments, installmentCents: totalCents / installments, dueDay,
      startDate: `${month}-${String(dueDay).padStart(2, '0')}`, billing: idx % 2 === 0 ? 'stripe' : 'legacy', catchUpMode: 'first_rate',
      ...(SPECIAL_TERMS[idx] ? { specialTerms: SPECIAL_TERMS[idx] } : {}),
    };
    contracts.push(contract);
    const iban = `DE${digits(20)}`;
    if (contract.billing === 'legacy') ibanLinks.push({ iban, contactId: c.id, confirmedAt: at(contract.startDate, '12:00') });

    const due = buildSchedule(contract, []).map((r) => r.dueDate).filter((d) => d <= DEMO_TODAY);
    const paidCount = LATE.has(idx) ? due.length - 1 : due.length;
    for (let i = 0; i < paidCount; i++) {
      const delay = Math.floor(rnd() * 3);
      const bookedOn = addDaysIso(due[i], delay) > DEMO_TODAY ? DEMO_TODAY : addDaysIso(due[i], delay);
      const id = `p-${slug(name)}-${i + 1}`;
      const ref = `NEXUS Rate ${i + 1}`;
      payments.push(contract.billing === 'legacy' ? bankPay(id, name, iban, contract.installmentCents, bookedOn, ref) : stripePay(id, name, contract.installmentCents, bookedOn, ref));
      allocations.push({ paymentId: id, contractId: contract.id, amountCents: contract.installmentCents, method: contract.billing === 'legacy' ? 'confirmed' : 'auto' });
    }
  });

  payments.push({
    id: 'p-payout-1', company: 'nexus', source: 'bank', connectionId: 'bank_qonto', externalId: 'bank-po-20261110', amountCents: 148000, bookedOn: '2026-11-10',
    payerName: 'Stripe Technologies Europe Ltd', reference: 'STRIPE PAYOUT po_1Nx20261110', kind: 'stripe_payout',
  });

  // --- Zulassungsdienst ---
  const z = (id: string, kind: Contact['kind'], name: string, phones: string[], emails: string[] = []): Contact => ({ id, company: 'zulassung', kind, name, phones, emails });
  contacts.push(
    z('d-schmidt', 'dealer', 'Autohaus Schmidt', ['+49209111222'], ['service@autohaus-schmidt.example.de']),
    z('d-mueller', 'dealer', 'Autohaus Müller', ['+492041555666'], ['buchhaltung@autohaus-mueller.example.de']),
    z('d-krause', 'dealer', 'Autohaus Krause', ['+49201333444']),
    z('p-demir', 'private', 'Herr Demir', ['+491701234567']),
    z('p-oezdemir', 'private', 'Ayşe Özdemir', ['+491602223344']),
    z('p-celik', 'private', 'Emre Çelik', ['+491765556677']),
    z('p-wagner', 'private', 'Jonas Wagner', ['+491519998877']),
  );

  const vehicles: Vehicle[] = [
    { id: 'v-schmidt-golf', contactId: 'd-schmidt', vin: 'WVWZZZ1KZBW000123', plate: 'GE-AS 123', model: 'VW Golf' },
    { id: 'v-mueller-astra', contactId: 'd-mueller', vin: 'W0L0AHL4865000456', plate: 'BOT-MK 456', model: 'Opel Astra' },
    { id: 'v-mueller-focus', contactId: 'd-mueller', vin: 'WF0AXXGCDA0000211', plate: 'BOT-MK 211', model: 'Ford Focus' },
    { id: 'v-mueller-octavia', contactId: 'd-mueller', vin: 'TMBJG7NE0J0000218', plate: 'BOT-MK 218', model: 'Škoda Octavia' },
    { id: 'v-krause-bmw', contactId: 'd-krause', vin: 'WBA8E1105K0000701', plate: 'E-KR 701', model: 'BMW 320d' },
    { id: 'v-krause-mb', contactId: 'd-krause', vin: 'WDD2050421R000702', plate: 'E-KR 702', model: 'Mercedes C 200' },
    { id: 'v-wagner-yaris', contactId: 'p-wagner', vin: 'VNKKL3D3X0A000088', plate: 'BOT-JW 88', model: 'Toyota Yaris' },
  ];

  const jobs: Job[] = [
    { id: 'j-schmidt-1', vehicleId: 'v-schmidt-golf', contactId: 'd-schmidt', service: 'Umschreibung', location: 'bottrop', priceCents: 8900, status: 'waiting_customer', doneAt: null, invoiceIds: [], notes: 'eVB-Nummer fehlt noch.' },
    { id: 'j-mueller-1', vehicleId: 'v-mueller-astra', contactId: 'd-mueller', service: 'Umschreibung', location: 'bottrop', priceCents: 8900, status: 'done', doneAt: at('2026-11-10', '14:00'), invoiceIds: [] },
    { id: 'j-mueller-0a', vehicleId: 'v-mueller-focus', contactId: 'd-mueller', service: 'Neuzulassung inkl. Kennzeichen', location: 'essen', priceCents: 39000, status: 'invoiced', doneAt: at('2026-10-05', '11:00'), invoiceIds: ['i-z-290'] },
    { id: 'j-mueller-0b', vehicleId: 'v-mueller-octavia', contactId: 'd-mueller', service: 'Umschreibung mit Kennzeichen', location: 'bottrop', priceCents: 25000, status: 'invoiced', doneAt: at('2026-10-13', '15:00'), invoiceIds: ['i-z-295'] },
    { id: 'j-krause-1', vehicleId: 'v-krause-bmw', contactId: 'd-krause', service: 'Zulassung vor Ort', location: 'onsite', priceCents: 9900, status: 'paid', doneAt: at('2026-11-03', '10:00'), invoiceIds: ['i-z-301'] },
    { id: 'j-krause-2', vehicleId: 'v-krause-mb', contactId: 'd-krause', service: 'Zulassung vor Ort', location: 'onsite', priceCents: 9900, status: 'paid', doneAt: at('2026-11-05', '11:30'), invoiceIds: ['i-z-305'] },
    { id: 'j-wagner-1', vehicleId: 'v-wagner-yaris', contactId: 'p-wagner', service: 'Umschreibung vor Ort', location: 'onsite', priceCents: 9900, status: 'paid', doneAt: at('2026-11-06', '16:00'), invoiceIds: ['i-z-306'] },
  ];

  const zInv = (id: string, number: string, contactId: string, totalCents: number, issuedOn: IsoDate, dueDate: IsoDate, status: Invoice['status'], text: string): Invoice => ({
    id, company: 'zulassung', source: 'lexware', connectionId: 'lexware_zulassung', externalId: `lex-z-${number}`, contactId, number, totalCents,
    openCents: status === 'paid' ? 0 : totalCents, issuedOn, dueDate, status, text,
  });
  const invoices: Invoice[] = [
    {
      id: 'i-lex-118', company: 'nexus', source: 'lexware', connectionId: 'lexware_nexus', externalId: 'lex-n-RE-2026-118', contactId: 'm-schulz', number: 'RE-2026-118',
      totalCents: 25000, openCents: 25000, issuedOn: '2026-11-01', dueDate: '2026-11-15', status: 'open', text: 'NEXUS Mitgliedschaft, Rate November',
    },
    zInv('i-z-290', 'RE-Z-2026-290', 'd-mueller', 39000, '2026-10-06', '2026-10-20', 'overdue', 'Neuzulassung BOT-MK 211 inkl. Kennzeichen'),
    zInv('i-z-295', 'RE-Z-2026-295', 'd-mueller', 25000, '2026-10-14', '2026-10-28', 'overdue', 'Umschreibung BOT-MK 218 mit Kennzeichen'),
    zInv('i-z-301', 'RE-Z-2026-301', 'd-krause', 9900, '2026-11-03', '2026-11-17', 'paid', 'Zulassung E-KR 701'),
    zInv('i-z-305', 'RE-Z-2026-305', 'd-krause', 9900, '2026-11-05', '2026-11-19', 'paid', 'Zulassung E-KR 702'),
    zInv('i-z-306', 'RE-Z-2026-306', 'p-wagner', 9900, '2026-11-06', '2026-11-20', 'paid', 'Umschreibung BOT-JW 88'),
    zInv('i-z-311', 'RE-Z-2026-311', 'd-mueller', 8900, '2026-11-10', '2026-11-24', 'open', 'Umschreibung BOT-MK 456'),
  ];

  const wa = (p: Pick<Message, 'id' | 'threadId' | 'direction' | 'body' | 'sentAt' | 'contactId'> & Partial<Message>): Message => {
    const phone = contacts.find((c) => c.id === p.contactId)?.phones[0] ?? '';
    return {
      channel: 'whatsapp', connectionId: 'whatsapp_kunden', externalId: `wamid.${p.id}`, from: p.direction === 'in' ? phone : OWNER_WHATSAPP,
      to: p.direction === 'in' ? OWNER_WHATSAPP : phone, jobId: null, needsReply: false, ...p,
    };
  };
  const QUICK = 'Für die Umschreibung brauchen wir: ZB I + II, eVB, Ausweis, Vollmacht, SEPA-Mandat.';
  const messages: Message[] = [
    wa({ id: 'm-oezdemir-in-1', threadId: 't-oezdemir', direction: 'in', contactId: 'p-oezdemir', sentAt: at('2026-11-06', '09:12'), needsReply: true, body: 'Hallo, ich möchte mein Auto auf mich umschreiben lassen. Was brauchen Sie dafür?' }),
    wa({ id: 'm-oezdemir-out-1', threadId: 't-oezdemir', direction: 'out', contactId: 'p-oezdemir', sentAt: at('2026-11-06', '09:40'), body: QUICK }),
    wa({ id: 'm-schmidt-out-0', threadId: 't-schmidt', direction: 'out', contactId: 'd-schmidt', jobId: 'j-schmidt-1', sentAt: at('2026-11-09', '15:20'), body: 'Für den Golf GE-AS 123 fehlt uns noch die eVB-Nummer, dann geht die Umschreibung raus.' }),
    wa({ id: 'm-celik-in-1', threadId: 't-celik', direction: 'in', contactId: 'p-celik', sentAt: at('2026-11-09', '11:05'), needsReply: true, body: 'Guten Tag, welche Unterlagen brauche ich für eine Umschreibung?' }),
    wa({ id: 'm-celik-out-1', threadId: 't-celik', direction: 'out', contactId: 'p-celik', sentAt: at('2026-11-09', '11:30'), body: QUICK }),
    wa({ id: 'm-demir-in-1', threadId: 't-demir', direction: 'in', contactId: 'p-demir', sentAt: at('2026-11-10', '09:50'), needsReply: true, body: 'Guten Tag, können Sie mir bitte noch die Rechnung für die Zulassung schicken?' }),
    wa({ id: 'm-demir-out-1', threadId: 't-demir', direction: 'out', contactId: 'p-demir', sentAt: at('2026-11-10', '10:05'), body: 'Die Rechnung schicke ich Ihnen morgen.' }),
    wa({ id: 'm-wagner-in-1', threadId: 't-wagner', direction: 'in', contactId: 'p-wagner', sentAt: at('2026-11-11', '08:45'), needsReply: true, body: 'Moin, meine Schwester will ihren Wagen umschreiben. Was muss sie mitbringen?' }),
    wa({ id: 'm-wagner-out-1', threadId: 't-wagner', direction: 'out', contactId: 'p-wagner', sentAt: at('2026-11-11', '09:10'), body: QUICK }),
    wa({ id: 'm-schmidt-in-1', threadId: 't-schmidt', direction: 'in', contactId: 'd-schmidt', jobId: 'j-schmidt-1', sentAt: at('2026-11-12', '06:30'), needsReply: true, body: 'Guten Morgen, ist der Golf GE-AS 123 heute fertig?' }),
  ];

  const commitments: AppState['commitments'] = [
    { id: 'c-demir', messageId: 'm-demir-out-1', contactId: 'p-demir', kind: 'invoice', text: 'Die Rechnung schicke ich Ihnen morgen.', dueAt: at('2026-11-11', '18:00'), status: 'open' },
  ];

  const events: CalendarEvent[] = [
    { id: 'ev-1', title: 'Zulassungsstelle Bottrop: Kennzeichen abholen', startAt: at(DEMO_TODAY, '10:30'), endAt: at(DEMO_TODAY, '11:15'), location: 'Zulassungsstelle Bottrop' },
    { id: 'ev-2', title: 'Vor-Ort-Zulassung Autohaus Krause', startAt: at(DEMO_TODAY, '13:00'), endAt: at(DEMO_TODAY, '14:00'), location: 'Autohaus Krause, Essen' },
    { id: 'ev-3', title: 'Telefonat Steuerberater', startAt: at(DEMO_TODAY, '16:00'), endAt: at(DEMO_TODAY, '16:30') },
    { id: 'ev-4', title: 'Händlertermin Autohaus Müller', startAt: at('2026-11-13', '10:00'), endAt: at('2026-11-13', '11:00'), location: 'Autohaus Müller, Bottrop' },
  ];

  const calls: Call[] = [
    { id: 'call-seele', series: 'SEELE', startsAt: at(DEMO_TODAY, '20:00'), topic: 'SEELE: Selbstführung im Alltag', slideCount: 10, slidesStatus: 'todo', slides: [] },
    { id: 'call-finance', series: 'Finance', startsAt: at('2026-11-19', '19:00'), topic: 'Finance: Rücklagen und Liquidität planen', slideCount: 6, slidesStatus: 'todo', slides: [] },
  ];

  const content: ContentItem[] = [
    { id: 'ct-1', title: 'Reel: 3 Fehler bei der Ratenzahlung', stage: 'idea' },
    { id: 'ct-2', title: 'Mitglieder-Interview (Rohmaterial)', stage: 'raw', due: '2026-11-18' },
    { id: 'ct-3', title: 'Karussell: Highlights aus dem SEELE-Call', stage: 'edit', due: '2026-11-14' },
    { id: 'ct-4', title: 'Newsletter November', stage: 'approval', due: '2026-11-13' },
    { id: 'ct-5', title: 'Podcast Folge 12: Disziplin statt Motivation', stage: 'published' },
  ];

  return {
    connections, contacts, contracts, exceptions: {}, payments, allocations, ibanLinks, invoices, messages, commitments, events, calls, content, vehicles, jobs,
    insights: [], actions: [], audit: [], assistantChat: [], subscriptions: [], dismissedProposals: [], portalMembers: [], ignoredPortalMembers: [], orderConfirmations: [], invoiceReadings: [], takeovers: [],
    settings: { replyThresholdHours: 2, briefingsEnabled: true, ownerPhone: '+491510000000', suppressedCoachKeys: [], takeoverReminderDays: 3, takeoverLinkNudgeDays: 7 },
  };
}

export const createDemoStateForTests = createDemoState;
