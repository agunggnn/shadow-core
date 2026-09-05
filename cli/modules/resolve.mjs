#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnv } from "../core/env.mjs";
import { loadModuleRegistry } from "./registry.mjs";

export function resolveModuleProfiles({ registry, target }) {
    const byId = new Map(registry.modules.map((module) => [module.id, module]));
    const selected = [];
    const seen = new Set();
    const visiting = new Set();
    const visit = (id, explicit = false) => {
        if (visiting.has(id)) throw new Error(`Circular dependency detected involving module '${id}'.`);
        if (seen.has(id)) return;
        const module = byId.get(id);
        if (!module) throw new Error(`Unknown module '${id}'. Add modules/${id}/module.json first.`);
        if (!module.enabled && (explicit || id !== "core")) {
            throw new Error(`Module '${id}' is not active. Run 'hetzer install ${id}' first.`);
        }
        if (module.lifecycle === "external") {
            if (explicit) throw new Error(`Module '${id}' is externally managed and has no Hetzer runtime to start.`);
            return;
        }
        visiting.add(id);
        for (const dependency of module.requires) visit(dependency);
        visiting.delete(id);
        seen.add(id);
        selected.push(module.profile);
    };

    if (["all", "*"].includes(target)) {
        for (const module of registry.modules) {
            if (module.enabled && module.lifecycle === "compose") visit(module.id);
        }
        return [...new Set(selected)];
    }
    visit(target, true);
    return [...new Set(selected)];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const args = process.argv.slice(2);
        const target = args[0] || "core";
        const option = (name) => {
            const index = args.indexOf(name);
            return index >= 0 ? args[index + 1] : "";
        };
        const root = path.resolve(option("--root") || process.env.HETZER_ROOT || process.cwd());
        const envFile = path.resolve(option("--env-file") || process.env.HETZER_ENV_FILE || path.join(root, ".env"));
        const values = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
        const registry = loadModuleRegistry({
            builtinFile: path.join(path.dirname(fileURLToPath(import.meta.url)), "builtin.json"),
            root,
            disabledModules: values.HETZER_DISABLED_MODULES,
            enabledModules: values.HETZER_ENABLED_MODULES,
        });
        process.stdout.write(`${resolveModuleProfiles({ registry, target }).join("\n")}\n`);
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
