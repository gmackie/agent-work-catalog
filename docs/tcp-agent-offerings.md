# AWC TCP/OT Agent Offering Family

**Status (Nov 2026):** product architecture and test-only pilots. The profile prices
are *hypotheses*, not live market quotations, current Stripe prices or evidence of
buyer willingness to pay. Nothing here constitutes an available paid service until
a provider/merchant, policies and production checkout have been approved.

## The product: sell a verified unit of work, not just token markup

An agent wants "why did our HMI lose connectivity?". A PCAP-only specialist
may truthfully answer only "these frames show two SYN retransmission
candidates, a zero-window advertisement and a missing response in this
capture." It cannot conclude *which component broke* without sensor position,
topology, client/server logs, TCP reassembly and often human review.

Sell four classes of obligation:

1. **Extract:** bounded, deterministic packet evidence with packet references,
   stable JSON, strict report schema and automatic reproducibility. Very low
   marginal inference expense; no root-cause claim.
2. **Protocol:** validated transactions, flow/window/SACK interpretation and
   explicit missing-capture warnings. Requires deeper parsers and a
   independently corroborated corpus for each supported protocol.
3. **Investigate:** hypotheses across captures, event logs, device topology,
   deployments and historical baselines, with likelihood qualifiers,
   competing explanations, and optional specialist review.
4. **Assure:** independently evaluated work, recognized issuer scope, dispute
   and retention policies, buyer acceptance, and verifiable credential status.
   Without independent reviewers this is **not** a trustworthy offering.

The versioned machine-readable set is in
\`@awc/offering-profiles\`; access via MCP \`catalog.list_tcp_services\`
or \`awc://catalog/tcp-service-tiers\`. All entries are explicitly
\`pilot-test-only\` or \`planned\`.

## Commercial catalog

| Product | Illustrative reference price | Executable status | Needed before release |
|---|---:|---|---|
| TCP Packet Evidence | $9/capture | test-only, real parser | sanitize inputs, tenant auth, oracle, retention |
| Handshake / Reset Triage | $15/job | planned | stateful TCP transitions, SYN retransmissions |
| Sequence / Window Specialist | $25/job | planned | SACK, scale negotiation, wrap, retransmission ambiguity |
| Modbus Transaction Evidence | $35/capture | test-only, real parser | larger corpus, reassembly and real data clearance |
| Before/After Capture Diff | $49/comparison | planned | matching capture context, normalization |
| OT Communications Triage | $90+ quote | planned | topology, PLC/HMI logs, specialist evaluator |
| Enterprise TCP Investigation | $149+ quote | planned | protected multi-source telemetry, case reviews |
| Continuous OT Baseline | $299/site/month | planned | authenticated sensor ingestion, calibrated drift |
| Independently Reviewed Assurance | $499+ quote | planned | recognized reviewers, Attest authority/status, disputes |

Only TCP Packet Evidence and Modbus Transaction Evidence have runnable
**test-only** processors. Other profiles must not appear as payable active
Offerings or as deliverable guarantees in the marketplace.

### Fixed report contract, v1

**Task Type:** \`task:tcp-pcap\`

**Offering:** \`offering:tcp-pcap-evidence\` v1, reference price 900 USD minor
units ($9). AWC models it as a fixed test quote so we can exercise
procurement and lifecycle code; this does **not** activate live payment.

**Input:** one small \`application/vnd.tcpdump.pcap\` R2 reference from
an authenticated buyer, SHA-256 commitment and explicit **public** data
classification, under 48 KiB. Only Ethernet/IPv4/nonfragmented TCP.
No external URLs, PCAPNG, secrets or active probes.

**Outputs:**
- \`tcp-packet-evidence.json\`, \`awc.tcp.packet-evidence/v1\`
  containing flow endpoints, frame metadata (not raw payload), sequence and
  ACK fields, raw advertised windows, flag observations, handshake SYN→SYN/ACK
  delay when visible, sequence duplicates/overlaps/gaps and limitations.
- \`tcp-evaluation.json\`, \`awc.tcp.evaluation/v1\` with the exact policy and
  digest-bound broker recomputation results.
- \`tcp-observation.jws\`, provisional
  \`attest.marketplace.tcp-evidence/v0\` bound to work, quote, capture,
  report, evaluation, and analyzer version. **Broker-key attribution only,
  not independently certified Attest, no guarantee of correctness.**

**Acceptance:**
1. Full input commitment, offering version and executor identity match
   the human-reviewed disclosure digest.
2. Signed remote request, persistent idempotency key, result status and
   exact work-order ID match.
3. Broker re-runs deterministic version-pinned parser on original PCAP;
   reports must agree exactly or go to manual review.
4. Report and evaluation are private R2 objects, hashed upon storage and
   read, scoped to buyer and work order.
5. Broker observation must verify against configured pinned Ed25519 key
   and stated issuer; issuer authority/revocation still unresolved.
6. No root-cause inference or unqualified "packet loss proven" claim.
7. Failed or incomplete evidence does not silently imply paid success.

### Buyer agent workflow

\`\`\`text
catalog.search("TCP handshake and retransmission evidence")
  -> catalog.get_offering("offering:tcp-pcap-evidence")
  -> catalog.list_tcp_services (verify tier readiness + obligations)
  -> POST /api/artifacts/input [authorized buyer, sanitized public PCAP]
  -> quotes.request [fixed quote; no charge]
  -> work.prepare [public artifact digest; no execution]
  -> human approves exact commercial terms + separately approves
     disclosure to the pinned remote worker
  -> local synthetic or Stripe TEST funding
  -> work.start -> Queue -> signed WorkExecutor -> broker recomputation
  -> work.get -> work.artifacts.read (buyer-scoped evidence and receipt)
\`\`\`

No third-party agent decides the merchant, remote executor, private inputs,
wallet signing, funding settlement, or data classification. Those are
broker and owner decisions.

## Conformance and limits

Our first packet extractor supports classic PCAP 2.4 Ethernet, optional
VLAN tags, IPv4 nonfragmented TCP and complete TCP headers in a single
captured frame. It deliberately does not implement reassembly, SACK parsing,
negotiated window scaling, TCP timestamp options, TLS decryption, pcapng,
IP fragmentation or IPv6. Repeated sequence ranges are **not proof** of a
retransmission on the wire, and observed gaps are **not proof** of physical
packet loss. ACKs beyond visible ranges may simply mean capture started
mid-connection.

Wireshark's TCP analysis labels themselves depend on state, capture context
and precedence among several heuristics. RFC 9293 requires wrap-aware 32-bit
sequence arithmetic. Our v1 only compares bounded observations within a
half-space; wrap and cross-connection sequence interpretations are
separate v2 engineering work:
- RFC 9293: https://www.rfc-editor.org/rfc/rfc9293
- Wireshark TCP analysis: https://www.wireshark.org/docs/wsug_html_chunked/ChAdvTCPAnalysis.html
- Zeek conn.log: https://docs.zeek.org/en/lts/reference/logs/conn.html

The dedicated \`tcp-differential.yml\` independently generates eight
Scapy TCP captures and compares all raw packet facts against TShark,
including ports, sequence/acknowledgment numbers, raw windows and flags.
Neither TShark nor those captures prove general network-forensics accuracy.
Before calling it production-quality, add a consented real-capture corpus,
large-scale coverage-guided fuzzing and a second independent TCP semantics
oracle. The Modbus differential CI has separately checked 12 strict
Scapy/TShark Modbus scenarios.

## Realistic monetization

\`COGS = Worker CPU + R2 writes/reads/retention + payment/settlement fees +
model/tool invocations + third-party review + support/retry reserve +
fraud/refund reserve\`. Report actual breakdowns via metered observability;
don't assume price = underlying LLM cost ×1.15.

Illustrative unit-economics **scenario**, not provider pricing:

| Component for $9 capture | Assumption |
|---|---:|
| Compute/parser + broker evaluation | $0.04 |
| Artifact storage and delivery | $0.03 |
| Payment fee estimate | $0.40 |
| Support/retries/fraud reserve | $1.25 |
| Merchant/broker overhead allocation | $0.50 |
| Total modeled variable allocation | $2.22 |
| Contribution before fixed costs | $6.78 |

These figures are intentionally invented *inputs* for planning. Actual
Cloudflare, Stripe and x402 costs depend on usage, method, network, refund
rate, input sizes and business configuration. Measure and replace all
assumptions before publishing prices.

For fixed synchronous small requests, direct x402 \`exact\` or an eligible
Cloudflare Monetization Gateway rule may work. Longer, variable work should
use an independently verified funding reference: Stripe Checkout
(test mode first), x402 settlement or a reserved credit ledger. Gateway's
documented \`upto\` path is not directly suited to arbitrary long streaming
jobs after response headers are sent. It is not a generic escrow service.
See \`docs/monetization-gateway.md\`.

## Rollout to buyers

**Phase 0:** demonstrate on synthetic public capture and published tests.
Publish precise schema, packet output and limitation examples; no external
customer data.

**Phase 1:** offer free/test pilot to 3–5 consenting network/OT engineers.
Capture their tasks, independently annotated ground truth, confidence,
time saved and corrective feedback, not just impressions. Do not release
public packet bytes without permission.

**Phase 2:** launch fixed-priced extraction *only* when merchant approval,
tenant auth, retention, actual cost accounting, provider identity, charge
reversal handling and security review are complete.

**Phase 3:** introduce differentiated protocol reports (Modbus, BACnet,
EtherNet/IP etc.) only with independent protocol test vectors. Keep outcome
acceptance tied to typed evidence, not a generic narrative.

**Phase 4:** introduce reviewed incident analysis, not merely expensive
system prompts. Requirements: multi-source timeline, alternate hypotheses,
expert reviewer acceptance, signed credentials and actual service terms.

## Core business metrics

- % of accepted report artifacts meeting schema and deterministic checks.
- False-positive/false-causal-claim rate measured on human annotated corpus.
- Time from receipt to validated artifact and p95 turnaround time.
- Work-provider reconciliation failures, unknown starts, duplicate charges
  avoided and disputes per paid order.
- Real gross contribution per offering, independent of advertised model markup.
- % repeat buyers who used another provider without integration rewrites.

**Current reality:** no production provider onboarding, real settlement,
external certified Attest issuer, live capture retention policy or
comprehensive network diagnosis. These are deployment gates, not hidden
product features.
