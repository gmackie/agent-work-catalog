# AWC MCP vertical slice

A Cloudflare Workers/Effect 4 experimental marketplace with a free public catalog, buyer-authenticated quoting, contract inspection, independently authenticated approval, test-mode funding and Queue-backed **synthetic** execution.

## Implemented model-facing tools

- Free: `catalog.search`, `catalog.get_offering`.
- Authenticated buyer: `quotes.request`, `work.prepare`, `work.get`, `billing.options`.
- With Stripe TEST configured: `billing.checkout`, `billing.reconcile`.
- With a Cloudflare Queue binding: `work.start`, which rejects any order not separately approved and verified funded.
- Independently enabled testnet-only: `sandbox.paid_text_stats` with Cloudflare Agents SDK x402.

**There is no MCP `work.approve` tool.** An agent cannot authenticate as the human reviewer using its own audience token. The interactive Contract Inspector App opens the separate review page in the host browser.

Public versioned offerings and buyer-scoped work order resources remain available; results are structured and usable without MCP Apps. The v0.2 implementation uses fictional seed providers and keyword search, not live verified marketplace discovery.

## MCP Apps

- `ui://awc/marketplace.html`: search sample offerings.
- `ui://awc/contract.html`: inspect the exact scoped quote, price and digest, and request the host open the separately authenticated browser review page.
- Other Apps from `docs/mcp-apps.md` remain designs.

## Running locally and configuring services

Follow [the complete setup and security walkthrough](contract-execution.md). The Worker requires an actual D1 database ID, database migrations, a Queue named `awc-work-jobs`, bundled MCP App assets, and separate sandbox credentials. All spending stays simulated unless the separately configured **Stripe TEST** rail is exercised; even then only synthetic example work is produced.

In production, use an OIDC issuer such as nathan, not the localhost static demo credentials. Configurable keys are `OIDC_ISSUER`, `OIDC_JWKS_URL`, `OIDC_MCP_AUDIENCE`, `OIDC_APPROVAL_AUDIENCE`, `OIDC_APPROVAL_CLIENT_ID` and `OIDC_APPROVAL_ACR`. The issuer must mint a trusted `awc_buyer_id`, separate client/audience claims and correct scopes. This is a JWT verification layer, **not** an OAuth authorization code client or hosted login wizard. The review page currently expects a separately obtained token; proper PKCE/passkey login and CSRF handling remain outstanding.

## Payment and trust boundaries

Cloudflare Monetization Gateway is not configured here; it remains closed beta with documented x402 constraints. Its `PAYMENT-CONTEXT` is not automatically an independently settled work-order receipt. The existing Base Sepolia paidTool test doesn't pay for an entire gig.

Stripe TEST Checkout payment status is re-read from Stripe, matched to the exact work, and only then transitioned to `funded`. Production use still needs refund/chargeback reconciliation and audited ledger semantics.

D1 optimistic concurrency protects the lifecycle. Queue is at-least-once; the synthetic Worker is deterministic and restart-safe under a short execution lease. This is **not** general exactly-once execution for third-party agents, and commercial cancellation, evaluator approval, disputes, and Attest receipts remain next steps.

## Verification

CI builds both MCP Apps, typechecks Effect packages, runs domain/MCP/auth/commerce/Stripe negative tests and performs a Wrangler dry-run bundle. Successful CI is not evidence of real Cloudflare deployment, real payment settlement or external provider execution.
