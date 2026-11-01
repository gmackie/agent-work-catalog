import { describe,expect,it } from "vitest";
import { Effect } from "effect";
import { runScenario,SCENARIOS } from "../src/index.ts";
describe("cross-domain operations simulations",()=>{
 it("runs every defined scenario with deterministic policy and no real effects",async()=>{
  for(const scenario of SCENARIOS){
   const report=await Effect.runPromise(runScenario(scenario.id));
   expect(report.mode).toBe("strictly-simulated");
   expect(report.scenario).toBe(scenario.id);
   expect(report.events.every(x=>x.outcome==="simulated")).toBe(true);
   expect(report.note).toContain("NO real");
  }
 });
 it("vending creates a replenishment work request rather than dispensing inventory",async()=>{
  const r=await Effect.runPromise(runScenario("vending"));
  expect(r.attemptedActions[0]?.status).toBe("simulated");
  expect(r.after.restockOrders).toBe(1);
  expect(r.after.stockRemaining).toBe(2);
  expect(r.account.spentMinor).toBe("1800");
 });
 it("cloud allocates synthetic capacity without new external API credentials",async()=>{
  const r=await Effect.runPromise(runScenario("cloud"));
  expect(r.after.reservedComputeUnits).toBe(1);
  expect(r.account.spentMinor).toBe("3500");
 });
 it("plant performs safe coordination, escalates schedule and denies unsafe PLC write",async()=>{
  const r=await Effect.runPromise(runScenario("plant"));
  expect(r.after.maintenanceTickets).toBe(1);
  expect(r.after.scheduleProposals).toBeUndefined();
  expect(r.attemptedActions.map(x=>x.status)).toEqual(["simulated","escalated","denied"]);
  expect(r.account.spentMinor).toBe("0");
  expect(r.obligations[0]?.status).toBe("breached");
 });
});
