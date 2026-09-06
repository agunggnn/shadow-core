import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { assertInteractiveHumanSession, listCredentials, promptSecret, revealCredential, setCredential } from "./creds.mjs";
import { Grimoire } from "./hetzer-vault.mjs";

test("creds module can list, set, and reveal credentials in Grimoire Vault", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hetzer-creds-test-"));
    fs.mkdirSync(path.join(root, "data"));
    const envFile = path.join(root, ".env");
    const masterKey = "test-master-key-for-creds-unit-testing-32chars";
    fs.writeFileSync(envFile, `HETZER_GRIMOIRE_KEY=${masterKey}\n`);

    // List initially
    const listInitial = listCredentials({ root, envFile });
    assert.ok(listInitial.length >= 6);
    const initialPass = listInitial.find((item) => item.id === "nine-router-initial-password");
    assert.equal(initialPass.configured, false);

    // Set a credential
    const setResult = setCredential({
        root,
        envFile,
        id: "nine-router-initial-password",
        secret: "my-super-secret-password-123",
    });
    assert.equal(setResult.id, "nine-router-initial-password");
    assert.equal(setResult.envVar, "NINE_ROUTER_INITIAL_PASSWORD");

    // Check .env content
    const envContent = fs.readFileSync(envFile, "utf8");
    assert.match(envContent, /NINE_ROUTER_INITIAL_PASSWORD=secretRef:nine-router-initial-password/);
    assert.doesNotMatch(envContent, /my-super-secret-password-123/);

    // Reveal credential
    const revealed = revealCredential({
        root,
        envFile,
        id: "nine-router-initial-password",
    });
    assert.equal(revealed.secret, "my-super-secret-password-123");
    assert.equal(revealed.module, "9router");
    assert.ok(revealed.usage.length > 0);

    // Update credential
    setCredential({
        root,
        envFile,
        id: "nine-router-initial-password",
        secret: "updated-password-456",
    });
    const updated = revealCredential({
        root,
        envFile,
        id: "nine-router-initial-password",
    });
    assert.equal(updated.secret, "updated-password-456");

    fs.rmSync(root, { recursive: true, force: true });
});

test("promptSecret reads from non-TTY input stream cleanly", async () => {
    const input = Readable.from(["my-streamed-secret\n"]);
    const secret = await promptSecret("Prompt: ", { input, output: { write: () => {} } });
    assert.equal(secret, "my-streamed-secret");
});

test("assertInteractiveHumanSession blocks non-TTY or agent environments", () => {
    // Save original env
    const origOverride = process.env.HETZER_ALLOW_NON_INTERACTIVE_REVEAL;
    const origCursor = process.env.CURSOR_PROJECT_DIR;
    const origAntigravity = process.env.ANTIGRAVITY_AGENT;
    delete process.env.HETZER_ALLOW_NON_INTERACTIVE_REVEAL;

    try {
        // In this automated test process, stdin is either non-TTY or ANTIGRAVITY_AGENT is set
        assert.throws(() => {
            assertInteractiveHumanSession();
        }, /Access Denied/);

        // Allowed when explicit override is provided
        process.env.HETZER_ALLOW_NON_INTERACTIVE_REVEAL = "1";
        assert.doesNotThrow(() => {
            assertInteractiveHumanSession();
        });
    } finally {
        if (origOverride !== undefined) process.env.HETZER_ALLOW_NON_INTERACTIVE_REVEAL = origOverride;
        else delete process.env.HETZER_ALLOW_NON_INTERACTIVE_REVEAL;
        if (origCursor !== undefined) process.env.CURSOR_PROJECT_DIR = origCursor;
        else delete process.env.CURSOR_PROJECT_DIR;
        if (origAntigravity !== undefined) process.env.ANTIGRAVITY_AGENT = origAntigravity;
        else delete process.env.ANTIGRAVITY_AGENT;
    }
});

