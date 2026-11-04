/**
 * Private R2 artifact custody. No public bucket URLs, user-defined paths,
 * cross-tenant references or arbitrary remote fetches.
 */
export const INPUT_MEDIA = "application/vnd.tcpdump.pcap" as const;
export const OUTPUT_MEDIA = ["application/json","application/jose"] as const;
const inputMax=48*1024,outputMax=120*1024;
export class CustodyError extends Error {
  constructor(readonly code:"invalid"|"not_found"|"integrity"|"unavailable",message:string){
    super(message);this.name="CustodyError";
  }
}
export interface R2BodyLike {
  readonly size:number;
  arrayBuffer():Promise<ArrayBuffer>;
}
export interface R2BucketLike {
  get(key:string):Promise<R2BodyLike|null>;
  put(key:string,content:Uint8Array,options:{
    sha256:string;httpMetadata:{contentType:string};
  }):Promise<unknown>;
}
export interface ArtifactRecord {
  readonly ref:string;
  readonly sha256:string;
  readonly bytes:number;
  readonly mediaType:string;
}
const hex=async(raw:Uint8Array):Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256",Uint8Array.from(raw)))]
    .map(x=>x.toString(16).padStart(2,"0")).join("");
const textHash=async(value:string)=>hex(new TextEncoder().encode(value));
const refFor=(digest:string)=>"artifact:sha256:"+digest;
const parseRef=(ref:string):string=>{
  const match=/^artifact:sha256:([a-f0-9]{64})$/.exec(ref);
  if(!match)throw new CustodyError("invalid","Unsupported or malformed artifact reference");
  return match[1]!;
};
const checkPrincipal=(buyerId:string,workId?:string)=>{
  if(!buyerId||buyerId.length>200||workId!==undefined&&(!workId||workId.length>200))
    throw new CustodyError("invalid","Invalid buyer/work identity");
};
async function keyFor(buyerId:string,digest:string,workId?:string){
  checkPrincipal(buyerId,workId);
  const buyerHash=await textHash("awc/buyer/v1:"+buyerId);
  if(workId===undefined)return `v1/input/${buyerHash}/${digest}`;
  const workHash=await textHash("awc/work/v1:"+buyerId+":"+workId);
  return `v1/result/${buyerHash}/${workHash}/${digest}`;
}
export function createR2ArtifactCustody(bucket:R2BucketLike){
  const store=async(buyerId:string,bytes:Uint8Array,mediaType:string,workId?:string):Promise<ArtifactRecord>=>{
    const max=workId===undefined?inputMax:outputMax;
    if(!bytes.length||bytes.length>max)throw new CustodyError("invalid","Artifact exceeds allowed size");
    if(workId===undefined&&mediaType!==INPUT_MEDIA ||
      workId!==undefined&&!OUTPUT_MEDIA.includes(mediaType as typeof OUTPUT_MEDIA[number]))
      throw new CustodyError("invalid","Artifact media type is not permitted");
    const sha256=await hex(bytes),key=await keyFor(buyerId,sha256,workId);
    try{
      const saved=await bucket.put(key,Uint8Array.from(bytes),{
        sha256,httpMetadata:{contentType:mediaType},
      });
      if(!saved)throw new Error("R2 put unsuccessful");
    }catch{throw new CustodyError("unavailable","Private artifact write failed");}
    return {ref:refFor(sha256),sha256,bytes:bytes.length,mediaType};
  };
  const read=async(buyerId:string,ref:string,max:number,workId?:string):Promise<Uint8Array>=>{
    const digest=parseRef(ref),key=await keyFor(buyerId,digest,workId);
    let stored:R2BodyLike|null;
    try{stored=await bucket.get(key);}
    catch{throw new CustodyError("unavailable","Private artifact read failed");}
    if(!stored)throw new CustodyError("not_found","Artifact unavailable to this identity");
    if(!Number.isSafeInteger(stored.size)||stored.size<=0||stored.size>max)
      throw new CustodyError("integrity","Stored artifact has invalid size");
    const bytes=new Uint8Array(await stored.arrayBuffer());
    if(bytes.length!==stored.size||await hex(bytes)!==digest)
      throw new CustodyError("integrity","Stored artifact digest mismatch");
    return bytes;
  };
  return {
    putInput:(buyerId:string,bytes:Uint8Array)=>store(buyerId,bytes,INPUT_MEDIA),
    readInput:(buyerId:string,ref:string)=>read(buyerId,ref,inputMax),
    putOutput:(buyerId:string,workId:string,bytes:Uint8Array,mediaType:string)=>
      store(buyerId,bytes,mediaType,workId),
    readOutput:(buyerId:string,workId:string,ref:string)=>read(buyerId,ref,outputMax,workId),
  };
}
export type ArtifactCustody=ReturnType<typeof createR2ArtifactCustody>;
