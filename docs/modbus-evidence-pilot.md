# Real Modbus/TCP evidence pilot — bounded capture, R2, signed observation

**Status: experimental, disabled by default.** This parses actual packets, but does NOT diagnose physical controller health, prove a device timeout, claim independent professional assurance, charge real money, or execute external side effects.

## Architecture

```text
Buyer -> POST /api/artifacts/input (explicitly PUBLIC classic PCAP)
        -> bounded format inspection -> private R2 content-addressed input
Buyer -> MCP quotes.request + work.prepare (R2 artifact reference)
Human -> separate exact quote approval + remote disclosure consent
Buyer -> Stripe TEST / local fake funding -> MCP work.start
Queue -> D1 dispatch journal -> signed HTTPS request to PINNED executor
Remote Worker -> real bounded Modbus/TCP parser -> deterministic JSON evidence
Broker -> independently re-runs SAME parser on original committed input
       -> verifies report correspondence -> private R2 report & evaluation
       -> broker Ed25519-signed, Attest-shaped observation JWS in private R2
       -> commercial work marked submitted; buyer-scoped artifact retrieval
```

This is a consistency verification based on the same parser implementation; it is **not** independent analysis by a second implementation or recognized external evaluator.

## Supported capture formats and limits

- Classic PCAP 2.4, little/big endian, microsecond/nanosecond timestamps.
- Ethernet (LINKTYPE 1), IPv4, complete nonfragmented TCP segments on port **502**; up to two complete VLAN tags.
- Modbus MBAP transaction identifier, protocol ID, unit ID, function code, exception response code, request/response pairing, RTT observations when visible.
- **48 KiB**, **500 frames**, **250 complete Modbus ADUs** maximum; bounded output.
- Reports unmatched requests as **no response observed in the supplied capture**, never as proven PLC timeouts.
- Unsupported: pcapng, TCP stream reassembly, IPv6, IPv4 fragments, TLS/Modbus Security, retranmission handling, raw register data interpretation and conclusions about device fault causation. A real plant trace may contain sensitive device information even if the uploader labels it public.

Technical references: [Modbus specifications](https://www.modbus.org/modbus-specifications) and [IETF classic PCAP format draft](https://datatracker.ietf.org/doc/draft-ietf-opsawg-pcap/09/). An independent TShark corpus comparison and fuzzing are recommended before relying on any result outside this pilot.

## Implemented packages

- `@awc/modbus-pcap`: actual bounded classic PCAP parser, deterministic structured findings and a recomputation evaluator.
- `@awc/artifact-custody`: private R2 buyer-scoped inputs and buyer+work-scoped outputs, `artifact:sha256:...` references, recomputed digest on every read.
- `@awc/modbus-workflow`: report consistency check, R2-backed JSON report/evaluation and observation JWS; no raw public bucket URLs.
- `@awc/attest-receipts`: provisional `attest.marketplace.modbus-observation/v0` structured assertion matching the fields of `gmackie/attest`'s domain. Signed compact EdDSA JWS with a pinned private key, verified with a pinned public key.
- `apps/server`: authenticated binary upload `POST /api/artifacts/input`, buyer-only `GET /api/artifacts/results/<workId>/<sha256>`, and MCP `work.artifacts.read` supporting JSON or signature-checked observation details.
- `examples/remote-executor`: real Modbus analysis behind `ENABLE_MODBUS_PCAP=true`, retaining existing synthetic worker example as default.

**Important Attest limitation:** a valid JWS establishes that the configured broker key signed an observation. It does not establish the issuer's independent authority, active status/revocation, W3C VC conformance, or a financial settlement. The full multi-issuer work receipt profile remains tracked in [gmackie/attest#9](https://github.com/gmackie/attest/issues/9).

## Local setup

Install Node 24+ / pnpm 10 and configure the two existing Cloudflare Workers with their D1 databases, Queues, and signing secrets. The repository uses placeholder D1 IDs; no service was deployed.

```sh
corepack enable
pnpm install --no-frozen-lockfile
pnpm --filter @awc/mcp-ui build
pnpm typecheck
pnpm test
pnpm --filter @awc/server bundle
pnpm --filter @awc/example-remote-executor bundle

# Provision an R2 bucket in your account (private; no public access):
pnpm --filter @awc/server exec wrangler r2 bucket create awc-private-artifacts
# Also configure real D1 binding IDs, apply the existing migrations,
# and apply apps/server/migrations/0004_dispatch.sql.
```

The remote Worker requires `ENABLE_EXAMPLE_EXECUTOR=true`, `ENABLE_MODBUS_PCAP=true` and `AWC_SHARED_KEY`, plus its existing D1 binding.

The broker Worker requires `ENABLE_TRUSTED_REMOTE_DISPATCH=true`, `ENABLE_MODBUS_PCAP=true`, a private R2 `ARTIFACTS` binding and the operator-pinned `AWC_REMOTE_EXECUTOR_ID`, `AWC_REMOTE_EXECUTOR_HOST`, `AWC_REMOTE_EXECUTOR_ORIGIN`, and `AWC_REMOTE_EXECUTOR_SHARED_KEY` (the same key configured on the remote Worker). The destination must be an approved HTTPS endpoint, not user-supplied.

For signed local observations configure `AWC_ATTEST_OBSERVATION_ISSUER`, `AWC_ATTEST_KEY_ID`, `AWC_ATTEST_PRIVATE_KEY_PEM` (PKCS#8 Ed25519 private key) and `AWC_ATTEST_PUBLIC_KEY_PEM` (SPKI public key). Put private keys in Worker secrets, never in repository files. No production issuer enrollment/status registry is provided.

Keep all real payments off. Only local fake funding or Stripe **TEST** may authorize the explicitly fictional fixed-price offering `offering:modbus-pcap-analysis`.

### Upload an explicitly public, sanitized capture

```sh
curl -X POST 'http://localhost:8787/api/artifacts/input' \
  -H 'Authorization: Bearer <sandbox buyer credential>' \
  -H 'Content-Type: application/vnd.tcpdump.pcap' \
  -H 'X-AWC-Data-Classification: public' \
  --data-binary '@public-modbus-sample.pcap'
```

Returns `ref`, `sha256`, `bytes` and `mediaType`. Upload does **not** automatically certify public-data suitability or consent.

Use MCP `quotes.request` for `offering:modbus-pcap-analysis` and `work.prepare` with a public input:

```json
{
  "quoteId": "quote_...",
  "idempotencyKey": "public_modbus_001",
  "dataClassification": "public",
  "inputs": [{
    "name": "pcap",
    "kind": "reference",
    "mediaType": "application/vnd.tcpdump.pcap",
    "reference": "artifact:sha256:<digest>",
    "sha256": "<digest>"
  }]
}
```

In the separate human review approve exact quote terms and the explicitly displayed destination/input disclosure digest, then use local simulated funding or Stripe TEST. `work.start` queues the pinned remote executor; `work.get` shows progress and artifact references. `work.artifacts.read` verifies tenant/work scope and SHA-256; for `application/jose` it verifies the local issuer signature against configured pinned key.

The report, evaluation and JWS are stored separately in R2, each referenced by digest. The broker's D1 dispatch record temporarily holds the **base64 public capture** to ensure crash/retry continuity. This is not zero-retention; there is not yet an automatic deletion/lifecycle policy for uploaded or orphaned captures.

## Verification and release gates

The integration suite exercises a real signed HTTP request against the reference Cloudflare Worker, input from private fake-R2, actual packet analysis, broker recomputation, R2 persistence, EdDSA verification, and idempotent finalization. Unit tests cover malformed input, wrong hashes, modified evidence and cross-buyer access.

Before any nonpublic/production usage: add tested retention and deletion, quotas/rate limits, robust tenant identity (PKCE/OIDC), real provider registration and terms, independent second-parser validation and authorized Attest issuer/status checking, operational disaster recovery, reliable financial reversals, external worker cancellation, plus security and packet corpus review. A 48KiB packet snippet is **not** a comprehensive network diagnostic.
