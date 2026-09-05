#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnv } from "../core/env.mjs";
import { Grimoire, resolveVaultPath } from "./hetzer-vault.mjs";

export const KNOWN_CREDENTIALS = Object.freeze({
    "nine-router-initial-password": Object.freeze({
        envVar: "NINE_ROUTER_INITIAL_PASSWORD",
        moduleId: "9router",
        targetId: "nine-router",
        keyName: "initial_password",
        authType: "password",
        label: "9Router Initial Password",
        description: "Initial login password for 9Router Web UI (http://127.0.0.1:20140).",
        usage: "Open http://127.0.0.1:20140 in browser and log in with this password. If previously run, execute 'hetzer down -v && hetzer up' to reset volume to new password.",
    }),
    "nine-router-jwt-secret": Object.freeze({
        envVar: "NINE_ROUTER_JWT_SECRET",
        moduleId: "9router",
        targetId: "nine-router",
        keyName: "jwt_secret",
        authType: "api-key",
        label: "9Router JWT Secret",
        description: "Secret key for signing JWT session tokens in 9Router.",
        usage: "Used internally by 9Router for browser and API session validation.",
    }),
    "nine-router-api-key-secret": Object.freeze({
        envVar: "NINE_ROUTER_API_KEY_SECRET",
        moduleId: "9router",
        targetId: "nine-router",
        keyName: "api_key_secret",
        authType: "api-key",
        label: "9Router API Key Secret",
        description: "Secret key for client API key hashing/verification in 9Router.",
        usage: "Used internally by 9Router when authenticating client requests.",
    }),
    "nine-router-machine-id-salt": Object.freeze({
        envVar: "NINE_ROUTER_MACHINE_ID_SALT",
        moduleId: "9router",
        targetId: "nine-router",
        keyName: "machine_id_salt",
        authType: "api-key",
        label: "9Router Machine ID Salt",
        description: "Unique machine identification salt for 9Router instance.",
        usage: "Used internally by 9Router for node fingerprint derivation.",
    }),
    "cognee-llm-api-key": Object.freeze({
        envVar: "COGNEE_LLM_API_KEY",
        moduleId: "cognee",
        targetId: "cognee",
        keyName: "llm_api_key",
        authType: "api-key",
        label: "Cognee LLM API Key",
        description: "LLM provider API key (OpenAI, Anthropic, OpenRouter, etc.) for Cognee.",
        usage: "Used by Cognee container for knowledge graph extraction and memory indexing.",
    }),
    "cognee-embedding-api-key": Object.freeze({
        envVar: "COGNEE_EMBEDDING_API_KEY",
        moduleId: "cognee",
        targetId: "cognee",
        keyName: "embedding_api_key",
        authType: "api-key",
        label: "Cognee Embedding API Key",
        description: "Optional API key for dedicated embedding models (if separate from LLM key).",
        usage: "Used by Cognee when using a standalone embedding provider.",
    }),
    "npm-token": Object.freeze({
        envVar: "NODE_AUTH_TOKEN",
        moduleId: "core",
        targetId: "npm",
        keyName: "auth_token",
        authType: "api-key",
        label: "NPM Registry Auth Token",
        description: "NPM authentication token to publish hetzer package to npm registry.",
        usage: "Used when publishing to https://registry.npmjs.org/. Run 'npm run publish-pkg' or 'hetzer publish'.",
    }),
    "npm-auth-token": Object.freeze({
        envVar: "NODE_AUTH_TOKEN",
        moduleId: "core",
        targetId: "npm",
        keyName: "auth_token",
        authType: "api-key",
        label: "NPM Auth Token (Alias)",
        description: "NPM authentication token alias to publish hetzer package to npm registry.",
        usage: "Used when publishing to https://registry.npmjs.org/. Run 'npm run publish-pkg' or 'hetzer publish'.",
    }),
});

function replaceEnvValue(text, name, value) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

export async function promptSecret(promptText = "Enter secret value: ", { input = process.stdin, output = process.stderr } = {}) {
    if (!input.isTTY || typeof input.setRawMode !== "function") {
        const chunks = [];
        for await (const chunk of input) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return Buffer.concat(chunks).toString("utf8").trim();
    }
    return new Promise((resolve) => {
        output.write(promptText);
        const wasRaw = input.isRaw;
        input.setRawMode(true);
        input.resume();

        let secret = "";
        const onData = (chunk) => {
            const str = chunk.toString();
            for (let i = 0; i < str.length; i++) {
                const char = str[i];
                if (char === "\r" || char === "\n" || char === "\u0004") {
                    cleanup();
                    output.write("\n");
                    resolve(secret);
                    return;
                } else if (char === "\u0003") { // Ctrl+C
                    cleanup();
                    output.write("\n");
                    process.exit(130);
                } else if (char === "\b" || char === "\x7f") { // Backspace
                    if (secret.length > 0) {
                        secret = secret.slice(0, -1);
                        output.write("\b \b");
                    }
                } else {
                    secret += char;
                    output.write("*");
                }
            }
        };

        function cleanup() {
            input.removeListener("data", onData);
            if (input.setRawMode) input.setRawMode(wasRaw || false);
            if (typeof input.pause === "function") input.pause();
            if (typeof input.unref === "function") input.unref();
        }

        input.on("data", onData);
    });
}


function openVault(root, envFile) {
    const values = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
    const masterKey = process.env.HETZER_GRIMOIRE_KEY || values.HETZER_GRIMOIRE_KEY || "";
    if (!masterKey || String(masterKey).startsWith("secretRef:")) {
        throw new Error("HETZER_GRIMOIRE_KEY is not set in .env or environment. Run 'hetzer init' first.");
    }
    const envVault = resolveVaultPath(root);
    const dbPath = envVault || path.join(root, "data", "hetzer-vault.db");
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
                description: known?.description || item.notes || item.label || "Stored credential",
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
            throw new Error(`Credential '${id}' not found in Grimoire Vault.`);
        }
        const secret = vault.reveal(id);
        if (secret === null) {
            throw new Error(`Failed to decrypt credential '${id}'. Ensure HETZER_GRIMOIRE_KEY matches the database.`);
        }
        const known = KNOWN_CREDENTIALS[id] || null;
        return {
            id,
            secret,
            module: known?.moduleId || entry.projectId || "custom",
            authType: entry.authType,
            description: known?.description || entry.notes || entry.label || "Stored credential",
            usage: known?.usage || "",
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
        };
    } finally {
        vault.close();
    }
}

export async function ensureCredential({ root, envFile, id, promptMessage }) {
    if (!id) throw new Error("Credential ID is required.");
    try {
        const revealed = revealCredential({ root, envFile, id });
        if (revealed && revealed.secret) {
            return revealed.secret;
        }
    } catch {
        // Not found in vault, prompt JIT
    }

    const promptText = promptMessage || `[!] Credential '${id}' is not yet in Grimoire Vault.\nEnter secret value (masked input): `;
    const secret = await promptSecret(promptText);
    if (!secret) {
        throw new Error(`Credential '${id}' cannot be empty.`);
    }
    setCredential({ root, envFile, id, secret });
    return secret;
}

export function setCredential({ root, envFile, id, secret }) {
    if (!id || typeof id !== "string") throw new Error("Credential ID is required.");
    if (typeof secret !== "string" || !secret) throw new Error("Secret value is required.");

    const { vault, envFile: targetEnv } = openVault(root, envFile);
    try {
        const known = KNOWN_CREDENTIALS[id];
        const targetId = known?.targetId || id.split("-")[0] || "hetzer";
        const keyName = known?.keyName || id;
        const authType = known?.authType || (id.includes("password") ? "password" : "api-key");
        const label = known?.label || id;
        const allowedActions = ["compose.start", "process.start"];

        vault.upsertTarget({ id: targetId, name: targetId, target_type: "hetzer-module" });
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
            actor: "hetzer-cli",
            action: "vault.set-credential",
            target_id: targetId,
            credential_id: id,
            reason: "User updated credential via hetzer creds set",
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
        const root = path.resolve(process.env.HETZER_ROOT || process.cwd());
        const envFile = path.resolve(process.env.HETZER_ENV_FILE || path.join(root, ".env"));

        if (action === "list") {
            const list = listCredentials({ root, envFile });
            process.stdout.write("================================================================================\n");
            process.stdout.write("  HETZER - CREDENTIAL VAULT (GRIMOIRE)\n");
            process.stdout.write("================================================================================\n");
            process.stdout.write("ID                            MODULE    STATUS      DESCRIPTION\n");
            process.stdout.write("----------------------------  --------  ----------  ----------------------------\n");
            for (const item of list) {
                const idCol = item.id.padEnd(28);
                const modCol = item.module.padEnd(8);
                const statusCol = (item.configured ? "configured" : "not set").padEnd(10);
                process.stdout.write(`${idCol}  ${modCol}  ${statusCol}  ${item.description}\n`);
            }
            process.stdout.write("--------------------------------------------------------------------------------\n");
            process.stdout.write("Commands:\n");
            process.stdout.write("  - Reveal secret value: hetzer creds reveal <id>\n");
            process.stdout.write("  - Save/update value  : hetzer creds set <id> [value] (prompts if omitted)\n");
            process.stdout.write("================================================================================\n");
        } else if (action === "reveal" || action === "get") {
            const id = args[1];
            if (!id) throw new Error("Usage: hetzer creds reveal <id>");
            const cred = revealCredential({ root, envFile, id });
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  CREDENTIAL DETAIL: ${cred.id}\n`);
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  Secret Value : ${cred.secret}\n`);
            process.stdout.write(`  Module       : ${cred.module}\n`);
            process.stdout.write(`  Type         : ${cred.authType}\n`);
            process.stdout.write(`  Description  : ${cred.description}\n`);
            if (cred.usage) {
                process.stdout.write(`  Usage        : ${cred.usage}\n`);
            }
            process.stdout.write("================================================================================\n");
        } else if (action === "set") {
            const id = args[1];
            let secret = args[2];
            if (!id) throw new Error("Usage: hetzer creds set <id> [value]");
            if (!secret) {
                secret = await promptSecret(`Enter secret value for '${id}': `);
            }
            if (!secret) throw new Error("Secret value is required.");
            const result = setCredential({ root, envFile, id, secret });
            process.stdout.write("================================================================================\n");
            process.stdout.write(`[v] Credential '${result.id}' successfully saved to Vault (AES-256-GCM)!\n`);
            process.stdout.write(`[v] Updated .env configuration: ${result.envVar}=secretRef:${result.id}\n`);
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  Module      : ${result.module}\n`);
            process.stdout.write(`  Description : ${result.description}\n`);
            if (result.usage) {
                process.stdout.write(`  Usage       : ${result.usage}\n`);
            }
            if (result.id.startsWith("npm-")) {
                process.stdout.write("  Apply       : Run 'node scripts/publish.mjs' or 'npm run publish-pkg' to publish to npm.\n");
            } else {
                const upTarget = result.module && result.module !== "core" ? `hetzer up ${result.module}` : "hetzer up";
                process.stdout.write(`  Apply       : Run '${upTarget}' (or 'hetzer up') to reload services.\n`);
            }
            process.stdout.write("================================================================================\n");
        } else {
            throw new Error(`Unknown creds command: '${action}'. Use 'list', 'reveal', or 'set'.`);
        }
    } catch (error) {
        process.stderr.write(`[hetzer creds error] ${error.message}\n`);
        process.exitCode = 1;
    }
}
