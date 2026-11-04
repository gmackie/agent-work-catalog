/** Synthetic classic PCAP fixture generator, never raw customer traffic. */
export interface SamplePacket {
  readonly direction:"request"|"response";
  readonly transactionId:number;
  readonly functionCode:number;
  readonly exceptionCode?:number;
  readonly unitId?:number;
  readonly timestampMicros?:number;
}
const be16=(view:DataView,at:number,v:number)=>view.setUint16(at,v,false);
const be32=(view:DataView,at:number,v:number)=>view.setUint32(at,v,false);
export function makeTestPcap(steps:readonly SamplePacket[]):Uint8Array{
  const header=new Uint8Array(24);
  const h=new DataView(header.buffer);
  h.setUint32(0,0xa1b2c3d4,true);h.setUint16(4,2,true);h.setUint16(6,4,true);
  h.setUint32(16,65535,true);h.setUint32(20,1,true);
  const buffers:Uint8Array[]=[header];
  for(const [index,step] of steps.entries()){
    const exception=step.exceptionCode!==undefined;
    const pdu=new Uint8Array(exception?3:2);
    pdu[0]=step.functionCode|(exception?0x80:0);
    pdu[1]=exception?step.exceptionCode!:0;
    if(exception)pdu[2]=0;
    const adu=new Uint8Array(7+pdu.length),mb=new DataView(adu.buffer);
    be16(mb,0,step.transactionId);be16(mb,2,0);be16(mb,4,pdu.length+1);
    adu[6]=step.unitId??1;adu.set(pdu,7);
    const tcpLen=20,ipLen=20,ethLen=14,frame=new Uint8Array(ethLen+ipLen+tcpLen+adu.length);
    const v=new DataView(frame.buffer);
    be16(v,12,0x0800);
    frame[14]=0x45;be16(v,16,ipLen+tcpLen+adu.length);frame[22]=64;frame[23]=6;
    const response=step.direction==="response";
    frame.set(response?[10,0,0,2]:[10,0,0,1],26);
    frame.set(response?[10,0,0,1]:[10,0,0,2],30);
    be16(v,34,response?502:40000);be16(v,36,response?40000:502);
    be32(v,38,index+1);frame[46]=0x50;frame[47]=0x18;
    frame.set(adu,54);
    const record=new Uint8Array(16),rv=new DataView(record.buffer);
    rv.setUint32(0,1700000000,true);
    rv.setUint32(4,step.timestampMicros??index*40000,true);
    rv.setUint32(8,frame.length,true);rv.setUint32(12,frame.length,true);
    buffers.push(record,frame);
  }
  const size=buffers.reduce((n,b)=>n+b.length,0);
  const out=new Uint8Array(size);
  let at=0;for(const b of buffers){out.set(b,at);at+=b.length;}
  return out;
}
