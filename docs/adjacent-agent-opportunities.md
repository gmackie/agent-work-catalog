# Twelve additional work-offering domains: research-to-pilot roadmap

These are **market hypotheses**, not active marketplace vendors, purchased
services or measured demand. Versioned candidate records with source
adapters, executor pipelines, inputs, deliverables and acceptance tests are
published read-only in \`@awc/domain-opportunities\` and the MCP
\`catalog.list_domain_opportunities\` tool. None can be commissioned yet.

## How to choose a vertical

An offering is attractive if (1) it produces an independently inspectable
output, (2) a seller's expertise or assets make the premium justified,
(3) an owner can authorize its data and actions, and (4) the workload can
be completed within a measurable commercial contract. A $20 task that can
be autonomously and deterministically validated is often a better first
marketplace SKU than a $2,000 project with ambiguous acceptance or
regulated data.

Use the following initial rubric, each scored 1–5: build time,
verifiability, repeat-demand potential, integration friction, data
sensitivity and regulatory exposure. Scores below reflect engineering
judgment, **not customer research**.

| # | Domain | First credible purchase | Evidence | Wedge / first customer conversation |
|---|---|---|---|---|
| 1 | Software engineering | Bounded PR/test fix | CI, patch digest, reviewer acceptance | Maintainer with many small labeled issues |
| 2 | Cloud IaC & governance | IaC plan policy check | Pinned OPA rules, JSON findings | MSP or platform team reviewing PRs |
| 3 | Industrial PLC/fieldbus | EtherNet/IP/CIP packet evidence | Protocol oracle, frame references | OT integrator troubleshooting a demo cell |
| 4 | Vehicle CAN/J1939 | Offline DM1 trouble code decode | SPN/FMI and CAN frame match | Fleet workshop / equipment dealer |
| 5 | Building BACnet | Trend/point configuration QA | Time/unit invariants, point coverage | Commissioning consultant |
| 6 | Water/wastewater | Historian data-quality report | Units, coverage, threshold test vectors | Municipal engineer/SCADA operator |
| 7 | Manufacturing SPC | Bounded dimensional quality analysis | Recomputed charts, control limits | Plant quality engineer |
| 8 | Food R&D | Emulsion formulation DOE | Mass balance and lab test plan | Ingredient/culinary lab |
| 9 | Restaurant throughput | Forecast next shift constraints | Holdout error, queue capacity | Franchise operations manager |
| 10 | K–12 assessment | CASE-aligned rubric coverage | Standard version, human rubric review | Educator/curriculum coordinator |
| 11 | Healthcare interfaces | Synthetic HL7/FHIR profile validation | Official schema/IG validator errors | Integration vendor/hospital IT team |
| 12 | RFP technical compliance | Clause-to-evidence traceability | Exact paragraph citations, coverage | Small engineering/IT bidder |

These twelve are **additional to TCP/Modbus analysis**. Wedges are
deliberately output-focused, not vague "expert agent for everything"
listings.

## Initial commercial positioning (hypotheses)

- **Low-ticket self-serve**: a deterministic audit, validation or
  report costing $5–$50. Use direct x402, validated credit ledger, or
  Stripe where fees/UX permit. Example: IaC policy check, CAN code decode,
  versioned curriculum coverage.
- **Bounded gigs**: $50–$250 with fixed deliverable and verifiable
  acceptance, often a human reviewer. Example: PR bug fix, SPC analysis,
  BACnet commissioning report, public RFP traceability.
- **Contracted specialist work**: $250+ or recurring with milestones,
  data-handling agreements, professional review, merchant/payout setup and
  dispute machinery. Example: OT incident triage, wastewater quality
  consulting, healthcare production interop.

A 10–20% inference markup is not sufficient by itself to pay for
distributed execution, retries, support, settlement, evaluation and
marketplace fees. Sell specialist capability/verified work, not
unexplained model routing. Actual pricing comes after provider
costs and customer interviews; figures above are only experimental
product-design bands.

## Recommended order of builds

### First: repo PR review / engineering patch verification

**Source:** existing GitHub App WorkSource already ingests signed events.
**Executor:** isolated coding agent limited to a branch and test command;
do not grant production deployment privileges. **Result:** patch,
test output and a PR reference. **Acceptance:** CI + scoped diff +
maintainer approval. This is a practical full circle for our
\`WorkOpportunity -> WorkOrder -> Execution -> DeliveredArtifact\` contract.
It exercises real external side effects with explicit approval, a gap
in the current synthetic executor.

### Second: read-only IaC policy audit

**Source:** Terraform plan or CDK diff. **Executor:** pinned
Conftest/OPA rules plus optional read-only language explanations.
**Result:** rule ID, location, evidence and suggested patch.
**Acceptance:** exact policy bundle version, reproducible rule results.
No modifying resources or secrets. This is a stronger "specialist
tool" story than generic LLM inference and produces comparable work.

### Third: manufacturing quality/SPC

**Source:** small anonymized CSV, shift/lot metadata and spec bounds.
**Executor:** deterministic statistics/measurement quality checks.
**Result:** chart data, anomalies and measurement caveats.
**Acceptance:** independent numeric vectors and quality engineer review.
It tests numerical artifacts, not merely text or code.

### Fourth–sixth: BACnet trends, curriculum/CASE alignment,
FHIR conformance using **only synthetic data**. These each bring
standard-specific verification and strong ecosystem value, but need
trusted data governance and standards-version pinning before
real-world deployment.

### Longer-term: CAN, PLC protocols, wastewater, food formulation,
restaurant forecasting and procurement RFPs

CAN/J1939 and protocol work require licensed/reference decoder
assets and careful interpretation. Water/food are process-sensitive;
instrument calibration or human lab/operator evaluation is essential.
Restaurant demand needs real, permissioned transaction history.
RFP compliance needs exact source citations and no false legal
compliance guarantees.

## Standard interfaces for any offering

\`\`\`text
WorkSource.verifiedIngest
  -> WorkOpportunity (NOT contract)
  -> TaskType + Offering (immutable versioned outcome)
  -> Quote + WorkOrder / owner spending authorization
  -> PaymentGate (verified, not user-supplied receipts)
  -> ExecutionRequest (bounded inputs, scoped grants)
  -> WorkExecutor.start/inspect/recover/cancel
  -> ArtifactStore (content-addressed and tenant scoped)
  -> Evaluation policy (domain-specific, independently checkable)
  -> human acceptance / settlement and Attest receipt claims
\`\`\`

Every provider needs real issuer identity and a proven ability to
fulfill its task type. A price in a catalog isn't an invoice or
payment proof, and a signed output isn't necessarily a correct result.
Where the provider controls the evaluator too, claims are marked as
self-checked until an independent authority joins.

The MCP server should make the domain opportunity registry available
**read-only**, so agents can propose integrations without mistakenly
purchasing an unimplemented service. Activation requires actual
work-provider onboarding, test fixtures, settlement, legal terms and
acceptance policy.

## Cross-domain security gates

- No arbitrary remote providers get access to secrets or data through
  model-selected URLs. Connectors require authenticated installation.
- GitHub write access, cloud changes and equipment commands require
  explicit capability grants and human/tenant approval, not just funds.
- Schools: minimize and segregate student data; avoid automated
  high-stakes decisions without educator review. Standards: OneRoster,
  CASE, QTI and LTI, https://www.1edtech.org/standards.
- Healthcare: synthetic/deidentified first, per-version FHIR
  Implementation Guides and official validators, plus proper PHI
  contracts before actual patient data;
  https://hl7.org/fhir/ and https://hl7.org/fhir/implementationguide.html.
- OT and building: passive/read-only design, licensed operator signoff
  on anything physically consequential; NIST SP 800-82r3 and
  ANSI/ASHRAE BACnet Standard 135-2024;
  https://csrc.nist.gov/pubs/sp/800/82/r3/final and
  https://www.ashrae.org/technical-resources/standards-and-guidelines/titles-purposes-and-scopes.
- No promise of clinical, engineering, procurement or legal
  certification merely because an agent generated a report.

## How to validate demand rather than guess

For each candidate, recruit 3–5 practitioners with an actual recurrent
workflow, write an input/expected-output fixture, have two reviewers
score correctness and time saved, and test willingness to pay for a
bounded completed artifact versus a raw LLM subscription. Measure
usage, repeated purchase, cost to serve, dispute/clarification rate,
and how many results pass automatic verification unaided.

Successful offerings graduate from \`design-only\` to \`pilot-test-only\`
only after a real adapter and conformance suite exist; from pilot to
live only after identity, billing, privacy and independent review are
implemented. Do not flip a readiness badge based on a compelling demo.
