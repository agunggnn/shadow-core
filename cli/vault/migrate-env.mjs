#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnv } from "../core/env.mjs";
import { Grimoire, resolveVaultPath } from "./hetzer-vault.mjs";

const BINDINGS = {
    NINE_ROUTER_JWT_SECRET: ["nine-router-jwt-secret", "nine-router", "jwt_secret"],
    NINE_ROUTER_INITIAL_PASSWORD: ["nine-router-initial-password", "nine-router", "initial_password"],
    NINE_ROUTER_API_KEY_SECRET: ["nine-router-api-key-secret", "nine-router", "api_key_secret"],
    NINE_ROUTER_MACHINE_ID_SALT: ["nine-router-machine-id-salt", "nine-router", "machine_id_salt"],
    COGNEE_LLM_API_KEY: ["cognee-llm-api-key", "cognee", "llm_api_key"],
    COGNEE_EMBEDDING_API_KEY: ["cognee-embedding-api-key", "cognee", "embedding_api_key"],
};

function replaceValue(text, name, value) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

export function autoIngestPlaintextEnv({ root, envFile, masterKey }) {
    if (!fs.existsSync(envFile)) return [];
    let text = fs.readFileSync(envFile, "utf8");
    const values = parseEnv(text);
    const resolvedMasterKey = masterKey || process.env.HETZER_GRIMOIRE_KEY || values.HETZER_GRIMOIRE_KEY || "";
    if (!resolvedMasterKey || String(resolvedMasterKey).startsWith("secretRef:")) {
        return [];
    }

    const envVault = resolveVaultPath(root);
    const vault = new Grimoire({ dbPath: envVault || path.join(root, "data", "hetzer-vault.db"), masterKey: resolvedMasterKey });
    const migrated = [];

    try {
        for (const [name, [id, targetId, keyName]] of Object.entries(BINDINGS)) {
            const value = values[name] || "";
            if (!value || value.startsWith("replace-") || value.startsWith("secretRef:")) {
                continue;
            }
            vault.upsertTarget({ id: targetId, name: targetId, target_type: "hetzer-module" });
            const allowedActions = ["compose.start", "process.start"];
            const canonicalExisting = vault.find(id);
            const input = {
                id,
                projectId: targetId,
                keyName,
                label: name,
                authType: name.includes("PASSWORD") ? "password" : "api-key",
                scope: "env",
                accessRole: "operator",
                allowedActions,
                secret: value,
                source: "auto-env-ingest",
            };
            if (canonicalExisting) vault.update(id, input);
            else vault.create(input);
            text = replaceValue(text, name, `secretRef:${id}`);
            migrated.push(name);
        }

        for (const [name, rawVal] of Object.entries(values)) {
            if (BINDINGS[name] || !rawVal || typeof rawVal !== "string") continue;
            if (rawVal.startsWith("secretRef:") || rawVal.startsWith("replace-") || name === "HETZER_GRIMOIRE_KEY") continue;

            const isSensitiveKey = /(?:_KEY|_SECRET|_TOKEN|_PASSWORD|_AUTH)$/i.test(name) || name === "NODE_AUTH_TOKEN";
            if (isSensitiveKey) {
                const targetId = name.toLowerCase().replace(/_/g, "-");
                const id = targetId;
                vault.upsertTarget({ id: "env", name: "env", target_type: "environment" });
                const allowedActions = ["compose.start", "process.start"];
                const canonicalExisting = vault.find(id);
                const input = {
                    id,
                    projectId: "env",
                    keyName: name.toLowerCase(),
                    label: name,
                    authType: name.includes("PASSWORD") ? "password" : "api-key",
                    scope: "env",
                    accessRole: "operator",
                    allowedActions,
                    secret: rawVal,
                    source: "auto-env-ingest",
                };
                if (canonicalExisting) vault.update(id, input);
                else vault.create(input);
                text = replaceValue(text, name, `secretRef:${id}`);
                migrated.push(name);
            }
        }

        if (migrated.length) {
            fs.writeFileSync(envFile, text, { encoding: "utf8", mode: 0o600 });
            try { fs.chmodSync(envFile, 0o600); } catch { /* Windows */ }
        }
        return migrated;
    } finally {
        vault.close();
    }
}

export function migrateEnvCredentials({ root, envFile, masterKey, authorizationRef }) {
    if (!/^user:[a-z0-9][a-z0-9._-]{5,120}$/i.test(String(authorizationRef || ""))) {
        throw new Error("An explicit authorization reference is required (user:<reference>).");
    }
    let text = fs.readFileSync(envFile, "utf8");
    const values = parseEnv(text);
    const envVault = resolveVaultPath(root);
    const vault = new Grimoire({ dbPath: envVault || path.join(root, "data", "hetzer-vault.db"), masterKey });
    const migrated = [];
    const tightened = [];
    try {
        for (const [name, [id, targetId, keyName]] of Object.entries(BINDINGS)) {
            const allowedActions = ["compose.start"];
            const value = values[name] || "";
            const canonicalExisting = vault.find(id);
            if (!value || value.startsWith("replace-")) {
                if (canonicalExisting) {
                    vault.update(id, { allowedActions });
                    tightened.push(name);
                }
                continue;
            }
            if (value.startsWith("secretRef:")) {
                const referencedId = value.slice("secretRef:".length);
                if (vault.find(referencedId)) {
                    vault.update(referencedId, { allowedActions });
                    tightened.push(name);
                }
                continue;
            }
            vault.upsertTarget({ id: targetId, name: targetId, target_type: "hetzer-module" });
            const input = {
                id,
                projectId: targetId,
                keyName,
                label: name,
                authType: name.includes("PASSWORD") ? "password" : "api-key",
                scope: "env",
                accessRole: "operator",
                allowedActions,
                secret: value,
                source: "explicit-env-migration",
            };
            if (canonicalExisting) vault.update(id, input);
            else vault.create(input);
            text = replaceValue(text, name, `secretRef:${id}`);
            migrated.push(name);
        }
        if (migrated.length) {
            fs.writeFileSync(envFile, text, { encoding: "utf8", mode: 0o600 });
            try { fs.chmodSync(envFile, 0o600); } catch { /* Windows ACLs are managed by the host. */ }
        }
        vault.recordAudit({
            actor: "hetzer-cli",
            action: "vault.import-explicit-env",
            reason: authorizationRef,
            outcome: "allowed",
            metadata: { migrated, tightened },
        });
        return migrated;
    } finally {
        vault.close();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const args = process.argv.slice(2);
        const option = (name) => {
            const index = args.indexOf(name);
            return index >= 0 ? args[index + 1] : "";
        };
        const root = path.resolve(option("--root") || process.env.HETZER_ROOT || process.cwd());
        const envFile = path.resolve(option("--env-file") || process.env.HETZER_ENV_FILE || path.join(root, ".env"));
        const values = parseEnv(fs.readFileSync(envFile, "utf8"));
        const migrated = migrateEnvCredentials({
            root,
            envFile,
            masterKey: process.env.HETZER_GRIMOIRE_KEY || values.HETZER_GRIMOIRE_KEY || "",
            authorizationRef: option("--authorization-ref"),
        });
        process.stdout.write(`Secured ${migrated.length} environment credential(s) as secretRef bindings.\n`);
    } catch (error) {
        process.stderr.write(`Credential migration failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}
