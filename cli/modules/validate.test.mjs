import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatValidationReport, validateAllModules, validateModuleRecipe } from "./validate.mjs";

test("validateModuleRecipe detects valid recipe in existing cognee module", () => {
    const result = validateModuleRecipe({ root: ".", moduleId: "cognee" });
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
    assert.ok(result.passed.length >= 8);
    const text = formatValidationReport(result);
    assert.match(text, /Status: Module 'cognee' VALID/);
});

test("validateModuleRecipe catches invalid JSON and missing files", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hetzer-val-test-"));
    try {
        const modDir = path.join(tempDir, "modules", "bad-mod");
        fs.mkdirSync(modDir, { recursive: true });

        // Missing module.json
        const resMissing = validateModuleRecipe({ root: tempDir, moduleId: "bad-mod" });
        assert.equal(resMissing.valid, false);
        assert.match(resMissing.errors[0], /module.json' not found/);

        // Corrupted module.json
        fs.writeFileSync(path.join(modDir, "module.json"), "{ invalid json");
        const resCorrupt = validateModuleRecipe({ root: tempDir, moduleId: "bad-mod" });
        assert.equal(resCorrupt.valid, false);
        assert.match(resCorrupt.errors[0], /Failed to parse/);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("validateModuleRecipe flags insecure 0.0.0.0 ports and missing compose profile", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hetzer-val-test2-"));
    try {
        const modDir = path.join(tempDir, "modules", "insecure-mod");
        fs.mkdirSync(modDir, { recursive: true });

        fs.writeFileSync(path.join(modDir, "module.json"), JSON.stringify({
            schemaVersion: 1,
            id: "insecure-mod",
            label: "Insecure Mod",
            version: "1",
            profile: "insecure-mod",
            lifecycle: "compose",
            surface: "headless",
            requires: ["core"],
            composeFiles: ["docker-compose.yml"],
            services: [{ id: "srv1" }],
        }, null, 2));

        // Compose file with 0.0.0.0 open port and no profiles
        fs.writeFileSync(path.join(modDir, "docker-compose.yml"), `services:
  srv1:
    image: test:latest
    ports:
      - "8080:8080"
`);

        const res = validateModuleRecipe({ root: tempDir, moduleId: "insecure-mod" });
        assert.equal(res.valid, true); // It's valid schema-wise but has security warnings
        assert.ok(res.warnings.some((w) => w.includes("profiles: [insecure-mod]")));
        assert.ok(res.warnings.some((w) => w.includes("exposed to all interfaces")));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("validateAllModules inspects all available modules", () => {
    const results = validateAllModules({ root: "." });
    assert.ok(results.length >= 1);
    const cognee = results.find((r) => r.id === "cognee");
    assert.ok(cognee);
    assert.equal(cognee.valid, true);
});
