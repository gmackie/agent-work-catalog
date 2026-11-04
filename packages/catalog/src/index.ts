import { Schema } from "effect";
import { Offering, TaskType, WorkError, type WorkOrder } from "@awc/contracts";

/** Catalogs are supplier claims: validation does not prove competence or safe execution. */
export const decodeTaskType = Schema.decodeUnknownSync(TaskType);
export const decodeOffering = Schema.decodeUnknownSync(Offering);

/** A deterministic eligibility pass follows semantic candidate retrieval. */
export function isEligible(offering: Offering, task: TaskType, order: WorkOrder): boolean {
  if (offering.taskTypeId !== task.id || order.taskTypeId !== task.id ||
      offering.id !== order.offeringId) return false;
  if (!order.allowedEffects.every((effect) => task.permittedEffects.includes(effect))) return false;
  if (!order.inputs.every((input) => task.inputMediaTypes.includes(input.mediaType))) return false;
  if (offering.pricing.mode === "fixed" && offering.pricing.fixedAmount !== undefined) {
    if (offering.pricing.fixedAmount.currency.toUpperCase() !== order.budget.currency.toUpperCase()) return false;
    if (BigInt(offering.pricing.fixedAmount.minorUnits) > BigInt(order.budget.minorUnits)) return false;
  }
  return true;
}
export function requireEligible(offering: Offering, task: TaskType, order: WorkOrder): void {
  if (!isEligible(offering, task, order)) {
    throw new WorkError("unauthorized", "Offering does not meet task, effect, input or budget constraints");
  }
}
