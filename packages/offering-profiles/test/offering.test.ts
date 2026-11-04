import {describe,expect,it} from "vitest";
import {tcpServiceProfiles,executableTcpPilot} from "../src/index.ts";
describe("commercial work profiles",()=>{
  it("keeps unbuilt offerings non-purchasable and all categories versioned",()=>{
    expect(tcpServiceProfiles).toHaveLength(9);
    expect(new Set(tcpServiceProfiles.map(x=>x.id)).size).toBe(tcpServiceProfiles.length);
    expect(tcpServiceProfiles.every(x=>x.requiredEvidence.length>0&&x.disallowedClaims.length>0)).toBe(true);
    expect(executableTcpPilot("tcp.packet-evidence.v1")?.readiness).toBe("pilot-test-only");
    expect(executableTcpPilot("tcp.enterprise-incident.v1")).toBeNull();
    expect(tcpServiceProfiles.filter(x=>x.readiness==="pilot-test-only")).toHaveLength(2);
  });
});
