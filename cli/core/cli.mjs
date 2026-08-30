import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configureMcp } from "../mcp/configure.mjs";
import { loadModuleRegistry } from "../modules/registry.mjs";
import { resolveModuleProfiles } from "../modules/resolve.mjs";
import { setModuleEnabled } from "../modules/toggle.mjs";
import { migrateEnvCredentials } from "../vault/migrate-env.mjs";
import { parseEnv } from "./env.mjs";

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const builtinFile = path.join(cliRoot, "modules", "builtin.json");
const templatesDir = path.join(cliRoot, "templates");

function replaceEnvValue(text, name, value) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

function copyIfMissing(source, target) {
    if (fs.existsSync(target)) return false;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true, errorOnExist: true });
    return true;
}

function randomHex(bytes = 32) {
    return crypto.randomBytes(bytes).toString("hex");
}

function run(file, args, options = {}) {
    const result = spawnSync(file, args, {
        cwd: options.cwd,
        env: options.env || process.env,
        stdio: options.capture ? "pipe" : "inherit",
        encoding: options.capture ? "utf8" : undefined,
        windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        const message = options.capture ? String(result.stderr || result.stdout || "").trim() : "";
        throw new Error(message || `${path.basename(file)} exited with status ${result.status}.`);
    }
    return options.capture ? String(result.stdout || "") : "";
}

function projectEnvironment(root) {
    const envFile = path.join(root, ".env");
    if (!fs.existsSync(envFile)) throw new Error(`Missing ${envFile}. Run 'shadow init' first.`);
    const values = parseEnv(fs.readFileSync(envFile, "utf8"));
    return { envFile, values };
}

function registryFor(root, values) {
    return loadModuleRegistry({
        builtinFile,
        root,
        disabledModules: process.env.SHADOW_DISABLED_MODULES || values.SHADOW_DISABLED_MODULES,
        enabledModules: process.env.SHADOW_ENABLED_MODULES || values.SHADOW_ENABLED_MODULES,
    });
}

function compose(root, envFile, args) {
    run(process.execPath, [
        path.join(cliRoot, "vault", "compose-runner.mjs"),
        "--root", root,
        "--env-file", envFile,
        "--",
        ...args,
    ], { cwd: root });
}

function profileArguments(root, values, target) {
    const profiles = resolveModuleProfiles({ registry: registryFor(root, values), target });
    return profiles.flatMap((profile) => ["--profile", profile]);
}

export function initializeProject(root) {
    const resolvedRoot = path.resolve(root);
    fs.mkdirSync(resolvedRoot, { recursive: true });
    copyIfMissing(path.join(templatesDir, "docker-compose.yml"), path.join(resolvedRoot, "docker-compose.yml"));
    copyIfMissing(path.join(templatesDir, ".env.example"), path.join(resolvedRoot, ".env.example"));
    const cogneeTemplate = path.join(templatesDir, "modules", "cognee");
    if (fs.existsSync(cogneeTemplate)) {
        copyIfMissing(cogneeTemplate, path.join(resolvedRoot, "modules", "cognee"));
    }

    const envFile = path.join(resolvedRoot, ".env");
    copyIfMissing(path.join(resolvedRoot, ".env.example"), envFile);
    let text = fs.readFileSync(envFile, "utf8");
    const values = parseEnv(text);
    const generated = {
        NINE_ROUTER_JWT_SECRET: randomHex(),
        NINE_ROUTER_INITIAL_PASSWORD: randomHex(16),
        NINE_ROUTER_API_KEY_SECRET: randomHex(),
        NINE_ROUTER_MACHINE_ID_SALT: randomHex(),
        SHADOW_GRIMOIRE_KEY: crypto.randomBytes(48).toString("base64url"),
    };
    for (const [name, value] of Object.entries(generated)) {
        if (!values[name] || String(values[name]).startsWith("replace-")) text = replaceEnvValue(text, name, value);
    }
    fs.writeFileSync(envFile, text, { encoding: "utf8", mode: 0o600 });
    try { fs.chmodSync(envFile, 0o600); } catch { /* Windows ACLs are managed by the host. */ }

    const current = parseEnv(text);
    migrateEnvCredentials({
        root: resolvedRoot,
        envFile,
        masterKey: process.env.SHADOW_GRIMOIRE_KEY || current.SHADOW_GRIMOIRE_KEY,
        authorizationRef: "user:shadow-init",
    });
    configureMcp(resolvedRoot);
    return { root: resolvedRoot, envFile };
}

function help() {
    return `Shadow Core

Usage: shadow <command> [arguments]

  init [directory]          Create or secure a Shadow Core project
  doctor                    Validate Docker and the core Compose contract
  up [module|all]           Pull and start core or an enabled module
  down                      Stop the project without deleting volumes
  status                    Show container and image state
  logs [service]            Follow project logs
  modules                   List available and enabled modules
  install <module>          Enable an optional module
  remove <module>           Disable an optional module without deleting data
  module <id> <action>      Run a declared host-process module action
  mcp configure|serve       Configure or run the Shadow MCP bridge
  tui                       Open the live terminal operations view
`;
}

export async function main(argv = process.argv.slice(2), options = {}) {
    const command = argv[0] || "help";
    const args = argv.slice(1);
    const root = path.resolve(options.root || process.env.SHADOW_ROOT || process.cwd());

    if (["help", "--help", "-h"].includes(command)) {
        process.stdout.write(help());
        return;
    }
    if (command === "init") {
        const result = initializeProject(args[0] ? path.resolve(args[0]) : root);
        process.stdout.write(`Shadow Core initialized at ${result.root}\n`);
        return;
    }

    const { envFile, values } = projectEnvironment(root);
    if (command === "doctor") {
        run("docker", ["compose", "version"], { cwd: root });
        compose(root, envFile, ["--profile", "core", "config", "--quiet"]);
        process.stdout.write("Shadow Core configuration is valid.\n");
        return;
    }
    if (["install", "remove"].includes(command)) {
        if (!args[0]) throw new Error(`Usage: shadow ${command} <module>`);
        setModuleEnabled({
            root,
            envFile,
            moduleId: args[0],
            enabled: command === "install",
            builtinFile,
        });
        configureMcp(root);
        process.stdout.write(`Module '${args[0]}' ${command === "install" ? "enabled" : "disabled"}.\n`);
        return;
    }
    if (command === "modules") {
        run(process.execPath, [path.join(cliRoot, "modules", "list.mjs"), "--root", root], { cwd: root });
        return;
    }
    if (command === "up") {
        const target = args[0] === "all" ? "*" : args[0] || "core";
        const profiles = profileArguments(root, values, target);
        compose(root, envFile, [...profiles, "pull", "--policy", "always", "--ignore-buildable"]);
        compose(root, envFile, [...profiles, "up", "-d"]);
        return;
    }
    if (command === "down") {
        compose(root, envFile, [...profileArguments(root, values, "*"), "down"]);
        return;
    }
    if (command === "status") {
        compose(root, envFile, [...profileArguments(root, values, "*"), "ps", "--all"]);
        return;
    }
    if (command === "logs") {
        compose(root, envFile, [...profileArguments(root, values, "*"), "logs", "-f", ...args]);
        return;
    }
    if (command === "module") {
        if (args.length < 2) throw new Error("Usage: shadow module <module> <action> [args]");
        run(process.execPath, [path.join(cliRoot, "modules", "runtime.mjs"), ...args], {
            cwd: root,
            env: { ...process.env, SHADOW_ROOT: root, SHADOW_ENV_FILE: envFile },
        });
        return;
    }
    if (command === "mcp") {
        const action = args[0] || "serve";
        if (action === "configure") {
            process.stdout.write(`Registered MCP servers in ${configureMcp(root)}\n`);
            return;
        }
        if (action !== "serve") throw new Error("Usage: shadow mcp <configure|serve>");
        run(process.execPath, [
            path.join(cliRoot, "vault", "exec.mjs"),
            "--root", root,
            "--env-file", envFile,
            "--",
            process.execPath,
            path.join(cliRoot, "mcp", "server.mjs"),
        ], { cwd: root });
        return;
    }
    if (command === "tui") {
        run(process.execPath, [path.join(cliRoot, "modules", "tui.mjs"), "--root", root], { cwd: root });
        return;
    }
    throw new Error(`Unknown command '${command}'. Run 'shadow help'.`);
}
