import { Effect } from "effect";
import { AdapterError, validateExecutionRequest, validateExecutionSnapshot, type WorkExecutor, type ExecutionRequest, type ExecutionHandle } from "./index.ts";

/** Fixture runner for third-party executor implementations; safe with deterministic test providers only. */
export async function probeExecutor(executor: WorkExecutor, fixture: ExecutionRequest) {
  const input = validateExecutionRequest(fixture);
  if (!executor.manifest.roles.includes("work-executor")) throw new AdapterError("invalid_input", "Executor must advertise its role");
  if (!executor.manifest.supportedTaskTypes.includes(input.taskTypeId)) {
    throw new AdapterError("unsupported", "Executor does not declare the task type");
  }
  const first = await Effect.runPromise(executor.start(input));
  const replay = await Effect.runPromise(executor.start(input));
  if (first.executionId !== input.executionId ||
      replay.executionId !== first.executionId ||
      replay.providerExecutionId !== first.providerExecutionId) {
    throw new AdapterError("conflict", "Executor start is not idempotent");
  }
  const recovered = await Effect.runPromise(executor.recover(input));
  if (!recovered || recovered.providerExecutionId !== first.providerExecutionId) {
    throw new AdapterError("conflict", "Executor cannot recover a previously accepted request");
  }
  const snapshot = await Effect.runPromise(executor.inspect(first));
  validateExecutionSnapshot(snapshot, input);
  return { handle: first, snapshot };
}

/** Strict handle comparison to reject caller-supplied switches to another execution. */
export function assertExecutionHandle(handle: ExecutionHandle, expected: ExecutionHandle): void {
  if (handle.executionId !== expected.executionId ||
      handle.providerExecutionId !== expected.providerExecutionId) {
    throw new AdapterError("unauthorized", "Execution handle mismatch");
  }
}
