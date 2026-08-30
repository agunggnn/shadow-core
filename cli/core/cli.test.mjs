import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { initializeProject } from "./cli.mjs";
import { parseEnv } from "./env.mjs";

test("initializeProject creates a secured, repeatable project contract", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-core-init-"));
    initializeProject(root);
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
