import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configureMcp } from "../mcp/configure.mjs";
import { loadModuleRegistry } from "../modules/registry.mjs";
import { resolveModuleProfiles } from "../modules/resolve.mjs";
import { setModuleEnabled } from "../modules/toggle.mjs";
import { listCredentials, revealCredential, setCredential } from "../vault/creds.mjs";
import { migrateEnvCredentials } from "../vault/migrate-env.mjs";
import { parseEnv } from "./env.mjs";
import {
    migrateBundledImagePins,
    moduleIdsForProfiles,
    resolveLifecycleTarget,
    updateComposeCommands,
} from "./update.mjs";

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
    const registry = registryFor(root, values);
    const resolvedTarget = resolveLifecycleTarget(registry, target);
    const profiles = resolveModuleProfiles({ registry, target: resolvedTarget });
    return {
        registry,
        profiles,
        arguments: profiles.flatMap((profile) => ["--profile", profile]),
    };
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
    let initialPassword = generated.NINE_ROUTER_INITIAL_PASSWORD;
    try {
        const revealed = revealCredential({ root: resolvedRoot, envFile, id: "nine-router-initial-password" });
        if (revealed?.secret) initialPassword = revealed.secret;
    } catch { /* ignore */ }
    return { root: resolvedRoot, envFile, initialPassword };
}

function printInitWizard(result) {
    process.stdout.write("================================================================================\n");
    process.stdout.write("  SHADOW CORE - INISIALISASI PROYEK BERHASIL\n");
    process.stdout.write("================================================================================\n");
    process.stdout.write(`[v] Direktori Proyek  : ${result.root}\n`);
    process.stdout.write(`[v] File Konfigurasi  : .env (izin akses diamankan chmod 600)\n`);
    process.stdout.write(`[v] Grimoire Vault    : data/shadow-vault.db (Terenkripsi AES-256-GCM)\n`);
    process.stdout.write(`[v] MCP Server        : .mcp.json terkonfigurasi\n`);
    process.stdout.write("--------------------------------------------------------------------------------\n");
    process.stdout.write("  INFORMASI LOGIN & KREDENSIAL AWAL 9ROUTER:\n");
    process.stdout.write("--------------------------------------------------------------------------------\n");
    process.stdout.write("  URL Web UI       : http://127.0.0.1:20140\n");
    process.stdout.write("  Username Default : admin (atau saat setup pertama kali di UI)\n");
    process.stdout.write(`  Initial Password : ${result.initialPassword || "(tersimpan di vault)"}\n\n`);
    process.stdout.write("  CATATAN KEAMANAN (ZERO-PLAINTEXT):\n");
    process.stdout.write("  Password ini telah dienkripsi di Grimoire Vault (data/shadow-vault.db).\n");
    process.stdout.write("  File .env hanya menyimpan referensi aman:\n");
    process.stdout.write("    NINE_ROUTER_INITIAL_PASSWORD=secretRef:nine-router-initial-password\n");
    process.stdout.write("  sehingga kredensial Anda aman dari kebocoran teks polos ke git.\n\n");
    process.stdout.write("  MANAJEMEN KREDENSIAL:\n");
    process.stdout.write("  - Lihat password kapan saja : shadow creds reveal nine-router-initial-password\n");
    process.stdout.write("  - Ganti password di vault   : shadow creds set nine-router-initial-password <password-baru>\n");
    process.stdout.write("  - Cek semua kredensial      : shadow creds list\n");
    process.stdout.write("--------------------------------------------------------------------------------\n");
    process.stdout.write("  LANGKAH SELANJUTNYA:\n");
    process.stdout.write("--------------------------------------------------------------------------------\n");
    process.stdout.write("  1. Nyalakan services   : shadow up\n");
    process.stdout.write("  2. Buka Web UI         : http://127.0.0.1:20140 (login dengan password di atas)\n");
    process.stdout.write("  3. Cek live dashboard  : shadow tui\n");
    process.stdout.write("  4. Cek modul tambahan  : shadow modules\n");
    process.stdout.write("================================================================================\n");
}

function printModuleGuide(moduleId, action) {
    if (action === "install") {
        process.stdout.write(`Modul '${moduleId}' berhasil diaktifkan.\n`);
        if (moduleId === "cognee") {
            process.stdout.write("\n================================================================================\n");
            process.stdout.write("  PANDUAN KONFIGURASI MODUL: cognee\n");
            process.stdout.write("================================================================================\n");
            process.stdout.write("Modul 'cognee' menyediakan memori graf & vektor persisten via Model Context Protocol (MCP).\n\n");
            process.stdout.write("KREDENSIAL YANG DIBUTUHKAN:\n");
            process.stdout.write("  Modul ini memerlukan API key LLM (OpenAI, Anthropic, OpenRouter, dll.).\n\n");
            process.stdout.write("CARA MENGATUR KREDENSIAL (TANPA EDIT .ENV MANUAL):\n");
            process.stdout.write("  Jalankan perintah berikut untuk menyimpan API key ke Vault terenkripsi:\n");
            process.stdout.write("    shadow creds set cognee-llm-api-key <api-key-anda>\n\n");
            process.stdout.write("CARA MENJALANKAN & MENGHUBUNGKAN:\n");
            process.stdout.write("  1. Mulai service   : shadow up cognee\n");
            process.stdout.write("  2. Setup MCP       : shadow mcp configure\n");
            process.stdout.write("  3. Gunakan MCP     : Buka Claude Desktop / Cursor / Cline, tools berikut akan aktif:\n");
            process.stdout.write("                       - remember, recall, improve, forget_memory\n");
            process.stdout.write("================================================================================\n");
        } else if (moduleId === "9router") {
            process.stdout.write("\n================================================================================\n");
            process.stdout.write("  PANDUAN MODUL: 9router\n");
            process.stdout.write("================================================================================\n");
            process.stdout.write("Modul '9router' adalah AI Gateway lokal untuk routing model cerdas dan fallback.\n\n");
            process.stdout.write("CARA MENGAKSES & LOGIN:\n");
            process.stdout.write("  1. Jalankan service : shadow up 9router\n");
            process.stdout.write("  2. Buka browser     : http://127.0.0.1:20140\n");
            process.stdout.write("  3. Cek password     : shadow creds reveal nine-router-initial-password\n");
            process.stdout.write("================================================================================\n");
        } else {
            process.stdout.write(`Jalankan 'shadow up ${moduleId}' untuk memulai modul.\n`);
        }
    } else {
        process.stdout.write(`Modul '${moduleId}' berhasil dinonaktifkan.\n`);
        process.stdout.write(`[i] Jalankan 'shadow up' untuk menerapkan perubahan profile Compose.\n`);
    }
}

function help() {
    return `Shadow Core

Usage: shadow <command> [arguments]

  init [directory]          Create or secure a Shadow Core project
  doctor                    Validate Docker and Compose configuration
  up [module|all]           Pull and start core, 9router, or enabled modules
  update [target|all]       Pull, recreate, and verify a module or service
  down                      Stop the project without deleting volumes
  status                    Show container and image state
  logs [service]            Follow project logs
  modules                   List available and enabled modules
  install <module>          Enable a module (e.g. 9router, cognee)
  remove <module>           Disable a module without deleting data
  creds [list|reveal|set]   Manage encrypted secrets in Shadow Vault
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
        printInitWizard(result);
        return;
    }

    const { envFile, values } = projectEnvironment(root);
    if (command === "doctor") {
        run("docker", ["compose", "version"], { cwd: root });
        const selection = profileArguments(root, values, "*");
        compose(root, envFile, [...selection.arguments, "config", "--quiet"]);
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
        printModuleGuide(args[0], command);
        return;
    }
    if (["creds", "credentials"].includes(command)) {
        const subCommand = args[0] || "list";
        if (subCommand === "list") {
            const list = listCredentials({ root, envFile });
            process.stdout.write("================================================================================\n");
            process.stdout.write("  SHADOW CORE - CREDENTIAL VAULT (GRIMOIRE)\n");
            process.stdout.write("================================================================================\n");
            process.stdout.write("ID                            MODUL     STATUS      DESKRIPSI\n");
            process.stdout.write("----------------------------  --------  ----------  ----------------------------\n");
            for (const item of list) {
                const idCol = item.id.padEnd(28);
                const modCol = item.module.padEnd(8);
                const statusCol = (item.configured ? "tersimpan" : "belum diset").padEnd(10);
                process.stdout.write(`${idCol}  ${modCol}  ${statusCol}  ${item.description}\n`);
            }
            process.stdout.write("--------------------------------------------------------------------------------\n");
            process.stdout.write("Perintah:\n");
            process.stdout.write("  - Lihat nilai rahasia : shadow creds reveal <id>\n");
            process.stdout.write("  - Simpan/ubah nilai   : shadow creds set <id> <nilai>\n");
            process.stdout.write("================================================================================\n");
            return;
        }
        if (subCommand === "reveal" || subCommand === "get") {
            const id = args[1];
            if (!id) throw new Error("Usage: shadow creds reveal <id>");
            const cred = revealCredential({ root, envFile, id });
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  DETAIL KREDENSIAL: ${cred.id}\n`);
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  Nilai Rahasia : ${cred.secret}\n`);
            process.stdout.write(`  Modul         : ${cred.module}\n`);
            process.stdout.write(`  Tipe          : ${cred.authType}\n`);
            process.stdout.write(`  Deskripsi     : ${cred.description}\n`);
            if (cred.usage) {
                process.stdout.write(`  Cara Pakai    : ${cred.usage}\n`);
            }
            process.stdout.write("================================================================================\n");
            return;
        }
        if (subCommand === "set") {
            const id = args[1];
            const secret = args[2];
            if (!id || !secret) throw new Error("Usage: shadow creds set <id> <value>");
            const result = setCredential({ root, envFile, id, secret });
            process.stdout.write("================================================================================\n");
            process.stdout.write(`[v] Kredensial '${result.id}' berhasil disimpan ke Vault (AES-256-GCM)!\n`);
            process.stdout.write(`[v] Konfigurasi .env diperbarui: ${result.envVar}=secretRef:${result.id}\n`);
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  Modul     : ${result.module}\n`);
            process.stdout.write(`  Deskripsi : ${result.description}\n`);
            if (result.usage) {
                process.stdout.write(`  Cara Pakai: ${result.usage}\n`);
            }
            process.stdout.write("  Terapkan  : Jalankan 'shadow up' untuk memuat ulang ke container.\n");
            process.stdout.write("================================================================================\n");
            return;
        }
        throw new Error(`Subcommand creds tidak dikenal: '${subCommand}'. Gunakan 'list', 'reveal', atau 'set'.`);
    }
    if (command === "modules") {
        run(process.execPath, [path.join(cliRoot, "modules", "list.mjs"), "--root", root], { cwd: root });
        return;
    }
    if (command === "up") {
        const target = args[0] === "all" ? "*" : (args[0] || "*");
        const selection = profileArguments(root, values, target);
        compose(root, envFile, [...selection.arguments, "pull", "--policy", "always", "--ignore-buildable"]);
        compose(root, envFile, [...selection.arguments, "up", "-d"]);
        return;
    }
    if (command === "update") {
        const requestedTarget = args[0] || "all";
        const selection = profileArguments(root, values, requestedTarget);
        const currentEnv = fs.readFileSync(envFile, "utf8");
        const migration = migrateBundledImagePins({
            envText: currentEnv,
            moduleIds: moduleIdsForProfiles(selection.registry, selection.profiles),
        });
        if (migration.text !== currentEnv) {
            fs.writeFileSync(envFile, migration.text, { encoding: "utf8", mode: 0o600 });
        }
        for (const change of migration.changes) {
            process.stdout.write(`Pinned ${change.serviceId} ${change.version} in ${path.basename(envFile)}.\n`);
        }
        for (const custom of migration.custom) {
            process.stdout.write(`Keeping custom ${custom.variable}; only known Shadow release pins are migrated.\n`);
        }
        for (const composeArgs of updateComposeCommands(selection.arguments)) {
            compose(root, envFile, composeArgs);
        }
        process.stdout.write(`Updated '${requestedTarget}' from its configured image digests.\n`);
        return;
    }
    if (command === "down") {
        compose(root, envFile, [...profileArguments(root, values, "*").arguments, "down"]);
        return;
    }
    if (command === "status") {
        compose(root, envFile, [...profileArguments(root, values, "*").arguments, "ps", "--all"]);
        return;
    }
    if (command === "logs") {
        compose(root, envFile, [...profileArguments(root, values, "*").arguments, "logs", "-f", ...args]);
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
