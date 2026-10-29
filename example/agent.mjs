// One paid call from an ElizaOS agent: the runtime loads the plugin, starts the NanoX402Service,
// and runs the PAY_NANO_X402 action through its own action pipeline (runtime.processActions).
// Settings come from the environment: NANO_SEED (secret), NANO_PAYTO_ALLOWLIST, optional caps.
import { AgentRuntime, ChannelType, stringToUuid } from "@elizaos/core";
import sqlPlugin, { createDatabaseAdapter } from "@elizaos/plugin-sql";
import nanoX402Plugin from "eliza-plugin-nano-x402";

const DOOR = process.env.NANO_X402_URL ?? "https://pursekeeper.dev/v1/fetch?url=https://example.com";
// pursekeeper.dev's payTo, as quoted in its 402; override with your own allowlist.
process.env.NANO_PAYTO_ALLOWLIST ??= "nano_1xug1q5t7nxoj3ywwzokiea9jz8fq8qfgzp8pbyfr3co3e5xgj755uofu8ue";
process.env.NANO_MAX_PER_CALL ??= "0.001";
process.env.NANO_MAX_TOTAL ??= "0.002";
process.env.PGLITE_DATA_DIR ??= ".eliza-db";

const character = {
  name: "NanoBuyer",
  bio: ["An agent that can buy small x402 resources with Nano, within caps its operator sets."],
  // NANO_SEED is NOT put in the character: ElizaOS stores the character in its database.
  // The plugin reads it from the process environment instead, and never prints it.
  settings: {
    NANO_PAYTO_ALLOWLIST: process.env.NANO_PAYTO_ALLOWLIST,
    NANO_MAX_PER_CALL: process.env.NANO_MAX_PER_CALL,
    NANO_MAX_TOTAL: process.env.NANO_MAX_TOTAL,
  },
};

// Local PGlite store, migrated before the runtime starts (what `elizaos start` does for you).
const agentId = stringToUuid(character.name);
const adapter = createDatabaseAdapter({ dataDir: process.env.PGLITE_DATA_DIR }, agentId);
await adapter.init();
await adapter.runPluginMigrations([{ name: sqlPlugin.name, schema: sqlPlugin.schema }], { verbose: false });

const runtime = new AgentRuntime({ agentId, character, adapter, plugins: [sqlPlugin, nanoX402Plugin] });
await runtime.initialize({ skipMigrations: true });

const roomId = stringToUuid("nano-x402-example-room");
const userId = stringToUuid("nano-x402-example-user");
await runtime.ensureConnection({ entityId: userId, roomId, worldId: stringToUuid("nano-x402-example-world"),
  userName: "operator", name: "operator", source: "example", type: ChannelType.DM });
const message = {
  id: stringToUuid(`msg-${Date.now()}`), entityId: userId, agentId: runtime.agentId, roomId,
  content: { text: `Fetch ${DOOR} and pay in Nano if it asks.`, source: "example", channelType: ChannelType.DM },
  createdAt: Date.now(),
};
// The agent's planned response selects the action; the runtime validates and runs it.
const response = {
  id: stringToUuid(`resp-${Date.now()}`), entityId: runtime.agentId, agentId: runtime.agentId, roomId,
  content: { text: "Buying it with Nano within my caps.", actions: ["PAY_NANO_X402"], source: "example" },
  createdAt: Date.now(),
};

await runtime.processActions(message, [response], undefined, async (content) => {
  console.log(content.text);
  return [];
});
const [result] = runtime.getActionResults(message.id);
console.log(JSON.stringify({ success: result?.success, blockHash: result?.data?.blockHash ?? null, status: result?.data?.status ?? null }));
await runtime.stop?.();
process.exit(result?.success ? 0 : 1);
