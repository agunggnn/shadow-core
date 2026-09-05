import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { initializeProject } from "./cli.mjs";
import { parseEnv } from "./env.mjs";

test("initializeProject creates a secured, repeatable project contract", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-core-init-"));
    const initResult = initializeProject(root);
    assert.ok(initResult.initialPassword && initResult.initialPassword.length > 0);
    const first = fs.readFileSync(path.join(root, ".env"), "utf8");
    const values = parseEnv(first);
    assert.match(values.NINE_ROUTER_JWT_SECRET, /^secretRef:/);
    assert.ok(values.SHADOW_GRIMOIRE_KEY.length >= 32);
    assert.equal(fs.existsSync(path.join(root, "data", "shadow-vault.db")), true);
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
