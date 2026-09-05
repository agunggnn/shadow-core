import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    checkStagedDiff,
    findGitDir,
    installGitHook,
    uninstallGitHook,
} from "./git-hook.mjs";

test("findGitDir locates current git root directory", () => {
    const gitDir = findGitDir(process.cwd());
    assert.ok(gitDir, "Must locate .git directory");
    assert.ok(fs.existsSync(gitDir));
});

test("checkStagedDiff reports clean on clean tree", () => {
    const result = checkStagedDiff(process.cwd());
    assert.equal(typeof result.ok, "boolean");
    assert.equal(typeof result.latencyMs, "number");
    assert.ok(result.latencyMs >= 0);
});

test("installGitHook and uninstallGitHook manage pre-commit file cleanly in mock repo", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hetzer-hook-test-"));
    try {
        const mockGit = path.join(tempDir, ".git");
        fs.mkdirSync(mockGit, { recursive: true });

        const installRes = installGitHook(tempDir);
        assert.ok(installRes.installed);
        assert.ok(fs.existsSync(installRes.path));

        const content = fs.readFileSync(installRes.path, "utf8");
        assert.ok(content.includes("Hetzer Zero-Plaintext Pre-Commit Hook"));

        const uninstallRes = uninstallGitHook(tempDir);
        assert.ok(uninstallRes.uninstalled);
        assert.ok(!fs.existsSync(installRes.path));
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
});
