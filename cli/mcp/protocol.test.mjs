import assert from "node:assert/strict";
import test from "node:test";

import { handleMcpRequest } from "./protocol.mjs";

const catalog = {
    definitions: [{ name: "shadow_test", description: "Test", inputSchema: { type: "object" } }],
    async call(name) {
        if (name !== "shadow_test") throw new Error(`Unknown tool '${name}'.`);
        return { ok: true };
    },
};

test("MCP bridge supports stateless discovery and tool calls", async () => {
    const discover = await handleMcpRequest({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }, catalog);
    assert.ok(discover.result.supportedVersions.length > 0);
    const called = await handleMcpRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "shadow_test", arguments: {} },
    }, catalog);
    assert.deepEqual(called.result.structuredContent, { ok: true });
});
