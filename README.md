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


## Standards interoperability — experimental adapters

The repository now includes working **standards-based projections** for responsibility delegation:

- `@awc/authzen`: AuthZEN Authorization API 1.0 evaluation, fail-closed when execution requires extra financial/state checks; localhost-only PDP pilot.
- `@awc/coaz-mcp`: experimental subset of COAZ-MCP's default tool-call mapping with strict reviewed-tool authorization. The complete CEL draft binding is not implemented.
- `@awc/odrl-profile`: narrow W3C ODRL 2.2 JSON-LD Agreement profile and strict validation; not a legal contract or standalone grant.
- `@awc/events`: CNCF CloudEvents 1.0 JSON envelope and replay-safe in-memory journal.
- `@awc/provenance`: PROV-O delegation, activity, artifact and outcome graph exporter.
- `@awc/openslo`: OpenSLO v1 threshold-metric obligations and data-source references.
- `@awc/osb-adapter`: Open Service Broker API 2.17 catalog parsing and **non-executing** provision previews.
- `@awc/ubl-adapter`: safe illustrative UBL 2.4 Order XML export (not full XSD/codelist validation).
- `@awc/standards-demo`: the same vending/cloud/plant simulation mapped through these standards. Call MCP `operations.standards` or `pnpm standards:demo`.

See [interoperability implementation](docs/standards-interoperability-implementation.md) and [standards adoption research](docs/standards-adoption-research.md). These packages are experimental adapter subsets, **not broad conformance claims** or production money/machine interfaces.


## AuthZEN authorization-first boundary (new draft PR)

AWC's **external policy decision protocol is OpenID AuthZEN 1.0**. Authorization is not an LLM prompt, unsigned ODRL policy, MCP tool annotation, or claim of wallet funding.

- `@awc/mandate-registry`: tenant-scoped read-only D1-backed authority snapshots for signed-format proposals, parent mandate chains, asset-owner permissions, current observations, reviewed MCP tool policies and independent approvals. No public registration endpoint.
- `@awc/pdp-auth`: independent PDP OIDC audience, issuer/JWKS validation, strict client allowlist and service scope; no MCP/human-token reuse.
- `@awc/authzen`: exact AuthZEN PDP evaluation and optional trusted conditional commitment verifier.
- `@awc/authzen-client`: fixed-origin, authenticated AuthZEN 1.0 client for an external Gatekeeper PDP; rejects unavailable/malformed decisions rather than silently allowing.
- `@awc/coaz-mcp`: supported COAZ-MCP tool-call mapping; verified OAuth subject/client, tenant-scoped Gatekeeper admission, and object-level domain policy.
- `@awc/economics-durable`: real transactional SQLite reservation ledger tested using Node SQLite, with parent/child shared spending limits, idempotent settlement evidence and safe wind-down; not a payment processor.
- `@awc/authzen-finance`: a **separately verified reservation** may satisfy a conditional AuthZEN decision for the exact action revision; only commit-time gateways may consume such authority.
- `AWCEconomicAccount`: private Cloudflare SQLite-backed Durable Object with no public mutation RPC. The namespace is provisioned by Wrangler but is not connected to actual provider settlement.

See [AuthZEN integration and security roadmap](docs/authzen-gatekeeper-integration.md). Production PDP is **off by default**, with no arbitrary issuer/admin writes or real settlement enabled. Current simulations remain usable locally.

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
