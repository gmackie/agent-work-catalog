import {readFile,mkdir,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {analyzeTcpPcap} from "../src/index.ts";
if(!process.argv[2])throw Error("Pass corpus path");
const root=resolve(process.argv[2]);
const manifest=JSON.parse(await readFile(resolve(root,"manifest.json"),"utf8")) as {cases:Array<{name:string;file:string}>};
await mkdir(resolve(root,"reports"),{recursive:true});
for(const item of manifest.cases){
  if(!/^[a-z0-9_]+$/.test(item.name)||item.file!==item.name+".pcap")throw Error("Unsafe case name");
  const report=await analyzeTcpPcap(new Uint8Array(await readFile(resolve(root,item.file))));
  await writeFile(resolve(root,"reports",item.name+".json"),JSON.stringify(report,null,2)+"\n");
}
console.log("AWC TCP analyzed",manifest.cases.length,"captures");
