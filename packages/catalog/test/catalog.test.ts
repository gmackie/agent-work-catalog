import { describe, expect, it } from "vitest";
import { isEligible } from "../src/index.ts";
import type { Offering, TaskType, WorkOrder } from "@awc/contracts";

const task: TaskType = {
  id: "task:report", version: "1", name: "Report", description: "Write a report",
  inputMediaTypes: ["text/plain"], outputMediaTypes: ["application/json"], permittedEffects: [],
};
const offering: Offering = {
  id: "offer:report", version: "1", providerId: "provider:one", taskTypeId: task.id,
  title: "Report", description: "A report", pricing: { mode: "fixed", fixedAmount: { currency: "USD", minorUnits: "3500" } },
  execution: [{ protocol: "openai-responses", endpoint: "https://provider.example/v1/responses" }],
};
const order: WorkOrder = {
  schemaVersion: "1", id: "order:1", sourceId: "source:a", sourceWorkId: "external:1",
  taskTypeId: task.id, offeringId: offering.id, inputs: [{ name: "brief", mediaType: "text/plain", kind: "inline", data: "hello" }],
  funding: { kind: "demo", reference: "sandbox" }, budget: { currency: "USD", minorUnits: "4000" },
  dataClassification: "public", allowedEffects: [],
};
describe("offering eligibility", () => {
  it("matches compatible bounded work", () => expect(isEligible(offering, task, order)).toBe(true));
  it("rejects over-budget quotes", () => expect(isEligible(offering, task, { ...order, budget: { currency: "USD", minorUnits: "1000" } })).toBe(false));
  it("rejects unpermitted effects", () => expect(isEligible(offering, task, { ...order, allowedEffects: ["deploy"] })).toBe(false));
  it("rejects incompatible inputs", () => expect(isEligible(offering, task, { ...order, inputs: [{ name: "file", mediaType: "application/zip", kind: "inline", data: {} }] })).toBe(false));
});
