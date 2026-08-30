import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { setModuleEnabled } from "./toggle.mjs";

const builtinFile = path.resolve("cli", "modules", "builtin.json");

test("module install and remove update state without deleting the recipe", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-toggle-"));
    const recipe = path.join(root, "modules", "cognee");
    fs.mkdirSync(recipe, { recursive: true });
    fs.writeFileSync(path.join(recipe, "module.json"), JSON.stringify({
        id: "cognee", lifecycle: "external", surface: "headless", defaultEnabled: false, services: [],
    }));
    const envFile = path.join(root, ".env");
    fs.writeFileSync(envFile, "SHADOW_ENABLED_MODULES=\nSHADOW_DISABLED_MODULES=\n");

    setModuleEnabled({ root, envFile, moduleId: "cognee", enabled: true, builtinFile });
    assert.match(fs.readFileSync(envFile, "utf8"), /SHADOW_ENABLED_MODULES=cognee/);
    setModuleEnabled({ root, envFile, moduleId: "cognee", enabled: false, builtinFile });
    assert.match(fs.readFileSync(envFile, "utf8"), /SHADOW_DISABLED_MODULES=cognee/);
    assert.equal(fs.existsSync(path.join(recipe, "module.json")), true);
    fs.rmSync(root, { recursive: true, force: true });
});
