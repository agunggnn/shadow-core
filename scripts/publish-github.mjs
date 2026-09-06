#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { revealCredential, setCredential, promptSecret } from "../cli/vault/creds.mjs";

const root = path.resolve(process.env.HETZER_ROOT || process.cwd());
const envFile = path.resolve(process.env.HETZER_ENV_FILE || path.join(root, ".env"));

async function main() {
    process.stdout.write("================================================================================\n");
    process.stdout.write("  HETZER - SECURE GITHUB PACKAGES PUBLISH (npm.pkg.github.com)\n");
    process.stdout.write("================================================================================\n");

    const pkgJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    if (!pkgJson.name.startsWith("@agunggnn/")) {
        throw new Error(`Package name '${pkgJson.name}' must be scoped as '@agunggnn/hetzer' to publish to GitHub Packages.`);
    }

    // 1. Resolve or prompt for GitHub Token (with write:packages permission)
    let githubToken = process.env.GITHUB_TOKEN || process.env.NODE_AUTH_TOKEN || "";
    if (!githubToken && fs.existsSync(envFile)) {
        try {
            const revealed = revealCredential({ root, envFile, id: "github-token" });
            githubToken = revealed.secret;
        } catch {
            // Token not in vault yet
        }
    }

    if (!githubToken) {
        process.stdout.write("[!] GitHub Personal Access Token (classic) is not yet stored in Grimoire Vault.\n");
        process.stdout.write("    Required token permissions: 'write:packages', 'read:packages', 'repo'.\n");
        process.stdout.write("    Input will be masked when you paste the token.\n\n");
        githubToken = await promptSecret("Enter GitHub Personal Access Token (paste & press Enter): ");
        if (!githubToken) {
            throw new Error("GitHub Token cannot be empty. Publish process aborted.");
        }

        // Securely store into Grimoire Vault (AES-256-GCM)
        if (fs.existsSync(envFile)) {
            setCredential({ root, envFile, id: "github-token", secret: githubToken });
            process.stdout.write("[v] GitHub Token encrypted & stored in Grimoire Vault (AES-256-GCM)!\n");
            process.stdout.write("[v] .env reference: GITHUB_TOKEN=secretRef:github-token (Zero-Plaintext)\n\n");
        }
    } else {
        process.stdout.write("[v] Using authenticated GitHub Token from environment or Grimoire Vault.\n\n");
    }

    // 2. Validate GitHub Packages Authentication
    process.stdout.write("[i] Verifying authentication with GitHub Packages (https://npm.pkg.github.com/)...\n");
    const whoami = spawnSync("npm", [
        "whoami",
        "--registry=https://npm.pkg.github.com/",
        `--//npm.pkg.github.com/:_authToken=${githubToken}`,
    ], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        shell: process.platform === "win32",
    });

    if (whoami.status !== 0) {
        const err = (whoami.stderr || whoami.stdout || "").trim();
        throw new Error(`GitHub Packages authentication failed (Status ${whoami.status}): ${err}\nEnsure your GitHub PAT has 'write:packages' and 'read:packages' permissions.`);
    }

    const ghUser = whoami.stdout.trim();
    process.stdout.write(`[v] Authentication successful! Connected as GitHub user: @${ghUser}\n\n`);

    // 3. Run Test Suite & Static Checks
    process.stdout.write("[i] Running test suite and static checks (node scripts/check.mjs)...\n");
    const check = spawnSync(process.execPath, [path.join(root, "scripts", "check.mjs")], {
        cwd: root,
        stdio: "inherit",
        windowsHide: true,
    });
    if (check.status !== 0) {
        throw new Error("Test suite failed. Fix test failures before publishing.");
    }
    process.stdout.write("\n[v] All internal verification checks passed.\n\n");

    // 4. Dry-run Pack Inspection
    process.stdout.write("[i] Running dry-run package bundling...\n");
    const pack = spawnSync("npm", ["pack", "--dry-run"], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        shell: process.platform === "win32",
    });
    if (pack.status !== 0) {
        throw new Error(`npm pack --dry-run failed: ${pack.stderr}`);
    }

    process.stdout.write(`[v] Package ready: ${pkgJson.name} (v${pkgJson.version})\n\n`);

    // 5. Publish to GitHub Packages
    process.stdout.write(`[i] Publishing ${pkgJson.name}@${pkgJson.version} to https://npm.pkg.github.com/ ...\n`);
    const publish = spawnSync("npm", [
        "publish",
        "--registry=https://npm.pkg.github.com/",
        `--//npm.pkg.github.com/:_authToken=${githubToken}`,
    ], {
        cwd: root,
        stdio: "inherit",
        windowsHide: true,
        shell: process.platform === "win32",
        env: {
            ...process.env,
            NODE_AUTH_TOKEN: githubToken,
        },
    });

    if (publish.status !== 0) {
        throw new Error(`npm publish failed with exit code ${publish.status}`);
    }

    process.stdout.write("\n================================================================================\n");
    process.stdout.write(`  [v] GITHUB PACKAGES PUBLISH SUCCESSFUL!\n`);
    process.stdout.write(`  Package  : ${pkgJson.name}@${pkgJson.version}\n`);
    process.stdout.write(`  Registry : https://npm.pkg.github.com/@agunggnn/hetzer\n`);
    process.stdout.write(`  Repo URL : https://github.com/agunggnn/hetzer/packages\n`);
    process.stdout.write("================================================================================\n");
}

main().catch((err) => {
    process.stderr.write(`\n[x] GitHub Publish Error: ${err.message}\n`);
    process.exitCode = 1;
});
