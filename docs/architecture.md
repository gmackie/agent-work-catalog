# Architecture and trust boundaries

## Vocabulary

- **TaskType**: stable definition of an outcome, inputs, outputs and permitted effects.
- **Offering**: commercial packaging by a provider (price and invocation transports).
- **WorkOrder**: an immutable buyer/provider agreement for a concrete assignment; NOT an MCP Task or A2A Task.
- **WorkProvider**: upstream source of incoming work (our market, another marketplace, enterprise ticketing or partner webhook), responsible for translating the source format and returning deliverables.
- **Worker**: execution target (LLM, tool, A2A agent, human-supervised job or deterministic service), receives normalized inputs and returns structured results.
- **PaymentGate**: independently checks actual funding / money ceilings before execution, never trusts a work-source declaration.
- **WorkRepository**: state transitions, leases, result persistence and outbound event/outbox.
- **Attest receipt profile**: independently issued provenance and outcome claims; separate from payment authorization.

## Sequence

1. An administrator configures WorkProvider credentials and fixed callback destinations.
2. Authenticated incoming work is parsed into a v1 WorkOrder. Only a broker-controlled catalog/policy may bind an offering to an execution route.
3. Broker deduplicates (source ID, external work ID), checks budget/effects/data classification and confirms funding with the relevant payment provider.
4. Broker claims a durable execution lease and dispatches to the configured Worker. **Never infer authorization from worker prompt text.**
5. Worker returns a WorkResult: outputs are structured, with content-addressed artifact references for large results. Broker validates it.
6. Broker persists the result and a delivery-outbox entry before notifying WorkProvider.
7. WorkProvider idempotently acknowledges delivery, with a stable idempotency key; retrying the callback never re-runs inference.
8. Acceptance, disputes, settlement and Attest credentials are handled by separate services and event streams.

## Status of this scaffold

The current in-memory WorkRepository is intentionally NOT a production queue. It has no durable claim leases, DB transactions, retry fencing, cross-process consistency or outbox sweeper. The initial processIncomingWork function executes one bounded worker call.

Production on Cloudflare should use a Durable Object or SQL transaction per WorkOrder for CAS/lease fencing, a durable outbox, Workflows/Queues for long-lived execution, R2 for artifacts, and a coordinator/reconciler for uncertain worker outcomes.

The catalog and worker route must be independently authorized. The current worker routing maps taskTypeId to a configured executor, and the incoming offeringId is NOT yet verified against a trusted offering registry. Do not permit paid execution until that integration exists.

## First integration surface

All execution adapters implement the same Effect port:

```ts
interface Worker {
  id: string
  taskTypeIds: readonly string[]
  execute(order: WorkOrder): Effect.Effect<WorkResult, WorkError>
}
```

The interface is deliberately transport-independent. A future worker session can expose `start`, `poll`, `cancel`, `progress` and `artifact` handles without changing the WorkOrder meaning.

Similarly, WorkProvider.ingest() and publish() are inverse transformations across an upstream provider's transport, and should never be confused with an AI inference provider.

## Integration roadmap

- Durable WorkOrder aggregate, transactional outbox, distributed execution leases and cancellation.
- Trusted Offering registry with task, input/output, cost, effects, data classification and provider routing checks.
- Artifact storage API with verified digest, ACL, MIME type, expiration and non-SSRF retrieval.
- Remote worker adapters for full OpenAI Responses background tasks, MCP Tasks and A2A.
- Provider adapters for signed HTTP API, GitHub issues/PRs, external commercial platforms, and reusable marketplace broker.
- Identity/mandates, Attest receipt SDK, x402 verifiers, Stripe Connect where payout to third-party sellers is required.
