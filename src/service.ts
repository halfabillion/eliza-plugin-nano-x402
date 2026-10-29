import { Service, type IAgentRuntime } from "@elizaos/core";
import { PaymentGuard, xnoToRaw } from "./guard.js";
import { paidFetch, type NanoSigner, type PaidFetchOptions, type PaidResult } from "./client.js";
import { seedSigner } from "./signer.js";

export const NANO_X402_SERVICE = "nano_x402";

/** Reads one setting: the runtime (character settings/secrets) first, then the process environment. Never logged. */
function setting(runtime: IAgentRuntime, key: string): string | undefined {
  const v = runtime.getSetting(key);
  if (v !== null && v !== undefined && v !== "") return String(v);
  const env = typeof process !== "undefined" ? process.env?.[key] : undefined;
  return env === undefined || env === "" ? undefined : env;
}

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
export class NanoX402Service extends Service {
  static serviceType = NANO_X402_SERVICE;
  capabilityDescription = "Pays Nano (XNO) x402 'exact' quotes on nano:mainnet within operator-set caps and a payTo allowlist";

  /** Operators can set this before the runtime starts to use a remote/hardware signer instead of NANO_SEED. */
  static injectedSigner?: NanoSigner;

  readonly guard: PaymentGuard;
  private signer?: NanoSigner;

  constructor(runtime: IAgentRuntime, signer?: NanoSigner) {
    super(runtime);
    const allow = (setting(runtime, "NANO_PAYTO_ALLOWLIST") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    this.guard = new PaymentGuard({
      network: setting(runtime, "NANO_NETWORK") ?? "nano:mainnet",
      payToAllowlist: allow,
      maxPerCallRaw: xnoToRaw(setting(runtime, "NANO_MAX_PER_CALL") ?? "0.001"),
      maxTotalRaw: xnoToRaw(setting(runtime, "NANO_MAX_TOTAL") ?? "0.01"),
    });
    this.signer = signer ?? NanoX402Service.injectedSigner;
  }

  static async start(runtime: IAgentRuntime): Promise<NanoX402Service> {
    return new NanoX402Service(runtime);
  }

  static async stop(runtime: IAgentRuntime): Promise<void> {
    await runtime.getService<NanoX402Service>(NANO_X402_SERVICE)?.stop();
  }

  async stop(): Promise<void> { this.signer = undefined; }

  private getSigner(): NanoSigner {
    if (this.signer) return this.signer;
    const seed = setting(this.runtime, "NANO_SEED");
    if (!seed) throw new Error("NANO_SEED is not set (add it to the character's settings.secrets or the environment)");
    this.signer = seedSigner({
      seed, index: Number(setting(this.runtime, "NANO_INDEX") ?? 0),
      rpcUrl: setting(this.runtime, "NANO_RPC"), workUrl: setting(this.runtime, "NANO_WORK_URL"),
    });
    return this.signer;
  }

  /** Fetch `url`, paying at most one Nano send block through the guard. */
  async payAndFetch(url: string, opts: Omit<PaidFetchOptions, "fetch"> & { fetch?: typeof fetch } = {}): Promise<PaidResult> {
    return paidFetch(url, this.guard, this.getSigner(), opts);
  }

  spentRaw(): string { return this.guard.spent.toString(); }
}
