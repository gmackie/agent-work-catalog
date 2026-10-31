import { describe,expect,it } from "vitest";
import { identifyActor, requireScope } from "../src/index.ts";

const config={sandboxBuyerToken:"sandbox-buyer-token-never-publish-1234567890",
  sandboxHumanToken:"sandbox-human-token-never-publish-123456789"};
describe("Role-separated credential boundary",()=>{
  it("never accepts an agent's token as human approval",async()=>{
    const agent=await identifyActor("Bearer "+config.sandboxBuyerToken,"mcp",config,true);
    expect(agent?.kind).toBe("agent");
    expect(await identifyActor("Bearer "+config.sandboxBuyerToken,"human",config,true)).toBeNull();
    expect(()=>requireScope(agent??null,"work:approve")).toThrow();
  });
  it("requires a completely separate human credential in local sandbox",async()=>{
    const human=await identifyActor("Bearer "+config.sandboxHumanToken,"human",config,true);
    expect(human?.ceremony).toBe("local-sandbox-only");
    expect(await identifyActor("Bearer "+config.sandboxHumanToken,"mcp",config,true)).toBeNull();
    expect(()=>requireScope(human??null,"work:approve")).not.toThrow();
  });
  it("fails closed for short or absent sandbox secrets",async()=>{
    expect(await identifyActor("Bearer a-short-secret","human",{sandboxHumanToken:"a-short-secret"},true)).toBeNull();
    expect(await identifyActor(null,"mcp",config,true)).toBeNull();
  });
});
