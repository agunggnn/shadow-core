#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnv } from "../core/env.mjs";
import { Grimoire, resolveVaultPath } from "./shadow-vault.mjs";

export const KNOWN_CREDENTIALS = Object.freeze({
    "nine-router-initial-password": Object.freeze({
        envVar: "NINE_ROUTER_INITIAL_PASSWORD",
        moduleId: "9router",
        targetId: "nine-router",
        keyName: "initial_password",
        authType: "password",
        label: "9Router Initial Password",
        description: "Password login awal untuk Web UI 9Router (http://127.0.0.1:20140).",
        usage: "Buka http://127.0.0.1:20140 di browser, login menggunakan password ini (form 9Router hanya meminta Password, tanpa username). Jika sebelumnya pernah dijalankan, jalankan 'shadow down -v && shadow up' agar volume lama direset ke password baru.",
    }),
    "nine-router-jwt-secret": Object.freeze({
        envVar: "NINE_ROUTER_JWT_SECRET",
        moduleId: "9router",
        targetId: "nine-router",
        keyName: "jwt_secret",
        authType: "api-key",
        label: "9Router JWT Secret",
        description: "Kunci rahasia signing JWT session token pada 9Router.",
        usage: "Digunakan internal oleh 9Router untuk validasi sesi browser dan API.",
    }),
    "nine-router-api-key-secret": Object.freeze({
        envVar: "NINE_ROUTER_API_KEY_SECRET",
        moduleId: "9router",
        targetId: "nine-router",
        keyName: "api_key_secret",
        authType: "api-key",
        label: "9Router API Key Secret",
        description: "Kunci rahasia hashing/verifikasi API key client pada 9Router.",
        usage: "Digunakan internal oleh 9Router saat mengotentikasi request client.",
    }),
    "nine-router-machine-id-salt": Object.freeze({
        envVar: "NINE_ROUTER_MACHINE_ID_SALT",
        moduleId: "9router",
        targetId: "nine-router",
        keyName: "machine_id_salt",
        authType: "api-key",
        label: "9Router Machine ID Salt",
        description: "Salt unik identifikasi mesin instance 9Router.",
        usage: "Digunakan internal oleh 9Router untuk derivasi node fingerprint.",
    }),
    "cognee-llm-api-key": Object.freeze({
        envVar: "COGNEE_LLM_API_KEY",
        moduleId: "cognee",
        targetId: "cognee",
        keyName: "llm_api_key",
        authType: "api-key",
        label: "Cognee LLM API Key",
        description: "API key LLM provider (OpenAI, Anthropic, OpenRouter, dll.) untuk Cognee.",
        usage: "Digunakan oleh container Cognee untuk ekstraksi knowledge graph dan memori.",
    }),
    "cognee-embedding-api-key": Object.freeze({
        envVar: "COGNEE_EMBEDDING_API_KEY",
        moduleId: "cognee",
        targetId: "cognee",
        keyName: "embedding_api_key",
        authType: "api-key",
        label: "Cognee Embedding API Key",
        description: "API key opsional khusus model embedding (jika terpisah dari LLM key).",
        usage: "Digunakan oleh Cognee saat menggunakan model embedding pihak ketiga terpisah.",
    }),
});

function replaceEnvValue(text, name, value) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

function openVault(root, envFile) {
    const values = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
    const masterKey = process.env.SHADOW_GRIMOIRE_KEY || values.SHADOW_GRIMOIRE_KEY || "";
    if (!masterKey || String(masterKey).startsWith("secretRef:")) {
        throw new Error("SHADOW_GRIMOIRE_KEY belum diatur di .env atau environment. Jalankan 'shadow init' terlebih dahulu.");
    }
    const envVault = resolveVaultPath(root);
    const dbPath = envVault || path.join(root, "data", "shadow-vault.db");
    return {
        vault: new Grimoire({ dbPath, masterKey }),
        values,
        envFile,
        root,
    };
}

export function listCredentials({ root, envFile }) {
    const { vault } = openVault(root, envFile);
    try {
        const stored = vault.list();
        const storedMap = new Map(stored.map((item) => [item.id, item]));
        const result = [];

        for (const [id, item] of storedMap.entries()) {
            const known = KNOWN_CREDENTIALS[id];
            result.push({
                id,
                module: known?.moduleId || item.projectId || "custom",
                authType: item.authType,
                configured: true,
                description: known?.description || item.notes || item.label || "Kredensial tersimpan",
                usage: known?.usage || "",
            });
        }

        for (const [id, known] of Object.entries(KNOWN_CREDENTIALS)) {
            if (!storedMap.has(id)) {
                result.push({
                    id,
                    module: known.moduleId,
                    authType: known.authType,
                    configured: false,
                    description: known.description,
                    usage: known.usage,
                });
            }
        }

        return result;
    } finally {
        vault.close();
    }
}

export function revealCredential({ root, envFile, id }) {
    const { vault } = openVault(root, envFile);
    try {
        const entry = vault.find(id);
        if (!entry) {
            throw new Error(`Kredensial '${id}' tidak ditemukan di Grimoire Vault.`);
        }
        const secret = vault.reveal(id);
        if (secret === null) {
            throw new Error(`Gagal membuka kredensial '${id}'. Pastikan SHADOW_GRIMOIRE_KEY cocok dengan database.`);
        }
        const known = KNOWN_CREDENTIALS[id] || null;
        return {
            id,
            secret,
            module: known?.moduleId || entry.projectId || "custom",
            authType: entry.authType,
            description: known?.description || entry.notes || entry.label || "Kredensial tersimpan",
            usage: known?.usage || "",
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
        };
    } finally {
        vault.close();
    }
}

export function setCredential({ root, envFile, id, secret }) {
    if (!id || typeof id !== "string") throw new Error("ID kredensial wajib diisi.");
    if (typeof secret !== "string" || !secret) throw new Error("Nilai rahasia (secret) wajib diisi.");

    const { vault, envFile: targetEnv } = openVault(root, envFile);
    try {
        const known = KNOWN_CREDENTIALS[id];
        const targetId = known?.targetId || id.split("-")[0] || "shadow";
        const keyName = known?.keyName || id;
        const authType = known?.authType || (id.includes("password") ? "password" : "api-key");
        const label = known?.label || id;
        const allowedActions = ["compose.start", "process.start"];

        vault.upsertTarget({ id: targetId, name: targetId, target_type: "shadow-module" });
        const existing = vault.find(id);
        if (existing) {
            vault.update(id, { secret, allowedActions });
        } else {
            vault.create({
                id,
                projectId: targetId,
                keyName,
                label,
                authType,
                scope: "env",
                accessRole: "operator",
                allowedActions,
                secret,
                source: "cli-creds-set",
            });
        }

        let envText = fs.readFileSync(targetEnv, "utf8");
        const envVar = known?.envVar || id.toUpperCase().replace(/[^A-Z0-9]/g, "_");
        envText = replaceEnvValue(envText, envVar, `secretRef:${id}`);
        fs.writeFileSync(targetEnv, envText, { encoding: "utf8", mode: 0o600 });
        try { fs.chmodSync(targetEnv, 0o600); } catch { /* Windows */ }

        vault.recordAudit({
            actor: "shadow-cli",
            action: "vault.set-credential",
            target_id: targetId,
            credential_id: id,
            reason: "User updated credential via shadow creds set",
            outcome: "allowed",
            metadata: { envVar },
        });

        return {
            id,
            envVar,
            module: known?.moduleId || targetId,
            description: known?.description || label,
            usage: known?.usage || "",
        };
    } finally {
        vault.close();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const args = process.argv.slice(2);
        const action = args[0] || "list";
        const root = path.resolve(process.env.SHADOW_ROOT || process.cwd());
        const envFile = path.resolve(process.env.SHADOW_ENV_FILE || path.join(root, ".env"));

        if (action === "list") {
            const list = listCredentials({ root, envFile });
            process.stdout.write("================================================================================\n");
            process.stdout.write("  SHADOW CORE - CREDENTIAL VAULT (GRIMOIRE)\n");
            process.stdout.write("================================================================================\n");
            process.stdout.write("ID                            MODUL     STATUS      DESKRIPSI\n");
            process.stdout.write("----------------------------  --------  ----------  ----------------------------\n");
            for (const item of list) {
                const idCol = item.id.padEnd(28);
                const modCol = item.module.padEnd(8);
                const statusCol = (item.configured ? "tersimpan" : "belum diset").padEnd(10);
                process.stdout.write(`${idCol}  ${modCol}  ${statusCol}  ${item.description}\n`);
            }
            process.stdout.write("--------------------------------------------------------------------------------\n");
            process.stdout.write("Perintah:\n");
            process.stdout.write("  - Lihat nilai rahasia : shadow creds reveal <id>\n");
            process.stdout.write("  - Simpan/ubah nilai   : shadow creds set <id> <nilai>\n");
            process.stdout.write("================================================================================\n");
        } else if (action === "reveal" || action === "get") {
            const id = args[1];
            if (!id) throw new Error("Usage: shadow creds reveal <id>");
            const cred = revealCredential({ root, envFile, id });
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  DETAIL KREDENSIAL: ${cred.id}\n`);
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  Nilai Rahasia : ${cred.secret}\n`);
            process.stdout.write(`  Modul         : ${cred.module}\n`);
            process.stdout.write(`  Tipe          : ${cred.authType}\n`);
            process.stdout.write(`  Deskripsi     : ${cred.description}\n`);
            if (cred.usage) {
                process.stdout.write(`  Cara Pakai    : ${cred.usage}\n`);
            }
            process.stdout.write("================================================================================\n");
        } else if (action === "set") {
            const id = args[1];
            const secret = args[2];
            if (!id || !secret) throw new Error("Usage: shadow creds set <id> <value>");
            const result = setCredential({ root, envFile, id, secret });
            process.stdout.write("================================================================================\n");
            process.stdout.write(`[v] Kredensial '${result.id}' berhasil disimpan ke Vault (AES-256-GCM)!\n`);
            process.stdout.write(`[v] Konfigurasi .env diperbarui: ${result.envVar}=secretRef:${result.id}\n`);
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  Modul     : ${result.module}\n`);
            process.stdout.write(`  Deskripsi : ${result.description}\n`);
            if (result.usage) {
                process.stdout.write(`  Cara Pakai: ${result.usage}\n`);
            }
            const upTarget = result.module && result.module !== "core" ? `shadow up ${result.module}` : "shadow up";
            process.stdout.write(`  Terapkan  : Jalankan '${upTarget}' (atau 'shadow up') untuk memuat ulang ke container.\n`);
            process.stdout.write("================================================================================\n");
        } else {
            throw new Error(`Perintah creds tidak dikenal: '${action}'. Gunakan 'list', 'reveal', atau 'set'.`);
        }
    } catch (error) {
        process.stderr.write(`[shadow creds error] ${error.message}\n`);
        process.exitCode = 1;
    }
}
