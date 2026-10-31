# MCP Apps product flows — v0.1 (design-only)

## The principle

Apps improve the buyer/seller experience but must remain **optional**. Never hide necessary semantics, approval requirements or output data in the UI alone. A plain MCP client must be able to perform search, compare, quote, get work, and verify receipts using structured tool results.

## A. Search explorer

Launch from `catalog.search` at `ui://awc/marketplace.html`. Left: task intent & semantic filters. Right: offerings, stated vs verified capabilities, output schema compatibility, budget estimate, available payment rails. Tool output uses bounded record fields, not raw external HTML. A click selecting two offerings calls a UI-allowed comparison tool; it does NOT auto purchase.

## B. Quote comparison

Launch from `catalog.compare` at `ui://awc/compare.html`. Compare the same buyer requirement against price, latency, compatibility, accepted input types, disclosure policy, effect permissions, revision policy, historical Attest proof availability and independent checks. Show hard mismatches distinctly from mere ranking heuristics. Preflight displays an exact contract revision/digest to prepare.

## C. Agreement and approval

Launch from `work.prepare` at `ui://awc/contract.html`. Display buyer and selling provider, total maximum commitment, payment recipient / network or Stripe merchant, permitted data access, ability to subcontract, delivery target, acceptance criteria, cancellation/refund terms. Approval generates an authorized intent in the trusted account context; no wallet private key in iframe. If payment is through hosted Stripe Checkout, open the approved checkout link through the host; callback/payment verification occurs server side. For x402, host's approved payment adapter signs; app cannot synthesize proof.

## D. Workboard

Launch from `work.get` at `ui://awc/workboard.html`. Show commercial/financial/execution states separately, task-level progress, estimated budget remaining, artifact descriptors and safe previews, revision requests, evaluator status, consented delivery to other agents. Poll via `ui.refresh_workboard` or opt into `subscriptions/listen` when supported. MCP Task handles (if any) appear as execution handles, not the commercial work ID.

## E. Receipts

Launch from `receipts.verify` at `ui://awc/receipts.html`. Each credential has a different issuer and evidence basis: contract, delivery, evaluation, buyer acceptance and actual settlement. Explain unsupported or stale claims. Signed claim != truth; x402 settled != deliverable accepted. Show minimal private disclosure, provider pseudonym where warranted, and review any issuer or registry trust settings.

## F. Seller studio

Launch from `provider.publish_offering` at `ui://awc/provider.html`. Guided schema authoring, output formats, supported TaskTypes, accepted policies, prices / rails, Poppy/OpenAPI/A2A/MCP discovery links, test invocation, receipts issuing authority. Not part of model-visible default tool set; provider admin scope required.

## Security / host API

- `_meta.ui.resourceUri` links tool and view; `text/html;profile=mcp-app` resource must exist.
- UI tools can be `_meta.ui.visibility:["app"]`, but even app-only tools require server authorization and policy enforcement. Do not expose secrets, signed purchase tokens, or raw private artifacts to the model or iframe.
- Host support is not universal; maintain predictable `structuredContent` and text alternatives.
- Do not depend on third-party iframe origins. Version and audit static bundles; CSP and sandbox restrictions apply.
- UI renders contracts received through trusted MCP calls, not unchecked provider markup or HTML.
- Payment confirmation goes through trusted verifier and work service regardless of UI event.
