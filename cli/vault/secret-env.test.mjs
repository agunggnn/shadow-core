import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Grimoire } from "./hetzer-vault.mjs";
import { resolveSecretEnvironment } from "./secret-env.mjs";

test("secret environment resolves explicit references without exposing unrelated credentials", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hetzer-secret-env-"));
    fs.mkdirSync(path.join(root, "data"));
    const masterKey = "test-secret-environment-master-key-long-enough";
    const vault = new Grimoire({ dbPath: path.join(root, "data", "hetzer-vault.db"), masterKey });
    vault.create({ id: "worker-token", projectId: "worker", keyName: "token", secret: "resolved-value" });
    vault.create({ id: "unrelated-token", projectId: "other", keyName: "token", secret: "must-not-leak" });
    vault.close();
    const envFile = path.join(root, ".env");
    fs.writeFileSync(envFile, "WORKER_TOKEN=secretRef:worker-token\nPLAIN_SETTING=visible\n");

    const env = resolveSecretEnvironment({
        root,
        envFile,
        baseEnv: { HETZER_GRIMOIRE_KEY: masterKey },
        allowNames: ["WORKER_TOKEN"],
    });
    assert.equal(env.WORKER_TOKEN, "resolved-value");
    assert.equal(env.UNRELATED_TOKEN, undefined);
    assert.equal(env.PLAIN_SETTING, undefined);

    const empty = resolveSecretEnvironment({ root, envFile, baseEnv: {}, allowNames: [] });
    assert.equal(empty.WORKER_TOKEN, undefined);
    fs.rmSync(root, { recursive: true, force: true });
});
