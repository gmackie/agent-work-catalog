import {describe,expect,it} from "vitest";
import {analyzeTcpPcap,TcpCaptureError} from "../src/index.ts";
function seed(){
  const header=new Uint8Array(94),v=new DataView(header.buffer);
  v.setUint32(0,0xa1b2c3d4,true);v.setUint16(4,2,true);
  v.setUint16(6,4,true);v.setUint32(16,65535,true);v.setUint32(20,1,true);
  v.setUint32(24,1700000000,true);v.setUint32(32,54,true);v.setUint32(36,54,true);
  v.setUint16(52,0x0800,false);header[54]=0x45;
  v.setUint16(56,40,false);header[62]=64;header[63]=6;
  header.set([192,0,2,1],66);header.set([192,0,2,2],70);
  v.setUint16(74,12345,false);v.setUint16(76,502,false);
  v.setUint32(78,100,false);header[86]=0x50;header[87]=0x02;
  v.setUint16(88,8192,false);
  return header;
}
function rng(seed:number){
  let x=seed>>>0;return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return x>>>0;};
}
describe("deterministic malformed TCP capture robustness",()=>{
  it("accepts bounded reports or returns typed rejection, never uncontrolled errors",async()=>{
    const sample=seed();
    for(let n=1;n<=1000;n++){
      const next=rng(n);
      let b=Uint8Array.from(sample);
      const mode=n%4;
      if(mode===0)b[next()%b.length]!^=1<<(next()%8);
      if(mode===1)b=b.slice(0,next()%b.length);
      if(mode===2){const at=next()%b.length;b[at]=next()&255;}
      if(mode===3)b=Uint8Array.from([...b,...new Array(next()%8).fill(0)]);
      try {
        const report=await analyzeTcpPcap(b);
        expect(report.coverage.totalFrames).toBeLessThanOrEqual(500);
        expect(report.segments.length).toBeLessThanOrEqual(500);
        expect(report.observations.length).toBeLessThanOrEqual(300);
        expect(JSON.stringify(report).length).toBeLessThan(120_001);
      }catch(e){
        if(!(e instanceof TcpCaptureError))
          throw new Error("Unchecked parser error for seed "+n+": "+String(e));
      }
    }
  },20000);
});
