import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runInstallWizard } from "./install-wizard.mjs";

test("runInstallWizard applies 9Router default automatically when nonInteractive", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-wizard-test-"));
    try {
        const envFile = path.join(tempDir, ".env");
        fs.writeFileSync(envFile, "SHADOW_ENABLED_MODULES=\n");

        const result = await runInstallWizard({
            root: tempDir,
            envFile,
            moduleId: "cognee",
            nonInteractive: true,
        });

        assert.equal(result.configured, true);
        assert.equal(result.mode, "9router-default");

        const envContent = fs.readFileSync(envFile, "utf8");
        assert.match(envContent, /COGNEE_LLM_ENDPOINT=http:\/\/host\.docker\.internal:20140\/v1/);
        assert.match(envContent, /COGNEE_LLM_API_KEY=shadow-default/);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
