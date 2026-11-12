import disputes from './stripe/disputes.json';
import invoices from './stripe/invoices.json';
import products from './stripe/products.json';
import refunds from './stripe/refunds.json';
import subscriptions from './stripe/subscriptions.json';

import type { StripeRaw } from '@/domain/import/stripe';

/** Mittag UTC des Tages als Unix-Sekunden (zeitzonensicher für Europe/Berlin). */
export const unix = (isoDate: string): number => Date.parse(`${isoDate}T12:00:00Z`) / 1000;

/** Stripe-Rohdaten, wie der Connector sie dem Mapper übergibt (Listen ausgepackt). */
export const stripeRaw: StripeRaw = {
  subscriptions: subscriptions.data,
  products: products.data,
  invoices: invoices.data,
  refunds: refunds.data,
  disputes: disputes.data,
};

/** Pfad (ohne Query) → Stripe-Antwort-JSON. Erstattungen und Streitfälle tragen hier schon `invoiceId`. */
export const stripeRoutes: Record<string, unknown> = {
  '/v1/subscriptions': subscriptions,
  '/v1/products': products,
  '/v1/invoices': invoices,
  '/v1/refunds': refunds,
  '/v1/disputes': disputes,
};

/** Wird in Task 3 mit den Lexware-Fixtures gefüllt. */
export const lexwareRoutes: Record<string, unknown> = {};
