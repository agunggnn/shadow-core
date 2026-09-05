import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    detectPlatforms,
    installSkill,
    installToCursor,
    installToCline,
} from "./installer.mjs";

test("detectPlatforms reports available agents and returns structured list", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-skill-detect-"));
    try {
        const list = detectPlatforms(tempDir);
        assert.ok(Array.isArray(list));
        assert.ok(list.length >= 3);
        const ids = list.map((p) => p.id);
        assert.ok(ids.includes("cursor"));
        assert.ok(ids.includes("claude"));
        assert.ok(ids.includes("cline"));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("installToCursor writes .cursor/rules/shadow-vault.mdc and .cursorrules", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-skill-cursor-"));
    try {
        const created = installToCursor(tempDir);
        assert.ok(created.length >= 2);

        const mdcFile = path.join(tempDir, ".cursor", "rules", "shadow-vault.mdc");
        assert.ok(fs.existsSync(mdcFile), ".cursor/rules/shadow-vault.mdc must exist");
        const mdcContent = fs.readFileSync(mdcFile, "utf8");
        assert.ok(mdcContent.includes("Zero-Plaintext"));
        assert.ok(mdcContent.includes("secretRef:"));

        const legacyFile = path.join(tempDir, ".cursorrules");
        assert.ok(fs.existsSync(legacyFile), ".cursorrules must exist");
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("installToCline writes .clinerules in workspace", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-skill-cline-"));
    try {
        const created = installToCline(tempDir);
        assert.ok(created.length >= 1);

        const clineFile = path.join(tempDir, ".clinerules");
        assert.ok(fs.existsSync(clineFile), ".clinerules must exist");
        const content = fs.readFileSync(clineFile, "utf8");
        assert.ok(content.includes("Zero-Plaintext"));
        assert.ok(content.includes("secretRef:"));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});

test("installSkill dispatches target correctly", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-skill-dispatch-"));
    try {
        const created = installSkill({ root: tempDir, target: "cursor" });
        assert.ok(created.length >= 2);
        assert.ok(fs.existsSync(path.join(tempDir, ".cursor", "rules", "shadow-vault.mdc")));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
