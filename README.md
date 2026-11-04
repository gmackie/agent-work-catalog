# Agent Work Catalog (AWC)

Open, Apache-2.0 Effect 4 monorepo for describing, discovering, commissioning and eventually verifying purchasable work across independent agent providers.

A **TaskType** describes an outcome; **Offering** describes what a seller promises; **Quote** binds terms; **WorkOrder** is the commercial contract; **WorkProvider** ingests external assignments; **Worker** executes them. MCP Tasks and A2A Tasks are execution handles, **not** the WorkOrder.


## Responsibility and autonomous operations (new experimental reference)

AWC can now model ongoing delegated **economic and operational responsibility** independently from a single commercial WorkOrder:

- `@awc/responsibility`: versioned OperatingMandate and ActionProposal schemas, attenuated child mandates, independent asset-owner permission, fresh-state policy decisions, canonical action-revision commitments, and objective evidence assessment.
- `@awc/economics`: Effect simulation ledger for funded accounts, per-mandate budget, sibling subdelegation allocations, expense reservations, exact capture, revocation and safe wind-down. **No real money.**
- `@awc/operations`: bounded operations controller, observation-to-plan reconciliation and simulated action receipts; generic physical/safety-critical control is categorically denied.
- `@awc/adapter-sdk`: reviewed adapter manifest + conformance validation and read-only WoT Thing Description inspection.
- `@awc/simulations` and `apps/operations-demo`: vending, cloud and production-cell scenarios with execution history, spending and safety decisions.
- MCP `operations.scenarios` and `operations.simulate`; optional `ui://awc/operations.html` testbench.

Run `pnpm operations:demo` after installation. This is **simulation-only**: no external cloud provisioning, vending hardware, PLC commands, settlement, authentic Attest credentials or live mandate issuance. See [the responsibility specification](specs/responsibility-v1.md) and [operations architecture](docs/operations-architecture.md). The cryptographic trust registry and serializable production ledger remain release blockers.

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

## TCP/OT analysis product family and next agent offerings

The `@awc/tcp-analysis` executor extracts bounded TCP flow evidence from explicitly public classic PCAPs, including observed endpoints, repeated sequence-range candidates, possible gaps, reset flags and zero-window advertisements. It makes **no loss-attribution, causal-diagnosis, or full-TCP-reassembly claim**. The new `offering:tcp-flow-evidence` is available for **sandbox and Stripe TEST** routing through human-approved R2 custody, signed remote execution, deterministic report recomputation and a provisional broker-signed observation.

The [TCP evidence product family](docs/tcp-analysis-product-family.md) defines nine product tiers from free intake to human-reviewed investigations, with acceptance/verification rules, rollout gates and hypothetical prices; [TCP offering manifest](specs/tcp-offering-family-v1.json) is machine-readable.

The [next twelve agent-work domains](docs/agent-offering-domains.md) and their [structured map](specs/agent-opportunity-map-v1.json) identify independently checkable SaaS, OT, medical, education, financial and operational work opportunities. These are ideas, **not active marketplace products**.

## TCP packet-evidence agents and twelve adjacent marketplace domains

The **real but bounded** `@awc/tcp-pcap` analyzer handles declared-public classic PCAP captures and reports TCP packet facts, handshakes, receive-window advertisements and ambiguous sequence-range observations. It does **not** prove packet loss or root cause, perform stream reassembly, or interpret encrypted payloads. The approved/test-funded WorkOrder path can route `offering:tcp-pcap-evidence` to a pinned remote Worker, recompute evidence, store private R2 outputs and emit a **provisional broker-signed observation**.

The `@awc/offering-profiles` package describes nine tiered TCP/OT services; only the TCP evidence pilots and the earlier Modbus pilot are test-implemented. `@awc/domain-opportunities` defines twelve additional **research-only** verticals (engineering, IaC, OT, CAN/J1939, BACnet, water, SPC, food, restaurant throughput, education, healthcare, and procurement).

Both packet-evidence surfaces are inspectable through read-only MCP catalog tools: `catalog.list_tcp_services` and `catalog.list_domain_opportunities`. No live prices, active providers or regulated-data handling are implied.

See [TCP product family](docs/tcp-agent-offerings.md) and [twelve adjacent domains](docs/adjacent-agent-opportunities.md).
