#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadModuleRegistry, publicModuleSummary } from "./registry.mjs";

function parseEnv(file) {
    if (!fs.existsSync(file)) return {};
    const values = {};
    for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith("#")) continue;
        const separator = line.indexOf("=");
        if (separator < 1) continue;
        values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    }
    return values;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.env.HETZER_ROOT || process.cwd());
const fileEnv = parseEnv(path.join(root, ".env"));
const env = (name) => process.env[name] || fileEnv[name] || "";
const registry = loadModuleRegistry({
    builtinFile: path.join(here, "builtin.json"),
    root,
    disabledModules: env("HETZER_DISABLED_MODULES"),
    enabledModules: env("HETZER_ENABLED_MODULES"),
});
const summary = publicModuleSummary(registry);

if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify({ modules: summary, warnings: registry.warnings }, null, 2)}\n`);
} else {
    const widths = { id: 16, status: 9, lifecycle: 10, surface: 9 };
    const row = (id, status, lifecycle, surface, label) => [
        id.padEnd(widths.id),
        status.padEnd(widths.status),
        lifecycle.padEnd(widths.lifecycle),
        surface.padEnd(widths.surface),
        label,
    ].join("  ");
    process.stdout.write(`${row("MODULE", "STATUS", "LIFECYCLE", "SURFACE", "LABEL")}\n`);
    for (const module of summary) {
        process.stdout.write(`${row(
            module.id,
            module.enabled ? "enabled" : "disabled",
            module.lifecycle,
            module.surface,
            module.label,
        )}\n`);
    }
    for (const warning of registry.warnings) process.stderr.write(`warning: ${warning}\n`);
}
