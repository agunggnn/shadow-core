import assert from "node:assert/strict";
import test from "node:test";

import { analyzeContainerFailure, askReasoner, checkReasonerStatus } from "./reasoner.mjs";

test("checkReasonerStatus detects running 9Router server", async () => {
    const mockFetch = async (url) => {
        if (url.includes("/api/health")) {
            return { ok: true, status: 200 };
        }
        return { ok: false, status: 404 };
    };

    const status = await checkReasonerStatus({
        root: ".",
        fetchFn: mockFetch,
    });
    assert.equal(status.available, true);
    assert.equal(status.status, 200);
});

test("askReasoner calls chat completions endpoint and returns content", async () => {
    const mockFetch = async (url, options) => {
        const body = JSON.parse(options.body);
        assert.equal(body.messages[1].content, "ping");
        return {
            ok: true,
            status: 200,
            json: async () => ({
                model: "openai/gpt-4o-mini",
                choices: [{ message: { content: "pong" } }],
            }),
        };
    };

    const res = await askReasoner({
        prompt: "ping",
        root: ".",
        fetchFn: mockFetch,
    });
    assert.equal(res.ok, true);
    assert.equal(res.content, "pong");
});

test("analyzeContainerFailure uses static heuristics fallback when 9Router offline", async () => {
    const mockOfflineFetch = async () => {
        throw new Error("ECONNREFUSED");
    };

    const res = await analyzeContainerFailure({
        serviceId: "cognee-mcp",
        logs: "PermissionError: [Errno 13] Permission denied: '/cognee-data/system'",
        composeContent: "volumes: - cognee_data:/cognee-data",
        root: ".",
        fetchFn: mockOfflineFetch,
    });

    assert.equal(res.ok, true);
    assert.equal(res.source, "static-heuristics");
    assert.match(res.cause, /Permission Denied/);
    assert.match(res.suggestion, /volume mount point/);
});

test("analyzeContainerFailure parses AI JSON response from 9Router", async () => {
    const mockAiFetch = async (url) => {
        if (url.includes("/api/health")) {
            return { ok: true, status: 200 };
        }
        return {
            ok: true,
            status: 200,
            json: async () => ({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            cause: "Container kehabisan memory RAM.",
                            suggestion: "Naikkan nilai mem_limit di compose menjadi 4g.",
                        }),
                    },
                }],
            }),
        };
    };

    const res = await analyzeContainerFailure({
        serviceId: "test-srv",
        logs: "Killed (OOM)",
        composeContent: "mem_limit: 100m",
        root: ".",
        fetchFn: mockAiFetch,
    });

    assert.equal(res.ok, true);
    assert.equal(res.source, "9router-ai");
    assert.match(res.cause, /memory/);
});
