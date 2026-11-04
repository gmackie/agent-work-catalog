# AWC Worker Interface — draft 0.1

The contract is independent of OpenAI Responses, MCP Tasks, A2A Task objects and Cloudflare Workflows.

## Inbound

A Worker receives one validated `WorkOrder` containing:

- opaque IDs for source, source work, offering and canonical TaskType;
- named `WorkInput` elements: inline JSON or content-addressed `artifact:` references;
- monetary ceiling in **integer minor units** plus currency;
- data classification, permitted external effects, optional deadline;
- a funding reference whose authenticity has already been checked outside the Worker.

WorkProvider obtains and normalizes external work. It must not choose a privileged Worker merely by setting a free-text model field; trusted broker routing chooses the executor.

## Outbound

Worker returns `WorkResult` with the exact `orderId`, summary, timestamp, artifact descriptors, and optional executionRef. Each artifact is inline data or an opaque authenticated reference. The broker must verify the result matches the order, then persist it prior to publishing upstream.

A Worker can fail with typed WorkError; it cannot claim a payment was successful or grant its own spending authority.

## Subsequent async revision

For long-running tasks, add:
- `start(order): Effect<ExecutionHandle>`, with stable idempotency key;
- `poll(handle): Effect<ExecutionSnapshot>`;
- `cancel(handle): Effect<CancelResult>`;
- progress and partial artifact event envelopes;
- terminal result and recoverable failure, each bound to contract revision;
- explicit uncertainty states for lost external replies, not blind restarts.

The WorkOrder remains the *commercial* contract, even if execution uses MCP Tasks/A2A internally.

## Attack surface

No arbitrary remote URL fetches; artifact resolvers must enforce tenant, content hash, MIME and size. Untrusted document/prompt text cannot increase OAuth scopes, payout amounts or allowed effects. Outputs are untrusted and require schema/format and eventual policy verification.

For confidential work, provider-to-worker disclosures and third-party model retention must be independently authorized.
