#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveSecretEnvironment } from "./secret-env.mjs";

function parseArguments(argv) {
    const marker = argv.indexOf("--");
    if (marker === -1 || !argv[marker + 1]) {
        throw new Error("Usage: exec --root <path> --env-file <path> [--allow NAME,NAME] -- <command> [args]");
    }
    const options = argv.slice(0, marker);
    const value = (name) => {
        const index = options.indexOf(name);
        return index >= 0 ? options[index + 1] : "";
    };
    return {
        root: path.resolve(value("--root") || process.cwd()),
        envFile: path.resolve(value("--env-file")),
        allowNames: value("--allow").split(",").map((name) => name.trim()).filter(Boolean),
        command: argv[marker + 1],
        commandArgs: argv.slice(marker + 2),
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const options = parseArguments(process.argv.slice(2));
        const env = resolveSecretEnvironment({ ...options, action: "process.start" });
        const result = spawnSync(options.command, options.commandArgs, {
            stdio: "inherit",
            env,
            windowsHide: true,
        });
        if (result.error) throw result.error;
        process.exitCode = result.status === null ? 1 : result.status;
    } catch (error) {
        process.stderr.write(`Hetzer process failed: ${error.message}\n`);
        process.exitCode = 1;
    }
}
