#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { Grimoire, resolveMasterKey, resolveVaultPath } from "./hetzer-vault.mjs";
import { parseEnv } from "../core/env.mjs";

export const DETECTION_RULES = [
    {
        id: "npm-token",
        type: "npm_token",
        label: "NPM Access Token",
        pattern: /\bnpm_[A-Za-z0-9]{36}\b/g,
    },
    {
        id: "openai-api-key",
        type: "openai_key",
        label: "OpenAI API Key",
        pattern: /\bsk-[A-Za-z0-9_-]{24,}\b/g,
    },
    {
        id: "anthropic-api-key",
        type: "anthropic_key",
        label: "Anthropic API Key",
        pattern: /\bsk-ant-[A-Za-z0-9_-]{24,}\b/g,
    },
    {
        id: "gemini-api-key",
        type: "gemini_key",
        label: "Google Gemini API Key",
        pattern: /\bAIza[0-9A-Za-z-_]{35}\b/g,
    },
    {
        id: "github-token",
        type: "github_token",
        label: "GitHub Personal Access Token",
        pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
    },
    {
        id: "slack-token",
        type: "slack_token",
        label: "Slack Bot/User Token",
        pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g,
    },
    {
        id: "aws-access-key",
        type: "aws_key",
        label: "AWS Access Key ID",
        pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    },
    {
        id: "jwt-token",
        type: "jwt",
        label: "JSON Web Token (JWT)",
        pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    },
    {
        id: "private-key",
        type: "private_key",
        label: "Private Key Certificate",
        pattern: /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]+?-----END [A-Z ]+PRIVATE KEY-----/g,
    },
];

const FAST_PREFIXES = ["npm_", "sk-", "AIza", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "xox", "AKIA", "eyJ", "-----BEGIN"];

function quickBailout(text) {
    if (!text || typeof text !== "string" || text.length < 16) return true;
    for (let i = 0; i < FAST_PREFIXES.length; i++) {
        if (text.includes(FAST_PREFIXES[i])) return false;
    }
    return true;
}

export function scanText(text) {
    const start = performance.now();
    if (quickBailout(text)) {
        return {
            hasSecrets: false,
            matches: [],
            latencyMs: Number((performance.now() - start).toFixed(4)),
        };
    }

    const matches = [];
    for (const rule of DETECTION_RULES) {
        rule.pattern.lastIndex = 0;
        let match;
        while ((match = rule.pattern.exec(text)) !== null) {
            matches.push({
                type: rule.type,
                label: rule.label,
                defaultId: rule.id,
                value: match[0],
                index: match.index,
            });
        }
    }

    return {
        hasSecrets: matches.length > 0,
        matches,
        latencyMs: Number((performance.now() - start).toFixed(4)),
    };
}

export function redactAndVault(text, { root, envFile, masterKey, autoVault = true } = {}) {
    const start = performance.now();
    const scan = scanText(text);

    if (!scan.hasSecrets) {
        return {
            text,
            redactedCount: 0,
            detected: [],
            latencyMs: Number((performance.now() - start).toFixed(4)),
        };
    }

    let resultText = text;
    const detected = [];
    let vaultInstance = null;

    if (autoVault && root) {
        try {
            const actualEnvFile = envFile || path.join(root, ".env");
            const values = fs.existsSync(actualEnvFile) ? parseEnv(fs.readFileSync(actualEnvFile, "utf8")) : {};
            const key = masterKey || resolveMasterKey({ root, envValues: values });
            if (key && !String(key).startsWith("secretRef:")) {
                const envVault = resolveVaultPath(root);
                vaultInstance = new Grimoire({
                    dbPath: envVault || path.join(root, "data", "hetzer-vault.db"),
                    masterKey: key,
                });
            }
        } catch {
            // If vault cannot be opened, continue with redaction without vaulting
        }
    }

    try {
        const uniqueValues = new Map();
        for (const item of scan.matches) {
            if (!uniqueValues.has(item.value)) {
                uniqueValues.set(item.value, item);
            }
        }

        let counter = 1;
        for (const [rawVal, item] of uniqueValues.entries()) {
            const hash = crypto.createHash("sha256").update(rawVal).digest("hex").slice(0, 8);
            const refId = uniqueValues.size === 1 ? item.defaultId : `${item.defaultId}-${hash}`;
            const refString = `secretRef:${refId}`;

            resultText = resultText.split(rawVal).join(refString);

            if (vaultInstance) {
                try {
                    const existing = vaultInstance.find(refId);
                    const allowedActions = ["compose.start", "process.start"];
                    vaultInstance.upsertTarget({ id: "sniffed-secrets", name: "sniffed-secrets", target_type: "hetzer-module" });
                    if (existing) {
                        vaultInstance.update(refId, { secret: rawVal, allowedActions });
                    } else {
                        vaultInstance.create({
                            id: refId,
                            projectId: "sniffed-secrets",
                            keyName: refId,
                            label: item.label,
                            authType: "api-key",
                            scope: "env",
                            accessRole: "operator",
                            allowedActions,
                            secret: rawVal,
                            source: "secret-sniffer",
                        });
                    }
                } catch {
                    // Ignore vault write errors
                }
            }

            detected.push({
                type: item.type,
                label: item.label,
                id: refId,
                ref: refString,
            });
            counter++;
        }
    } finally {
        if (vaultInstance) {
            try { vaultInstance.close(); } catch { /* Ignore */ }
        }
    }

    return {
        text: resultText,
        redactedCount: detected.length,
        detected,
        latencyMs: Number((performance.now() - start).toFixed(4)),
    };
}

export function restoreSecrets(text, { root, envFile, masterKey } = {}) {
    if (!text || typeof text !== "string" || !text.includes("secretRef:")) {
        return text;
    }

    let actualEnvFile = envFile || (root ? path.join(root, ".env") : "");
    let values = {};
    if (actualEnvFile && fs.existsSync(actualEnvFile)) {
        values = parseEnv(fs.readFileSync(actualEnvFile, "utf8"));
    }
    const key = masterKey || resolveMasterKey({ root, envValues: values });
    if (!key || String(key).startsWith("secretRef:")) {
        return text;
    }

    const envVault = root ? resolveVaultPath(root) : null;
    const dbPath = envVault || (root ? path.join(root, "data", "hetzer-vault.db") : "");
    if (!dbPath || !fs.existsSync(dbPath)) {
        return text;
    }

    const vault = new Grimoire({ dbPath, masterKey: key });
    try {
        return text.replace(/secretRef:([a-zA-Z0-9._-]+)/g, (match, id) => {
            try {
                const entry = vault.find(id);
                if (!entry) return match;
                const secret = vault.reveal(id);
                return secret !== null ? secret : match;
            } catch {
                return match;
            }
        });
    } finally {
        vault.close();
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const input = process.argv.slice(2).join(" ");
    if (!input) {
        process.stdout.write("Usage: sniffer.mjs <text_to_scan>\n");
        process.exit(0);
    }
    const res = redactAndVault(input, { autoVault: false });
    process.stdout.write(JSON.stringify(res, null, 2) + "\n");
}
