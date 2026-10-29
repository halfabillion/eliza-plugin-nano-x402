import * as N from "nanocurrency";
import type { NanoSigner } from "./client.js";

export interface SeedSignerConfig {
  /** 64-hex seed. Read from a Worker secret; never logged, never returned. */
  seed: string;
  index?: number;
  /** Node RPC for account_info (optional). Default: the no-node service at `accountInfoApi`. */
  rpcUrl?: string;
  accountInfoApi?: string;
  /** RPC-style work_generate endpoint, used when the 402 says work is required. */
  workUrl?: string;
  fetch?: typeof fetch;
}

const SEND_THRESHOLD = "fffffff800000000";

export function seedSigner(cfg: SeedSignerConfig): NanoSigner {
  if (!/^[0-9a-fA-F]{64}$/.test(cfg.seed ?? "")) throw new Error("NANO_SEED must be 64 hex characters");
  const sk = N.deriveSecretKey(cfg.seed, cfg.index ?? 0);
  const address = N.deriveAddress(N.derivePublicKey(sk), { useNanoPrefix: true });
  const f = cfg.fetch ?? fetch;
  const post = (u: string, body: unknown) =>
    f(u, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }).then((r) => r.json() as Promise<any>);

  async function accountInfo() {
    if (cfg.rpcUrl) {
      const i = await post(cfg.rpcUrl, { action: "account_info", account: address, representative: "true" });
      if (i.error) throw new Error(`account_info: ${i.error}`);
      return { frontier: i.frontier as string, balance: BigInt(i.balance), representative: i.representative as string };
    }
    const api = (cfg.accountInfoApi ?? "https://pursekeeper.dev").replace(/\/$/, "");
    const r = await f(`${api}/v1/account_info?account=${encodeURIComponent(address)}`);
    if (!r.ok) throw new Error(`account_info HTTP ${r.status}`);
    const i: any = await r.json();
    if (i.error) throw new Error(`account_info: ${i.error}`);
    if (!i.found) throw new Error("payer account has no blocks yet; receive first");
    return { frontier: i.frontier as string, balance: BigInt(i.balance_raw), representative: i.representative as string };
  }

  async function work(hash: string, origin: string): Promise<string> {
    if (cfg.workUrl) {
      const r = await post(cfg.workUrl, { action: "work_generate", hash, difficulty: SEND_THRESHOLD });
      if (r.work) return r.work;
    }
    try {
      const r = await post(`${origin}/v1/work`, { hash });
      if (r.work) return r.work;
    } catch { /* fall through */ }
    const w = await N.computeWork(hash, { workThreshold: SEND_THRESHOLD });
    if (!w) throw new Error("could not compute work");
    return w;
  }

  return {
    account: async () => address,
    async signSend({ payTo, amount, workRequired, origin }) {
      const info = await accountInfo();
      if (info.balance < amount) throw new Error(`balance ${info.balance} raw < ${amount} raw`);
      const w = workRequired ? await work(info.frontier, origin) : null;
      const { block, hash } = N.createBlock(sk, {
        work: w, previous: info.frontier, representative: info.representative,
        balance: (info.balance - amount).toString(), link: payTo,
      });
      (block as any).account = String(block.account).replace(/^xrb_/, "nano_");
      return { block: block as unknown as Record<string, unknown>, hash };
    },
  };
}
