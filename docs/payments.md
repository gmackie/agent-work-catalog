# Billing and funding boundaries

Stripe is a card/payment provider, not the semantic catalog or an authority to approve execution. x402 is a different payment rail; both must implement the same PaymentGate proof-of-funding contract. A WorkOrder's funding reference is a locator to verify, **not evidence in itself**.

## Stripe Checkout

1. Determine quote from trusted offering, contract version and accepted price. Never accept the WorkProvider's self-reported budget as the charge authority.
2. Create a Stripe Checkout Session with exact work order, source and offering metadata. Store the session identifier and immutable contract commitment.
3. On Stripe webhooks verify the HMAC signature against the RAW request body; durably deduplicate event IDs. Completion redirects are NOT payment evidence.
4. Check `payment_status`. Delayed methods may need `checkout.session.async_payment_succeeded`.
5. Before executing, retrieve/reconcile the Checkout Session server-to-server. Match order ID, source, offering, currency, minor amount, complete and paid status.
6. Persist funding authorization and order state atomically before dispatch; handle refunds, reversals and disputes separately.

The initial `@awc/payment-stripe` package provides session creation, signed webhook parsing and server-side payment verification. It does not expose a public HTTP endpoint, hold funds in escrow, or implement Connect payouts. Developers must implement auth, trusted pricing, webhook idempotency and persistence before production use.

## x402

- `exact`: known charge, especially credit top-ups and fixed invocations.
- `upto`: authorize upper bound, settle metered amount where scheme/facilitator support is confirmed.
- Other schemes (batch vouchers or authorize/capture) should be feature-detected from supported facilitators; never assume universal support.
- Provider credit spending is a ledger debit, not automatically a new x402 transaction.

The next adapter should verify x402 settlement independently using a trusted facilitator/network reader, with finality, recipient, asset, amount, account, contract digest and replay/idempotency checks. Unsupported schemes MUST fail closed.

## Operational compliance

Stripe payment methods, merchant of record, Connect account onboarding, taxes, chargebacks and any marketplace escrow/legal obligations are separate business decisions. Do not claim money is held in escrow merely because a payment is authorized.
