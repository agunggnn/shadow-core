#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveSecretEnvironment } from "./secret-env.mjs";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const name = args[0] || "";
    const value = (flag) => {
        const index = args.indexOf(flag);
        return index >= 0 ? args[index + 1] : "";
    };
    const root = path.resolve(value("--root") || process.env.SHADOW_ROOT || process.cwd());
    const envFile = path.resolve(value("--env-file") || process.env.SHADOW_ENV_FILE || path.join(root, ".env"));
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) {
        process.stderr.write("Usage: read-env <ENV_NAME>\n");
        process.exitCode = 1;
    } else {
        try {
            const env = resolveSecretEnvironment({ root, envFile, action: "process.start", allowNames: [name] });
            process.stdout.write(env[name] || "");
        } catch (error) {
            process.stderr.write(`${error.message}\n`);
            process.exitCode = 1;
        }
    }
}
