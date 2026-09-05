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

export async function pingMcpServer({ url, timeoutMs = 5000, fetchFn = globalThis.fetch }) {
    const start = Date.now();
    const initPayload = {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "shadow-cli", version: "0.2.1" },
        },
    };

    let response;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            response = await fetchFn(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(initPayload),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }
    } catch (err) {
        return {
            ok: false,
            url,
            latencyMs: Date.now() - start,
            error: err.name === "AbortError" ? "Request timeout (melebihi batas waktu)" : err.message,
        };
    }

    const latencyMs = Date.now() - start;
    if (!response.ok) {
        return {
            ok: false,
            url,
            latencyMs,
            status: response.status,
            error: `HTTP ${response.status} ${response.statusText}`,
        };
    }

    let initData;
    try {
        initData = await response.json();
    } catch (err) {
        return {
            ok: false,
            url,
            latencyMs,
            error: `Respon bukan JSON valid: ${err.message}`,
        };
    }

    let tools = [];
    try {
        const toolsPayload = {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/list",
            params: {},
        };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const toolsRes = await fetchFn(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(toolsPayload),
                signal: controller.signal,
            });
            if (toolsRes.ok) {
                const toolsData = await toolsRes.json();
                tools = toolsData.result?.tools || [];
            }
        } finally {
            clearTimeout(timer);
        }
    } catch {
        // Optional tools failure doesn't block initialize success
    }

    return {
        ok: true,
        url,
        latencyMs,
        protocolVersion: initData.result?.protocolVersion || "unknown",
        serverInfo: initData.result?.serverInfo || { name: "unknown", version: "unknown" },
        tools,
    };
}

export async function diagnoseMcpService({ root, targetService, out = process.stdout, fetchFn = globalThis.fetch }) {
    const envFile = path.join(root, ".env");
    const fileEnv = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
    const here = path.dirname(fileURLToPath(import.meta.url));
    const registry = loadModuleRegistry({
        builtinFile: path.resolve(here, "..", "modules", "builtin.json"),
        root,
        disabledModules: environmentValue(fileEnv, "SHADOW_DISABLED_MODULES"),
        enabledModules: environmentValue(fileEnv, "SHADOW_ENABLED_MODULES"),
    });

    const allMcpServices = registry.modules.flatMap((m) =>
        m.services.map((s) => ({ ...s, moduleEnabled: m.enabled }))
    ).filter((s) => s.mcpServer);

    if (!allMcpServices.length) {
        out.write("Tidak ada service dengan endpoint MCP yang terdaftar di Shadow Core.\n");
        return { ok: false, checked: 0 };
    }

    if (targetService) {
        const found = allMcpServices.find((s) => s.id === targetService || s.moduleId === targetService || s.mcpServer.name === targetService);
        if (found && !found.moduleEnabled) {
            out.write(`[!] Modul '${found.moduleId}' belum diaktifkan.\n`);
            out.write(`    Jalankan 'shadow install ${found.moduleId} && shadow up ${found.moduleId}' untuk mengaktifkan service MCP ini.\n`);
            return { ok: false, checked: 0 };
        }
        if (!found) {
            out.write(`Service MCP '${targetService}' tidak ditemukan.\n`);
            out.write(`Pilihan service MCP: ${allMcpServices.map((s) => s.mcpServer.name).join(", ")}\n`);
            return { ok: false, checked: 0 };
        }
    }

    const targets = targetService
        ? allMcpServices.filter((s) => (s.id === targetService || s.moduleId === targetService || s.mcpServer.name === targetService) && s.moduleEnabled)
        : allMcpServices.filter((s) => s.moduleEnabled);

    if (!targets.length) {
        out.write("Tidak ada service dengan endpoint MCP yang sedang aktif di Shadow Core.\n");
        out.write(`Modul MCP yang tersedia: ${allMcpServices.map((s) => s.moduleId).join(", ")}\n`);
        out.write("Jalankan 'shadow install <modul> && shadow up <modul>' untuk mengaktifkannya.\n");
        return { ok: false, checked: 0 };
    }

    out.write("================================================================================\n");
    out.write("  SHADOW CORE - MCP DIAGNOSTIC & PING\n");
    out.write("================================================================================\n");

    let allOk = true;

    for (const service of targets) {
        const baseUrl = serviceUrl(service, fileEnv);
        if (!baseUrl) {
            out.write(`[-] ${service.id}: Port atau Base URL belum dikonfigurasi.\n\n`);
            allOk = false;
            continue;
        }

        const endpointUrl = new URL(service.mcpServer.path, `${baseUrl}/`).href;
        out.write(`Memeriksa: ${service.mcpServer.name} (${endpointUrl})\n`);
        out.write("--------------------------------------------------------------------------------\n");

        const result = await pingMcpServer({ url: endpointUrl, fetchFn });

        if (result.ok) {
            out.write(`  [v] Status Koneksi : OK (Latency: ${result.latencyMs}ms)\n`);
            out.write(`  [v] Server Info    : ${result.serverInfo.name} v${result.serverInfo.version}\n`);
            out.write(`  [v] Protokol       : v${result.protocolVersion}\n`);
            if (result.tools.length > 0) {
                out.write(`  [v] Tools Aktif    : ${result.tools.length} tools tersedia\n`);
                for (const tool of result.tools) {
                    const desc = tool.description ? tool.description.replace(/\n.*/s, "").slice(0, 70) : "Tanpa deskripsi";
                    out.write(`      - ${tool.name.padEnd(16)} : ${desc}\n`);
                }
            } else {
                out.write("  [i] Tools Aktif    : Belum ada tools yang diekspos server ini\n");
            }
            out.write(`\nStatus: Endpoint MCP '${service.mcpServer.name}' BERFUNGSI NORMAL.\n`);
        } else {
            out.write(`  [x] Status Koneksi : GAGAL (${result.error})\n`);
            out.write(`  [!] Panduan        : Pastikan container service sudah menyala.\n`);
            out.write(`                       Jalankan: shadow up ${service.moduleId}\n`);
            out.write(`                       Cek log : shadow logs ${service.composeService || service.id}\n`);
            out.write(`\nStatus: Endpoint MCP '${service.mcpServer.name}' TIDAK DAPAT DIHUBUNGI.\n`);
            allOk = false;
        }
        out.write("================================================================================\n");
    }

    return { ok: allOk, checked: targets.length };
}
