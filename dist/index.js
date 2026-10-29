import { payNanoX402Action } from "./action.js";
import { NanoX402Service } from "./service.js";
export const nanoX402Plugin = {
    name: "nano-x402",
    description: "Pay Nano (XNO) x402 'exact' quotes on nano:mainnet from an ElizaOS agent, behind a payment guard.",
    services: [NanoX402Service],
    actions: [payNanoX402Action],
};
export default nanoX402Plugin;
export { payNanoX402Action, targetUrl } from "./action.js";
export { NanoX402Service, NANO_X402_SERVICE } from "./service.js";
export { paidFetch, requestKey } from "./client.js";
export { PaymentGuard, GuardRefusal, xnoToRaw, NANO_MAINNET } from "./guard.js";
export { seedSigner } from "./signer.js";
