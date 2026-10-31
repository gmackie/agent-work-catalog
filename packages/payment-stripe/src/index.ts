import { Effect, Layer } from "effect";
import Stripe from "stripe";
import { parseMinorUnits, WorkError, type WorkOrder } from "@awc/contracts";
import { PaymentGate } from "@awc/runtime";

export interface CheckoutRequest {
  readonly order: WorkOrder;
  /** Must be calculated against server-owned catalog pricing, not an arbitrary buyer quote. */
  readonly trustedProductName: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
}
export const createStripeClient = (secretKey: string) => new Stripe(secretKey);

/** Creates hosted payment session. Real pricing/authorization must be checked by the caller. */
export const startCheckout = (stripe: Stripe, request: CheckoutRequest) => Effect.tryPromise({
  try: async () => {
    const amount = parseMinorUnits(request.order.budget.minorUnits);
    if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Unsupported amount");
    for (const candidate of [request.successUrl, request.cancelUrl]) {
      if (new URL(candidate).protocol !== "https:") throw new Error("Checkout redirects require HTTPS");
    }
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      client_reference_id: request.order.id,
      line_items: [{
        price_data: {
          currency: request.order.budget.currency.toLowerCase(),
          unit_amount: Number(amount),
          product_data: { name: request.trustedProductName },
        }, quantity: 1,
      }],
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      metadata: {
        awc_order_id: request.order.id,
        awc_source_id: request.order.sourceId,
        awc_offering_id: request.order.offeringId,
      },
    }, { idempotencyKey: "awc:checkout:" + request.order.id });
    if (!session.url) throw new Error("Checkout URL unavailable");
    return { sessionId: session.id, url: session.url };
  },
  catch: () => new WorkError("unavailable", "Could not create Stripe Checkout session"),
});

/** Independently reconcile the Checkout Session before allowing work to begin. */
export const stripePaymentLayer = (stripe: Stripe) => Layer.succeed(PaymentGate, {
  assertFunded: (order: WorkOrder) => Effect.tryPromise({
    try: async () => {
      if (order.funding.kind !== "stripe-checkout" || !order.funding.reference.startsWith("cs_")) {
        throw new Error("Payment mechanism unsupported by Stripe gate");
      }
      const session = await stripe.checkout.sessions.retrieve(order.funding.reference);
      if (session.mode !== "payment" || session.payment_status !== "paid" ||
          session.status !== "complete" || session.metadata?.awc_order_id !== order.id ||
          session.metadata?.awc_source_id !== order.sourceId ||
          session.metadata?.awc_offering_id !== order.offeringId ||
          session.client_reference_id !== order.id ||
          session.currency?.toUpperCase() !== order.budget.currency.toUpperCase() ||
          String(session.amount_total) !== parseMinorUnits(order.budget.minorUnits).toString()) {
        throw new Error("Funding does not match the exact work order");
      }
    },
    catch: () => new WorkError("payment_required", "Work order is not confirmed paid by Stripe"),
  }),
});

/** Pass the RAW, unmodified request body. Event IDs require durable deduplication. */
export const verifyStripeWebhook = (stripe: Stripe, rawBody: string, signature: string, webhookSecret: string) =>
  Effect.try({
    try: (): Stripe.Event => stripe.webhooks.constructEvent(rawBody, signature, webhookSecret),
    catch: () => new WorkError("unauthorized", "Invalid Stripe webhook signature"),
  });
