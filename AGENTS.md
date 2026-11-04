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
