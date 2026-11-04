import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { registryLayer, AdapterError, validateDelivery, validateExecutionRequest, type WorkExecutor, type ExecutionRequest, type ExecutionHandle } from "../src/index.ts";
import { probeExecutor } from "../src/conformance.ts";
const fixture: ExecutionRequest = {
  schemaVersion:"awc.execution/v1",executionId:"exec-1",attemptId:"try-1",
  idempotencyKey:"exec-1:accepted",workOrderId:"work-1",contractDigest:"a".repeat(64),
  taskTypeId:"task:sample",offeringId:"offering:sample",
  inputs:[{kind:"inline",name:"brief",mediaType:"text/plain",data:"Hello world"}],
  requiredOutputs:[{role:"result",mediaType:"text/plain"}],
  constraints:{maxCost:{currency:"USD",minorUnits:"100"},allowedEffects:[],dataClassification:"public",maxDurationSeconds:120},
};
function worker():WorkExecutor {
  const handle:ExecutionHandle={executionId:fixture.executionId,providerExecutionId:"remote-123",status:"completed"};
  return {manifest:{schemaVersion:"awc.adapter/v1",id:"example.worker",version:"1.0.0",
    displayName:"Example Worker",roles:["work-executor"],transport:"in-process-effect",
    supportedTaskTypes:["task:sample"],capabilities:["recover","cancel"]},
    start:()=>Effect.succeed(handle),recover:()=>Effect.succeed(handle),
    inspect:()=>Effect.succeed({handle,status:"completed",updatedAt:new Date().toISOString(),
      result:{orderId:fixture.workOrderId,summary:"Done",producedAt:new Date().toISOString(),artifacts:[]}}),
    cancel:()=>Effect.succeed({handle,status:"already_terminal"})};
}
describe("Adapter SDK contracts",()=>{
  it("probes idempotent start and recovery across the common interface",async()=>{
    const result=await probeExecutor(worker(),fixture);
    expect(result.snapshot.result?.orderId).toBe("work-1");
  });
  it("fails closed on mismatched contract and illegal artifact references",()=>{
    expect(()=>validateExecutionRequest({...fixture,contractDigest:"a"})).toThrow();
    expect(()=>validateExecutionRequest({...fixture,inputs:[{kind:"reference",name:"x",mediaType:"text/plain",reference:"http://example.com"}]})).toThrow();
    expect(()=>validateDelivery({workOrderId:"wrong",contractDigest:"b".repeat(64),idempotencyKey:"demo",
      result:{orderId:"work-1",summary:"Done",producedAt:"2026-10-31T18:00:00Z",artifacts:[]}})).toThrow();
  });
  it("rejects ambiguous duplicate adapter identities",()=>{
    expect(()=>registryLayer([], [worker(),worker()])).toThrow(AdapterError);
  });
});
