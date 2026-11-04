import { CompactSign,compactVerify,importPKCS8,importSPKI } from "jose";

/** Broker-attributed consistency observation. NOT Attest authority/VC certification. */
export const TCP_EVIDENCE_PROFILE="attest.marketplace.tcp-evidence/v0" as const;
export interface TcpEvidenceReceipt {
  readonly schema:typeof TCP_EVIDENCE_PROFILE;
  readonly id:string;
  readonly issuer:string;
  readonly subject:string;
  readonly workOrderId:string;
  readonly contractDigest:string;
  readonly inputDigest:string;
  readonly reportDigest:string;
  readonly evaluationDigest:string;
  readonly analyzer:"awc/tcp-pcap@0.1.0";
  readonly evaluationPolicy:"awc.tcp.deterministic-consistency/v1";
  readonly assurance:"broker-consistency-only";
  readonly issuedAt:string;
  readonly status:"active-at-issuance";
  readonly claims:Readonly<Record<string,{kind:"string"|"boolean"|"integer";value:string|boolean}>>;
}
export interface TcpReceiptSigner {
  readonly issuerId:string;readonly keyId:string;
  readonly privateKeyPem:string;readonly publicKeyPem:string;
}
export class TcpEvidenceError extends Error {
  constructor(readonly code:"invalid"|"unauthorized",message:string){super(message);this.name="TcpEvidenceError";}
}
const sha=/^[a-f0-9]{64}$/;
const digest=async(value:string)=>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))]
    .map(x=>x.toString(16).padStart(2,"0")).join("");
export async function makeTcpEvidenceReceipt(input:{
  issuerId:string;subject:string;workOrderId:string;contractDigest:string;
  inputDigest:string;reportDigest:string;evaluationDigest:string;
  packetFrames:number;flowCount:number;observations:number;issuedAt:string;
}):Promise<TcpEvidenceReceipt>{
  if(!input.issuerId||!input.subject||!input.workOrderId||
      [input.contractDigest,input.inputDigest,input.reportDigest,input.evaluationDigest].some(v=>!sha.test(v))||
      ![input.packetFrames,input.flowCount,input.observations].every(n=>Number.isSafeInteger(n)&&n>=0)||
      !Number.isFinite(Date.parse(input.issuedAt)))
    throw new TcpEvidenceError("invalid","Incomplete or invalid TCP observation");
  const id="awc:tcp-evidence:"+await digest(JSON.stringify(input));
  return {
    schema:TCP_EVIDENCE_PROFILE,id,issuer:input.issuerId,subject:input.subject,
    workOrderId:input.workOrderId,contractDigest:input.contractDigest,
    inputDigest:input.inputDigest,reportDigest:input.reportDigest,
    evaluationDigest:input.evaluationDigest,analyzer:"awc/tcp-pcap@0.1.0",
    evaluationPolicy:"awc.tcp.deterministic-consistency/v1",
    assurance:"broker-consistency-only",issuedAt:input.issuedAt,status:"active-at-issuance",
    claims:{
      "awc.consistency_checked":{kind:"boolean",value:true},
      "awc.packet_frames":{kind:"integer",value:String(input.packetFrames)},
      "awc.flow_count":{kind:"integer",value:String(input.flowCount)},
      "awc.observation_count":{kind:"integer",value:String(input.observations)},
      "awc.root_cause_proven":{kind:"boolean",value:false},
    },
  };
}
export async function signTcpEvidenceReceipt(
  receipt:TcpEvidenceReceipt,signer:TcpReceiptSigner,
):Promise<string>{
  if(receipt.issuer!==signer.issuerId||!signer.keyId)
    throw new TcpEvidenceError("unauthorized","Local TCP issuer identity mismatch");
  const key=await importPKCS8(signer.privateKeyPem,"EdDSA");
  return new CompactSign(new TextEncoder().encode(JSON.stringify(receipt)))
    .setProtectedHeader({alg:"EdDSA",typ:TCP_EVIDENCE_PROFILE,kid:signer.keyId})
    .sign(key);
}
export async function verifyTcpEvidenceReceipt(jws:string,expected:{
  issuerId:string;keyId:string;publicKeyPem:string;
  workOrderId:string;contractDigest:string;
}):Promise<TcpEvidenceReceipt>{
  if(jws.length>30_000)throw new TcpEvidenceError("invalid","Receipt too large");
  try {
    const key=await importSPKI(expected.publicKeyPem,"EdDSA");
    const res=await compactVerify(jws,key,{algorithms:["EdDSA"]});
    if(res.protectedHeader.alg!=="EdDSA"||
       res.protectedHeader.kid!==expected.keyId||
       res.protectedHeader.typ!==TCP_EVIDENCE_PROFILE)
      throw new TcpEvidenceError("unauthorized","Wrong signing profile or key");
    const value=JSON.parse(new TextDecoder().decode(res.payload)) as TcpEvidenceReceipt;
    if(value.schema!==TCP_EVIDENCE_PROFILE||value.issuer!==expected.issuerId||
       value.workOrderId!==expected.workOrderId||value.contractDigest!==expected.contractDigest||
       value.assurance!=="broker-consistency-only"||value.status!=="active-at-issuance"||
       value.analyzer!=="awc/tcp-pcap@0.1.0"||
       ![value.inputDigest,value.reportDigest,value.evaluationDigest].every(x=>sha.test(x))||
       value.claims?.["awc.root_cause_proven"]?.value!==false)
      throw new TcpEvidenceError("unauthorized","TCP receipt assertions mismatched");
    return value;
  }catch(e){
    if(e instanceof TcpEvidenceError)throw e;
    throw new TcpEvidenceError("unauthorized","Signed TCP receipt could not be verified");
  }
}
