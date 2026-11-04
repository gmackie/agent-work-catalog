import { Effect } from "effect";
import { SCENARIOS,runScenario } from "@awc/simulations";
async function main(){
 for(const scenario of SCENARIOS){
  const result=await Effect.runPromise(runScenario(scenario.id));
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
