import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    defaultHetzerHome,
    initializeProject,
    isHetzerWorkspace,
    main,
    printModuleHelp,
    resolveProjectRoot,
} from "./cli.mjs";
import { parseEnv } from "./env.mjs";

test("initializeProject creates a secured, repeatable project contract", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hetzer-core-init-"));
    const initResult = initializeProject(root);
    assert.ok(initResult.initialPassword && initResult.initialPassword.length > 0);
    const first = fs.readFileSync(path.join(root, ".env"), "utf8");
    const values = parseEnv(first);
    assert.match(values.NINE_ROUTER_JWT_SECRET, /^secretRef:/);
    assert.ok(values.HETZER_GRIMOIRE_KEY.length >= 32);
    assert.equal(fs.existsSync(path.join(root, "data", "hetzer-vault.db")), true);
    assert.equal(fs.existsSync(path.join(root, "modules", "cognee", "module.json")), true);

    initializeProject(root);
    assert.equal(fs.readFileSync(path.join(root, ".env"), "utf8"), first);
    fs.rmSync(root, { recursive: true, force: true });
});

test("Compose startup encodes dynamic route chunks before 9Router starts", () => {
    const template = fs.readFileSync(path.resolve(import.meta.dirname, "..", "templates", "docker-compose.yml"), "utf8");
    assert.match(template, /replaceAll\("%5B","%255B"\)/);
    assert.match(template, /replaceAll\("%5D","%255D"\)/);
    assert.ok(template.indexOf("Encoded dynamic route paths") < template.indexOf("exec node custom-server.js"));
});

test("defaultHetzerHome resolves ~/.hetzer or HETZER_HOME", () => {
    const home = defaultHetzerHome();
    assert.ok(home.endsWith(".hetzer"));

    const prev = process.env.HETZER_HOME;
    try {
        process.env.HETZER_HOME = "/custom/hetzer/home";
        assert.equal(defaultHetzerHome(), path.resolve("/custom/hetzer/home"));
    } finally {
        if (prev === undefined) delete process.env.HETZER_HOME;
        else process.env.HETZER_HOME = prev;
    }
});

test("isHetzerWorkspace and resolveProjectRoot identify local workspace vs global fallback", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hetzer-resolve-test-"));
    try {
        assert.equal(isHetzerWorkspace(tempDir), false);

        const customRoot = resolveProjectRoot({ root: tempDir });
        assert.equal(customRoot, tempDir);

        // Fake hetzer workspace
        fs.writeFileSync(path.join(tempDir, "docker-compose.yml"), "services:\n  nine-router:\n    image: test\n");
        fs.writeFileSync(path.join(tempDir, ".env"), "HETZER_PROJECT_NAME=test\n");
        assert.equal(isHetzerWorkspace(tempDir), true);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("printModuleHelp renders native module guide for 9router and cognee", () => {
    let output = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = (chunk) => {
        output += chunk;
        return true;
    };
    try {
        printModuleHelp("9router", ".", { NINE_ROUTER_PORT: "20140" });
        assert.match(output, /NATIVE MODULE GUIDE: 9Router/);
        assert.match(output, /hetzer up 9router/);
        assert.match(output, /nine-router-initial-password/);
    } finally {
        process.stdout.write = originalWrite;
    }
});

test("install auto-scaffolds module directory from templates if missing in workspace", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hetzer-install-test-"));
    const originalStdout = process.stdout.write;
    process.stdout.write = () => true;
    try {
        fs.writeFileSync(path.join(tempDir, "docker-compose.yml"), "services:\n");
        fs.writeFileSync(path.join(tempDir, ".env"), "HETZER_ENABLED_MODULES=\nHETZER_DISABLED_MODULES=\n");
        assert.equal(fs.existsSync(path.join(tempDir, "modules", "cognee", "module.json")), false);

        await main(["install", "cognee"], { root: tempDir });

        assert.equal(fs.existsSync(path.join(tempDir, "modules", "cognee", "module.json")), true);
        const envContent = fs.readFileSync(path.join(tempDir, ".env"), "utf8");
        assert.match(envContent, /HETZER_ENABLED_MODULES=.*cognee/);
    } finally {
        process.stdout.write = originalStdout;
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("validate CLI command validates modules successfully", async () => {
    let output = "";
    const originalStdout = process.stdout.write;
    process.stdout.write = (chunk) => {
        output += chunk;
        return true;
    };
    try {
        await main(["validate", "cognee"], { root: "." });
        assert.match(output, /MODULE VALIDATION: cognee/);
        assert.match(output, /Status: Module 'cognee' VALID/);
    } finally {
        process.stdout.write = originalStdout;
    }
});


