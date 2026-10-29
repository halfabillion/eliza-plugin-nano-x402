# eliza-plugin-nano-x402

An ElizaOS plugin that lets an agent pay Nano (XNO) x402 `exact` quotes on `nano:mainnet`, behind a payment guard that runs before anything is signed.

- **Service** `NanoX402Service` (`nano_x402`): one guard and one signer per agent runtime.
- **Action** `PAY_NANO_X402`: fetch a URL; if it answers 402 with a Nano exact quote, pay it within the operator's caps and return the body plus the send-block hash.
- Pinned to `@elizaos/core` **1.7.2**. Wraps the x402 exact scheme with `nanocurrency` 2.5.0 for block signing.

## Guard (all checked before signing)
- Wrong network refused (default `nano:mainnet`).
- `payTo` not in `NANO_PAYTO_ALLOWLIST` refused. An empty allowlist fails closed at service start.
- Amount above `NANO_MAX_PER_CALL` refused; cumulative spend above `NANO_MAX_TOTAL` for the runtime's life refused.
- A second invocation for the same request never signs a second block (including concurrent calls).
- A redirect to another origin is never paid. Malformed quotes are refused.
- The quote is used within `maxTimeoutSeconds` and re-fetched when older; a quote that expires while signing sends nothing.
- One send block per call; no automatic paid retry after a non-2xx. The same signed payload is re-presented only while the seller returns `X-Nano-Represent`.
- No secrets in the package. The seed is read from the `NANO_SEED` environment variable (or a signer you inject), stays inside the signer closure, and is never returned, logged or printed. Do not put `NANO_SEED` in the character file: ElizaOS persists the character, secrets included, to its database.

## Install
```bash
npm install --ignore-scripts eliza-plugin-nano-x402 @elizaos/core@1.7.2
```

## Use in your agent
```ts
import nanoX402Plugin from "eliza-plugin-nano-x402";

export const character = {
  name: "NanoBuyer",
  plugins: [],
  settings: {
    NANO_PAYTO_ALLOWLIST: "nano_1xug1q5t7nxoj3ywwzokiea9jz8fq8qfgzp8pbyfr3co3e5xgj755uofu8ue", // pursekeeper.dev
    NANO_MAX_PER_CALL: "0.001",
    NANO_MAX_TOTAL: "0.01",
  },
};
// project: { agents: [{ character, plugins: [nanoX402Plugin] }] }
// environment: NANO_SEED=<64-hex seed of a small, capped account>
```
Ask the agent "fetch https://pursekeeper.dev/v1/fetch?url=https://example.com" and the runtime selects and runs `PAY_NANO_X402`.

## One-call example (runs in the ElizaOS runtime, no LLM key needed)
`example/agent.mjs` starts an `AgentRuntime` with `@elizaos/plugin-sql` (local PGlite) and this plugin, then runs `PAY_NANO_X402` through the runtime's own action pipeline (`runtime.processActions`) against `https://pursekeeper.dev/v1/fetch?url=https://example.com` (Ӿ0.001).
```bash
cd example
npm install --ignore-scripts
NANO_SEED=<64-hex seed> npm start
# prints the agent's reply with the block hash, then {"success":true,"blockHash":"…","status":200}
```
Override the target with `NANO_X402_URL`, and the payee allowlist and caps with `NANO_PAYTO_ALLOWLIST`, `NANO_MAX_PER_CALL`, `NANO_MAX_TOTAL`. Optional `NANO_RPC` (node RPC for `account_info`) and `NANO_WORK_URL` (work server); by default account info comes from pursekeeper.dev's free `/v1/account_info` and work from the door's `/v1/work`, falling back to local CPU work.

## Tests
```bash
npm install --ignore-scripts && npm test
```
33 offline tests against a mocked 402: wrong network, payTo allowlist, per-call cap, cumulative cap, no second block (including concurrent), cross-origin redirect never paid, malformed quotes, stale quote refused (including expiry during signing), no paid retry after non-2xx, same-block re-present only, plus the ElizaOS wiring: plugin shape, URL extraction, `validate`, handler pays once per request, cumulative cap across actions, allowlist refusal, fail-closed empty allowlist, and the seed never appearing in any output.

## Licence
MIT
