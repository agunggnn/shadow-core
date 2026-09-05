import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { loadModuleRegistry, publicModuleSummary } from "./registry.mjs";

const builtinFile = path.resolve("cli", "modules", "builtin.json");
const root = path.resolve(".");

test("public registry contains core, 9router, and optional Cognee", () => {
    const registry = loadModuleRegistry({ builtinFile, root });
    assert.deepEqual(publicModuleSummary(registry).map((module) => module.id), ["core", "9router", "cognee"]);
    assert.equal(registry.services.find((service) => service.id === "9router").surface, "iframe");
    assert.equal(registry.services.some((service) => service.id === "cognee"), false);
});

test("Cognee exposes a validated HTTP MCP endpoint when enabled", () => {
    const registry = loadModuleRegistry({ builtinFile, root, enabledModules: "cognee" });
    const service = registry.services.find((entry) => entry.id === "cognee");
    assert.deepEqual(service.mcpServer, { name: "cognee", transport: "http", path: "/mcp" });
    assert.ok(registry.composeFiles.includes("modules/cognee/docker-compose.cognee.yml"));
});
