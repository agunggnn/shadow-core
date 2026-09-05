import assert from "node:assert/strict";
import test from "node:test";

import { renderTui } from "./tui.mjs";

test("terminal view renders observed values without dashboard or invented gauges", () => {
    const output = renderTui({
        root: "/hetzer",
        generatedAt: "2026-08-30T00:00:00.000Z",
        docker: { state: "offline", detail: "Docker not installed" },
        vault: { state: "n/a", detail: "not initialized" },
        mcp: { state: "ready", detail: "4 registered tools" },
        services: [{
            id: "9router",
            label: "9Router",
            state: "offline",
            endpoint: "http://127.0.0.1:20140",
            detail: "unreachable",
        }],
        warnings: [],
    }, { color: false });

    assert.match(output, /Docker not installed/);
    assert.match(output, /4 registered tools/);
    assert.match(output, /Values are observed/);
    assert.doesNotMatch(output, /Dashboard|Atlas|85%|laguna|Hermes/);
});
