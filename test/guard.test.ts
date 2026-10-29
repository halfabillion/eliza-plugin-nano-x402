import { describe, it, expect, vi } from "vitest";
import { PaymentGuard, GuardRefusal, xnoToRaw } from "../src/guard.js";
import { paidFetch, type NanoSigner } from "../src/client.js";

const SELLER = "nano_1xug1q5t7nxoj3ywwzokiea9jz8fq8qfgzp8pbyfr3co3e5xgj755uofu8ue";
const OTHER = "nano_3t6k35gi95xu6tergt6p69ck76ogmitsa8mnijtpxm9fkcm736xtoncuohr3";
const URL1 = "https://door.example/v1/hash?msg=hi";
const PRICE = xnoToRaw("0.001");

function quoteBody(over: Record<string, unknown> = {}, resourceUrl = URL1) {
  return {
    x402Version: 2,
    resource: { url: resourceUrl, description: "d", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: "nano:mainnet", amount: PRICE.toString(), asset: "XNO", payTo: SELLER,
      maxTimeoutSeconds: 60, extra: { workOptional: true }, ...over }],
  };
}
const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");
const r402 = (body: unknown) => new Response("{}", { status: 402, headers: { "payment-required": enc(body) } });

function mockFetch(quote: unknown, paid: () => Response = () => new Response("ok", { status: 200 })) {
  return vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
    const h = (init?.headers ?? {}) as Record<string, string>;
    return h["payment-signature"] ? paid() : r402(quote);
  });
}
function mockSigner() {
  let n = 0;
  const s: NanoSigner & { calls: number } = {
    calls: 0,
    account: async () => OTHER,
    signSend: async () => { s.calls++; n++; return { block: { type: "state", n }, hash: n.toString(16).padStart(64, "0") }; },
  };
  return s;
}
const guard = (o: Partial<ConstructorParameters<typeof PaymentGuard>[0]> = {}) =>
  new PaymentGuard({ payToAllowlist: [SELLER], maxPerCallRaw: PRICE, maxTotalRaw: PRICE * 3n, ...o });

describe("payment guard (offline, mocked 402)", () => {
  it("pays a valid quote once and presents one PAYMENT-SIGNATURE", async () => {
    const s = mockSigner(); const f = mockFetch(quoteBody());
    const r = await paidFetch(URL1, guard(), s, { fetch: f as any });
    expect(r.status).toBe(200); expect(r.paid).toBe(true); expect(s.calls).toBe(1);
    const sent = JSON.parse(Buffer.from((f.mock.calls[1][1]!.headers as any)["payment-signature"], "base64").toString());
    expect(sent.x402Version).toBe(2); expect(sent.accepted.payTo).toBe(SELLER); expect(sent.payload.block.type).toBe("state");
  });
  it("refuses the wrong network", async () => {
    const s = mockSigner();
    await expect(paidFetch(URL1, guard(), s, { fetch: mockFetch(quoteBody({ network: "nano:betanet" })) as any }))
      .rejects.toMatchObject({ code: "wrong_network" });
    expect(s.calls).toBe(0);
  });
  it("refuses a payTo outside the allowlist", async () => {
    const s = mockSigner();
    await expect(paidFetch(URL1, guard(), s, { fetch: mockFetch(quoteBody({ payTo: OTHER })) as any }))
      .rejects.toMatchObject({ code: "payto_not_allowed" });
    expect(s.calls).toBe(0);
  });
  it("refuses an amount above the per-call cap", async () => {
    const s = mockSigner();
    await expect(paidFetch(URL1, guard(), s, { fetch: mockFetch(quoteBody({ amount: (PRICE + 1n).toString() })) as any }))
      .rejects.toMatchObject({ code: "over_call_cap" });
    expect(s.calls).toBe(0);
  });
  it("refuses once the cumulative cap is reached", async () => {
    const s = mockSigner(); const g = guard({ maxTotalRaw: PRICE * 2n });
    const f = mockFetch(quoteBody());
    await paidFetch(URL1 + "&a=1", g, s, { fetch: mockFetch(quoteBody({}, URL1 + "&a=1")) as any });
    await paidFetch(URL1 + "&a=2", g, s, { fetch: mockFetch(quoteBody({}, URL1 + "&a=2")) as any });
    await expect(paidFetch(URL1, g, s, { fetch: f as any })).rejects.toMatchObject({ code: "over_total_cap" });
    expect(s.calls).toBe(2); expect(g.spent).toBe(PRICE * 2n);
  });
  it("never signs a second block for the same request", async () => {
    const s = mockSigner(); const g = guard();
    await paidFetch(URL1, g, s, { fetch: mockFetch(quoteBody()) as any });
    await expect(paidFetch(URL1, g, s, { fetch: mockFetch(quoteBody()) as any })).rejects.toMatchObject({ code: "duplicate" });
    expect(s.calls).toBe(1);
  });
  it("never signs twice for concurrent invocations of the same request", async () => {
    const s = mockSigner(); const g = guard();
    const res = await Promise.allSettled([1, 2].map(() => paidFetch(URL1, g, s, { fetch: mockFetch(quoteBody()) as any })));
    expect(res.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(s.calls).toBe(1);
  });
  it("does not retry with a new block after a paid non-2xx", async () => {
    const s = mockSigner(); const f = mockFetch(quoteBody(), () => new Response("boom", { status: 500 }));
    const r = await paidFetch(URL1, guard(), s, { fetch: f as any });
    expect(r.status).toBe(500); expect(s.calls).toBe(1); expect(f).toHaveBeenCalledTimes(2);
  });
  it("never pays a redirect to another origin", async () => {
    const s = mockSigner();
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/pay" } }));
    await expect(paidFetch(URL1, guard(), s, { fetch: f as any })).rejects.toMatchObject({ code: "cross_origin" });
    expect(s.calls).toBe(0); expect(f).toHaveBeenCalledTimes(1);
  });
  it("refuses a quote whose resource points at another origin", async () => {
    const s = mockSigner();
    await expect(paidFetch(URL1, guard(), s, { fetch: mockFetch(quoteBody({}, "https://evil.example/x")) as any }))
      .rejects.toMatchObject({ code: "cross_origin" });
    expect(s.calls).toBe(0);
  });
  it("does not follow redirects on the paid request", async () => {
    const s = mockSigner(); const f = mockFetch(quoteBody(), () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    const r = await paidFetch(URL1, guard(), s, { fetch: f as any });
    expect(r.status).toBe(302); expect(f).toHaveBeenCalledTimes(2);
    expect((f.mock.calls[1][1] as RequestInit).redirect).toBe("manual");
  });
  it.each([
    ["not base64 json", "%%%"],
    ["x402Version 1", enc({ ...quoteBody(), x402Version: 1 })],
    ["no accepts", enc({ ...quoteBody(), accepts: [] })],
    ["amount not integer", enc(quoteBody({ amount: "1.5" }))],
    ["payTo not nano", enc(quoteBody({ payTo: "0xabc" }))],
    ["asset not XNO", enc(quoteBody({ asset: "USDC" }))],
    ["missing resource", enc({ ...quoteBody(), resource: undefined })],
  ])("refuses a malformed quote: %s", async (_n, hdr) => {
    const s = mockSigner();
    const f = vi.fn(async () => new Response("{}", { status: 402, headers: { "payment-required": hdr } }));
    await expect(paidFetch(URL1, guard(), s, { fetch: f as any })).rejects.toBeInstanceOf(GuardRefusal);
    expect(s.calls).toBe(0);
  });
  it("refuses a stale quote instead of re-using it", () => {
    let t = 0; const g = guard({ now: () => t });
    const q = { required: quoteBody() as any, accepted: quoteBody().accepts[0] as any, origin: "https://door.example", receivedAt: 0 };
    t = 60_000;
    expect(() => g.authorize(q, URL1, "k")).toThrow(/stale_quote/);
  });
  it("refuses if the quote expires while signing, and releases the reservation", async () => {
    const g = guard();
    const s: NanoSigner = { account: async () => OTHER, signSend: async () => { (g as any).now = () => Date.now() + 61_000; return { block: {}, hash: "0".repeat(64) }; } };
    const f = mockFetch(quoteBody());
    await expect(paidFetch(URL1, g, s, { fetch: f as any })).rejects.toMatchObject({ code: "stale_quote" });
    expect(f).toHaveBeenCalledTimes(1); expect(g.spent).toBe(0n);
  });
  it("re-presents the same block (never a new one) while the seller confirms", async () => {
    const s = mockSigner(); let n = 0; const sigs: string[] = [];
    const f = vi.fn(async (_u: any, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      if (!h["payment-signature"]) return r402(quoteBody());
      sigs.push(h["payment-signature"]);
      return ++n < 3 ? new Response("{}", { status: 402, headers: { "x-nano-represent": "tok" } }) : new Response("ok");
    });
    const r = await paidFetch(URL1, guard(), s, { fetch: f as any, sleep: async () => {} });
    expect(r.status).toBe(200); expect(s.calls).toBe(1); expect(new Set(sigs).size).toBe(1);
  });
  it("passes through a free (non-402) response without signing", async () => {
    const s = mockSigner();
    const r = await paidFetch(URL1, guard(), s, { fetch: (async () => new Response("free")) as any });
    expect(r).toMatchObject({ status: 200, paid: false, body: "free" }); expect(s.calls).toBe(0);
  });
  it("never puts the seed in output (seed signer)", async () => {
    const { seedSigner } = await import("../src/signer.js");
    const seed = "a".repeat(64);
    const spy = vi.spyOn(console, "log"); const spyE = vi.spyOn(console, "error");
    const sg = seedSigner({ seed, fetch: (async () => new Response(JSON.stringify({ found: false }))) as any });
    await expect(sg.signSend({ payTo: SELLER, amount: PRICE, workRequired: false, origin: "https://door.example" })).rejects.toThrow(/no blocks/);
    for (const c of [...spy.mock.calls, ...spyE.mock.calls]) expect(JSON.stringify(c)).not.toContain(seed);
    expect(JSON.stringify(sg)).not.toContain(seed);
  });
});
