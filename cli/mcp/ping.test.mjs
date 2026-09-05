import assert from "node:assert/strict";
import test from "node:test";

import { pingMcpServer } from "./ping.mjs";

test("pingMcpServer handles successful JSON-RPC initialize and tools/list", async () => {
    const mockFetch = async (url, options) => {
        const body = JSON.parse(options.body);
        if (body.method === "initialize") {
            return {
                ok: true,
                status: 200,
                statusText: "OK",
                json: async () => ({
                    jsonrpc: "2.0",
                    id: 1,
                    result: {
                        protocolVersion: "2025-11-25",
                        serverInfo: { name: "test-mcp", version: "1.0.0" },
                    },
                }),
            };
        }
        if (body.method === "tools/list") {
            return {
                ok: true,
                status: 200,
                statusText: "OK",
                json: async () => ({
                    jsonrpc: "2.0",
                    id: 2,
                    result: {
                        tools: [
                            { name: "test_tool", description: "A sample testing tool" },
                        ],
                    },
                }),
            };
        }
        return { ok: false, status: 404, statusText: "Not Found" };
    };

    const result = await pingMcpServer({
        url: "http://127.0.0.1:8001/mcp",
        fetchFn: mockFetch,
    });

    assert.equal(result.ok, true);
    assert.equal(result.serverInfo.name, "test-mcp");
    assert.equal(result.protocolVersion, "2025-11-25");
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, "test_tool");
});

test("pingMcpServer handles connection error or rejection gracefully", async () => {
    const failingFetch = async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:8001");
    };

    const result = await pingMcpServer({
        url: "http://127.0.0.1:8001/mcp",
        fetchFn: failingFetch,
    });

    assert.equal(result.ok, false);
    assert.match(result.error, /ECONNREFUSED/);
});
