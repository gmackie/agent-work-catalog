import { Effect } from "effect";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { withX402 } from "agents/x402";
import { z } from "zod/v4";
import { MarketplaceError, type Marketplace } from "@awc/marketplace";

export const MARKETPLACE_APP_URI = "ui://awc/marketplace.html";

export interface PaidSandboxConfig {
  readonly network: "base-sepolia";
  readonly recipient: `0x${string}`;
  readonly facilitatorUrl: string;
}
export interface McpServerConfig {
  readonly marketplace: Marketplace;
  readonly buyerId: string | null;
  /** Bundled, self-contained HTML built by @awc/mcp-ui. */
  readonly appHtml: string;
  /** Testnet-only. Never enable a paid tool by default. */
  readonly paidSandbox?: PaidSandboxConfig;
}

const response = (value: Record<string, unknown>, message: string) => ({
  content: [{ type: "text" as const, text: message }],
  structuredContent: value,
});
const failure = (error: unknown) => {
  const known = error instanceof MarketplaceError ? error :
    new MarketplaceError("unavailable", "Operation failed");
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: known.code + ": " + known.message }],
  };
};
const guarded = async <T extends object>(
  effect: Effect.Effect<T, MarketplaceError>,
  summary: (value: T) => string,
) => {
  try {
    const value = await Effect.runPromise(effect);
    return response(value as Record<string, unknown>, summary(value));
  } catch (error) {
    return failure(error);
  }
};
const unauthenticated = () => ({
  isError: true as const,
  content: [{ type: "text" as const, text: "unauthorized: Configure an authorized buyer connection before requesting private work" }],
});

/**
 * Creates a fresh MCP SDK v2 server per transport request.
 * This is a control plane; it NEVER executes paid work or authorizes real funding.
 */
export function createCatalogMcpServer(config: McpServerConfig): McpServer {
  const server = new McpServer({ name: "Agent Work Catalog", version: "0.1.0" });

  const searchSchema = z.object({
    intent: z.string().min(3).max(2000),
    currency: z.string().max(10).optional(),
    maxPriceMinor: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
    inputMediaType: z.string().max(120).optional(),
    outputMediaType: z.string().max(120).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }).strict();

  registerAppTool(server, "catalog.search", {
    description: "Find purchasable types of work by outcome. Demo catalog, NOT live verified providers.",
    inputSchema: searchSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    _meta: { ui: { resourceUri: MARKETPLACE_APP_URI } },
  }, async (args) => guarded(config.marketplace.search(args), (value) =>
    "Found " + (Array.isArray(value.matches) ? value.matches.length : 0) + " illustrative offerings. No payment required."));

  server.registerTool("catalog.get_offering", {
    description: "Read a versioned offering and its canonical task type. Listings are sample data.",
    inputSchema: z.object({ offeringId: z.string().min(3).max(180) }).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async ({ offeringId }) => guarded(config.marketplace.getOffering(offeringId), (value) =>
    "Offering: " + ((value.offering as { title?: string }).title ?? offeringId)));

  // App UI resource is available to all clients; host renders only when MCP Apps is supported.
  registerAppResource(server, "AWC Marketplace Explorer", MARKETPLACE_APP_URI, {
    description: "Interactive offering explorer; optional for non-MCP Apps hosts.",
    mimeType: RESOURCE_MIME_TYPE,
  }, async () => ({
    contents: [{
      uri: MARKETPLACE_APP_URI, mimeType: RESOURCE_MIME_TYPE,
      text: config.appHtml || "<!doctype html><html><body>Build the Marketplace Explorer App first.</body></html>",
    }],
  }));

  server.registerResource("AWC public catalog", "awc://catalog/manifest", {
    title: "AWC Catalog Manifest", description: "Public demo catalog metadata", mimeType: "application/json",
  }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({
      schemaVersion: "awc-catalog/v0.1", catalog: "seeded-demo-only",
      discovery: "catalog.search", protectedWork: "bearer-authenticated-sandbox",
    }) }],
  }));

  server.registerResource("Versioned offering", new ResourceTemplate("awc://offerings/{slug}/{version}", {
    list: undefined,
  }), { description: "Public offering and matching task type", mimeType: "application/json" },
  async (uri, variables) => {
    const slug = String(variables.slug);
    const result = await Effect.runPromise(config.marketplace.getOffering("offering:" + slug));
    if (String(variables.version) !== result.offering.version) throw new Error("Offering version not found");
    return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(result) }] };
  });

  // Only an authenticated principal can see private work tools and resource templates.
  // This is a single-buyer sandbox key, NOT a substitute for OAuth in multi-tenant deployment.
  if (config.buyerId) {
    const buyerId = config.buyerId;

    server.registerTool("quotes.request", {
      description: "Request an exact fixed-price quote for an illustrative offering; no charge.",
      inputSchema: z.object({
        offeringId: z.string().min(3).max(180),
        scope: z.string().min(8).max(2000),
        idempotencyKey: z.string().min(8).max(100),
        maxPriceMinor: z.string().regex(/^(0|[1-9][0-9]*)$/).optional(),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    }, async (args) => guarded(config.marketplace.requestQuote(buyerId, args), (value) =>
      "Quote " + value.id + " proposed only; no payment has occurred."));

    server.registerTool("work.prepare", {
      description: "Prepare an UNFUNDED commercial work order from a quote. Does not hire, execute or charge.",
      inputSchema: z.object({
        quoteId: z.string().min(3).max(150),
        idempotencyKey: z.string().min(8).max(100),
        inputs: z.array(z.object({
          name: z.string().min(1).max(100),
          mediaType: z.string().min(3).max(120),
          kind: z.enum(["inline", "reference"]),
          data: z.unknown().optional(),
          reference: z.string().optional(),
          sha256: z.string().optional(),
        }).strict()).min(1).max(10),
      }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    }, async (args) => guarded(config.marketplace.prepareWork(buyerId, {
      quoteId: args.quoteId,
      idempotencyKey: args.idempotencyKey,
      inputs: args.inputs.map((input) => ({
        name: input.name, mediaType: input.mediaType, kind: input.kind,
        ...(input.data !== undefined ? { data: input.data } : {}),
        ...(input.reference !== undefined ? { reference: input.reference } : {}),
        ...(input.sha256 !== undefined ? { sha256: input.sha256 } : {}),
      })),
    }), (value) =>
      "Work order " + value.id + " is PREPARED, UNFUNDED. No executor has been started."));

    server.registerTool("work.get", {
      description: "Read this authorized buyer's prepared commercial work order, not an MCP Task.",
      inputSchema: z.object({ workId: z.string().min(3).max(160) }).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    }, async ({ workId }) => guarded(config.marketplace.getWork(buyerId, workId), (value) =>
      "Work order " + value.id + " state: " + value.state));

    server.registerTool("billing.options", {
      description: "Inspect the sandbox's payment capabilities. This server does NOT process real funding.",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    }, async () => response({
      mode: "sandbox_only", stripeEnabled: false, directX402Enabled: false,
      creditAccountsEnabled: false, canStartWork: false,
      message: "Payment and execution are intentionally disabled in this vertical slice.",
    }, "No live payment rail configured; work orders remain unfunded."));

    server.registerResource("Private work order", new ResourceTemplate("awc://work-orders/{workId}", {
      list: undefined,
    }), { description: "Buyer-private prepared work order", mimeType: "application/json" },
    async (uri, variables) => {
      const result = await Effect.runPromise(config.marketplace.getWork(buyerId, String(variables.workId)));
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(result) }] };
    });
  }

  // Separately enabled testnet paid operation. Its result is deterministic, not LLM inference.
  if (config.paidSandbox) {
    const paid = withX402(server, {
      network: config.paidSandbox.network,
      recipient: config.paidSandbox.recipient,
      facilitator: { url: config.paidSandbox.facilitatorUrl },
    });
    paid.paidTool(
      "sandbox.paid_text_stats",
      "TESTNET-ONLY $0.01 deterministic word/character analysis. Not a completed gig.",
      0.01,
      { text: z.string().min(1).max(500) },
      { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      async ({ text }) => response({
        characters: text.length, words: text.trim().split(/\s+/).length, mode: "base-sepolia-testnet",
      }, "Word and character counts returned after the testnet payment check."),
    );
  }

  return server;
}
