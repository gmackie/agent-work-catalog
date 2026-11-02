import { DurableObject } from "cloudflare:workers";
import { makeDurableAccountLedger } from "@awc/economics-durable";
import type { Env } from "./index.ts";
import type { AtomicSqlStorage } from "@awc/economics-durable";

/**
 * Single-account SQLite ledger boundary.
 *
 * There are deliberately NO public mutation RPC methods. The underlying
 * transactional ledger is testable with SQLite and can only be wired to a
 * trusted, separately authenticated finance/issuer service after that
 * service verifies settlement evidence and grant issuance.
 *
 * A caller cannot create synthetic money by accessing an MCP tool.
 */
export class AWCEconomicAccount extends DurableObject<Env> {
  private readonly ledger:ReturnType<typeof makeDurableAccountLedger>;
  constructor(ctx:DurableObjectState,env:Env){
    super(ctx,env);
    const storage:AtomicSqlStorage={
      sql:{
        exec:<T extends Record<string,unknown>>(query:string,...bindings:(string|number|null)[])=>({
          toArray:()=>ctx.storage.sql.exec(query,...bindings).toArray() as unknown as T[]
        }),
      },
      transactionSync:<T>(callback:()=>T):T=>ctx.storage.transactionSync(callback),
    };
    this.ledger=makeDurableAccountLedger(storage);
  }

  /** Explicitly read-only operational metadata. Does not reveal customer balances. */
  async status():Promise<{ready:boolean;mode:string}>{
    return {ready:true,mode:"private-transactional-treasury-unbound"};
  }
}
