// 2a: Demo-Link. Der echte Stripe-Link folgt in 2b.
export const paymentLinkFor = (contractId: string): string => `https://buy.stripe.com/demo/${contractId}`;
