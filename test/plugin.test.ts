import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
import { describe, it, expect, vi } from "vitest";
import plugin, { NanoX402Service, payNanoX402Action, targetUrl, xnoToRaw, NANO_X402_SERVICE, type NanoSigner } from "../src/index.js";

const SELLER = "nano_1xug1q5t7nxoj3ywwzokiea9jz8fq8qfgzp8pbyfr3co3e5xgj755uofu8ue";
const URL1 = "https://door.example/v1/hash?msg=hi";
const PRICE = xnoToRaw("0.001");
const SEED = "a".repeat(64);
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const quote = (amount = PRICE) => ({ x402Version: 2, resource: { url: URL1 }, accepts: [{ scheme: "exact", network: "nano:mainnet", amount: amount.toString(), asset: "XNO", payTo: SELLER, maxTimeoutSeconds: 60, extra: { workOptional: true } }] });

function runtime(settings: Record<string, string>) {
  const services = new Map<string, unknown>();
  const rt: any = { getSetting: (k: string) => settings[k] ?? null, getService: (n: string) => services.get(n) ?? null };
  return { rt, services };
}
function signer() {
  const signSend = vi.fn(async () => ({ block: { type: "state" }, hash: "B".repeat(64) }));
  return { s: { account: async () => "nano_payer", signSend } as NanoSigner, signSend };
}
function door(amount = PRICE) {
  return vi.fn(async (_u: string, init: any) => init.headers["payment-signature"]
    ? new Response('{"hash":"ok"}', { status: 200, headers: { "content-type": "application/json" } })
    : new Response("{}", { status: 402, headers: { "payment-required": enc(quote(amount)) } }));
}
const msg = (text: string) => ({ content: { text } }) as any;

describe("ElizaOS plugin wiring", () => {
  it("exports a plugin with the service and the PAY_NANO_X402 action", () => {
    expect(plugin.name).toBe("nano-x402");
    expect(plugin.services).toContain(NanoX402Service);
    expect(plugin.actions?.map((a) => a.name)).toEqual(["PAY_NANO_X402"]);
  });
  it("extracts the target URL from the message or options", () => {
    expect(targetUrl(msg(`fetch ${URL1}.`))).toBe(URL1);
    expect(targetUrl(msg("no url here"))).toBeUndefined();
    expect(targetUrl(msg("x"), { url: URL1 })).toBe(URL1);
  });
  it("validate is false without the service or without a URL", async () => {
    const { rt, services } = runtime({});
    expect(await payNanoX402Action.validate(rt, msg(URL1))).toBe(false);
    services.set(NANO_X402_SERVICE, {});
    expect(await payNanoX402Action.validate(rt, msg("hello"))).toBe(false);
    expect(await payNanoX402Action.validate(rt, msg(URL1))).toBe(true);
  });
});

describe("PAY_NANO_X402 handler through the service guard", () => {
  function setup(settings: Record<string, string> = {}) {
    const { rt, services } = runtime({ NANO_PAYTO_ALLOWLIST: SELLER, NANO_MAX_PER_CALL: "0.001", NANO_MAX_TOTAL: "0.002", NANO_SEED: SEED, ...settings });
    const { s, signSend } = signer();
    const svc = new NanoX402Service(rt, s);
    services.set(NANO_X402_SERVICE, svc);
    const f = door();
    const orig = svc.payAndFetch.bind(svc);
    svc.payAndFetch = (u, o = {}) => orig(u, { ...o, fetch: f as any });
    return { rt, svc, signSend, f };
  }
  it("pays once and returns the block hash via callback and ActionResult", async () => {
    const { rt, signSend } = setup();
    const cb = vi.fn(async () => []);
    const r = await payNanoX402Action.handler(rt, msg(`buy ${URL1}`), undefined, {}, cb) as any;
    expect(r.success).toBe(true);
    expect(r.data.blockHash).toBe("B".repeat(64));
    expect(signSend).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].text).toContain("B".repeat(64));
  });
  it("a second invocation for the same request never signs a second block", async () => {
    const { rt, signSend } = setup();
    await payNanoX402Action.handler(rt, msg(URL1), undefined, {});
    const r2 = await payNanoX402Action.handler(rt, msg(URL1), undefined, {}) as any;
    expect(r2.success).toBe(false);
    expect(signSend).toHaveBeenCalledTimes(1);
  });
  it("cumulative cap for the runtime is enforced across different requests", async () => {
    const { rt, signSend } = setup();
    for (const q of ["a", "b", "c"]) await payNanoX402Action.handler(rt, msg(`${URL1}&q=${q}`), undefined, {});
    expect(signSend).toHaveBeenCalledTimes(2);
  });
  it("payTo outside the allowlist is refused without signing", async () => {
    const { rt, signSend } = setup({ NANO_PAYTO_ALLOWLIST: "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3" });
    const r = await payNanoX402Action.handler(rt, msg(URL1), undefined, {}) as any;
    expect(r.success).toBe(false);
    expect(r.text).toMatch(/refused/);
    expect(signSend).not.toHaveBeenCalled();
  });
  it("an empty allowlist fails closed at service start, without echoing the seed", () => {
    const { rt } = runtime({ NANO_PAYTO_ALLOWLIST: "", NANO_SEED: SEED });
    let err = "";
    try { new NanoX402Service(rt); } catch (e) { err = String(e); }
    expect(err).not.toBe("");
    expect(err).not.toContain(SEED);
  });
  it("never echoes the seed in action output, even on signer errors", async () => {
    const { rt, svc } = setup();
    (svc as any).signer = undefined; // force the real seed signer, whose account lookup will fail offline
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const cb = vi.fn(async () => []);
    const r = await payNanoX402Action.handler(rt, msg(URL1), undefined, {}, cb) as any;
    vi.unstubAllGlobals();
    expect(r.success).toBe(false);
    expect(JSON.stringify(r) + JSON.stringify(cb.mock.calls)).not.toContain(SEED);
  });
  it("the default seed signer derives without exposing the seed", async () => {
    const { rt } = runtime({ NANO_PAYTO_ALLOWLIST: SELLER, NANO_SEED: SEED });
    const svc = new NanoX402Service(rt);
    expect(require("node:util").inspect(svc, { depth: 5 })).not.toContain(SEED);
  });
});
