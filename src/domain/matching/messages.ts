import type { Contact, Job, Message, Vehicle } from '@/domain/types';

export function normalizePhone(s: string): string {
  let t = s.replace(/[\s\-/()]/g, '');
  if (t.startsWith('00')) t = '+' + t.slice(2);
  else if (t.startsWith('0')) t = '+49' + t.slice(1);
  return t;
}

const PLATE_RE = /(?<![A-Za-zÄÖÜ0-9])([A-ZÄÖÜ]{1,3})[- ]([A-Z]{1,2}) ?(\d{1,4}[EH]?)(?![A-Za-z0-9])/g;

export function extractPlates(text: string): string[] {
  return [...text.toUpperCase().matchAll(PLATE_RE)].map((m) => `${m[1]}-${m[2]} ${m[3]}`);
}

export function extractVins(text: string): string[] {
  return [...text.toUpperCase().matchAll(/(?<![A-Z0-9])[A-HJ-NPR-Z0-9]{17}(?![A-Z0-9])/g)]
    .map((m) => m[0])
    .filter((v) => /\d/.test(v));
}

/** Bekanntes Kennzeichen im (großgeschriebenen) Text, Trenner optional, mit Wortgrenzen: „BOT-MK 45“ trifft nicht „BOT-MK 456“. */
export function plateInText(plate: string, upperText: string): boolean {
  const m = /^([A-ZÄÖÜ]{1,3})[- ]?([A-Z]{1,2}) ?(\d{1,4}[EH]?)$/.exec(plate.toUpperCase().trim());
  if (!m) return false;
  return new RegExp(`(?<![A-ZÄÖÜ0-9])${m[1]}[- ]?${m[2]}[- ]?${m[3]}(?![A-Z0-9])`).test(upperText);
}

type MatchInput = Pick<Message, 'from' | 'to' | 'direction' | 'body'>;

export function matchMessage(
  m: MatchInput,
  contacts: Contact[],
  vehicles: Vehicle[],
  jobs: Job[],
): { contactId: string | null; jobId: string | null } {
  const counterpart = m.direction === 'in' ? m.from : m.to;
  let contactId: string | null = null;
  let jobId: string | null = null;

  const phone = normalizePhone(counterpart);
  if (phone) contactId = contacts.find((c) => c.phones.some((p) => normalizePhone(p) === phone))?.id ?? null;
  if (!contactId) {
    const addr = counterpart.toLowerCase();
    contactId = contacts.find((c) => c.emails.some((e) => e && addr.includes(e.toLowerCase())))?.id ?? null;
  }

  const body = m.body.toUpperCase();
  const vins = extractVins(body);
  const vehicle = vehicles.find((v) => plateInText(v.plate, body)) ?? vehicles.find((v) => vins.includes(v.vin.toUpperCase()));
  if (vehicle) {
    contactId ??= vehicle.contactId;
    const open = jobs
      .filter((j) => j.vehicleId === vehicle.id && j.status !== 'paid')
      .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
    jobId = open[0]?.id ?? null;
  }
  return { contactId, jobId };
}

export function openReplies(
  messages: Message[],
  now: Date,
  thresholdHours: number,
): { message: Message; waitingHours: number }[] {
  const result: { message: Message; waitingHours: number }[] = [];
  for (const msg of messages) {
    if (msg.direction !== 'in' || !msg.needsReply || msg.doneManually) continue;
    const sent = Date.parse(msg.sentAt);
    const answered = messages.some(
      (o) => o.direction === 'out' && o.channel === msg.channel && o.threadId === msg.threadId && Date.parse(o.sentAt) > sent,
    );
    if (answered) continue;
    const waitingHours = Math.floor((now.getTime() - sent) / 3_600_000);
    if (waitingHours >= thresholdHours) result.push({ message: msg, waitingHours });
  }
  return result;
}
