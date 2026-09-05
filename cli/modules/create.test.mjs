import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createModuleRecipe, createModuleRecipeFromSource } from "./create.mjs";
import { validateModuleRecipe } from "./validate.mjs";

test("createModuleRecipe generates a valid recipe passing validateModuleRecipe", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-create-test-"));
    try {
        const result = createModuleRecipe({
            root: tempDir,
            moduleId: "my-service",
            label: "My Custom Service",
            port: 9000,
            mcp: true,
            webUi: true,
            sourceUrl: "https://github.com/my-org/my-service",
        });

        assert.equal(fs.existsSync(result.manifestFile), true);
        assert.equal(fs.existsSync(result.composeFile), true);
        assert.equal(fs.existsSync(result.readmeFile), true);
        assert.equal(result.sourceUrl, "https://github.com/my-org/my-service");

        // Run validation on the generated recipe!
        const validation = validateModuleRecipe({ root: tempDir, moduleId: "my-service" });
        assert.equal(validation.valid, true);
        assert.equal(validation.errors.length, 0);
        assert.ok(validation.passed.some((p) => p.includes("Loopback") || p.includes("127.0.0.1") || p.includes("loopback")));
        assert.ok(validation.passed.some((p) => p.includes("no-new-privileges")));
        assert.ok(validation.passed.some((p) => p.includes("MCP Server terdaftar")));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("createModuleRecipeFromSource analyzes source content and generates valid recipe", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-create-src-test-"));
    try {
        const sampleReadme = `
# SearXNG Engine
A privacy-respecting metasearch engine.
EXPOSE 8888
Available web UI dashboard.
        `;

        const mockFetch = async () => {
            throw new Error("ECONNREFUSED");
        };

        const result = await createModuleRecipeFromSource({
            root: tempDir,
            moduleId: "searxng",
            source: sampleReadme,
            fetchFn: mockFetch,
        });

        assert.equal(fs.existsSync(result.manifestFile), true);
        assert.equal(fs.existsSync(result.composeFile), true);

        const manifest = JSON.parse(fs.readFileSync(result.manifestFile, "utf8"));
        assert.equal(manifest.id, "searxng");
        assert.equal(manifest.services[0].fallbackPort, 8888);

        const validation = validateModuleRecipe({ root: tempDir, moduleId: "searxng" });
        assert.equal(validation.valid, true);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("createModuleRecipe throws error on duplicate or invalid module id", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-create-test2-"));
    try {
        assert.throws(
            () => createModuleRecipe({ root: tempDir, moduleId: "INVALID_ID" }),
            /tidak valid/
        );

        createModuleRecipe({ root: tempDir, moduleId: "my-mod" });
        assert.throws(
            () => createModuleRecipe({ root: tempDir, moduleId: "my-mod" }),
            /sudah ada/
        );
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
