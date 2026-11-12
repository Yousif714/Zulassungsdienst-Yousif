import type { IsoDate } from '../clock';
import type { MemberContract } from '../types';
import type { ContractProposal } from './proposals';

/** Vom Inhaber bestätigte Vertragswerte (Eingabe von „Vorschlag übernehmen“). */
export interface ContractDraft { totalCents: number; installments: number; installmentCents: number; dueDay: number; startDate: IsoDate; catchUpMode: MemberContract['catchUpMode'] }

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

function validDate(s: unknown): boolean {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Deutsche Fehlertexte; leer = gültig. */
export function validateContractDraft(d: ContractDraft): string[] {
  const errors: string[] = [];
  if (!isInt(d.installments) || d.installments < 1 || d.installments > 120) errors.push('Die Anzahl der Raten muss eine ganze Zahl zwischen 1 und 120 sein.');
  if (!isInt(d.dueDay) || d.dueDay < 1 || d.dueDay > 31) errors.push('Fälligkeitstag muss zwischen 1 und 31 liegen.');
  if (!isInt(d.totalCents) || d.totalCents <= 0) errors.push('Der Gesamtbetrag muss größer als 0 sein.');
  if (!isInt(d.installmentCents) || d.installmentCents <= 0) errors.push('Die Rate muss größer als 0 sein.');
  if (!validDate(d.startDate)) errors.push('Das Startdatum ist ungültig.');
  if (d.catchUpMode !== 'first_rate' && d.catchUpMode !== 'spread') errors.push('Der Nachholmodus ist ungültig.');
  if (errors.length === 0 && d.totalCents - d.installmentCents * (d.installments - 1) <= 0) errors.push('Die letzte Rate wäre negativ.');
  return errors;
}

/** Vorbelegung für das Formular; unbekannte Werte fehlen. */
export function draftFromProposal(p: ContractProposal): Partial<ContractDraft> {
  const out: Partial<ContractDraft> = { catchUpMode: 'first_rate' };
  if (p.totalCents !== null) out.totalCents = p.totalCents;
  if (p.installments !== null) out.installments = p.installments;
  if (p.installmentCents !== null) out.installmentCents = p.installmentCents;
  if (p.dueDay !== null) out.dueDay = p.dueDay;
  if (p.startDate !== null) out.startDate = p.startDate;
  return out;
}
