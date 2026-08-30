import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Grimoire } from "./shadow-vault.mjs";
import { migrateEnvCredentials } from "./migrate-env.mjs";

test("Cognee provider keys move from plaintext to scoped Vault references", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-cognee-key-"));
    const envFile = path.join(root, ".env");
    const masterKey = "test-migration-master-key-that-is-long-enough";
    fs.writeFileSync(envFile, `SHADOW_GRIMOIRE_KEY=${masterKey}\nCOGNEE_LLM_API_KEY=provider-secret\n`);

    const migrated = migrateEnvCredentials({ root, envFile, masterKey, authorizationRef: "user:test-approval" });
    assert.deepEqual(migrated, ["COGNEE_LLM_API_KEY"]);
    assert.match(fs.readFileSync(envFile, "utf8"), /COGNEE_LLM_API_KEY=secretRef:cognee-llm-api-key/);
    const vault = new Grimoire({ dbPath: path.join(root, "data", "shadow-vault.db"), masterKey });
    assert.equal(vault.resolveRef("secretRef:cognee-llm-api-key", {
        targetId: "cognee",
        action: "compose.start",
    }), "provider-secret");
    vault.close();
    fs.rmSync(root, { recursive: true, force: true });
});
