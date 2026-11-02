import { runStandardsScenario } from "@awc/standards-demo";
import { SCENARIOS } from "@awc/simulations";
async function main(){
 for(const s of SCENARIOS){
  const r=await runStandardsScenario(s.id);
  process.stdout.write(JSON.stringify({
   scenario:r.scenario,mode:r.mode,
   odrlPermissions:r.odrl.permission.length,
   odrlProhibitions:r.odrl.prohibition.length,
   authzenDecisions:r.authzen.map(x=>x.output.decision),
   cloudevents:r.cloudevents.map(e=>e.type),
   provenanceGraphs:r.provenance.length,
   opensloDocuments:r.openslo.map(x=>x.kind),
   resourceProvisioned:false,osbPreviewOnly:!!r.osbProvisionPreview,
   ublOrderExampleOnly:!!r.ublExampleOrderXml,
  })+"\n");
 }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
