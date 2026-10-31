import Stripe from "stripe";
import { CommerceError, type CheckoutRail, type VerifiedFunding } from "./index.ts";

/**
 * Stripe TEST Checkout: exact-price, digest-bound. Production merchant-of-record,
 * disputes, refunds and payouts require an explicit reviewed release profile.
 */
export function stripeTestCheckout(stripe: Stripe, origin: string): CheckoutRail {
  const base = new URL(origin);
  if (base.protocol !== "https:") throw new CommerceError("unsupported", "Checkout origin must be HTTPS");
  return {
    create: async(work, quote) => {
      const amount = Number(quote.price.minorUnits);
      if (!Number.isSafeInteger(amount) || amount<=0 || amount>99_999_999 ||
          quote.price.currency !== "USD") {
        throw new CommerceError("unsupported","Unsupported checkout currency or amount");
      }
      const session=await stripe.checkout.sessions.create({
        mode:"payment",
        client_reference_id:work.id,
        line_items:[{
          price_data:{
            currency:quote.price.currency.toLowerCase(),
            unit_amount:amount,
            product_data:{name:"AWC sandbox: "+quote.offeringId},
          },
          quantity:1,
        }],
        success_url:new URL("/connect?payment=returned",base).toString(),
        cancel_url:new URL("/connect?payment=cancelled",base).toString(),
        metadata:{
          awc_work_id:work.id,awc_buyer_id:work.buyerId,
          awc_quote_digest:quote.termsDigest,awc_offering_id:quote.offeringId,
        },
      },{idempotencyKey:"awc:test:checkout:"+work.id});
      if (!session.url || session.livemode) {
        throw new CommerceError("unavailable","Checkout must remain Stripe test mode");
      }
      return {sessionId:session.id,url:session.url};
    },
    verify: async (sessionId,work,quote):Promise<VerifiedFunding>=>{
      const session=await stripe.checkout.sessions.retrieve(sessionId);
      if (session.livemode || session.id !== sessionId ||
        session.mode!=="payment" || session.status!=="complete" ||
        session.payment_status!=="paid" ||
        session.client_reference_id!==work.id ||
        session.metadata?.awc_work_id!==work.id ||
        session.metadata?.awc_buyer_id!==work.buyerId ||
        session.metadata?.awc_quote_digest!==quote.termsDigest ||
        session.metadata?.awc_offering_id!==quote.offeringId ||
        session.currency?.toUpperCase()!==quote.price.currency ||
        String(session.amount_total)!==quote.price.minorUnits ||
        !session.payment_intent) {
        throw new CommerceError("funding_required","Stripe did not confirm exact contract funding");
      }
      // A paid Checkout Session alone does not guarantee no subsequent refund/chargeback.
      // This is a TEST-MODE demonstration. Real fulfillment requires reversal monitoring.
      return {
        rail:"stripe-test",reference:session.id,buyerId:work.buyerId,
        workId:work.id,quoteDigest:quote.termsDigest,
        currency:quote.price.currency,minorUnits:quote.price.minorUnits,
        observedAt:new Date().toISOString(),
      };
    },
  };
}
