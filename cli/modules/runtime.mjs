#!/usr/bin/env node

import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { parseEnv } from "../core/env.mjs";
import { loadModuleRegistry } from "./registry.mjs";
import fs from "node:fs";

const ARGUMENT_LIMIT = 64;
const ARGUMENT_LENGTH_LIMIT = 2048;

function environmentValue(fileEnv, name) {
    return process.env[name] || fileEnv[name] || "";
}

function validateArguments(args) {
    if (args.length > ARGUMENT_LIMIT) throw new Error(`Module actions accept at most ${ARGUMENT_LIMIT} arguments.`);
    return args.map((value) => {
        const text = String(value);
        if (!text || text.length > ARGUMENT_LENGTH_LIMIT || text.includes("\0")) {
            throw new Error("Module action contains an invalid argument.");
        }
        return text;
    });
}

export function prepareModuleInvocation({ root, envFile, builtinFile, moduleId, action, args = [] }) {
    const fileEnv = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
    const registry = loadModuleRegistry({
        builtinFile,
        root,
        disabledModules: environmentValue(fileEnv, "HETZER_DISABLED_MODULES"),
        enabledModules: environmentValue(fileEnv, "HETZER_ENABLED_MODULES"),
    });
    const module = registry.modules.find((candidate) => candidate.id === moduleId);
    if (!module) throw new Error(`Unknown module '${moduleId}'.`);
    if (!module.enabled) throw new Error(`Module '${moduleId}' is not active. Run 'hetzer install ${moduleId}' first.`);
    if (!module.runtime) throw new Error(`Module '${moduleId}' does not declare a host runtime.`);
    if (!module.runtime.actions.includes(action)) {
        throw new Error(`Action '${action}' is not available for module '${moduleId}'.`);
    }

    return {
        entryPath: module.runtime.entryPath,
        secretEnv: module.runtime.secretEnv,
        action,
        args: validateArguments(args),
    };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        const [moduleId, action, ...args] = process.argv.slice(2);
        if (!moduleId || !action) throw new Error("Usage: runtime <module> <action> [args]");
        const here = path.dirname(fileURLToPath(import.meta.url));
        const root = path.resolve(process.env.HETZER_ROOT || process.cwd());
        const envFile = path.resolve(process.env.HETZER_ENV_FILE || path.join(root, ".env"));
        const invocation = prepareModuleInvocation({
            root,
            envFile,
            builtinFile: path.join(here, "builtin.json"),
            moduleId,
            action,
            args,
        });
        const execRunner = path.resolve(here, "..", "vault", "exec.mjs");
        const execArgs = [
            execRunner,
            "--root", root,
            "--env-file", envFile,
            ...(invocation.secretEnv.length ? ["--allow", invocation.secretEnv.join(",")] : []),
            "--",
            process.execPath,
            invocation.entryPath,
            invocation.action,
            "--hetzer-root", root,
            ...invocation.args,
        ];
        const result = spawnSync(process.execPath, execArgs, { stdio: "inherit", windowsHide: true });
        if (result.error) throw result.error;
        process.exitCode = result.status === null ? 1 : result.status;
    } catch (error) {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    }
}
