import {describe,expect,it} from "vitest";
import family from "../../../specs/tcp-offering-family-v1.json";
import domains from "../../../specs/agent-opportunity-map-v1.json";

describe("Versioned AWC marketplace opportunity taxonomy",()=>{
  it("has nine distinct TCP/OT offerings and explicitly bounded deliverables",()=>{
    expect(family.schemaVersion).toBe("awc.tcp-offering-family/v1");
    expect(family.offerings).toHaveLength(9);
    expect(new Set(family.offerings.map(o=>o.id)).size).toBe(9);
    for(const offer of family.offerings){
      expect(offer.input.length).toBeGreaterThan(0);
      expect(offer.output.length).toBeGreaterThan(0);
      expect(offer.verifier.length).toBeGreaterThan(25);
      expect(offer.exclusions.length).toBeGreaterThan(0);
      expect(offer.testPriceUSD).toBeTruthy();
    }
    expect(family.priceDisclaimer).toContain("hypotheses");
    expect(family.offerings.find(o=>o.id==="offering:tcp-flow-evidence")?.stage)
      .toBe("implemented-test-only");
  });
  it("tracks twelve additional domains as unimplemented and tied to evaluation oracles",()=>{
    expect(domains.domains).toHaveLength(12);
    expect(new Set(domains.domains.map(d=>d.id)).size).toBe(12);
    for(const domain of domains.domains){
      expect(domain.implementation).toContain("proposed");
      expect(domain.deliverable.length).toBeGreaterThan(15);
      expect(domain.verificationOracle.length).toBeGreaterThan(15);
      expect(domain.priorityTier).toBeGreaterThanOrEqual(1);
      expect(domain.priorityTier).toBeLessThanOrEqual(3);
    }
    expect(domains.rankingNote).toContain("not empirical");
  });
});
