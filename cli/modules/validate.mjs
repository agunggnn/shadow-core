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
            errors: [`Module ID '${moduleId}' is invalid. Use lowercase kebab-case format (e.g. my-module).`],
            warnings,
            passed,
        };
    }

    const moduleDir = path.resolve(root, "modules", moduleId);
    if (!fs.existsSync(moduleDir) || !fs.statSync(moduleDir).isDirectory()) {
        return {
            id: moduleId,
            valid: false,
            errors: [`Module directory not found at: ${path.relative(root, moduleDir)}`],
            warnings,
            passed,
        };
    }

    const manifestFile = path.join(moduleDir, "module.json");
    if (!fs.existsSync(manifestFile)) {
        return {
            id: moduleId,
            valid: false,
            errors: [`Manifest file 'module.json' not found at: ${path.relative(root, manifestFile)}`],
            warnings,
            passed,
        };
    }

    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
        passed.push("Manifest module.json is valid JSON.");
    } catch (err) {
        return {
            id: moduleId,
            valid: false,
            errors: [`Failed to parse module.json: ${err.message}`],
            warnings,
            passed,
        };
    }

    // 1. Schema check
    if (manifest.schemaVersion !== 1) {
        errors.push("schemaVersion must be 1.");
    }
    if (manifest.id !== moduleId) {
        errors.push(`'id' in module.json ('${manifest.id}') does not match directory name '${moduleId}'.`);
    } else {
        passed.push(`Module ID is valid: '${manifest.id}'`);
    }

    if (!manifest.label) {
        warnings.push("Field 'label' should be provided with a user-friendly name.");
    }

    const lifecycle = manifest.lifecycle || "compose";
    if (!LIFECYCLES.has(lifecycle)) {
        errors.push(`Lifecycle '${lifecycle}' is invalid. Options: 'compose' or 'external'.`);
    } else {
        passed.push(`Lifecycle: ${lifecycle}`);
    }

    const surface = manifest.surface || "headless";
    if (!SURFACES.has(surface)) {
        errors.push(`Surface '${surface}' is invalid. Options: 'native', 'iframe', 'headless', 'external'.`);
    }

    if (!Array.isArray(manifest.requires)) {
        errors.push("Field 'requires' must be an array of string dependencies (e.g. ['core']).");
    } else if (lifecycle === "compose" && !manifest.requires.includes("core")) {
        warnings.push("Compose module should include 'core' in requires.");
    }

    // 2. Compose Checks
    if (lifecycle === "compose") {
        const composeFiles = Array.isArray(manifest.composeFiles) ? manifest.composeFiles : [];
        if (!composeFiles.length) {
            errors.push("Field 'composeFiles' must contain at least one compose file (e.g. ['docker-compose.yml']).");
        }

        for (const file of composeFiles) {
            if (!COMPOSE_PATTERN.test(file)) {
                errors.push(`Compose file name '${file}' is unsafe or does not match pattern.`);
                continue;
            }
            const composePath = path.join(moduleDir, file);
            if (!fs.existsSync(composePath)) {
                errors.push(`Compose file '${file}' not found at ${path.relative(root, composePath)}.`);
                continue;
            }

            const composeText = fs.readFileSync(composePath, "utf8");
            passed.push(`Compose file found: ${file}`);

            // A. Profile check
            const targetProfile = manifest.profile || moduleId;
            const profileRegex = new RegExp(`profiles:\\s*(?:\\[[^\\]]*?\\b${targetProfile}\\b[^\\]]*?\\]|-\\s*${targetProfile}\\b)`, "m");
            if (!profileRegex.test(composeText)) {
                warnings.push(`File '${file}' should define 'profiles: [${targetProfile}]' to prevent accidental startup.`);
            } else {
                passed.push(`Profile '${targetProfile}' is correctly defined in Compose.`);
            }

            // B. Port Loopback Isolation check
            const portLines = composeText.match(/^\s*-\s*["']?([0-9a-zA-Z_$.{}:-]+:[0-9]+)["']?/gm) || [];
            for (const line of portLines) {
                const cleaned = line.replace(/^\s*-\s*["']?|["']?\s*$/g, "").trim();
                const parts = cleaned.split(":");
                if (parts.length === 2 && !cleaned.includes("$")) {
                    warnings.push(`Port mapping '${cleaned}' is exposed to all interfaces (0.0.0.0). Recommend using '\${HETZER_BIND_ADDRESS:-127.0.0.1}:\${PORT:-${parts[0]}}:${parts[1]}'.`);
                } else if (cleaned.startsWith("0.0.0.0:")) {
                    warnings.push(`Port mapping '${cleaned}' explicitly uses 0.0.0.0. Recommend replacing with 127.0.0.1.`);
                } else if (cleaned.includes("127.0.0.1") || cleaned.includes("HETZER_BIND_ADDRESS")) {
                    passed.push(`Port binding is secure (isolated to loopback/127.0.0.1): ${cleaned}`);
                }
            }

            // C. Security Hardening
            if (composeText.includes("no-new-privileges:true")) {
                passed.push("Security hardening active: 'no-new-privileges:true'.");
            } else {
                warnings.push(`File '${file}' is recommended to include 'security_opt: [\"no-new-privileges:true\"]'.`);
            }

            // D. Multi-OS Gateway
            if (composeText.includes("host.docker.internal:host-gateway")) {
                passed.push("Multi-OS compatibility active: 'host.docker.internal:host-gateway'.");
            } else {
                warnings.push(`File '${file}' is recommended to include 'extra_hosts: [\"host.docker.internal:host-gateway\"]' for Linux/Windows/macOS compatibility.`);
            }

            // E. Resource Limits
            if (composeText.includes("mem_limit") || composeText.includes("cpus")) {
                passed.push("Resource limits (mem_limit/cpus) configured.");
            } else {
                warnings.push(`File '${file}' is recommended to include 'mem_limit' and 'cpus' to prevent local resource exhaustion.`);
            }

            // F. Healthcheck
            if (composeText.includes("healthcheck:")) {
                passed.push("Healthcheck configured.");
            } else {
                warnings.push(`File '${file}' is recommended to include a 'healthcheck' block.`);
            }
        }
    }

    // 3. Services & MCP validation
    if (Array.isArray(manifest.services)) {
        for (const service of manifest.services) {
            if (!service.id || !ID_PATTERN.test(service.id)) {
                errors.push(`Service ID '${service.id}' is invalid.`);
            }
            if (service.mcpServer) {
                const s = service.mcpServer;
                if (!s.name || !ID_PATTERN.test(s.name)) {
                    errors.push(`MCP server name '${s.name}' is invalid.`);
                }
                if (!MCP_TRANSPORTS.has(s.transport || "http")) {
                    errors.push(`MCP transport '${s.transport}' is invalid. Options: 'http' or 'sse'.`);
                }
                if (!s.path || !s.path.startsWith("/")) {
                    errors.push(`MCP path '${s.path}' must start with a slash '/'.`);
                } else {
                    passed.push(`MCP Server registered: ${s.name} (${s.transport || "http"} at ${s.path})`);
                }
            }
        }
    }

    // 4. Runtime Validation (if external)
    if (lifecycle === "external" && manifest.runtime) {
        if (!manifest.runtime.entry) {
            errors.push("External module with runtime must define 'runtime.entry'.");
        } else {
            const entryPath = path.join(moduleDir, manifest.runtime.entry);
            if (!fs.existsSync(entryPath)) {
                errors.push(`Runtime entry '${manifest.runtime.entry}' not found at ${path.relative(root, entryPath)}.`);
            } else {
                passed.push(`Runtime entry script found: ${manifest.runtime.entry}`);
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
    lines.push(`  MODULE VALIDATION: ${result.id}`);
    lines.push("================================================================================");

    for (const pass of result.passed) {
        lines.push(`  [v] ${pass}`);
    }
    for (const warn of result.warnings) {
        lines.push(`  [!] WARNING: ${warn}`);
    }
    for (const err of result.errors) {
        lines.push(`  [x] ERROR: ${err}`);
    }

    lines.push("--------------------------------------------------------------------------------");
    if (result.valid) {
        lines.push(`Status: Module '${result.id}' VALID ${result.warnings.length ? "(with improvement recommendations)" : "and meets all Hetzer reliability standards"}.`);
    } else {
        lines.push(`Status: Module '${result.id}' INVALID (${result.errors.length} error(s) found).`);
    }
    lines.push("================================================================================\n");

    return lines.join("\n");
}
