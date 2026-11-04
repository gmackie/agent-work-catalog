# Agent Work Catalog (AWC)

An open, Apache-2.0 Effect 4 monorepo for describing, receiving, executing, and verifying purchased work across independent agents and external marketplaces.

**A TaskType describes what can be done; an Offering describes what is for sale; a WorkOrder represents agreed work; WorkProvider ingests and returns jobs; Worker executes.** WorkOrders are distinct from MCP Tasks/A2A Tasks.

## Architecture

- `@awc/contracts`: versioned Effect Schema contracts for task types, offerings, work orders, artifacts, results and funding references.
- `@awc/catalog`: input/outputs/effects/budget eligibility checks, separate from semantic search and reputation ranking.
- `@awc/runtime`: Effect Context.Service ports for work-provider intake/delivery, worker execution, payment authorization, persistence and evidence.
- `@awc/provider-http`: HMAC-authenticated upstream webhooks and signed result callbacks.
- `@awc/worker-openai`: OpenAI Responses-compatible synchronous text worker. No arbitrary URL fetches or side effects.
- `@awc/payment-stripe`: Stripe Checkout funding, server-side settlement recheck and raw-body webhook signature validation.
- `@awc/demo`: in-memory end-to-end example, with **fake funding only**.

## Status

Initial experimental scaffold on a feature branch. No production-grade authorization, verified x402 payments, durable ledger, distributed execution leases, or Attest credential issuance is present yet.

## Local development

Node 24+, pnpm 10:

```sh
corepack enable
pnpm install
pnpm check
pnpm demo
```

No API keys are needed for the sandbox demo. Never use the demo payment layer or in-memory repository to handle real money or confidential work.

See `docs/architecture.md`, `docs/payments.md`, and `specs/worker-interface.md` for trust and protocol boundaries.
