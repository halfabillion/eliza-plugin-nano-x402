import type { Plugin } from "@elizaos/core";
import { payNanoX402Action } from "./action.js";
import { NanoX402Service } from "./service.js";

export const nanoX402Plugin: Plugin = {
  name: "nano-x402",
  description: "Pay Nano (XNO) x402 'exact' quotes on nano:mainnet from an ElizaOS agent, behind a payment guard.",
  services: [NanoX402Service],
  actions: [payNanoX402Action],
};
export default nanoX402Plugin;

export { payNanoX402Action, targetUrl } from "./action.js";
export { NanoX402Service, NANO_X402_SERVICE } from "./service.js";
export { paidFetch, requestKey, type NanoSigner, type PaidFetchOptions, type PaidResult } from "./client.js";
export { PaymentGuard, GuardRefusal, xnoToRaw, NANO_MAINNET, type GuardConfig, type Quote, type Accepted } from "./guard.js";
export { seedSigner, type SeedSignerConfig } from "./signer.js";
