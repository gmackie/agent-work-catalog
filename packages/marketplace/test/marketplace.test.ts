import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { makeMarketplace, inMemoryMarketplaceStore } from "../src/index.ts";

const id = (suffix: string) => "idempotency_" + suffix;
describe("marketplace vertical slice", () => {
  it("ranks and filters explicitly fictional offerings by price and media type", async () => {
    const service = makeMarketplace(inMemoryMarketplaceStore());
    const r = await Effect.runPromise(service.search({ intent: "OAuth security review", maxPriceMinor: "10000", inputMediaType: "text/plain" }));
    expect(r.catalog).toBe("seeded-demo-only");
    expect(r.matches[0]?.offering.id).toBe("offering:oauth-audit");
    expect(r.matches.every((m) => m.offering.pricing.fixedAmount ? Number(m.offering.pricing.fixedAmount.minorUnits) <= 10000 : true)).toBe(true);
    const cheap = await Effect.runPromise(service.search({intent: "OAuth security review", maxPriceMinor:"1000"}));
    expect(cheap.matches).toHaveLength(0);
  });

  it("creates an immutable fixed-price quote and a prepared UNFUNDED order", async () => {
    const service = makeMarketplace(inMemoryMarketplaceStore(), () => Date.parse("2026-10-31T14:00:00Z"));
    const request = { offeringId: "offering:oauth-audit", scope: "Review OAuth scopes and DPoP handling", idempotencyKey: id("quote") };
    const quote = await Effect.runPromise(service.requestQuote("buyerA", request));
    const replay = await Effect.runPromise(service.requestQuote("buyerA", request));
    expect(replay.id).toBe(quote.id);
    expect(quote.price.minorUnits).toBe("9000");
    expect(quote.termsDigest).toMatch(/^[0-9a-f]{64}$/);
    await expect(Effect.runPromise(service.requestQuote("buyerA", { ...request, scope: "Different work" }))).rejects.toThrow();

    const inputs = [{ name: "requirements", mediaType: "text/plain", kind: "inline" as const, data: "Review the login implementation" }];
    const order = await Effect.runPromise(service.prepareWork("buyerA", { quoteId: quote.id, inputs, idempotencyKey:id("work") }));
    const again = await Effect.runPromise(service.prepareWork("buyerA", { quoteId: quote.id, inputs, idempotencyKey:id("work") }));
    expect(order.id).toBe(again.id);
    expect(order.state).toBe("prepared_unfunded");
    expect(order.funding.status).toBe("not_authorized");
    expect((await Effect.runPromise(service.getWork("buyerA", order.id))).id).toBe(order.id);
    await expect(Effect.runPromise(service.getWork("buyerB", order.id))).rejects.toThrow();
    await expect(Effect.runPromise(service.prepareWork("buyerA", {quoteId:quote.id,inputs:[{...inputs[0]!,data:"swapped"}],idempotencyKey:id("work")}))).rejects.toThrow();
  });
  it("rejects incompatible inputs and unsupported metered quotes", async () => {
    const service = makeMarketplace(inMemoryMarketplaceStore());
    await expect(Effect.runPromise(service.requestQuote("buyerA", {
      offeringId: "offering:expert-inference", scope:"Ask about Modbus", idempotencyKey: id("metered"),
    }))).rejects.toThrow();
    const quote = await Effect.runPromise(service.requestQuote("buyerA", {
      offeringId:"offering:modbus-report",scope:"Diagnose HMI polling problems",idempotencyKey:id("modbus"),
    }));
    await expect(Effect.runPromise(service.prepareWork("buyerA", {
      quoteId:quote.id,idempotencyKey:id("badwork"),
      inputs:[{name:"pcap",mediaType:"application/zip",kind:"reference",reference:"artifact:abc"}],
    }))).rejects.toThrow();
  });
});
