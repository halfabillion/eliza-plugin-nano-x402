import { Service, type IAgentRuntime } from "@elizaos/core";
import { PaymentGuard } from "./guard.js";
import { type NanoSigner, type PaidFetchOptions, type PaidResult } from "./client.js";
export declare const NANO_X402_SERVICE = "nano_x402";
/**
 * Holds the agent's single PaymentGuard (per-call cap, cumulative cap for the life of this
 * runtime, payTo allowlist, one block per request) and the signer. The seed stays inside the
 * signer closure; nothing here returns, logs or prints it.
 *
 * Settings (character settings/secrets, else the process environment). Prefer the environment
 * for NANO_SEED: ElizaOS persists the character, secrets included, to its database.
 *   NANO_SEED              64-hex seed of the paying account (secret, required unless a signer is injected)
 *   NANO_INDEX             account index, default 0
 *   NANO_PAYTO_ALLOWLIST   comma-separated nano_ accounts the agent may pay (required)
 *   NANO_MAX_PER_CALL      XNO, default 0.001
 *   NANO_MAX_TOTAL         XNO for this runtime's life, default 0.01
 *   NANO_NETWORK           default nano:mainnet
 *   NANO_RPC / NANO_WORK_URL  optional node RPC and work server
 */
export declare class NanoX402Service extends Service {
    static serviceType: string;
    capabilityDescription: string;
    /** Operators can set this before the runtime starts to use a remote/hardware signer instead of NANO_SEED. */
    static injectedSigner?: NanoSigner;
    readonly guard: PaymentGuard;
    private signer?;
    constructor(runtime: IAgentRuntime, signer?: NanoSigner);
    static start(runtime: IAgentRuntime): Promise<NanoX402Service>;
    static stop(runtime: IAgentRuntime): Promise<void>;
    stop(): Promise<void>;
    private getSigner;
    /** Fetch `url`, paying at most one Nano send block through the guard. */
    payAndFetch(url: string, opts?: Omit<PaidFetchOptions, "fetch"> & {
        fetch?: typeof fetch;
    }): Promise<PaidResult>;
    spentRaw(): string;
}
