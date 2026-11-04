# Agent Work Catalog (AWC)

Open, Apache-2.0 Effect 4 monorepo for describing, discovering, commissioning and eventually verifying purchasable work across independent agent providers.

A **TaskType** describes an outcome; **Offering** describes what a seller promises; **Quote** binds terms; **WorkOrder** is the commercial contract; **WorkProvider** ingests external assignments; **Worker** executes them. MCP Tasks and A2A Tasks are execution handles, **not** the WorkOrder.

## Current experimental implementation

- `@awc/contracts`, `@awc/catalog` and `@awc/marketplace`: schema and task/offer matching, quote issuance, prepared contract persistence.
- `@awc/mcp-server`: Streamable HTTP MCP server with public search, price quotes, work review, test checkout and paid-tool sandbox interfaces.
- `apps/mcp-ui`: Marketplace Explorer and **Contract Inspector** MCP Apps, with plain tool-result fallback.
- `@awc/auth`: verified issuer/audience JWT profile for buying agents and a **separate interactive approval audience**, plus localhost-only distinct sandbox secrets.
- `@awc/commerce`: human approval, Stripe **TEST** session and exact contract validation, D1 compare-and-swap lifecycle, synthetic Worker and Queue recovery.
- `apps/server`: Cloudflare Worker, D1 migrations, Queues producer/consumer and scheduled recovery.
- `@awc/runtime`, `@awc/worker-openai`, `@awc/provider-http`: independent transport and work executor adapters.
- `@awc/payment-stripe`: underlying Stripe Checkout adapter; commercial work-specific Stripe TEST binding lives in `@awc/commerce`.

**Nothing has been deployed by these PRs.** Work providers and deliverables are fictional; payment paths are TEST-only or synthetic. The next steps are independently verified provider onboarding, full OAuth browser sign-in, actual real-work execution with durable external-operation reconciliation, Attest receipts, and reviewed live settlement.

## Local development

Node 24+ and pnpm 10:

```sh
corepack enable
pnpm install --no-frozen-lockfile
pnpm --filter @awc/mcp-ui build
pnpm typecheck
pnpm test
pnpm --filter @awc/server bundle
pnpm demo
```

See [MCP prototype](docs/mcp-implementation.md), [contract and execution walkthrough](docs/contract-execution.md), [MCP design](docs/mcp-server-design.md), and [Cloudflare Monetization Gateway research](docs/monetization-gateway.md).

Never use demo credentials, simulated payment state, in-memory stores or synthetic issuer claims for real customer work.

## Plug-in provider ecosystem

The new `@awc/adapter-sdk` introduces separate `WorkSource` and `WorkExecutor` roles. GitHub Issues can feed signed, replay-protected **opportunities** to D1; a signed HTTPS remote executor handles authorized execution requests with durable idempotency and recovery. A standalone Cloudflare remote Worker example and integration tests exercise the real HTTP wire contract.

These adapters are **not** automatically connected to real-money commerce. GitHub issues never create approved WorkOrders just by receiving a label; remote execution needs a trusted broker registration and scope checks.

See [adapter SDK and buildable integrations](docs/adapters.md) for code samples, GitHub App enrollment, Cloudflare setup, security boundaries and conformance tests.

## Trusted remote dispatch (experimental)

The newest `@awc/dispatch` package bridges an approved and **test-funded** commercial WorkOrder to a pinned remote WorkExecutor. It requires an additional human-reviewed data-disclosure digest, persists the immutable request and remote handle in D1, and recovers uncertain starts by the same idempotency key. Queue polling validates and digests the returned synthetic artifacts before marking the work submitted.

**Off by default.** Only the fictional `offering:modbus-report` v1, public inline inputs and the read-only synthetic remote executor are eligible. No production payments, arbitrary provider URL selection, external side effects or Attest credential issuance are enabled. The provider's manifest is discovery metadata, not a trust grant.

See [Trusted remote dispatch guide](docs/trusted-remote-dispatch.md) for local Cloudflare setup, consent, D1 migration, tests and remaining release gates.

## Real Modbus/TCP pilot (private R2, evidence checks, draft Attest observations)

The optional, bounded `offering:modbus-pcap-analysis` now runs a real classic-PCAP Modbus/TCP packet parser instead of synthetic output. Uploaded **public-only** captures are stored in private R2; a human separately approves disclosure to an operator-pinned remote worker. The broker recomputes findings, stores report and evaluation evidence in R2, and issues a **provisional broker-signed Attest-shaped observation JWS** (not an independent Attest VC, evaluation or payment receipt). Test/fake funding only; execution disabled by default. See [the packet-evidence pilot](docs/modbus-evidence-pilot.md) for setup, scope and limitations.

## Independent Modbus/TCP oracle

The bounded PCAP pilot now has a separate Scapy + TShark differential CI gate.
Public synthetic captures are generated independently from the TypeScript
parser; the oracle checks decoded Modbus fields, request/response pairing,
exceptions and observed response times. Unsupported formats and retransmission
limitations are explicitly separated from successful TShark comparisons.
A deterministic malformed-capture mutation sweep adds parser robustness checks.
See docs/pcap-differential-conformance.md for results and reproduction.
