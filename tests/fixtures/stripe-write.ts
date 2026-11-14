// Erfundene Stripe-Antworten für den Schreibzugriff (nie echtes Stripe).
export const stripeWriteRoutes: Record<string, unknown> = {
  'GET /v1/customers/search': { data: [] },
  'POST /v1/customers': { id: 'cus_test_1' },
  'GET /v1/products/search': { data: [] },
  'POST /v1/products': { id: 'prod_test_1' },
  'POST /v1/checkout/sessions': { id: 'cs_test_1', url: 'https://checkout.stripe.test/c/pay/cs_test_1', setup_intent: 'seti_test_1' },
  'GET /v1/setup_intents/seti_test_1': { id: 'seti_test_1', payment_method: 'pm_test_1' },
  'POST /v1/customers/cus_test_1': { id: 'cus_test_1' },
  'GET /v1/subscription_schedules': { data: [] },
  'POST /v1/subscription_schedules': { id: 'sub_sched_test_1' },
};
