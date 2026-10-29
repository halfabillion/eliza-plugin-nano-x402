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
export declare function seedSigner(cfg: SeedSignerConfig): NanoSigner;
