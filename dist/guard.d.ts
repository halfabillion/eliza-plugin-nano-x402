export declare const NANO_MAINNET = "nano:mainnet";
/** Convert a decimal XNO string ("0.001") to raw (bigint). */
export declare function xnoToRaw(xno: string): bigint;
export interface GuardConfig {
    /** Network the operator accepts. Default nano:mainnet. */
    network?: string;
    /** Nano accounts the agent may pay. Required, non-empty. */
    payToAllowlist: string[];
    /** Maximum raw per single call. */
    maxPerCallRaw: bigint;
    /** Maximum cumulative raw for the life of this guard (one process / one agent run). */
    maxTotalRaw: bigint;
    /** Clock, injectable for tests. */
    now?: () => number;
}
export interface Accepted {
    scheme: string;
    network: string;
    amount: string;
    asset: string;
    payTo: string;
    maxTimeoutSeconds?: number;
    extra?: Record<string, unknown>;
}
export interface Quote {
    /** The decoded PAYMENT-REQUIRED body. */
    required: {
        x402Version: number;
        resource: {
            url: string;
            [k: string]: unknown;
        };
        accepts: Accepted[];
    };
    /** The entry this client will pay. */
    accepted: Accepted;
    /** Origin the quote came from (after same-origin redirects only). */
    origin: string;
    /** ms timestamp at which the 402 was received. */
    receivedAt: number;
}
export declare class GuardRefusal extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
export declare class PaymentGuard {
    private readonly cfg;
    readonly network: string;
    private readonly allow;
    private spentRaw;
    private readonly paidKeys;
    private readonly inFlight;
    private readonly now;
    constructor(cfg: GuardConfig);
    get spent(): bigint;
    /** Pick the nano exact entry from a decoded PAYMENT-REQUIRED body, refusing anything malformed. */
    pick(required: unknown): Accepted;
    /**
     * Check a quote and reserve its amount against the caps. Returns a release() to call if
     * nothing was sent (so the reservation is undone). Throws GuardRefusal otherwise.
     * `key` identifies the logical request (method + url + body); a key that has already paid,
     * or is paying right now, is refused so a second invocation never signs a second block.
     */
    authorize(q: Quote, requestUrl: string, key: string): {
        amount: bigint;
        commit(): void;
        release(): void;
    };
    isStale(q: Quote): boolean;
}
