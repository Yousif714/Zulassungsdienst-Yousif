import type { Contact, Invoice, Job } from '@/domain/types';

export const JOB_STATUS_LABEL: Record<Job['status'], string> = {
  open: 'offen',
  waiting_customer: 'wartet auf Kunde',
  done: 'erledigt',
  invoiced: 'abgerechnet',
  paid: 'bezahlt',
};

export const JOB_STATUS_ORDER: Job['status'][] = ['open', 'waiting_customer', 'done', 'invoiced', 'paid'];

export const LOCATION_LABEL: Record<Job['location'], string> = { bottrop: 'Bottrop', essen: 'Essen', online: 'Online', onsite: 'Vor Ort' };

export const INVOICE_STATUS_LABEL: Record<Invoice['status'], string> = { open: 'offen', overdue: 'überfällig', paid: 'bezahlt', void: 'storniert' };

export const CONTACT_KIND_LABEL: Record<Contact['kind'], string> = { dealer: 'Händler', private: 'Privat', member: 'Mitglied' };
