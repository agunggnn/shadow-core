import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { configureMcp } from "../mcp/configure.mjs";
import { loadModuleRegistry } from "../modules/registry.mjs";
import { resolveModuleProfiles } from "../modules/resolve.mjs";
import { setModuleEnabled } from "../modules/toggle.mjs";
import { KNOWN_CREDENTIALS, listCredentials, revealCredential, setCredential } from "../vault/creds.mjs";
import { migrateEnvCredentials } from "../vault/migrate-env.mjs";
import { runDoctor } from "./doctor.mjs";
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

export function defaultShadowHome() {
    return process.env.SHADOW_HOME
        ? path.resolve(process.env.SHADOW_HOME)
        : path.join(os.homedir(), ".shadow");
}

export function isShadowWorkspace(dir) {
    const composeFile = path.join(dir, "docker-compose.yml");
    const envFile = path.join(dir, ".env");
    const exampleFile = path.join(dir, ".env.example");
    if (fs.existsSync(composeFile)) {
        try {
            const content = fs.readFileSync(composeFile, "utf8");
            const isShadow = content.includes("nine-router") || content.includes("shadow-core") || content.includes("NINE_ROUTER");
            if (isShadow && (fs.existsSync(envFile) || fs.existsSync(exampleFile))) {
                return true;
            }
        } catch {
            return false;
        }
    }
    return false;
}

export function resolveProjectRoot(options = {}) {
    if (options.root) {
        return path.resolve(options.root);
    }
    if (process.env.SHADOW_ROOT) {
        return path.resolve(process.env.SHADOW_ROOT);
    }
    const cwd = process.cwd();
    if (isShadowWorkspace(cwd)) {
        return cwd;
    }
    return defaultShadowHome();
}

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
    if (!fs.existsSync(envFile)) {
        const isHome = root === defaultShadowHome();
        const locationMsg = isHome ? "Global user home (~/.shadow)" : `Direktori '${root}'`;
        throw new Error(`${locationMsg} belum diinisialisasi (file .env tidak ditemukan).\nJalankan 'shadow init' terlebih dahulu untuk membuat konfigurasi awal.`);
    }
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
    fs.mkdirSync(resolvedRoot, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(resolvedRoot, 0o700); } catch { /* Windows */ }
    copyIfMissing(path.join(templatesDir, "docker-compose.yml"), path.join(resolvedRoot, "docker-compose.yml"));
    copyIfMissing(path.join(templatesDir, ".env.example"), path.join(resolvedRoot, ".env.example"));
    const cogneeTemplate = path.join(templatesDir, "modules", "cognee");
    if (fs.existsSync(cogneeTemplate)) {
        copyIfMissing(cogneeTemplate, path.join(resolvedRoot, "modules", "cognee"));
    }

    const dataDir = path.join(resolvedRoot, "data");
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(dataDir, 0o700); } catch { /* Windows */ }

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
    try {
        configureMcp(resolvedRoot);
    } catch { /* ignore */ }
    return { root: resolvedRoot, envFile, initialPassword };
}

function printInitWizard(result) {
    const isGlobal = result.root === defaultShadowHome();
    process.stdout.write("================================================================================\n");
    process.stdout.write("  SHADOW CORE - INISIALISASI BERHASIL\n");
    process.stdout.write("================================================================================\n");
    process.stdout.write(`[v] Lokasi Instance   : ${result.root}${isGlobal ? " (Global User Home)" : " (Workspace Lokal)"}\n`);
    process.stdout.write(`[v] File Konfigurasi  : .env (izin akses diamankan chmod 600)\n`);
    process.stdout.write(`[v] Grimoire Vault    : data/shadow-vault.db (Terenkripsi AES-256-GCM)\n`);
    process.stdout.write(`[v] MCP Server        : .mcp.json terkonfigurasi\n`);
    if (isGlobal) {
        process.stdout.write(`[v] Akses Global      : Anda dapat menjalankan 'shadow' dari direktori mana saja!\n`);
    }
    process.stdout.write("--------------------------------------------------------------------------------\n");
    process.stdout.write("  INFORMASI LOGIN & KREDENSIAL AWAL 9ROUTER:\n");
    process.stdout.write("--------------------------------------------------------------------------------\n");
    process.stdout.write("  URL Web UI       : http://127.0.0.1:20140\n");
    process.stdout.write("  Form Login       : Masukkan password di bawah (9Router hanya meminta Password)\n");
    process.stdout.write(`  Initial Password : ${result.initialPassword || "(tersimpan di vault)"}\n\n`);
    process.stdout.write("  CATATAN PENTING INISIALISASI:\n");
    process.stdout.write("  9Router hanya membaca Initial Password saat database pertama kali dibuat.\n");
    process.stdout.write("  Jika sebelumnya 9Router sudah pernah dijalankan, jalankan:\n");
    process.stdout.write("    shadow down -v && shadow up\n");
    process.stdout.write("  untuk menghapus volume lama agar password baru ini aktif.\n\n");
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

export function printModuleHelp(moduleId, root, values) {
    const registry = registryFor(root, values);
    const module = registry.modules.find((m) => m.id === moduleId);
    if (!module) {
        process.stdout.write(`Modul '${moduleId}' tidak ditemukan.\n`);
        process.stdout.write("Jalankan 'shadow modules' untuk melihat daftar modul yang tersedia.\n");
        return;
    }

    const isEnabled = module.enabled;
    const isCompose = module.lifecycle === "compose";
    const service = module.services[0] || {};
    const composeService = service.composeService || moduleId;

    process.stdout.write("================================================================================\n");
    process.stdout.write(`  PANDUAN LENGKAP MODUL NATIVE: ${module.label || moduleId} (${module.id})\n`);
    process.stdout.write("================================================================================\n");
    process.stdout.write(`  Status      : ${isEnabled ? "Aktif (Enabled)" : "Nonaktif (Disabled)"}\n`);
    process.stdout.write(`  Lifecycle   : ${module.lifecycle}${isCompose ? " (Docker Compose Container)" : " (Host Process)"}\n`);
    if (service.role) process.stdout.write(`  Peran       : ${service.role}\n`);
    if (service.lore) process.stdout.write(`  Deskripsi   : ${service.lore}\n`);
    if (service.portEnv && values[service.portEnv]) {
        process.stdout.write(`  Web UI/Port : http://127.0.0.1:${values[service.portEnv]}\n`);
    } else if (service.fallbackPort) {
        process.stdout.write(`  Web UI/Port : http://127.0.0.1:${service.fallbackPort}\n`);
    }
    if (service.mcpServer) {
        process.stdout.write(`  MCP Server  : ${service.mcpServer.name} (${service.mcpServer.transport} at ${service.mcpServer.path})\n`);
    }

    process.stdout.write("--------------------------------------------------------------------------------\n");
    process.stdout.write("  PERINTAH NATIVE YANG TERSEDIA:\n");
    process.stdout.write("--------------------------------------------------------------------------------\n");

    if (isCompose) {
        process.stdout.write("1. MANAJEMEN CONTAINER DOCKER:\n");
        process.stdout.write(`   - Jalankan container        : shadow up ${module.id}\n`);
        process.stdout.write(`   - Update image ke digest baru: shadow update ${module.id}\n`);
        process.stdout.write(`   - Lihat live logs           : shadow logs ${composeService}\n`);
        process.stdout.write(`   - Pantau status container   : shadow status\n\n`);
    }

    const creds = Object.entries(KNOWN_CREDENTIALS)
        .filter(([_, def]) => def.moduleId === module.id)
        .map(([id, def]) => ({ id, ...def }));

    if (creds.length > 0) {
        process.stdout.write("2. KREDENSIAL & RAHASIA (GRIMOIRE VAULT):\n");
        for (const cred of creds) {
            process.stdout.write(`   - Cek rahasia '${cred.id}':\n`);
            process.stdout.write(`       shadow creds reveal ${cred.id}\n`);
            process.stdout.write(`   - Atur rahasia '${cred.id}':\n`);
            process.stdout.write(`       shadow creds set ${cred.id} <nilai>\n`);
        }
        process.stdout.write("\n");
    }

    process.stdout.write("3. AKTIVASI & STATUS MODUL:\n");
    process.stdout.write(`   - Aktifkan modul            : shadow install ${module.id}\n`);
    process.stdout.write(`   - Nonaktifkan modul         : shadow remove ${module.id}\n`);

    if (module.runtime?.actions?.length) {
        process.stdout.write("\n4. ACTION HOST-PROCESS:\n");
        for (const act of module.runtime.actions) {
            process.stdout.write(`   - shadow module ${module.id} ${act} [args]\n`);
        }
    }

    if (module.id === "9router") {
        process.stdout.write("\n4. AKSES WEB UI & CATATAN LOGIN:\n");
        process.stdout.write("   - URL Web UI                : http://127.0.0.1:20140\n");
        process.stdout.write("   - Form Login                : Masukkan Initial Password (tanpa username)\n");
        process.stdout.write("   - Reset Volume (Password)   : shadow down -v && shadow up 9router\n");
    }

    if (module.id === "cognee") {
        process.stdout.write("\n4. INTEGRASI MCP CLIENT:\n");
        process.stdout.write("   - Daftarkan ke editor/client: shadow mcp configure\n");
        process.stdout.write("   - Tools yang disediakan     : remember, recall, improve, forget_memory\n");
    }

    process.stdout.write("================================================================================\n");
}

function help() {
    return `Shadow Core

Usage: shadow [options] <command> [arguments]

Options:
  --root <path>             Tentukan root direktori Shadow instance (default: ~/.shadow)

Commands:
  init [directory]          Inisialisasi Shadow Core (default: ~/.shadow)
  doctor                    Cek kompatibilitas sistem, Docker engine, dan permissions
  up [module|all]           Jalankan container core, 9router, atau modul aktif
  update [target|all]       Tarik dan perbarui digest image modul/service
  down [-v]                 Hentikan service (gunakan -v untuk menghapus volume data)
  status                    Lihat status kontainer dan image
  logs [service]            Lihat log service
  modules [module]          Daftar modul tersedia atau panduan detail modul
  install <module>          Aktifkan modul (contoh: 9router, cognee)
  remove <module>           Nonaktifkan modul tanpa menghapus data
  module <id> [action|help] Panduan perintah native atau jalankan action host modul
  creds [list|reveal|set]   Kelola rahasia terenkripsi di Shadow Vault
  mcp configure|serve       Konfigurasi atau jalankan bridge Shadow MCP
  tui                       Buka tampilan operasional terminal interaktif
`;
}

export async function main(argv = process.argv.slice(2), options = {}) {
    const parsedArgs = [...argv];
    let rootOption = options.root;
    const rootIndex = parsedArgs.indexOf("--root");
    if (rootIndex !== -1 && parsedArgs[rootIndex + 1]) {
        rootOption = parsedArgs[rootIndex + 1];
        parsedArgs.splice(rootIndex, 2);
    }
    const command = parsedArgs[0] || "help";
    const args = parsedArgs.slice(1);
    const root = resolveProjectRoot({ root: rootOption });

    if (["help", "--help", "-h"].includes(command)) {
        process.stdout.write(help());
        return;
    }
    if (command === "doctor") {
        const result = runDoctor({ root, defaultHome: defaultShadowHome() });
        if (!result.ok) process.exitCode = 1;
        return;
    }
    if (command === "init") {
        const target = args[0]
            ? path.resolve(args[0])
            : (rootOption
                ? path.resolve(rootOption)
                : (isShadowWorkspace(process.cwd()) ? process.cwd() : defaultShadowHome()));
        const result = initializeProject(target);
        printInitWizard(result);
        return;
    }

    const { envFile, values } = projectEnvironment(root);
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
            const upTarget = result.module && result.module !== "core" ? `shadow up ${result.module}` : "shadow up";
            process.stdout.write(`  Terapkan  : Jalankan '${upTarget}' (atau 'shadow up') untuk memuat ulang ke container.\n`);
            process.stdout.write("================================================================================\n");
            return;
        }
        throw new Error(`Subcommand creds tidak dikenal: '${subCommand}'. Gunakan 'list', 'reveal', atau 'set'.`);
    }
    if (command === "modules") {
        if (args[0] && !args[0].startsWith("-")) {
            printModuleHelp(args[0], root, values);
            return;
        }
        run(process.execPath, [path.join(cliRoot, "modules", "list.mjs"), "--root", root, ...args], { cwd: root });
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
        compose(root, envFile, [...profileArguments(root, values, "*").arguments, "down", ...args]);
        return;
    }
    if (command === "status") {
        compose(root, envFile, [...profileArguments(root, values, "*").arguments, "ps", "--all"]);
        return;
    }
    if (command === "logs") {
        const registry = registryFor(root, values);
        const mappedArgs = [];
        for (const arg of args) {
            if (arg.startsWith("-")) {
                mappedArgs.push(arg);
                continue;
            }
            let foundModule = null;
            let foundService = null;
            for (const mod of registry.modules) {
                if (mod.id === arg) {
                    foundModule = mod;
                    foundService = mod.services[0];
                    break;
                }
                const s = mod.services.find((cand) => cand.id === arg || cand.composeService === arg);
                if (s) {
                    foundModule = mod;
                    foundService = s;
                    break;
                }
            }
            if (foundModule) {
                if (!foundModule.enabled) {
                    process.stderr.write(`[!] Modul '${foundModule.id}' belum diaktifkan.\n    Jalankan 'shadow install ${foundModule.id} && shadow up ${foundModule.id}' terlebih dahulu.\n`);
                    return;
                }
                mappedArgs.push(foundService?.composeService || arg);
            } else {
                mappedArgs.push(arg);
            }
        }
        compose(root, envFile, [...profileArguments(root, values, "*").arguments, "logs", "-f", ...mappedArgs]);
        return;
    }
    if (command === "module") {
        const moduleId = args[0];
        const action = args[1];
        if (!moduleId || ["help", "--help", "-h"].includes(moduleId)) {
            process.stdout.write("Penggunaan: shadow module <id> [action|help]\n\n");
            process.stdout.write("Panduan perintah native modul bawaan:\n");
            process.stdout.write("  shadow module 9router help\n");
            process.stdout.write("  shadow module cognee help\n\n");
            process.stdout.write("Jalankan 'shadow modules' untuk melihat daftar seluruh modul.\n");
            return;
        }
        if (!action || ["help", "--help", "-h"].includes(action)) {
            printModuleHelp(moduleId, root, values);
            return;
        }
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
