import fs from "node:fs";
import path from "node:path";
import { SECRET_REF_PATTERN } from "../vault/shadow-vault.mjs";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ENV_PATTERN = /^[A-Z][A-Z0-9_]*$/;
const COMPOSE_PATTERN = /^docker-compose(?:\.[a-z0-9-]+)?\.ya?ml$/;
const RUNTIME_ENTRY_PATTERN = /^(?:[a-zA-Z0-9._-]+\/)*[a-zA-Z0-9._-]+\.(?:mjs|js)$/;
const RUNTIME_ACTION_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const SURFACES = new Set(["native", "iframe", "headless", "external"]);
const LIFECYCLES = new Set(["compose", "external"]);
const RUNTIME_KINDS = new Set(["host-process"]);
const MCP_TRANSPORTS = new Set(["http", "sse"]);

function loadJson(file) {
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function csvSet(value) {
    return new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

function validateAuth(auth, serviceId) {
    if (!auth) return null;
    if (!SECRET_REF_PATTERN.test(auth.secretRef || "")) {
        throw new Error(`Service '${serviceId}' has an invalid secretRef.`);
    }
    if (auth.action && !/^[a-z0-9]+(?:[.:_-][a-z0-9]+)*$/.test(auth.action)) {
        throw new Error(`Service '${serviceId}' has an invalid auth action.`);
    }
    return {
        secretRef: auth.secretRef,
        targetId: String(auth.targetId || "").slice(0, 80),
        action: String(auth.action || "proxy.read").slice(0, 120),
    };
}

function validateMcpTools(tools, serviceId) {
    const methods = new Set(["GET", "POST", "PATCH", "DELETE"]);
    return (tools || []).map((tool) => {
        if (!/^[a-zA-Z0-9_.-]{1,128}$/.test(tool?.name || "")) {
            throw new Error(`Service '${serviceId}' has an invalid MCP tool name.`);
        }
        if (!/^\/(?!\/)[^\s]*$/.test(tool.path || "")) {
            throw new Error(`MCP tool '${tool.name}' must use a local absolute path.`);
        }
        const method = String(tool.method || "GET").toUpperCase();
        if (!methods.has(method)) throw new Error(`MCP tool '${tool.name}' has an invalid method.`);
        const argumentMode = tool.argumentMode || "legacy";
        if (!["legacy", "json-body"].includes(argumentMode)) {
            throw new Error(`MCP tool '${tool.name}' has an invalid argument mode.`);
        }
        const annotations = tool.annotations && typeof tool.annotations === "object"
            ? Object.fromEntries(Object.entries(tool.annotations)
                .filter(([key, value]) => ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"].includes(key) && typeof value === "boolean"))
            : {};
        return {
            name: tool.name,
            title: String(tool.title || tool.name).slice(0, 120),
            description: String(tool.description || `Read ${serviceId}${tool.path}.`).slice(0, 500),
            path: tool.path,
            method,
            argumentMode,
            annotations,
            ...(tool.inputSchema && typeof tool.inputSchema === "object" ? { inputSchema: tool.inputSchema } : {}),
        };
    });
}

function validateMcpServer(server, serviceId) {
    if (!server) return null;
    if (!ID_PATTERN.test(server.name || "")) {
        throw new Error(`Service '${serviceId}' has an invalid MCP server name.`);
    }
    const transport = String(server.transport || "http").toLowerCase();
    if (!MCP_TRANSPORTS.has(transport)) {
        throw new Error(`Service '${serviceId}' has an invalid MCP transport.`);
    }
    const targetPath = String(server.path || (transport === "http" ? "/mcp" : "/sse"));
    if (!/^\/(?!\/)[^\s]*$/.test(targetPath)) {
        throw new Error(`Service '${serviceId}' has an invalid MCP path.`);
    }
    return { name: server.name, transport, path: targetPath };
}

function validateService(service, moduleId, defaultSurface, lifecycle) {
    if (!service || !ID_PATTERN.test(service.id || "")) {
        throw new Error(`Module '${moduleId}' contains an invalid service id.`);
    }
    const surface = service.surface || defaultSurface;
    if (!SURFACES.has(surface)) throw new Error(`Service '${service.id}' has invalid surface '${surface}'.`);
    for (const field of ["urlEnv", "portEnv"]) {
        if (service[field] && !ENV_PATTERN.test(service[field])) {
            throw new Error(`Service '${service.id}' has invalid ${field}.`);
        }
    }
    return {
        ...service,
        moduleId,
        surface,
        external: lifecycle === "external" || service.external === true,
        embed: surface === "iframe" ? service.embed !== false : false,
        auth: validateAuth(service.auth, service.id),
        mcpTools: validateMcpTools(service.mcpTools, service.id),
        mcpServer: validateMcpServer(service.mcpServer, service.id),
    };
}

function normalizeComposeFiles(module, source, root) {
    const composeFiles = [...new Set(module.composeFiles || [])];
    if (composeFiles.some((file) => !COMPOSE_PATTERN.test(file))) {
        throw new Error(`Module '${module.id}' contains an unsafe Compose filename.`);
    }
    if (!composeFiles.length) return [];

    const sourceDir = path.dirname(source);
    return composeFiles.map((file) => {
        const absolute = path.resolve(sourceDir, file);
        const relative = path.relative(root, absolute);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error(`Module '${module.id}' Compose file escapes the Shadow root.`);
        }
        return relative.split(path.sep).join("/");
    });
}

function normalizeRuntime(runtime, module, source, root) {
    if (!runtime) return null;
    if (!RUNTIME_KINDS.has(runtime.kind)) {
        throw new Error(`Module '${module.id}' has invalid runtime kind.`);
    }
    if ((module.lifecycle || "external") !== "external" || (module.surface || "headless") !== "headless") {
        throw new Error(`Module '${module.id}' host-process runtime must be external and headless.`);
    }
    if (!RUNTIME_ENTRY_PATTERN.test(runtime.entry || "")) {
        throw new Error(`Module '${module.id}' has an invalid runtime entry.`);
    }

    const moduleDir = path.resolve(root, "modules", module.id);
    const sourceDir = path.dirname(source);
    const entryPath = path.resolve(sourceDir, runtime.entry);
    const relativeEntry = path.relative(moduleDir, entryPath);
    if (relativeEntry.startsWith("..") || path.isAbsolute(relativeEntry)) {
        throw new Error(`Module '${module.id}' runtime entry escapes its recipe directory.`);
    }
    if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
        throw new Error(`Module '${module.id}' runtime entry does not exist.`);
    }

    const actions = [...new Set(runtime.actions || [])];
    if (!actions.length || actions.some((action) => !RUNTIME_ACTION_PATTERN.test(action))) {
        throw new Error(`Module '${module.id}' has invalid runtime actions.`);
    }
    const secretEnv = [...new Set(runtime.secretEnv || [])];
    if (secretEnv.some((name) => !ENV_PATTERN.test(name))) {
        throw new Error(`Module '${module.id}' has invalid runtime secretEnv.`);
    }
    return {
        kind: runtime.kind,
        entry: runtime.entry,
        entryPath,
        actions,
        secretEnv,
    };
}

function validateModule(module, source, root) {
    if (!module || !ID_PATTERN.test(module.id || "")) {
        throw new Error(`Invalid module id in ${source}.`);
    }
    const lifecycle = module.lifecycle || "external";
    const surface = module.surface || "headless";
    if (!LIFECYCLES.has(lifecycle)) throw new Error(`Module '${module.id}' has invalid lifecycle.`);
    if (!SURFACES.has(surface)) throw new Error(`Module '${module.id}' has invalid surface.`);
    const composeFiles = normalizeComposeFiles(module, source, root);
    const requires = [...new Set(module.requires || [])];
    if (requires.some((id) => !ID_PATTERN.test(id))) {
        throw new Error(`Module '${module.id}' contains an invalid dependency.`);
    }
    const services = (module.services || []).map((service) => validateService(service, module.id, surface, lifecycle));
    const runtime = normalizeRuntime(module.runtime, module, source, root);
    return {
        id: module.id,
        label: String(module.label || module.id).slice(0, 120),
        version: String(module.version || "1").slice(0, 40),
        profile: String(module.profile || module.id).slice(0, 60),
        lifecycle,
        surface,
        defaultEnabled: module.defaultEnabled !== false,
        requires,
        composeFiles,
        services,
        runtime,
        source,
    };
}

function customManifestFiles(root) {
    const dir = path.join(root, "modules.d");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => path.join(dir, entry.name))
        .sort((a, b) => a.localeCompare(b));
}

function recipeManifestFiles(root) {
    const dir = path.join(root, "modules");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name))
        .map((entry) => path.join(dir, entry.name, "module.json"))
        .filter((file) => fs.existsSync(file))
        .sort((a, b) => a.localeCompare(b));
}

export function loadModuleRegistry({ builtinFile, root, disabledModules = "", enabledModules = "" }) {
    const builtin = loadJson(builtinFile);
    if (Number(builtin.schemaVersion) !== 1 || !Array.isArray(builtin.modules)) {
        throw new Error(`Unsupported module registry schema in ${builtinFile}.`);
    }
    const disabled = csvSet(disabledModules);
    const explicitlyEnabled = csvSet(enabledModules);
    const warnings = [];
    const modules = [];
    const moduleIds = new Set();
    const serviceIds = new Set();

    const add = (raw, source) => {
        const module = validateModule(raw, source, root);
        if (moduleIds.has(module.id)) throw new Error(`Duplicate module id '${module.id}'.`);
        for (const service of module.services) {
            if (serviceIds.has(service.id)) throw new Error(`Duplicate service id '${service.id}'.`);
            serviceIds.add(service.id);
        }
        moduleIds.add(module.id);
        const enabled = module.id === "core" || (
            !disabled.has(module.id) && (module.defaultEnabled || explicitlyEnabled.has(module.id))
        );
        modules.push({ ...module, enabled });
    };

    // Builtin core Compose paths are rooted at the Shadow project, while recipe
    // Compose paths are rooted beside their module.json.
    for (const module of builtin.modules) add(module, path.join(root, "shadow-core.module.json"));
    for (const file of recipeManifestFiles(root)) {
        try {
            const parsed = loadJson(file);
            add(parsed.module || parsed, file);
        } catch (error) {
            warnings.push(`${path.relative(root, file)}: ${error.message}`);
        }
    }
    for (const file of customManifestFiles(root)) {
        try {
            const parsed = loadJson(file);
            add(parsed.module || parsed, file);
        } catch (error) {
            warnings.push(`${path.basename(file)}: ${error.message}`);
        }
    }

    let changed = true;
    while (changed) {
        changed = false;
        const byId = new Map(modules.map((module) => [module.id, module]));
        for (const module of modules) {
            if (!module.enabled) continue;
            const unavailable = module.requires.find((id) => !byId.get(id)?.enabled);
            if (!unavailable) continue;
            module.enabled = false;
            module.disabledReason = `dependency '${unavailable}' is unavailable`;
            warnings.push(`Module '${module.id}' disabled because ${module.disabledReason}.`);
            changed = true;
        }
    }

    const active = modules.filter((module) => module.enabled);
    const composeFiles = [...new Set(active.flatMap((module) => module.composeFiles))];
    const services = active.flatMap((module) => module.services.map((service) => ({
        ...service,
        module: {
            id: module.id,
            label: module.label,
            version: module.version,
            profile: module.profile,
            lifecycle: module.lifecycle,
            surface: module.surface,
            source: module.source,
        },
    })));
    return { schemaVersion: 1, modules, services, composeFiles, warnings };
}

export function publicModuleSummary(registry) {
    return registry.modules.map((module) => ({
        id: module.id,
        label: module.label,
        version: module.version,
        profile: module.profile,
        lifecycle: module.lifecycle,
        surface: module.surface,
        enabled: module.enabled,
        disabledReason: module.disabledReason || null,
        requires: module.requires,
        runtime: module.runtime ? {
            kind: module.runtime.kind,
            entry: module.runtime.entry,
            actions: module.runtime.actions,
        } : null,
        source: path.relative(process.cwd(), module.source) || path.basename(module.source),
        services: module.services.map((service) => service.id),
    }));
}
