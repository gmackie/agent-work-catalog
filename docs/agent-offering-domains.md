# Twelve additional AWC agent-offering domains (product research)

**Status:** brainstorm and technical feasibility research. None of these twelve offerings is implemented or available for purchase merely because it is listed here. Rankings are engineering/opportunity judgments **not independently measured customer demand or TAM**. Machine-readable draft definitions: `specs/agent-opportunity-map-v1.json`.

## Opportunity matrix

| Priority | Domain | Initial purchasable outcome | Credible acceptance oracle | Main constraint |
| --- | --- | --- | --- | --- |
| 1 | OAuth/OIDC/MCP authorization conformance | Machine-readable conformance failures, replayable tests, remediation PR | OpenID Foundation test plans + signed policy fixtures; separate official certification | medium data risk |
| 1 | OpenAPI and SDK compatibility regression | Backward-compatibility diff, generated contract tests, failure patch | OpenAPI schema/JSON Schema + golden requests/response corpus | low data risk |
| 1 | CI regression and PR-review evidence | Failure classification, minimal reproduction, proposed fix PR | CI rerun results, test suite and reviewer approval | medium data risk |
| 1 | Industrial protocol interoperability and commissioning | Protocol evidence, mismatch report, regression fixtures | TShark/Zeek plus independent protocol validators and device-specific profile tests | medium-high data risk |
| 2 | BACnet/BMS commissioning evidence | Point mapping discrepancies, COV/event audit, integration report | BTL/PICS references, schema/point mapping, independent reviewer | high data risk |
| 1 | LTI 1.3 and OneRoster interoperability checks | Conformance bundle, roster mismatches, role-scope tests | 1EdTech specs and certification diagnostics where properly licensed | high data risk |
| 1 | X12 850/855/856/810 transaction reconciliation | Mismatch list, deterministic transformation, partner map tests | Versioned X12 transaction schemas, 997 functional acknowledgments and partner rules | medium data risk |
| 2 | CAN/J1939 fleet diagnostic evidence | PGN timeline, diagnostic messages, source-address conflict evidence | SAE J1939 profiles and approved signal-decoder fixtures | medium-high data risk |
| 3 | FHIR/HL7 interface profile validation | Profile violations, mapping tests, transformation diff | HL7 official validator and test-server checks | very high data risk |
| 2 | Invoice–PO–receipt reconciliation | Explainable discrepancies, matched line-items, exceptions awaiting approval | Deterministic arithmetic, entity resolution checks, payer signoff | high data risk |
| 2 | HACCP monitoring and deviation record audit | Missing monitoring windows, threshold deviations, signed exception dossier | Recorded measurements, approved limits, device calibration and QA sign-off | high data risk |
| 1 | WCAG accessibility evidence and issue reproduction | Reproducible automated findings, screenshots, manual review queue | WCAG-EM/ACT rules + human accessibility evaluator | medium data risk |

## How AWC should rank new categories

We should choose *small, verifiable jobs with an identifiable buyer*, not simply categories in which an LLM can generate plausible prose. Each offering needs:

- **A clear input data contract.** Can the source be obtained with buyer authority and privacy consent? Are inputs reproducible, versioned and digest-bound?
- **A bounded outcome.** Does the agent return a report, typed JSON, code patch, transformed file or verified state transition instead of an open-ended conversation?
- **An objective or independent acceptance oracle.** Official validators, CI, policy engines and domain-specific benchmarks; humans review claims that cannot be fully automated.
- **An execution permissions profile.** Begin read-only. File modification, asset control, financial transfers, medical or safety decisions require independent human consent and domain governance.
- **Repeat purchase or distribution channel.** Integrate existing GitHub issues, CI, e-commerce, LMS, EDI or operational systems so an agent gets work through familiar workflows.
- **A durable trust story.** Provider identity, quote/contract, fulfillment evidence, independent reviewer where necessary, payment authorization and settlement must be separately attributed.
- **Realistic economics.** Value saved > processing + data custody + review + incident/dispute costs. Commodity schema checks should have a free preview or batch pricing rather than an arbitrary LLM surcharge.

## Category-specific buildable MVPs

### 1. OAuth/OIDC/MCP authorization conformance

**Buyer:** SaaS vendors, internal platform teams. **Candidate offering:** `task:identity-conformance.evidence/v1`.

**Input:** Authorization configuration and sanitized integration transcripts.

**Output:** Machine-readable conformance failures, replayable tests, remediation PR.

**Acceptance oracle:** OpenID Foundation test plans + signed policy fixtures; separate official certification. **Data-risk level:** medium. 

**Why it may work:** Existing Nathan/Gatekeeper/MCP skills and test infrastructure; clear developer purchasing path.

**First prototype:** a source-agnostic deterministic/standards-based validator with five positive and five negative fixtures. Add a customer-specific adapter only after source authentication and permitted-data boundaries are understood. No production write authority in the first release. Prioritize a small partner trial with synthetic fixtures and a clearly priced deliverable.

### 2. OpenAPI and SDK compatibility regression

**Buyer:** API platform teams, integration agencies. **Candidate offering:** `task:api-contract-drift.evidence/v1`.

**Input:** Old/new OpenAPI schemas, approved mock endpoints, SDK fixtures.

**Output:** Backward-compatibility diff, generated contract tests, failure patch.

**Acceptance oracle:** OpenAPI schema/JSON Schema + golden requests/response corpus. **Data-risk level:** low. 

**Why it may work:** Good fast, repeatable, deterministic work with easy CI acceptance.

**First prototype:** a source-agnostic deterministic/standards-based validator with five positive and five negative fixtures. Add a customer-specific adapter only after source authentication and permitted-data boundaries are understood. No production write authority in the first release. Prioritize a small partner trial with synthetic fixtures and a clearly priced deliverable.

### 3. CI regression and PR-review evidence

**Buyer:** Engineering managers and repository maintainers. **Candidate offering:** `task:github-ci-triage.evidence/v1`.

**Input:** GitHub checks, test logs and scoped source diff.

**Output:** Failure classification, minimal reproduction, proposed fix PR.

**Acceptance oracle:** CI rerun results, test suite and reviewer approval. **Data-risk level:** medium. 

**Why it may work:** Existing GitHub WorkSource, signed work deliveries and visible buyer value.

**First prototype:** a source-agnostic deterministic/standards-based validator with five positive and five negative fixtures. Add a customer-specific adapter only after source authentication and permitted-data boundaries are understood. No production write authority in the first release. Prioritize a small partner trial with synthetic fixtures and a clearly priced deliverable.

### 4. Industrial protocol interoperability and commissioning

**Buyer:** Industrial OEMs, integrators and plant support. **Candidate offering:** `task:ot-protocol-regression.evidence/v1`.

**Input:** Consented Modbus, EtherNet/IP or DNP3 test captures and device profiles.

**Output:** Protocol evidence, mismatch report, regression fixtures.

**Acceptance oracle:** TShark/Zeek plus independent protocol validators and device-specific profile tests. **Data-risk level:** medium-high. 

**Why it may work:** Strong specialist differentiation; passive only and tightly scoped before device effects.

**First prototype:** a source-agnostic deterministic/standards-based validator with five positive and five negative fixtures. Add a customer-specific adapter only after source authentication and permitted-data boundaries are understood. No production write authority in the first release. Prioritize a small partner trial with synthetic fixtures and a clearly priced deliverable.

### 5. BACnet/BMS commissioning evidence

**Buyer:** Building automation contractors and facility operators. **Candidate offering:** `task:building-bacnet.evidence/v1`.

**Input:** BACnet point maps, exported BMS logs, approved passive captures.

**Output:** Point mapping discrepancies, COV/event audit, integration report.

**Acceptance oracle:** BTL/PICS references, schema/point mapping, independent reviewer. **Data-risk level:** high. 

**Why it may work:** Recurring integrator pain; certification must not be claimed.

**First prototype:** a source-agnostic deterministic/standards-based validator with five positive and five negative fixtures. Add a customer-specific adapter only after source authentication and permitted-data boundaries are understood. No production write authority in the first release. Find a domain adviser/customer sponsor before handling operational data.

### 6. LTI 1.3 and OneRoster interoperability checks

**Buyer:** District IT teams, EdTech providers, SIS/LMS integrators. **Candidate offering:** `task:education-lti-oneroster.evidence/v1`.

**Input:** Sandbox tool-launch JWT and synthetic OneRoster class/user datasets.

**Output:** Conformance bundle, roster mismatches, role-scope tests.

**Acceptance oracle:** 1EdTech specs and certification diagnostics where properly licensed. **Data-risk level:** high. 

**Why it may work:** EducateOS adjacency; privacy safe pilot uses synthetic student data.

**First prototype:** a source-agnostic deterministic/standards-based validator with five positive and five negative fixtures. Add a customer-specific adapter only after source authentication and permitted-data boundaries are understood. No production write authority in the first release. Prioritize a small partner trial with synthetic fixtures and a clearly priced deliverable.

### 7. X12 850/855/856/810 transaction reconciliation

**Buyer:** Manufacturers, distributors and EDI consultants. **Candidate offering:** `task:supply-edi.evidence/v1`.

**Input:** Partner-specific purchase order, ASN and invoice EDI fixtures.

**Output:** Mismatch list, deterministic transformation, partner map tests.

**Acceptance oracle:** Versioned X12 transaction schemas, 997 functional acknowledgments and partner rules. **Data-risk level:** medium. 

**Why it may work:** Clear financial impact, repeat integrations, machine-checkable delivery.

**First prototype:** a source-agnostic deterministic/standards-based validator with five positive and five negative fixtures. Add a customer-specific adapter only after source authentication and permitted-data boundaries are understood. No production write authority in the first release. Prioritize a small partner trial with synthetic fixtures and a clearly priced deliverable.

### 8. CAN/J1939 fleet diagnostic evidence

**Buyer:** Fleet maintenance, heavy equipment OEMs. **Candidate offering:** `task:fleet-j1939.evidence/v1`.

**Input:** Vehicle CAN/J1939 trace with permitted decoder/DBC and event context.

**Output:** PGN timeline, diagnostic messages, source-address conflict evidence.

**Acceptance oracle:** SAE J1939 profiles and approved signal-decoder fixtures. **Data-risk level:** medium-high. 

**Why it may work:** Buildable with field kit; proprietary/safety-sensitive signals need human review.

**First prototype:** a source-agnostic deterministic/standards-based validator with five positive and five negative fixtures. Add a customer-specific adapter only after source authentication and permitted-data boundaries are understood. No production write authority in the first release. Find a domain adviser/customer sponsor before handling operational data.

### 9. FHIR/HL7 interface profile validation

**Buyer:** Hospitals, lab integration teams and healthcare SaaS. **Candidate offering:** `task:health-fhir.evidence/v1`.

**Input:** Synthetic/de-identified FHIR resources and Implementation Guide.

**Output:** Profile violations, mapping tests, transformation diff.

**Acceptance oracle:** HL7 official validator and test-server checks. **Data-risk level:** very high. 

**Why it may work:** Interoperability value but PHI and clinical decision limits demand strict isolation.

**First prototype:** a source-agnostic deterministic/standards-based validator with five positive and five negative fixtures. Add a customer-specific adapter only after source authentication and permitted-data boundaries are understood. No production write authority in the first release. Restrict to synthetic test fixtures and require an explicit regulated-data governance review before onboarding.

### 10. Invoice–PO–receipt reconciliation

**Buyer:** Small finance teams, bookkeepers, procurement. **Candidate offering:** `task:finance-threeway.evidence/v1`.

**Input:** Approved invoice, PO and goods-receipt records.

**Output:** Explainable discrepancies, matched line-items, exceptions awaiting approval.

**Acceptance oracle:** Deterministic arithmetic, entity resolution checks, payer signoff. **Data-risk level:** high. 

**Why it may work:** Strong return on work but supplier/payment fraud and sensitive data risk.

**First prototype:** a source-agnostic deterministic/standards-based validator with five positive and five negative fixtures. Add a customer-specific adapter only after source authentication and permitted-data boundaries are understood. No production write authority in the first release. Find a domain adviser/customer sponsor before handling operational data.

### 11. HACCP monitoring and deviation record audit

**Buyer:** Food manufacturers, commercial kitchens, quality consultants. **Candidate offering:** `task:food-haccp.evidence/v1`.

**Input:** Calibrated temperature/time logs, HACCP plan critical limits and lot IDs.

**Output:** Missing monitoring windows, threshold deviations, signed exception dossier.

**Acceptance oracle:** Recorded measurements, approved limits, device calibration and QA sign-off. **Data-risk level:** high. 

**Why it may work:** Fits KitchenOS, but agent cannot certify food safe or change critical limits.

**First prototype:** a source-agnostic deterministic/standards-based validator with five positive and five negative fixtures. Add a customer-specific adapter only after source authentication and permitted-data boundaries are understood. No production write authority in the first release. Find a domain adviser/customer sponsor before handling operational data.

### 12. WCAG accessibility evidence and issue reproduction

**Buyer:** Web teams, agencies, public institutions. **Candidate offering:** `task:accessibility-evidence.evidence/v1`.

**Input:** Authorized page snapshots, site flow, expected user tasks.

**Output:** Reproducible automated findings, screenshots, manual review queue.

**Acceptance oracle:** WCAG-EM/ACT rules + human accessibility evaluator. **Data-risk level:** medium. 

**Why it may work:** Fast to pilot, but scanners alone cannot certify WCAG conformance.

**First prototype:** a source-agnostic deterministic/standards-based validator with five positive and five negative fixtures. Add a customer-specific adapter only after source authentication and permitted-data boundaries are understood. No production write authority in the first release. Prioritize a small partner trial with synthetic fixtures and a clearly priced deliverable.


## Credible reusable work templates

Rather than multiplying completely separate AI products, AWC can standardize seven recurring *commercial job forms*:

1. **Validate:** Does an input artifact satisfy a versioned standard/profile? Return normalized failures and proof.
2. **Compare:** Did a change violate a contract or baseline? Return paired evidence and confounders.
3. **Reconcile:** Are two or three authoritative records consistent? Return exception queue for human review.
4. **Diagnose:** Which directly observable failure modes occurred, what evidence supports them, and what is still unknown?
5. **Transform:** Convert a validated dataset to a target schema, with round-trip tests and reversible input commitments.
6. **Produce:** Generate a code patch, report or model under explicit acceptance criteria and a revision allowance.
7. **Monitor:** Periodically re-run an authorized, bounded job and deliver alerts, invoices or evidence; do not silently expand data access.

Every new domain picks one or more of these generic work forms, plus a domain input vocabulary, evaluator policy and signed work receipt profile. Payment, discovery, account identities and task progress are not reimplemented in each adapter.

## Recommended initial portfolio

**First three external pilots:**

- OAuth/OIDC/MCP conformance: leverage `nathan`, Gatekeeper, the MCP broker and official identity test plans; build a deterministic report of policy/authorization mistakes, not a “secure” certification.
- GitHub CI regression/PR acceptance: leverage the existing GitHub WorkSource and direct CI evidence; sell a bounded diagnostic or reviewed patch, not unsupervised deployment.
- Industrial protocol regression: extend our real Modbus/TCP evidence pilot to a named PLC/HMI integration fixture, with a third-party reference decoder and specific buyer acceptance criteria.

**Follow-up for recurring B2B revenue:** EDI partner reconciliation, LTI/OneRoster integration tests, and BACnet commissioning evidence once a sponsor can provide lawful test fixtures and domain evaluation.

**Partner-required:** healthcare FHIR, finance payment reconciliation and HACCP monitoring should be read-only and supervised until privacy, safety, legal and specialist review requirements are resolved.

## Official grounding and noncertification caveats

- OpenID Foundation provides formal conformance testing and separately managed certification; running our own check does not make an implementation “OpenID Certified”: https://openid.net/Certification/
- 1EdTech LTI 1.3 Advantage and OneRoster are published interoperability specifications with their own conformance paths: https://www.1edtech.org/standards/lti and https://www.1edtech.org/specifications
- HL7 maintains its FHIR Validator; do not substitute free-form LLM interpretation for profile validation: https://hl7.org/fhir/validator/
- BACnet BTL certification requires independent recognized tests and published listing, not merely an agent observing point traffic: https://bacnet.org/btl-certification/
- SAE J1939 defines the heavy-duty vehicle communications family; diagnostic services and proprietary signal definitions demand constrained access: https://saemobilus.sae.org/standards/j1939_202603-serial-control-communications-heavy-duty-vehicle-network-top-level-document
- GSA references X12 850 purchase orders, 856 advance ship notices, 810 invoices and 997 acknowledgments; partner-specific implementation conventions matter: https://www.gsa.gov/buy-through-us/purchasing-programs/requisition-programs/gsa-global-supply/doing-business-with-global-supply/business-transaction-processing-requirements
- FDA HACCP principles require records, defined critical limits, corrective action, verification and qualified responsibility; automatic anomaly detection alone is not a food-safety judgment: https://www.fda.gov/food/hazard-analysis-critical-control-point-haccp/haccp-principles-application-guidelines
- W3C explicitly states that no automated tool alone determines accessibility conformance; manual evaluation remains necessary: https://www.w3.org/WAI/test-evaluate/

## Go/no-go research checklist

For each domain, interview three potential buyers or integrators; request one non-sensitive fixture and its authoritative expected result; ask how the result is verified today; learn who approves spend, where inputs can run and what revisions are normal; test if a provider would pay for a small exact deliverable. Record paid pilot conversion, manual review time, false-positive rate and refund/acceptance events before claiming a market size or offering an SLA.

**The strongest moat is not the inference wrapper.** It's an ecosystem of versioned job types, independent evaluators, trusted source/executor adapters, consumer-controlled data handling, portable evidence and commercial settlement that can be plugged into any agent orchestration stack.
