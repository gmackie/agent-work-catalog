import type { ConditionalAuthorizationVerifier } from "@awc/authzen";
import type { DurableAccount,DurableMandate,DurableReservation } from "@awc/economics-durable";

export interface TrustedTreasuryLookup {
  readonly account:()=>Promise<DurableAccount>;
  readonly mandate:(id:string)=>Promise<DurableMandate>;
  readonly reservationByAction:(
    mandateId:string,actionId:string,idempotencyKey:string
  )=>Promise<DurableReservation|undefined>;
}
/**
 * An ALREADY_RESERVED financial commitment can satisfy part of a conditional
 * AuthZEN authorization. The PDP still checks the full mandate, asset owner,
 * current state and independent approvals. Reservation is not payment settlement.
 *
 * Do not connect this port to an MCP tool or client-supplied finance state.
 * The lookup must originate from a trusted treasury service tied to the same
 * organization/account and serializable ledger.
 */
export function createFundedConditionalVerifier(
  ledger:TrustedTreasuryLookup,
):ConditionalAuthorizationVerifier{
  return {
    verify:async({proposal,policy},caller)=>{
      const c=proposal.commitment;
      if(!c||caller.subjectId!==proposal.actorId) return undefined;
      const key=proposal.id+":"+proposal.revision;
      const [account,mandate,reservation]=await Promise.all([
        ledger.account(),ledger.mandate(proposal.mandateId),
        ledger.reservationByAction(proposal.mandateId,proposal.id,key),
      ]);
      if(!reservation||reservation.state!=="reserved"||
         reservation.mandateId!==proposal.mandateId||
         reservation.actionId!==proposal.id||
         reservation.idempotencyKey!==key||
         reservation.maximumMinor!==c.maximumMinor||
         account.accountId!==c.accountId||account.currency!==c.currency||
         mandate.mandateId!==proposal.mandateId||mandate.revoked||mandate.closed){
        return undefined;
      }
      if(!/^(0|[1-9][0-9]*)$/.test(reservation.maximumMinor)||
        BigInt(reservation.maximumMinor)===0n){
        return undefined;
      }
      const policyTime=Date.parse(policy.now);
      if(!Number.isFinite(policyTime))return undefined;
      return {
        proposalId:proposal.id,revision:proposal.revision,
        actorId:proposal.actorId,entityId:proposal.entityId,
        action:proposal.action,expiresAt:new Date(policyTime+10_000).toISOString(),
      };
    },
  };
}
