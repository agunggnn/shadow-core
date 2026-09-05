import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listMcpTools, runMcpToolCommand } from "../mcp/call.mjs";
import { configureMcp } from "../mcp/configure.mjs";
import { diagnoseMcpService } from "../mcp/ping.mjs";
import { createModuleRecipe, createModuleRecipeFromSource } from "../modules/create.mjs";
import { runInstallWizard } from "../modules/install-wizard.mjs";
import { loadModuleRegistry } from "../modules/registry.mjs";
import { resolveModuleProfiles } from "../modules/resolve.mjs";
import { setModuleEnabled } from "../modules/toggle.mjs";
import { formatValidationReport, validateAllModules, validateModuleRecipe } from "../modules/validate.mjs";
import { KNOWN_CREDENTIALS, listCredentials, promptSecret, revealCredential, setCredential } from "../vault/creds.mjs";
import { autoIngestPlaintextEnv, migrateEnvCredentials } from "../vault/migrate-env.mjs";
import { redactAndVault, scanText, restoreSecrets } from "../vault/sniffer.mjs";
import { runDoctor } from "./doctor.mjs";
import { parseEnv } from "./env.mjs";
import {
    migrateBundledImagePins,
    moduleIdsForProfiles,
    resolveLifecycleTarget,
    updateComposeCommands,
} from "./update.mjs";
import { verifyModuleDeployment } from "./verifier.mjs";

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
    try {
        autoIngestPlaintextEnv({ root, envFile });
    } catch {
        // Continue if auto-ingest encounters non-fatal issue
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
    const modulesTemplateDir = path.join(templatesDir, "modules");
    if (fs.existsSync(modulesTemplateDir)) {
        const entries = fs.readdirSync(modulesTemplateDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                copyIfMissing(path.join(modulesTemplateDir, entry.name), path.join(resolvedRoot, "modules", entry.name));
            }
        }
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
    if (module.sourceUrl) process.stdout.write(`  Source Repo : ${module.sourceUrl}\n`);
    if (service.role) process.stdout.write(`  Peran       : ${service.role}\n`);
    if (service.lore) process.stdout.write(`  Deskripsi   : ${service.lore}\n`);
    if (service.portEnv && values[service.portEnv]) {
        process.stdout.write(`  Web UI/Port : http://127.0.0.1:${values[service.portEnv]}\n`);
    } else if (service.fallbackPort) {
        process.stdout.write(`  Web UI/Port : http://127.0.0.1:${service.fallbackPort}\n`);
    }
    if (service.mcpServer) {
        process.stdout.write(`  MCP Server  : ${service.mcpServer.name} (${service.mcpServer.transport} at ${service.mcpServer.path})\n`);
        process.stdout.write(`  Cek Tools   : shadow mcp tools ${service.mcpServer.name}\n`);
        process.stdout.write(`  Ping Test   : shadow mcp ping ${service.mcpServer.name}\n`);
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

    if (service.mcpServer) {
        process.stdout.write(`\n4. INTEGRASI & EKSEKUSI MCP TOOL (${service.mcpServer.name}):\n`);
        process.stdout.write(`   - Cek daftar & sifat tool   : shadow mcp tools ${service.mcpServer.name}\n`);
        process.stdout.write(`   - Panggil tool langsung CLI : shadow mcp call ${service.mcpServer.name} <tool> [args]\n`);
        process.stdout.write(`   - Daftarkan ke AI client    : shadow mcp configure\n`);
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
  doctor [--fix]            Cek kompatibilitas sistem & Docker (--fix untuk auto-repair izin/direktori)
  up [module|all] [--wait]  Jalankan container core, 9router, atau modul aktif (--wait menunggu healthcheck)
  update [target|all]       Tarik dan perbarui digest image modul/service
  down [-v]                 Hentikan service (gunakan -v untuk menghapus volume data)
  status                    Lihat status kontainer dan image
  logs [service]            Lihat log service
  modules [module]          Daftar modul tersedia atau panduan detail modul
  install <module>          Aktifkan modul (contoh: 9router, cognee)
  remove <module>           Nonaktifkan modul tanpa menghapus data
  module <id> [action|help] Panduan perintah native atau jalankan action host modul
  module create <id> [--source <repo>] Buat resep modul baru (analisis AI via 9Router)
  validate [module]         Validasi integritas, keamanan, dan resep Docker modul
  creds [list|reveal|set]   Kelola rahasia terenkripsi di Shadow Vault
  sniffer [scan|redact] <t> Pindai dan amankan kredensial dari teks secara instan (<2ms)
  mcp configure|serve|ping  Konfigurasi, jalankan bridge, atau diagnostik ping Shadow MCP
  mcp tools <service>       Daftar tools MCP service beserta klasifikasi Offline/LLM
  mcp call <srv> <tool> [a] Panggil tool MCP service secara langsung tanpa AI client eksternal
  publish                   Build, validasi, dan publish paket @agunggnn/shadow-core ke npm
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
        const fix = args.includes("--fix");
        const result = runDoctor({ root, defaultHome: defaultShadowHome(), fix });
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
        const moduleId = args[0];
        if (command === "install") {
            const templateModuleDir = path.join(templatesDir, "modules", moduleId);
            const targetModuleDir = path.join(root, "modules", moduleId);
            if (!fs.existsSync(targetModuleDir) && fs.existsSync(templateModuleDir)) {
                copyIfMissing(templateModuleDir, targetModuleDir);
            }
            const nonInteractive = args.includes("--yes") || args.includes("--default");
            await runInstallWizard({ root, envFile, moduleId, nonInteractive });
        }
        setModuleEnabled({
            root,
            envFile,
            moduleId,
            enabled: command === "install",
            builtinFile,
        });
        configureMcp(root);
        printModuleGuide(moduleId, command);
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
            let secret = args[2];
            if (!id) throw new Error("Usage: shadow creds set <id> [value]");
            if (!secret) {
                secret = await promptSecret(`Masukkan nilai rahasia untuk '${id}': `);
            }
            if (!secret) throw new Error("Nilai rahasia (secret) wajib diisi.");
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
            if (result.id.startsWith("npm-")) {
                process.stdout.write("  Terapkan  : Jalankan 'npm run publish-pkg' atau 'node scripts/publish.mjs' untuk publish ke npm.\n");
            } else {
                const upTarget = result.module && result.module !== "core" ? `shadow up ${result.module}` : "shadow up";
                process.stdout.write(`  Terapkan  : Jalankan '${upTarget}' (atau 'shadow up') untuk memuat ulang ke container.\n`);
            }
            process.stdout.write("================================================================================\n");
            return;
        }
        throw new Error(`Subcommand creds tidak dikenal: '${subCommand}'. Gunakan 'list', 'reveal', atau 'set'.`);
    }
    if (["sniffer", "sniff"].includes(command)) {
        const sub = args[0] || "scan";
        const input = args.slice(1).join(" ");
        if (!input) {
            throw new Error("Usage: shadow sniffer <scan|redact> <text>");
        }
        if (sub === "scan") {
            const res = scanText(input);
            process.stdout.write("================================================================================\n");
            process.stdout.write("  SHADOW CORE - SECRET SNIFFER (SUB-2MS DETECTOR)\n");
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  Status Deteksi : ${res.hasSecrets ? "[!] KREDENSIAL DITEMUKAN" : "[v] AMAN (Tidak ada kredensial terdeteksi)"}\n`);
            process.stdout.write(`  Waktu Eksekusi : ${res.latencyMs} ms\n`);
            if (res.hasSecrets) {
                process.stdout.write("--------------------------------------------------------------------------------\n");
                for (const m of res.matches) {
                    process.stdout.write(`  * ${m.label} (${m.type}) di indeks ${m.index}\n`);
                }
            }
            process.stdout.write("================================================================================\n");
            return;
        }
        if (sub === "redact") {
            const res = redactAndVault(input, { root, envFile });
            process.stdout.write("================================================================================\n");
            process.stdout.write("  SHADOW CORE - SECRET SNIFFER (REDACT & AUTO-VAULT)\n");
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  Waktu Eksekusi : ${res.latencyMs} ms\n`);
            process.stdout.write(`  Jumlah Diamankan: ${res.redactedCount}\n`);
            process.stdout.write("--------------------------------------------------------------------------------\n");
            process.stdout.write(`  Teks Aman Dikirim ke AI:\n  ${res.text}\n`);
            process.stdout.write("================================================================================\n");
            return;
        }
        throw new Error(`Subcommand sniffer tidak dikenal: '${sub}'. Gunakan 'scan' atau 'redact'.`);
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
        const hasVerify = args.includes("--verify") || args.includes("--wait");
        const filteredArgs = args.filter((a) => a !== "--verify" && a !== "--wait");
        const target = filteredArgs[0] === "all" ? "*" : (filteredArgs[0] || "*");
        const selection = profileArguments(root, values, target);
        compose(root, envFile, [...selection.arguments, "pull", "--policy", "always", "--ignore-buildable"]);
        compose(root, envFile, [...selection.arguments, "up", "-d"]);
        if (hasVerify || (target !== "*" && target !== "all")) {
            const serviceId = target === "cognee" ? "cognee-mcp" : (target === "9router" ? "nine-router" : target);
            const composeFile = path.join(root, "modules", target, `docker-compose.${target}.yml`);
            const endpointUrl = target === "cognee"
                ? `http://127.0.0.1:${values.COGNEE_MCP_PORT || 8001}/health`
                : (target === "9router" ? `http://127.0.0.1:${values.NINE_ROUTER_PORT || 20140}/api/health` : null);
            const timeoutMs = target === "cognee" ? 75000 : 35000;
            await verifyModuleDeployment({
                root,
                moduleId: target,
                serviceId,
                composeFile,
                endpointUrl,
                timeoutMs,
            });
        }
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
    if (command === "validate") {
        const targetModule = args[0];
        if (targetModule) {
            const result = validateModuleRecipe({ root, moduleId: targetModule });
            process.stdout.write(formatValidationReport(result));
            if (!result.valid) process.exitCode = 1;
        } else {
            const results = validateAllModules({ root });
            if (!results.length) {
                process.stdout.write("Tidak ada recipe modul ditemukan di folder 'modules/'.\n");
                return;
            }
            let hasError = false;
            for (const r of results) {
                process.stdout.write(formatValidationReport(r));
                if (!r.valid) hasError = true;
            }
            if (hasError) process.exitCode = 1;
        }
        return;
    }
    if (command === "module") {
        const moduleId = args[0];
        const action = args[1];
        if (moduleId === "create") {
            const targetId = action;
            if (!targetId || targetId.startsWith("-")) {
                throw new Error("Penggunaan: shadow module create <id> [--source <repo/url>] [--label <label>] [--port <port>] [--mcp] [--web-ui]");
            }
            let label = "";
            let port = 0;
            let mcp = false;
            let webUi = false;
            let source = "";
            for (let i = 2; i < args.length; i++) {
                if (args[i] === "--label" && args[i + 1]) {
                    label = args[++i];
                } else if (args[i] === "--port" && args[i + 1]) {
                    port = parseInt(args[++i], 10) || 0;
                } else if (args[i] === "--mcp") {
                    mcp = true;
                } else if (args[i] === "--web-ui") {
                    webUi = true;
                } else if (args[i] === "--source" && args[i + 1]) {
                    source = args[++i];
                }
            }

            let created;
            if (source) {
                process.stdout.write(`[i] Menganalisis source modul via 9Router AI Engine: ${source}...\n`);
                created = await createModuleRecipeFromSource({
                    root,
                    moduleId: targetId,
                    source,
                    label,
                    port: port || undefined,
                    mcp: mcp || undefined,
                    webUi: webUi || undefined,
                });
            } else {
                created = createModuleRecipe({
                    root,
                    moduleId: targetId,
                    label,
                    port: port || 8080,
                    mcp,
                    webUi,
                });
            }

            process.stdout.write("================================================================================\n");
            process.stdout.write(`  SHADOW CORE - MODULE GENERATOR: ${created.moduleId}\n`);
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  [v] Direktori dibuat    : modules/${created.moduleId}/\n`);
            process.stdout.write(`  [v] Manifest dibuat     : modules/${created.moduleId}/module.json\n`);
            process.stdout.write(`  [v] Compose dibuat      : modules/${created.moduleId}/docker-compose.${created.moduleId}.yml\n`);
            process.stdout.write(`  [v] Dokumentasi dibuat  : modules/${created.moduleId}/README.md\n`);
            if (created.sourceUrl) {
                process.stdout.write(`  [v] Upstream Source     : ${created.sourceUrl}\n`);
            }
            process.stdout.write("--------------------------------------------------------------------------------\n");
            process.stdout.write("  Langkah selanjutnya:\n");
            process.stdout.write(`    1. Validasi resep     : shadow validate ${created.moduleId}\n`);
            process.stdout.write(`    2. Aktifkan modul     : shadow install ${created.moduleId}\n`);
            process.stdout.write(`    3. Mulai container    : shadow up ${created.moduleId}\n`);
            process.stdout.write("================================================================================\n");
            return;
        }
        if (moduleId === "validate") {
            const targetModule = action;
            if (targetModule) {
                const result = validateModuleRecipe({ root, moduleId: targetModule });
                process.stdout.write(formatValidationReport(result));
                if (!result.valid) process.exitCode = 1;
            } else {
                const results = validateAllModules({ root });
                if (!results.length) {
                    process.stdout.write("Tidak ada recipe modul ditemukan di folder 'modules/'.\n");
                    return;
                }
                let hasError = false;
                for (const r of results) {
                    process.stdout.write(formatValidationReport(r));
                    if (!r.valid) hasError = true;
                }
                if (hasError) process.exitCode = 1;
            }
            return;
        }
        if (action === "validate") {
            const result = validateModuleRecipe({ root, moduleId });
            process.stdout.write(formatValidationReport(result));
            if (!result.valid) process.exitCode = 1;
            return;
        }
        if (!moduleId || ["help", "--help", "-h"].includes(moduleId)) {
            process.stdout.write("Penggunaan: shadow module <id> [action|help|validate]\n");
            process.stdout.write("            shadow module create <id> [options]\n\n");
            process.stdout.write("Panduan perintah native modul bawaan:\n");
            process.stdout.write("  shadow module 9router help\n");
            process.stdout.write("  shadow module cognee help\n");
            process.stdout.write("  shadow module validate [id]     (Validasi standar keamanan & resep modul)\n");
            process.stdout.write("  shadow module create <id>       (Generate resep boilerplate modul baru)\n\n");
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
        if (action === "ping") {
            const targetService = args[1];
            const pingResult = await diagnoseMcpService({ root, targetService });
            if (!pingResult.ok) process.exitCode = 1;
            return;
        }
        if (action === "tools") {
            const targetService = args[1];
            if (!targetService) {
                throw new Error("Usage: shadow mcp tools <service>\nContoh: shadow mcp tools cognee");
            }
            const result = await listMcpTools({ root, targetService });
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  SHADOW CORE - DAFTAR MCP TOOLS (${result.serviceName})\n`);
            process.stdout.write(`  Endpoint: ${result.endpointUrl}\n`);
            process.stdout.write("================================================================================\n");
            if (result.tools.length === 0) {
                process.stdout.write("  Tidak ada tools yang diekspos oleh service ini.\n");
            } else {
                for (const tool of result.tools) {
                    const tag = tool.classification?.tag || "NATIVE";
                    const note = tool.classification?.note || "";
                    process.stdout.write(`\n* ${tool.name} [${tag}] (${note})\n`);
                    if (tool.description) {
                        process.stdout.write(`  Deskripsi : ${tool.description}\n`);
                    }
                    if (tool.inputSchema?.properties && Object.keys(tool.inputSchema.properties).length > 0) {
                        const required = new Set(tool.inputSchema.required || []);
                        const props = Object.entries(tool.inputSchema.properties)
                            .map(([k, v]) => `${k}${required.has(k) ? "*" : ""}: ${v.type || "any"}`)
                            .join(", ");
                        process.stdout.write(`  Argumen   : { ${props} }\n`);
                    }
                    process.stdout.write(`  Panggilan : shadow mcp call ${targetService} ${tool.name} '{}'\n`);
                }
            }
            process.stdout.write("================================================================================\n");
            return;
        }
        if (action === "call") {
            const targetService = args[1];
            const toolName = args[2];
            const argsJson = args[3] || "{}";
            if (!targetService || !toolName) {
                throw new Error("Usage: shadow mcp call <service> <tool> [argsJson]\nContoh: shadow mcp call cognee search '{\"query\": \"catatan\"}'");
            }
            const ok = await runMcpToolCommand({
                root,
                targetService,
                toolName,
                argsJson,
            });
            if (!ok) process.exitCode = 1;
            return;
        }
        if (action !== "serve") {
            throw new Error("Usage: shadow mcp <configure|serve|ping [service]|tools <service>|call <service> <tool> [args]>");
        }
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
    if (command === "publish") {
        const publishScript = path.join(cliRoot, "..", "scripts", "publish.mjs");
        run(process.execPath, [publishScript], { cwd: root });
        return;
    }
    if (command === "tui") {
        run(process.execPath, [path.join(cliRoot, "modules", "tui.mjs"), "--root", root], { cwd: root });
        return;
    }
    throw new Error(`Unknown command '${command}'. Run 'shadow help'.`);
}
