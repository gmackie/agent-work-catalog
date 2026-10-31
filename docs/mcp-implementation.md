# Runnable MCP marketplace vertical slice (draft)

This repo contains an experimental Effect 4 MCP server and one real interactive MCP App. This is a **sandbox**, not a production commercial marketplace.

## Implemented

- Stateless Streamable HTTP MCP SDK v2 over Cloudflare Workers via `agents/mcp/server`.
- Free tools: `catalog.search`, `catalog.get_offering`; public catalog and versioned offering resources.
- Buyer-only tools: `quotes.request`, `work.prepare`, `work.get`, `billing.options`; private work-order resource template.
- Three intentionally **fictional** offering records; matching is deterministic keyword retrieval with hard filters, not yet vector/OASF semantics.
- Effect marketplace service with in-memory tests, D1-backed persistent quotes and prepared orders, per-buyer lookup and idempotency constraints.
- `ui://awc/marketplace.html` MCP App (App SDK 2.x) with interactive search and safe DOM rendering; fallback structured tool results for ordinary clients.
- A separately opt-in testnet-only `sandbox.paid_text_stats` tool using Cloudflare Agents SDK `withX402`/`paidTool`, fixed price $0.01 on Base Sepolia; payment isn't enabled by default.
- Origin allowlist and tool-route header/body mismatch checks. One static sandbox buyer secret controls write access: **not multi-tenant OAuth**.

No payment authorizations, inference execution, real provider onboarding, fund capture, production Stripe acceptance, OpenID/Poppy sign-in, Attest issuance, MCP Tasks execution, or dynamic paid quotes are implemented. No live wallet or cloud service was deployed by the code change.

## Install and test

Use Node 24 and pnpm 10.

```sh
corepack enable
pnpm install --no-frozen-lockfile
pnpm --filter @awc/mcp-ui build
pnpm typecheck
pnpm test
pnpm --filter @awc/server bundle
```

The App build produces `apps/server/public/marketplace.html` with bundled JS, which the Worker serves as an MCP Apps resource via the ASSETS binding.

## Local Cloudflare Worker

Create a D1 database named `awc-catalog`:

```sh
pnpm --filter @awc/server exec wrangler d1 create awc-catalog
```

Replace the **all-zero placeholder UUID** in `apps/server/wrangler.jsonc` with the returned D1 database ID. Apply the schema locally (or remotely only after approved deployment):

```sh
cd apps/server
pnpm exec wrangler d1 migrations apply awc-catalog --local
cd ../..
```

Set a cryptographically random, 32+-character sandbox buyer credential **in a local `.dev.vars` file** (gitignored):
```sh
# apps/server/.dev.vars
AWC_BUYER_TOKEN=<generate a long random secret outside the repository>
```

Then:
```sh
pnpm --filter @awc/mcp-ui build
pnpm --filter @awc/server dev
```

Public endpoint: `http://localhost:8787/mcp` (current Wrangler local port), and `/connect` for human instructions. Configure the MCP host with its ordinary Streamable HTTP URL. For sandbox private tools, set `Authorization: Bearer <AWC_BUYER_TOKEN>` in the client's secure connector configuration.

**Never** publish that token in a catalog, app resource, link, prompt, or user conversation. The sandbox buyer ID is intentionally fixed; don't expose it to real users. Use proper OAuth, account identity and per-resource policy before any public buyer write operation.

## Deployment

1. Review access policy and ensure the sample records remain clearly marked as fictional.
2. Create a real D1 database and update its ID, set `AWC_BUYER_TOKEN` via `wrangler secret put`, and apply remote migrations.
3. Build bundled UI, then deploy the Worker using Wrangler.
4. Validate `/health`, signed-out discovery, authorized quote creation and buyer isolation.
5. Keep `ENABLE_X402_TESTNET=false` unless deliberately exercising paidTool with a **Base Sepolia testnet** receiving address. A live Monetization Gateway rule is not created here.
6. For public adoption: replace sandbox auth with a standards-compatible OAuth authorization server and resource metadata, implement trusted catalog/provider registration, quotas and per-tenant authorization, deploy durable outbox/leases, and only then enable actual work execution or payments.

## Auth and security notes

- `AWC_BUYER_TOKEN` binds **one demo buyer** only. There is no auth self-registration. Write endpoints are absent from `tools/list` for signed-out clients.
- All quote/work D1 records are looked up with the buyer ID, and repeated idempotency keys with differing terms are rejected. D1 uniqueness prevents concurrent duplicate records.
- `work.prepare` returns `prepared_unfunded`; there is deliberately no `work.confirm` or `work.start` in this slice. This avoids conflating a draft job with authorized spending.
- Work inputs are JSON inline or opaque `artifact:` references, never arbitrary remote URLs. No artifact resolver is enabled.
- Search metadata is untrusted; matching or claimed provider skills never imply authorization or certification. For public use, authenticate provider origins and verify credentials.
- A per-route browser Origin check and MCP routing header/body agreement are present; OAuth, rate limits, mandatory user confirmation and secure wallet approval remain to be built.

## Monetization experiment

The optional `sandbox.paid_text_stats` tool uses `agents/x402` `paidTool`, **not** Cloudflare Monetization Gateway edge rule creation. It operates only when the `ENABLE_X402_TESTNET` flag is `true` and `X402_TESTNET_RECIPIENT` is valid. The tool returns deterministic word/character counts after SDK verification of a Base Sepolia x402 payment.

Cloudflare Monetization Gateway itself is closed beta and must be configured in an eligible account; it isn't deployed or enrolled by this repository. Review `docs/monetization-gateway.md` for the edge `exact` and `upto` flows, pricing minimum/maximum, streaming limitations, origin JWT verification and Bazaar indexing caveats.

## Next implementation

- OAuth nathan/other issuer, D1 principal binding, tenant and per-tool policy + quotas.
- Real provider onboarding and a signed semantic catalog.
- `billing.options` with actual Stripe/x402 rails and fixed-price mandate approval.
- WorkOrder `start`, async MCP Tasks (when supported), and durable execution/receipt issuance.
- Playground App contract review UI, Attest verification and dispute/funding states.
