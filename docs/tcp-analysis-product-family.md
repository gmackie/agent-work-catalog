# TCP Analysis WorkExecutor — product architecture and offering family (draft v1)

**Status:** AWC is an experimental marketplace. A bounded TCP flow evidence parser and a 48 KiB public-data-only remote execution path are implemented on this branch; nine product SKUs are defined in `specs/tcp-offering-family-v1.json`. Prices in this document are **hypotheses, not actual market rates or production quotes**. None are enabled for live settlement.

## 1. What is being sold?

Do **not** attempt to sell “AI PCAP reading.” TShark, Wireshark, Zeek and OT-specific NDR sensors already extract packet and flow behavior very effectively. AWC should sell a *verified, reproducible work outcome* with versioned schemas, provenance, acceptance terms, a deterministic evidence layer and only then optional human-readable interpretation.

The fundamental units are:

| Object | Owner | Purpose |
|---|---|---|
| TaskType | AWC semantics | What outcome is required |
| Offering | Seller | How work is packaged, priced, delivered, evaluated |
| WorkOpportunity | Source | An uncommitted request; not authorization |
| Quote / WorkOrder | Broker | Commercial terms, buyer consent, funding and acceptance |
| ExecutionRequest | Broker | Minimal, policy-bounded data and permitted effects |
| WorkResult | Executor | Versioned, schema-checked outputs and artifact commitments |
| Observation/evaluation receipt | Named issuer | A cryptographically attributable, separately verified claim of checks performed |
| Payment settlement receipt | Payment authority | Independent proof funds actually settled; not proof of quality |

A model should not be the arbiter of raw packet facts. It may explain verified observations, propose plausible causes with confidence and caveats, and select the next **non-invasive** measurement. A human operator must approve external data disclosure and any physical-system effect.

## 2. Nine initial product SKUs

| SKU | Status | Hypothetical price | What buyer receives |
|---|---|---:|---|
| Capture Readiness & Evidence Limits | Proposed | $0–$5 | File/format support, observed time window, missing context and warnings |
| TCP Flow Evidence Report | **Test-mode implementation** | $15–$35 | Flow summaries, seq-range candidate anomalies, resets/zero windows, signed evidence |
| Modbus/TCP Transaction Evidence | Existing test-mode implementation | $25–$75 | MBAP transaction pairs, exception responses, packet-number evidence |
| TCP Reliability Triage | Proposed | $35–$85 | Correlated TCP seq/ACK/TShark evidence and cautious reliability hypotheses |
| Before/After Network Change | Proposed | $60–$160 | Comparable baselines, rate/percentile contrasts and confounders |
| Industrial Protocol Regression | Proposed | $80–$250 | Versioned conformance outputs against specific device/protocol profiles |
| Incident Evidence Bundle | Proposed | $150–$500 | PCAP+Zeek+app logs, timeline, graph, competing hypotheses, provenance |
| Continuous Passive OT Change Monitor | Proposed | $150–$1,000/site/mo | Agent-readable baseline and reviewed changes; on-prem sensor required |
| Human-Reviewed Network Investigation | Proposed | $250–$1,500/case | Named reviewer, evidence appendix, escalation and revision policy |

**Commercial caveat:** our current seeded catalog uses a fixed illustrative $25 for `offering:tcp-flow-evidence` and $35 for `offering:modbus-pcap-analysis` in **sandbox/Stripe TEST only**. We have not interviewed customers, proven willingness-to-pay, costed support, signed a merchant, or promised professional turnaround. These numbers should not be published as quotes without a commercial validation process.

## 3. Evidence tiers and acceptance policies

### Tier 0: Technical intake

Check that content is a supported classic PCAP and that the capture was explicitly cleared for external disclosure. Inspect file size, timestamp plausibility, network/linktype, frame bounds, IPv4/TCP header coverage. Missing bytes are not reconstructed; no claim about unseen packets.

**Acceptance:** independent schema/byte-range validation; typed failure on unsupported format. A text description alone is not fulfillment.

### Tier 1: Packet facts

Return exact observed packet frames, Modbus identifiers or TCP flags, transaction ranges, timestamps and bounded candidate anomalies. Do not report packet loss merely from a retransmission, a gap or an unmatched request.

**Acceptance:** matching external TShark/Scapy differential corpus for supported cases; independently bound input SHA; output schema and declared parser version. The current bounded TCP engine and Modbus parser support this tier on small public captures.

### Tier 2: Correlated reliability assessment

A version-pinned container runs TShark and Zeek over complete/appropriate TCP flows. It analyzes SYN/SYN-ACK, sequence/ACK advancement, retransmission candidates, zero window, SACK, out-of-order segments and approximate response distributions while respecting capture vantage and timestamp precision. Retransmitted-data RTT samples must honor Karn's rule (RFC 6298); capture-side latency isn't inherently end-to-end path RTT.

**Acceptance:** deterministic independent reference outputs and explicit ambiguity/coverage/confidence fields, not a single magic “packet loss %.” Not yet implemented in the production worker.

### Tier 3: Incident / before-after

Correlate two captures, Zeek logs, event metadata and app/service timing. Normalize vantage, collection period and flow mix. Compare feature distributions and scope to avoid attributing coincident changes to a deployment without corroboration.

**Acceptance:** each claim cites input artifacts and exact frames/log events, distinguishes observation vs hypothesis, and identifies missing exculpatory evidence. Requires a data retention, customer review and dispute policy.

### Tier 4: Operational assurance

A registered professional/authority with independently verifiable qualifications reviews the incident/acceptance bundle. Attest claims separately identify who observed, who assessed, who accepted and who confirmed payment. A broker signature doesn't certify the work or settle a bill.

**Acceptance:** named/evaluable issuer and status, authoritative criteria, disclosure/mandate, refund and appeals policy. **Not currently implemented.**

## 4. Current TCP engine: exactly what is in scope

`@awc/tcp-analysis` reads up to 48 KiB classic PCAP 2.4 Ethernet/IPv4 nonfragmented TCP, bounded to 500 frames and 80 endpoint flow identities. It groups a canonical bidirectional 4-tuple, observes data-segment byte ranges, duplicate sequence+payload pairs, overlapping ranges, possible gaps, SYN/SYNACK, FIN, RST and zero-window headers. It computes a capture-point SYN-to-SYNACK interval **only when both are seen**.

A duplicate sequence+payload is *not necessarily packet loss or a TCP retransmission*: mirror duplication and endpoint retransmission can look similar. An apparent sequence gap may be caused by dropped/missing capture traffic or out-of-order frames. Partial captures may start midstream. Seq-wrap and 4-tuple reuse are explicitly not resolved. The parser never actively touches a PLC, sends scan packets or issues commands.

A separate Scapy/TShark differential CI job checks network header fields and payload lengths against an independently generated synthetic corpus, while Modbus has a packet-specific external oracle. These are **synthetic** tests, not proof of real OT performance or safety.

### Real execution path (test-only)

    Buyer uploads sanitized public classic PCAP -> private R2 SHA reference
    Agent purchases OFFERING: tcp-flow-evidence (sandbox/Stripe TEST quote)
    Human separately reviews exact quote and exact external data disclosure
    Broker pins remote origin/worker and grants NO network/plant side effects
    Worker receives signed, idempotent, bounded PCAP and runs TypeScript TCP analyzer
    Broker recomputes same TCP report, checks all fields, stores report+evaluation in R2
    Broker signs draft Attest-shaped TCP observation with pinned development key
    WorkResult contains artifact refs, and buyer can read via MCP after submitted

Neither the signing key nor a wallet can be supplied by the model. The service is disabled by default until the operator provisions R2, D1, Queues and secrets. A remote WorkExecutor with a different ID, different capture SHA or different output schema cannot satisfy the original WorkOrder.

### Output contract for flow evidence

The JSON report must include:

- `schemaVersion`, deterministic `analyzer` ID, SHA-256 of exact original PCAP;
- coverage counts including total and skipped/truncated frames, observed TCP segments and number of flows;
- stable canonical flow identifiers, observed endpoints/ports, first/last frames and bounded payload counts;
- evidence-backed types such as duplicate sequence range, possible gap, reset, zero receive-window and missing initial handshake;
- a confidence label per finding: observed, heuristic or incomplete_capture;
- explicit global limitations and flow-specific limitations;
- no packet payload plaintext in the report or unaudited claims about root cause.

R2 stores original approved capture, TCP JSON, consistency-evaluation JSON and a compact signed JWS in scoped keys. Broker's D1 execution journal temporarily persists base64 public input bytes for crash recovery. **This is not zero data retention; private capture lifetime and D1 TTL are production blockers.**

## 5. Execution platforms and production economics

**Small, bounded, deterministic (<48 KiB):** Cloudflare Worker + D1 Queues + private R2 is sensible. Cloudflare Workers currently document 128 MiB memory and a 5-minute CPU allowance on paid plans; our own much lower thresholds are conservative pilot engineering limits, not the Cloudflare maximum. The test quote's price does not represent raw compute cost. https://developers.cloudflare.com/workers/platform/limits/

**Larger 10 MiB–1 GiB incident cases:** use an isolated, ephemeral container worker with TShark/Zeek under a resource quota, job-specific R2 grant, no public egress and explicit retention. Charge separately for preprocessing, storage, optional narrative inference and independent evaluation. Never stream whole captures into an LLM or arbitrary remote URL.

**Sensitive, regulated or physical OT:** prefer customer-owned on-prem/air-gapped execution. The broker receives only approved evidence commitments or sanitized derived metrics. Data residency, export restrictions, vendor access and consent override frictionless marketplace discovery.

An illustrative per-work-order margin model must include: billed deterministic and container CPU, durable artifact bytes and egress, token costs if used, independent evaluator charges, retries/reconciliation, support, payment and marketplace fees, acquisition, security compliance and refunds. A raw parser is not defensible at $25 solely because of compute scarcity; buyers pay for provenance, repeatability, support and verified integration. Test a no-charge preview and paid escalation before optimizing take rate.

### Why this isn't an OT NDR platform

Nozomi Guardian provides continuous passive OT asset discovery, network visualization and anomaly monitoring; Zeek produces flow histories and logs; Wireshark supports sophisticated TCP sequence analysis. Our current per-capture WorkExecutor does NOT compete with the full coverage or live sensor position of those platforms. It can instead be their **consumer/integrator**: a narrow evidence-backed report sold across multiple tools and providers.

Relevant docs:
- https://www.wireshark.org/docs/wsug_html_chunked/ChAdvTCPAnalysis
- https://www.wireshark.org/docs/dfref/t/tcp.html
- https://docs.zeek.org/en/lts/reference/logs/conn.html
- https://www.nozominetworks.com/platform/guardian
- https://www.rfc-editor.org/info/rfc9293/
- https://www.rfc-editor.org/info/rfc6298/
- https://www.rfc-editor.org/info/rfc7323/

## 6. Provider experience

Each provider advertises **what it measures**, not only its endpoint. AWC registry binds one offering/version to:

    taskType -> input/output schema -> evaluator policy -> optional review
        -> authorized runtime -> resource budget -> data destination
        -> payment mandate -> artifact/receipt commitments

Provide an operator-run onboarding wizard: discover provider URL, validate claimed capabilities, run synthetic conformance suite, review exact scope/data location, confirm domain and seller identity, register immutable offering revision, and hold provider test quota. Agent/tool search stays free. Actual payment/execution requires separately verified authorization and a spend limit.

For consumer MCP, expose catalog.search, catalog.get_offering, quotes.request, work.prepare, work.start (only after approval/funding), work.get, work.artifacts.read and receipts.verify when it is genuinely connected to the issuer/status registry. Long jobs must have async execution handles or MCP Tasks projections, not a blocking 30-minute tool call.

## 7. What to build next

1. Make the current TCP flow offering pass full signed HTTP/R2/Attest-shaped end-to-end tests and independent TShark differential CI.
2. Introduce well-defined capture provenance, 4-tuple session splitting, timestamp precision, TCP sequence unwrapping and retransmission ambiguity classifications.
3. Implement real reassembly/ACK analysis in a contained reference executor (Zeek/TShark) rather than silently extending a parser that makes narrower claims.
4. Add two-input before/after comparisons with explicit matched capture windows and flow population.
5. Stand up one opt-in pilot with sanitized open traces and field technicians; collect time saved, actionable resolution, false-positive/unsupported rates, completion/revision rates and willingness-to-pay.
6. Replace provisional observation signatures with Attest authority/status and separate accepted work and settled payment claims; do not market Attest reputation based on the broker's own signatures.
