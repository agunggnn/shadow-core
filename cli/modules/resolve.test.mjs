import assert from "node:assert/strict";
import test from "node:test";

import { resolveModuleProfiles } from "./resolve.mjs";

const module = (id, requires = [], options = {}) => ({
    id, profile: id, requires, enabled: true, lifecycle: "compose", ...options,
});

test("module resolution follows dependencies and active all selection", () => {
    const registry = { modules: [
        module("core"),
        module("cognee", ["core"]),
        module("later", ["core"], { enabled: false }),
    ] };
    assert.deepEqual(resolveModuleProfiles({ registry, target: "cognee" }), ["core", "cognee"]);
    assert.deepEqual(resolveModuleProfiles({ registry, target: "*" }), ["core", "cognee"]);
});

test("inactive modules must be explicitly installed before start", () => {
    assert.throws(() => resolveModuleProfiles({
        registry: { modules: [module("core"), module("cognee", ["core"], { enabled: false })] },
        target: "cognee",
    }), /shadow install cognee/);
});
