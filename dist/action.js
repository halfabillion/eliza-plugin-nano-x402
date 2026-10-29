import { GuardRefusal } from "./guard.js";
import { NANO_X402_SERVICE } from "./service.js";
const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/i;
/** The URL to buy: an explicit `options.url`, else the first http(s) URL in the message text. */
export function targetUrl(message, options) {
    const o = options?.url;
    if (typeof o === "string" && /^https?:\/\//i.test(o))
        return o;
    const m = String(message.content?.text ?? "").match(URL_RE);
    return m ? m[0].replace(/[.,;:!?]+$/, "") : undefined;
}
export const payNanoX402Action = {
    name: "PAY_NANO_X402",
    similes: ["NANO_X402_FETCH", "BUY_WITH_NANO", "PAID_FETCH", "X402_PAY"],
    description: "Fetch a URL that may answer HTTP 402 with an x402 'exact' quote on nano:mainnet, paying it in Nano (XNO) from the agent's own account. " +
        "Refuses anything outside the operator's payTo allowlist, per-call cap or cumulative cap, never pays a cross-origin redirect, and signs at most one block per request.",
    validate: async (runtime, message) => !!runtime.getService(NANO_X402_SERVICE) && !!targetUrl(message),
    handler: async (runtime, message, _state, options, callback) => {
        const svc = runtime.getService(NANO_X402_SERVICE);
        const url = targetUrl(message, options);
        if (!svc || !url)
            return { success: false, text: "No Nano x402 service or no URL in the request." };
        const method = typeof options?.method === "string" ? options.method : "GET";
        const body = typeof options?.body === "string" ? options.body : undefined;
        try {
            const r = await svc.payAndFetch(url, { method, body });
            const text = r.paid
                ? `Paid ${r.amountRaw} raw (block ${r.blockHash}); ${url} answered ${r.status}.\n${r.body.slice(0, 2000)}`
                : `${url} answered ${r.status} without asking for payment.\n${r.body.slice(0, 2000)}`;
            await callback?.({ text, actions: ["PAY_NANO_X402"], source: message.content?.source });
            return {
                success: r.status >= 200 && r.status < 300, text,
                values: { nanoX402Paid: r.paid, nanoX402BlockHash: r.blockHash ?? null },
                data: { status: r.status, paid: r.paid, blockHash: r.blockHash, amountRaw: r.amountRaw, contentType: r.contentType, body: r.body, spentRaw: svc.spentRaw() },
            };
        }
        catch (e) {
            const reason = e instanceof GuardRefusal ? e.message : `payment failed: ${e.message}`;
            const text = `Nano x402 for ${url}: ${reason}`;
            await callback?.({ text, actions: ["PAY_NANO_X402"], source: message.content?.source });
            return { success: false, text, error: text };
        }
    },
    examples: [
        [
            { name: "{{user}}", content: { text: "Get me the hash from https://pursekeeper.dev/v1/hash?msg=hello, pay in Nano if it asks." } },
            { name: "{{agent}}", content: { text: "Buying it with Nano within my caps.", actions: ["PAY_NANO_X402"] } },
        ],
    ],
};
