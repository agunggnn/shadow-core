import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseEnv } from "../core/env.mjs";
import { loadModuleRegistry } from "../modules/registry.mjs";

function environmentValue(fileEnv, name, fallback = "") {
    return process.env[name] || fileEnv[name] || fallback;
}

function serviceUrl(service, fileEnv) {
    const configured = service.urlEnv ? environmentValue(fileEnv, service.urlEnv) : "";
    if (configured && !configured.startsWith("secretRef:")) return configured.replace(/\/+$/, "");
    const port = service.portEnv ? environmentValue(fileEnv, service.portEnv) : "";
    const selected = port || String(service.fallbackPort || "");
    return /^\d+$/.test(selected) ? `http://127.0.0.1:${selected}` : "";
}

function resolveServiceEndpoint(root, targetService) {
    const envFile = path.join(root, ".env");
    const fileEnv = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
    const here = path.dirname(fileURLToPath(import.meta.url));
    const registry = loadModuleRegistry({
        builtinFile: path.resolve(here, "..", "modules", "builtin.json"),
        root,
        disabledModules: environmentValue(fileEnv, "SHADOW_DISABLED_MODULES"),
        enabledModules: environmentValue(fileEnv, "SHADOW_ENABLED_MODULES"),
    });

    let mcpServices = registry.modules.flatMap((m) =>
        m.services.map((s) => ({ ...s, moduleEnabled: m.enabled }))
    ).filter((s) => s.mcpServer);

    let found = mcpServices.find(
        (s) => s.id === targetService || s.moduleId === targetService || s.mcpServer.name === targetService
    );

    if (!found) {
        const fallbackDir = path.resolve(here, "..", "templates");
        if (fs.existsSync(path.join(fallbackDir, "modules"))) {
            const fallbackRegistry = loadModuleRegistry({
                builtinFile: path.resolve(here, "..", "modules", "builtin.json"),
                root: fallbackDir,
                disabledModules: environmentValue(fileEnv, "SHADOW_DISABLED_MODULES"),
                enabledModules: environmentValue(fileEnv, "SHADOW_ENABLED_MODULES"),
            });
            const fallbackMcp = fallbackRegistry.modules.flatMap((m) =>
                m.services.map((s) => ({ ...s, moduleEnabled: true }))
            ).filter((s) => s.mcpServer);
            found = fallbackMcp.find(
                (s) => s.id === targetService || s.moduleId === targetService || s.mcpServer.name === targetService
            );
            if (found) {
                mcpServices = fallbackMcp;
            }
        }
    }

    if (!found) {
        throw new Error(`Service MCP '${targetService}' tidak ditemukan. Service tersedia: ${mcpServices.map((s) => s.mcpServer.name).join(", ")}`);
    }

    const baseUrl = serviceUrl(found, fileEnv);
    if (!baseUrl) {
        throw new Error(`Service '${found.id}' belum memiliki port atau URL yang valid.`);
    }

    return {
        service: found,
        endpointUrl: new URL(found.mcpServer.path, `${baseUrl}/`).href,
    };
}

export function classifyToolNature(toolName, description = "") {
    const lowerName = toolName.toLowerCase();
    const lowerDesc = description.toLowerCase();

    if (
        lowerName.includes("forget")
        || lowerName.includes("delete")
        || lowerName.includes("remove")
        || lowerName.includes("clear")
    ) {
        return { tag: "OFFLINE", note: "Operasi lokal (tanpa LLM)" };
    }

    if (
        lowerName.includes("recall")
        || lowerName.includes("search")
        || lowerName.includes("find")
        || lowerName.includes("get")
        || lowerName.includes("read")
        || lowerName.includes("list")
    ) {
        return { tag: "HYBRID", note: "Pencarian lokal / vektor" };
    }

    if (
        lowerName.includes("remember")
        || lowerName.includes("improve")
        || lowerName.includes("generate")
        || lowerName.includes("extract")
        || lowerDesc.includes("llm")
    ) {
        return { tag: "LLM REASONING", note: "Memerlukan 9Router / LLM" };
    }

    return { tag: "NATIVE", note: "Fungsi bawaan modul" };
}

export async function listMcpTools({ root = process.cwd(), targetService, fetchFn = globalThis.fetch, timeoutMs = 5000 }) {
    const { endpointUrl, service } = resolveServiceEndpoint(root, targetService);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const payload = {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
            params: {},
        };

        const res = await fetchFn(endpointUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        const tools = (data.result?.tools || []).map((t) => ({
            ...t,
            classification: classifyToolNature(t.name, t.description),
        }));

        return {
            ok: true,
            serviceName: service.mcpServer.name,
            endpointUrl,
            tools,
        };
    } finally {
        clearTimeout(timer);
    }
}

export async function callMcpTool({
    root = process.cwd(),
    targetService,
    toolName,
    args = {},
    fetchFn = globalThis.fetch,
    timeoutMs = 30000,
}) {
    if (!targetService) throw new Error("Nama service MCP wajib diisi.");
    if (!toolName) throw new Error("Nama tool MCP wajib diisi.");

    const { endpointUrl, service } = resolveServiceEndpoint(root, targetService);

    const payload = {
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: {
            name: toolName,
            arguments: typeof args === "string" ? JSON.parse(args || "{}") : args,
        },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const res = await fetchFn(endpointUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: controller.signal,
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();

        if (data.error) {
            return {
                ok: false,
                isError: true,
                error: data.error.message || JSON.stringify(data.error),
                endpointUrl,
            };
        }

        const result = data.result || {};
        const contentText = (result.content || [])
            .map((item) => item.text || JSON.stringify(item))
            .join("\n") || JSON.stringify(result, null, 2);

        return {
            ok: !result.isError,
            isError: result.isError || false,
            content: contentText,
            rawResult: result,
            endpointUrl,
            serviceName: service.mcpServer.name,
        };
    } finally {
        clearTimeout(timer);
    }
}

export async function runMcpToolCommand({
    root = process.cwd(),
    targetService,
    toolName,
    argsJson = "{}",
    out = process.stdout,
    fetchFn = globalThis.fetch,
}) {
    try {
        out.write(`Memanggil tool '${toolName}' pada service '${targetService}'...\n`);
        const result = await callMcpTool({
            root,
            targetService,
            toolName,
            args: argsJson,
            fetchFn,
        });

        out.write("================================================================================\n");
        out.write(`  HASIL EKSEKUSI MCP TOOL: ${toolName} (${targetService})\n`);
        out.write("================================================================================\n");
        if (result.ok) {
            out.write(result.content + "\n");
        } else {
            out.write(`[x] Error: ${result.error || result.content}\n`);
        }
        out.write("================================================================================\n");
        return result.ok;
    } catch (err) {
        out.write(`[x] Gagal mengeksekusi tool: ${err.message}\n`);
        return false;
    }
}
