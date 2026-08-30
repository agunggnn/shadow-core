import fs from "node:fs";
import path from "node:path";

import { parseEnv } from "../core/env.mjs";
import { Grimoire, resolveVaultPath } from "./shadow-vault.mjs";

export function resolveSecretEnvironment({
    root,
    envFile,
    baseEnv = process.env,
    action = "process.start",
    allowNames,
}) {
    const values = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
    const allow = allowNames === undefined ? null : new Set(allowNames);
    const bindings = Object.entries(values).filter(([name, value]) =>
        String(value).startsWith("secretRef:") && (allow === null || allow.has(name))
    );
    const resolved = { ...baseEnv, SHADOW_ROOT: root };
    if (!bindings.length) return resolved;

    const masterKey = baseEnv.SHADOW_GRIMOIRE_KEY || values.SHADOW_GRIMOIRE_KEY || "";
    if (!masterKey || String(masterKey).startsWith("secretRef:")) {
        throw new Error("SHADOW_GRIMOIRE_KEY must be supplied at runtime to resolve secretRef bindings.");
    }
    const envVault = resolveVaultPath(root);
    const vault = new Grimoire({
        dbPath: envVault || path.join(root, "data", "shadow-vault.db"),
        legacyFile: path.join(root, "data", "vault.json"),
        masterKey,
    });
    try {
        for (const [name, reference] of bindings) {
            const id = String(reference).slice("secretRef:".length);
            const credential = vault.find(id);
            if (!credential) throw new Error(`Credential '${id}' referenced by ${name} was not found.`);
            const value = vault.resolveRef(reference, { targetId: credential.projectId, action });
            if (value === null) throw new Error(`Credential '${id}' is not allowed for ${action}.`);
            resolved[name] = value;
        }
        return resolved;
    } finally {
        vault.close();
    }
}
