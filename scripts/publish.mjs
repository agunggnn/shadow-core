#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listCredentials, revealCredential, setCredential, promptSecret } from "../cli/vault/creds.mjs";
import { parseEnv } from "../cli/core/env.mjs";

const root = path.resolve(process.env.SHADOW_ROOT || process.cwd());
const envFile = path.resolve(process.env.SHADOW_ENV_FILE || path.join(root, ".env"));

async function main() {
    process.stdout.write("================================================================================\n");
    process.stdout.write("  SHADOW CORE - BUILD & SECURE NPM PUBLISH (@agunggnn/shadow-core)\n");
    process.stdout.write("================================================================================\n");

    if (!fs.existsSync(envFile)) {
        throw new Error("File .env tidak ditemukan. Jalankan 'shadow init' terlebih dahulu.");
    }

    // 1. Resolve or prompt for NPM Token
    let npmToken = "";
    try {
        const revealed = revealCredential({ root, envFile, id: "npm-token" });
        npmToken = revealed.secret;
    } catch {
        try {
            const revealed = revealCredential({ root, envFile, id: "npm-auth-token" });
            npmToken = revealed.secret;
        } catch {
            // Token not in vault yet
        }
    }

    if (!npmToken) {
        process.stdout.write("[!] Token NPM belum tersimpan di Grimoire Vault.\n");
        process.stdout.write("    Input akan disembunyikan (masked) saat Anda mem-paste token.\n\n");
        npmToken = await promptSecret("Masukkan NPM Auth Token (paste & tekan Enter): ");
        if (!npmToken) {
            throw new Error("Token NPM tidak boleh kosong. Proses publish dibatalkan.");
        }

        // Securely store into Grimoire Vault (AES-256-GCM)
        setCredential({ root, envFile, id: "npm-token", secret: npmToken });
        process.stdout.write("[v] Token NPM berhasil dienkripsi & disimpan ke Grimoire Vault (data/shadow-vault.db)!\n");
        process.stdout.write("[v] Referensi .env: NODE_AUTH_TOKEN=secretRef:npm-token (Zero-Plaintext)\n\n");
    } else {
        process.stdout.write("[v] Menggunakan NPM Auth Token terenkripsi dari Grimoire Vault.\n\n");
    }

    // 2. Validate NPM Authentication
    process.stdout.write("[i] Memverifikasi otentikasi ke npm registry (https://registry.npmjs.org/)...\n");
    const whoami = spawnSync("npm", [
        "whoami",
        "--registry=https://registry.npmjs.org/",
        `--//registry.npmjs.org/:_authToken=${npmToken}`,
    ], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        shell: process.platform === "win32",
    });

    if (whoami.status !== 0) {
        const err = (whoami.stderr || whoami.stdout || "").trim();
        throw new Error(`Otentikasi NPM gagal (Status ${whoami.status}): ${err}\nPastikan token npm Anda valid dengan izin Read & Publish.`);
    }

    const npmUser = whoami.stdout.trim();
    process.stdout.write(`[v] Otentikasi sukses! Terhubung sebagai pengguna npm: @${npmUser}\n\n`);

    // 3. Run Test Suite
    process.stdout.write("[i] Menjalankan test suite dan static checks (node scripts/check.mjs)...\n");
    const check = spawnSync(process.execPath, [path.join(root, "scripts", "check.mjs")], {
        cwd: root,
        stdio: "inherit",
        windowsHide: true,
    });
    if (check.status !== 0) {
        throw new Error("Test suite gagal. Perbaiki pengujian sebelum mem-publish paket.");
    }
    process.stdout.write("\n[v] Seluruh verifikasi internal lulus.\n\n");

    // 4. Dry-run Pack Inspection
    process.stdout.write("[i] Melakukan dry-run package bundling...\n");
    const pack = spawnSync("npm", ["pack", "--dry-run"], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        shell: process.platform === "win32",
    });
    if (pack.status !== 0) {
        throw new Error(`npm pack --dry-run gagal: ${pack.stderr}`);
    }

    const pkgJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    process.stdout.write(`[v] Paket siap: ${pkgJson.name} (v${pkgJson.version})\n\n`);

    // 5. Publish to NPM
    process.stdout.write(`[i] Mem-publish ${pkgJson.name}@${pkgJson.version} ke npmjs.org (access: public)...\n`);
    const publish = spawnSync("npm", [
        "publish",
        "--access", "public",
        `--//registry.npmjs.org/:_authToken=${npmToken}`,
    ], {
        cwd: root,
        stdio: "inherit",
        windowsHide: true,
        shell: process.platform === "win32",
        env: {
            ...process.env,
            NODE_AUTH_TOKEN: npmToken,
        },
    });

    if (publish.status !== 0) {
        throw new Error(`npm publish gagal dengan exit code ${publish.status}`);
    }

    process.stdout.write("\n================================================================================\n");
    process.stdout.write(`  [v] PUBLISH BERHASIL!\n`);
    process.stdout.write(`  Paket   : ${pkgJson.name}@${pkgJson.version}\n`);
    process.stdout.write(`  NPM URL : https://www.npmjs.com/package/${pkgJson.name}\n`);
    process.stdout.write("================================================================================\n");
}

main().catch((err) => {
    process.stderr.write(`\n[x] Publish Error: ${err.message}\n`);
    process.exitCode = 1;
});
