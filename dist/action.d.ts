import type { Action, Memory } from "@elizaos/core";
/** The URL to buy: an explicit `options.url`, else the first http(s) URL in the message text. */
export declare function targetUrl(message: Memory, options?: Record<string, unknown>): string | undefined;
export declare const payNanoX402Action: Action;
