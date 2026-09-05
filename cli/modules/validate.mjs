import fs from "node:fs";
import path from "node:path";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COMPOSE_PATTERN = /^docker-compose(?:\.[a-z0-9-]+)?\.ya?ml$/;
const SURFACES = new Set(["native", "iframe", "headless", "external"]);
const LIFECYCLES = new Set(["compose", "external"]);
const MCP_TRANSPORTS = new Set(["http", "sse"]);

export function validateModuleRecipe({ root, moduleId }) {
    const errors = [];
    const warnings = [];
    const passed = [];

    if (!moduleId || !ID_PATTERN.test(moduleId)) {
        return {
            id: moduleId || "unknown",
            valid: false,
            errors: [`ID modul '${moduleId}' tidak valid. Gunakan format lowercase kebab-case (contoh: my-module).`],
            warnings,
            passed,
        };
    }

    const moduleDir = path.resolve(root, "modules", moduleId);
    if (!fs.existsSync(moduleDir) || !fs.statSync(moduleDir).isDirectory()) {
        return {
            id: moduleId,
            valid: false,
            errors: [`Direktori modul tidak ditemukan di: ${path.relative(root, moduleDir)}`],
            warnings,
            passed,
        };
    }

    const manifestFile = path.join(moduleDir, "module.json");
    if (!fs.existsSync(manifestFile)) {
        return {
            id: moduleId,
            valid: false,
            errors: [`File manifest 'module.json' tidak ditemukan di: ${path.relative(root, manifestFile)}`],
            warnings,
            passed,
        };
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
        passed.push("Manifest module.json berformat JSON valid.");
    } catch (err) {
        return {
            id: moduleId,
            valid: false,
            errors: [`File module.json gagal diparsing: ${err.message}`],
            warnings,
            passed,
        };
    }

    // 1. Schema check
    if (manifest.schemaVersion !== 1) {
        errors.push("schemaVersion harus bernilai 1.");
    }
    if (manifest.id !== moduleId) {
        errors.push(`'id' di module.json ('${manifest.id}') tidak cocok dengan nama direktori '${moduleId}'.`);
    } else {
        passed.push(`ID modul valid: '${manifest.id}'`);
    }

    if (!manifest.label) {
        warnings.push("Field 'label' sebaiknya diisi nama yang ramah pengguna.");
    }

    const lifecycle = manifest.lifecycle || "compose";
    if (!LIFECYCLES.has(lifecycle)) {
        errors.push(`Lifecycle '${lifecycle}' tidak valid. Pilihan: 'compose' atau 'external'.`);
    } else {
        passed.push(`Lifecycle: ${lifecycle}`);
    }

    const surface = manifest.surface || "headless";
    if (!SURFACES.has(surface)) {
        errors.push(`Surface '${surface}' tidak valid. Pilihan: 'native', 'iframe', 'headless', 'external'.`);
    }

    if (!Array.isArray(manifest.requires)) {
        errors.push("Field 'requires' harus berupa array string dependensi (misal: ['core']).");
    } else if (lifecycle === "compose" && !manifest.requires.includes("core")) {
        warnings.push("Modul compose sebaiknya memasukkan 'core' ke dalam requires.");
    }

    // 2. Compose Checks
    if (lifecycle === "compose") {
        const composeFiles = Array.isArray(manifest.composeFiles) ? manifest.composeFiles : [];
        if (!composeFiles.length) {
            errors.push("Field 'composeFiles' wajib berisi minimal satu file compose (misal: ['docker-compose.yml']).");
        }

        for (const file of composeFiles) {
            if (!COMPOSE_PATTERN.test(file)) {
                errors.push(`Nama file compose '${file}' tidak aman atau tidak sesuai pola.`);
                continue;
            }
            const composePath = path.join(moduleDir, file);
            if (!fs.existsSync(composePath)) {
                errors.push(`File compose '${file}' tidak ditemukan di ${path.relative(root, composePath)}.`);
                continue;
            }

            const composeText = fs.readFileSync(composePath, "utf8");
            passed.push(`File Compose ditemukan: ${file}`);

            // A. Profile check
            const targetProfile = manifest.profile || moduleId;
            const profileRegex = new RegExp(`profiles:\\s*(?:\\[[^\\]]*?\\b${targetProfile}\\b[^\\]]*?\\]|-\\s*${targetProfile}\\b)`, "m");
            if (!profileRegex.test(composeText)) {
                warnings.push(`File '${file}' sebaiknya mendefinisikan 'profiles: [${targetProfile}]' agar tidak menyala tanpa sengaja.`);
            } else {
                passed.push(`Profile '${targetProfile}' terdefinisi dengan benar di Compose.`);
            }

            // B. Port Loopback Isolation check
            const portLines = composeText.match(/^\s*-\s*["']?([0-9a-zA-Z_$.{}:-]+:[0-9]+)["']?/gm) || [];
            for (const line of portLines) {
                const cleaned = line.replace(/^\s*-\s*["']?|["']?\s*$/g, "").trim();
                const parts = cleaned.split(":");
                if (parts.length === 2 && !cleaned.includes("$")) {
                    warnings.push(`Port mapping '${cleaned}' terbuka ke semua interface (0.0.0.0). Sebaiknya gunakan '\${SHADOW_BIND_ADDRESS:-127.0.0.1}:\${PORT:-${parts[0]}}:${parts[1]}'.`);
                } else if (cleaned.startsWith("0.0.0.0:")) {
                    warnings.push(`Port mapping '${cleaned}' secara eksplisit menggunakan 0.0.0.0. Sebaiknya ganti dengan 127.0.0.1.`);
                } else if (cleaned.includes("127.0.0.1") || cleaned.includes("SHADOW_BIND_ADDRESS")) {
                    passed.push(`Port binding aman (terisolasi di loopback/127.0.0.1): ${cleaned}`);
                }
            }

            // C. Security Hardening
            if (composeText.includes("no-new-privileges:true")) {
                passed.push("Security hardening aktif: 'no-new-privileges:true'.");
            } else {
                warnings.push(`File '${file}' disarankan menyertakan 'security_opt: [\"no-new-privileges:true\"]'.`);
            }

            // D. Multi-OS Gateway
            if (composeText.includes("host.docker.internal:host-gateway")) {
                passed.push("Kompatibilitas multi-OS aktif: 'host.docker.internal:host-gateway'.");
            } else {
                warnings.push(`File '${file}' disarankan menyertakan 'extra_hosts: [\"host.docker.internal:host-gateway\"]' untuk kompatibilitas Linux/Windows/macOS.`);
            }

            // E. Resource Limits
            if (composeText.includes("mem_limit") || composeText.includes("cpus")) {
                passed.push("Resource limit (mem_limit/cpus) terkonfigurasi.");
            } else {
                warnings.push(`File '${file}' disarankan menyertakan 'mem_limit' dan 'cpus' untuk mencegah DoS lokal.`);
            }

            // F. Healthcheck
            if (composeText.includes("healthcheck:")) {
                passed.push("Healthcheck terkonfigurasi.");
            } else {
                warnings.push(`File '${file}' disarankan menyertakan blok 'healthcheck'.`);
            }
        }
    }

    // 3. Services & MCP validation
    if (Array.isArray(manifest.services)) {
        for (const service of manifest.services) {
            if (!service.id || !ID_PATTERN.test(service.id)) {
                errors.push(`Service id '${service.id}' tidak valid.`);
            }
            if (service.mcpServer) {
                const s = service.mcpServer;
                if (!s.name || !ID_PATTERN.test(s.name)) {
                    errors.push(`MCP server name '${s.name}' tidak valid.`);
                }
                if (!MCP_TRANSPORTS.has(s.transport || "http")) {
                    errors.push(`MCP transport '${s.transport}' tidak valid. Pilihan: 'http' atau 'sse'.`);
                }
                if (!s.path || !s.path.startsWith("/")) {
                    errors.push(`MCP path '${s.path}' harus dimulai dengan slash '/'.`);
                } else {
                    passed.push(`MCP Server terdaftar: ${s.name} (${s.transport || "http"} pada ${s.path})`);
                }
            }
        }
    }

    // 4. Runtime Validation (if external)
    if (lifecycle === "external" && manifest.runtime) {
        if (!manifest.runtime.entry) {
            errors.push("Modul external dengan runtime wajib mendefinisikan 'runtime.entry'.");
        } else {
            const entryPath = path.join(moduleDir, manifest.runtime.entry);
            if (!fs.existsSync(entryPath)) {
                errors.push(`Runtime entry '${manifest.runtime.entry}' tidak ditemukan di ${path.relative(root, entryPath)}.`);
            } else {
                passed.push(`Runtime entry script ditemukan: ${manifest.runtime.entry}`);
            }
        }
    }

    return {
        id: moduleId,
        valid: errors.length === 0,
        errors,
        warnings,
        passed,
    };
}

export function validateAllModules({ root }) {
    const modulesDir = path.resolve(root, "modules");
    if (!fs.existsSync(modulesDir)) return [];

    const entries = fs.readdirSync(modulesDir, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
        if (entry.isDirectory() && ID_PATTERN.test(entry.name)) {
            results.push(validateModuleRecipe({ root, moduleId: entry.name }));
        }
    }
    return results;
}

export function formatValidationReport(result) {
    const lines = [];
    lines.push("================================================================================");
    lines.push(`  VALIDASI MODUL: ${result.id}`);
    lines.push("================================================================================");

    for (const pass of result.passed) {
        lines.push(`  [v] ${pass}`);
    }
    for (const warn of result.warnings) {
        lines.push(`  [!] PERINGATAN: ${warn}`);
    }
    for (const err of result.errors) {
        lines.push(`  [x] ERROR: ${err}`);
    }

    lines.push("--------------------------------------------------------------------------------");
    if (result.valid) {
        lines.push(`Status: Modul '${result.id}' VALID ${result.warnings.length ? "(dengan saran peningkatan)" : "dan memenuhi seluruh standar kehandalan Shadow"}.`);
    } else {
        lines.push(`Status: Modul '${result.id}' TIDAK VALID (${result.errors.length} error ditemukan).`);
    }
    lines.push("================================================================================\n");

    return lines.join("\n");
}
