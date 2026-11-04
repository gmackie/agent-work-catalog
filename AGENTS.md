# Working agreement

This is an open Effect 4 monorepo defining machine-readable work contracts and independent adapter ports.

- Keep domain contracts and task semantics independent of Poppy, x402, Stripe and execution frameworks.
- Use Effect 4 Context.Service, Layer, Schema and typed errors. No Effect 3 imports or runtime APIs.
- A WorkProvider is the *source of an assignment*, not the executor. A Worker executes validated assignments. Billing and receipts are separate ports.
- Treat inbound provider data and worker outputs as untrusted. Verify signatures and authorization before effects or payments. Never fetch arbitrary user-provided URLs.
- All money is integer minor units, currency explicit, and external payment evidence independently verified. No production payments in demos.
- Persist the result before publishing to a provider. External delivery must be idempotent and recoverable from an outbox.
- Do not claim exactly-once external execution; use stable execution IDs, leases and reconciliation.
- Keep Attest receipt claims separate from actual payment evidence; no unreviewed production ZK or token writes.
- Write negative tests for schema swaps, duplicates, incorrect funding, callback failures, and task-type mismatches.

## Delegated responsibility and operating safety

- OperatingMandate objectives are **not** additional permission. Never grant capabilities based on a performance target or LLM plan alone.
- All actions must be tied to a trusted mandate chain, principal, accountable party, independent asset-owner grant, current state/version and scoped authorization.
- Parent and sibling delegates share one economic allowance. Funds are checked separately from budgets. Resource reservations must account for future liabilities and wind-down.
- Generic physical control, safety-function changes, raw PLC/OT writes and hazardous equipment actions are **out of scope** for AWC's default adapters. Simulators only. No live resource provisioning or unattended plant actuation in this repository.
- Mandates and observations supplied in MCP arguments are untrusted; trust sources must be configured by the server, not by user-provided metadata.
- No public deployment may use `makeSimulatedEconomicLedger` to represent actual payment funding or `ActionReceipt.simulation` as evidence of production execution.
- Revocation blocks new authority. Cleanup, existing liabilities and handing over ongoing operational responsibility require explicit reconciliation.

## Standards-first interop

- Do not introduce proprietary replacement protocols for ODRL, AuthZEN, OAuth, CloudEvents, PROV-O, OpenSLO, OSB or UBL when a supported normative mapping exists.
- Keep importing ODRL and other external documents **non-authoritative** until issuer, signature, profile, tenant and exact constraints are verified independently.
- AuthZEN's boolean allow means unconditional permission **only**. AWC conditional approvals and spending reservations belong to a separate commit-time service.
- COAZ-MCP is a working draft: unknown tools and unsupported CEL mappings must fail closed; tool annotations and server-provided schemas aren't authorization.
- Never treat an OSB provisioning preview or UBL purchase order as a charge, held escrow, deployed resource or verified delivery.
- Never present CloudEvents/PROV-O projections as signed evidence. Attest/VC verification is independent.
