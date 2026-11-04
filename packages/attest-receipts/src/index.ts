import { CompactSign,compactVerify,importPKCS8,importSPKI } from "jose";

/**
 * Attest-domain-compatible observation claim, NOT a registered W3C VC or
 * independently authorized issuer. Full authority/status verification belongs
 * to gmackie/attest#9; this provisional profile is for test-only provenance.
 */
export const OBSERVATION_SCHEMA="attest.marketplace.modbus-observation/v0" as const;
export const TCP_OBSERVATION_SCHEMA="attest.marketplace.tcp-observation/v0" as const;
export interface ObservationAttestation {
  readonly id:string;
  readonly schema:typeof OBSERVATION_SCHEMA | typeof TCP_OBSERVATION_SCHEMA;
  readonly subject:string;
  readonly issuer:string;
  readonly claims:Readonly<Record<string,
    | {kind:"string";value:string}
    | {kind:"boolean";value:boolean}
    | {kind:"integer";value:string;unit?:string}>>;
  readonly evidence:readonly {
    id:string;kind:"document-commitment"|"assessment";
    commitment:string;mediaType?:string;
  }[];
  readonly assurance:"direct-observation";
  readonly issuedAt:string;
  readonly status:"active";
}
export class ReceiptError extends Error {
  constructor(readonly code:"invalid"|"unauthorized",message:string){super(message);this.name="ReceiptError";}
}
export interface ObservationInput {
  readonly issuerId:string;
  readonly subject:string;
  readonly workId:string;
  readonly contractDigest:string;
  readonly captureDigest:string;
  readonly reportDigest:string;
  readonly evaluationDigest:string;
  readonly findings:number;
  readonly packetFrames:number;
  readonly issuedAt:string;
}
const digest=async(text:string)=>{
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(text)));
  return [...bytes].map(x=>x.toString(16).padStart(2,"0")).join("");
};
export async function buildObservation(input:ObservationInput):Promise<ObservationAttestation>{
  const sha=/^[a-f0-9]{64}$/;
  if(!input.issuerId||!input.subject||!input.workId||!sha.test(input.contractDigest)||
    !sha.test(input.captureDigest)||!sha.test(input.reportDigest)||
    !sha.test(input.evaluationDigest)||!Number.isSafeInteger(input.findings)||
    input.findings<0||!Number.isSafeInteger(input.packetFrames)||input.packetFrames<0||
    !Number.isFinite(Date.parse(input.issuedAt)))
    throw new ReceiptError("invalid","Observation claims are incomplete");
  const id="awc:observation:"+await digest(JSON.stringify({
    schema:OBSERVATION_SCHEMA,issuer:input.issuerId,subject:input.subject,
    workId:input.workId,contractDigest:input.contractDigest,
    captureDigest:input.captureDigest,reportDigest:input.reportDigest,
    evaluationDigest:input.evaluationDigest,
  }));
  return {
    id,schema:OBSERVATION_SCHEMA,subject:input.subject,issuer:input.issuerId,
    claims:{
      "awc.work_order_id":{kind:"string",value:input.workId},
      "awc.contract_digest":{kind:"string",value:input.contractDigest},
      "awc.capture_digest":{kind:"string",value:input.captureDigest},
      "awc.report_digest":{kind:"string",value:input.reportDigest},
      "awc.evaluation_digest":{kind:"string",value:input.evaluationDigest},
      "awc.parser_version":{kind:"string",value:"awc/modbus-pcap@0.1.0"},
      "awc.consistency_checked":{kind:"boolean",value:true},
      "awc.finding_count":{kind:"integer",value:String(input.findings),unit:"findings"},
      "awc.packet_frames":{kind:"integer",value:String(input.packetFrames),unit:"frames"},
    },
    evidence:[
      {id:"pcap:"+input.captureDigest,kind:"document-commitment",
        commitment:input.captureDigest,mediaType:"application/vnd.tcpdump.pcap"},
      {id:"report:"+input.reportDigest,kind:"document-commitment",
        commitment:input.reportDigest,mediaType:"application/json"},
      {id:"evaluation:"+input.evaluationDigest,kind:"assessment",
        commitment:input.evaluationDigest,mediaType:"application/json"},
    ],
    assurance:"direct-observation",issuedAt:input.issuedAt,status:"active",
  };
}
/** Separate TCP-flow evidence profile, not a claim of independently verified causation. */
export async function buildTcpObservation(input: ObservationInput & {
  readonly flowCount:number;
  readonly tcpSegments:number;
}):Promise<ObservationAttestation>{
  if(!Number.isSafeInteger(input.flowCount)||input.flowCount<0||
     !Number.isSafeInteger(input.tcpSegments)||input.tcpSegments<0){
    throw new ReceiptError("invalid","Invalid TCP observation counts");
  }
  const prior=await buildObservation(input);
  const claims={...prior.claims};
  delete claims["awc.parser_version"];
  return {
    ...prior,
    id:"awc:tcp-observation:"+await digest(JSON.stringify({
      domain:TCP_OBSERVATION_SCHEMA,
      workId:input.workId,issuer:input.issuerId,
      captureDigest:input.captureDigest,reportDigest:input.reportDigest,
      evaluationDigest:input.evaluationDigest,
    })),
    schema:TCP_OBSERVATION_SCHEMA,
    claims:{
      ...claims,
      "awc.analyzer_version":{kind:"string",value:"awc/tcp-flow-evidence@0.1.0"},
      "awc.flow_count":{kind:"integer",value:String(input.flowCount),unit:"flows"},
      "awc.observed_tcp_segments":{kind:"integer",value:String(input.tcpSegments),unit:"segments"},
      "awc.consistency_checked":{kind:"boolean",value:true},
    },
  };
}
export interface ReceiptSigner {
  readonly issuerId:string;
  readonly keyId:string;
  /** PEM PKCS#8 Ed25519 key restricted to this test-only observation profile. */
  readonly privateKeyPem:string;
}
export async function signObservation(input:ObservationAttestation, signer:ReceiptSigner):Promise<string>{
  if(input.issuer!==signer.issuerId||!signer.keyId||signer.keyId.length>120)
    throw new ReceiptError("unauthorized","Issuer and local signing key do not match");
  const key=await importPKCS8(signer.privateKeyPem,"EdDSA");
  return new CompactSign(new TextEncoder().encode(JSON.stringify(input)))
    .setProtectedHeader({alg:"EdDSA",kid:signer.keyId,typ:input.schema})
    .sign(key);
}
/** Pinned verifier key, not fetched from a user-supplied JWK/JWKS URL. */
export async function verifyObservation(
  jws:string,expected:{issuerId:string;keyId:string;publicKeyPem:string;workId:string;contractDigest:string;
    schema?:typeof OBSERVATION_SCHEMA | typeof TCP_OBSERVATION_SCHEMA},
):Promise<ObservationAttestation>{
  if(jws.length>30_000)throw new ReceiptError("invalid","Receipt too large");
  try{
    const key=await importSPKI(expected.publicKeyPem,"EdDSA");
    const verified=await compactVerify(jws,key,{algorithms:["EdDSA"]});
    const header=verified.protectedHeader;
    const expectedSchema=expected.schema??OBSERVATION_SCHEMA;
    if(header.alg!=="EdDSA"||header.kid!==expected.keyId||header.typ!==expectedSchema)
      throw new ReceiptError("unauthorized","Unexpected observation signing profile");
    const v=JSON.parse(new TextDecoder().decode(verified.payload)) as ObservationAttestation;
    if(v.schema!==expectedSchema||v.issuer!==expected.issuerId||
      v.status!=="active"||v.assurance!=="direct-observation"||
      v.claims?.["awc.work_order_id"]?.value!==expected.workId||
      v.claims?.["awc.contract_digest"]?.value!==expected.contractDigest||
      !Number.isFinite(Date.parse(v.issuedAt)))
      throw new ReceiptError("unauthorized","Observation claim does not match contract");
    return v;
  }catch(error){
    if(error instanceof ReceiptError)throw error;
    throw new ReceiptError("unauthorized","Signed observation could not be independently verified");
  }
}
