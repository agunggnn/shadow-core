#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

import { parseDockerJson } from "../core/docker.mjs";
import { parseEnv } from "../core/env.mjs";
import { createToolCatalog } from "../mcp/catalog.mjs";
import { loadModuleRegistry } from "./registry.mjs";

const ANSI = {
    reset: "\x1b[0m",
    dim: "\x1b[2m",
    cyan: "\x1b[36m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    red: "\x1b[31m",
};

function option(name, fallback = "") {
    const index = process.argv.indexOf(name);
    return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

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

async function probeJson(url, timeoutMs = 1500) {
    if (!url) return { state: "n/a", detail: "no health endpoint" };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            headers: { accept: "application/json" },
            signal: controller.signal,
        });
        return response.ok
            ? { state: "ready", detail: `HTTP ${response.status}` }
            : { state: "degraded", detail: `HTTP ${response.status}` };
    } catch (error) {
        const reason = error?.name === "AbortError" ? "timeout" : "unreachable";
        return { state: "offline", detail: reason };
    } finally {
        clearTimeout(timeout);
    }
}

function dockerSnapshot(root, envFile, registry, fileEnv) {
    const composeFiles = registry.composeFiles
        .map((file) => path.resolve(root, file))
        .filter((file) => fs.existsSync(file));
    if (!composeFiles.length) return { state: "n/a", detail: "no Compose files", rows: [] };

    const args = ["compose", "--project-name", environmentValue(fileEnv, "HETZER_PROJECT_NAME", "hetzer")];
    if (fs.existsSync(envFile)) args.push("--env-file", envFile);
    for (const file of composeFiles) args.push("-f", file);
    args.push("--profile", "*", "ps", "--all", "--format", "json");

    const result = spawnSync("docker", args, {
        cwd: root,
        encoding: "utf8",
        timeout: 3500,
        windowsHide: true,
    });
    if (result.error) {
        const detail = result.error.code === "ENOENT" ? "Docker not installed" : result.error.message;
        return { state: "offline", detail, rows: [] };
    }
    if (result.status !== 0) {
        const detail = String(result.stderr || "Docker Compose unavailable").trim().split(/\r?\n/).at(-1);
        return { state: "offline", detail: detail.slice(0, 120), rows: [] };
    }
    return { state: "ready", detail: "Compose reachable", rows: parseDockerJson(result.stdout) };
}

function vaultSnapshot(root, fileEnv) {
    const configured = environmentValue(fileEnv, "HETZER_VAULT_PATH");
    const dbPath = configured
        ? (path.isAbsolute(configured) ? configured : path.join(root, configured))
        : path.join(root, "data", "hetzer-vault.db");
    const exists = dbPath !== ":memory:" && fs.existsSync(dbPath);
    const unlocked = Boolean(environmentValue(fileEnv, "HETZER_GRIMOIRE_KEY"));
    if (!exists) return { state: "n/a", detail: "not initialized" };
    if (!unlocked) return { state: "locked", detail: "database present; key unavailable" };
    return { state: "ready", detail: "database present; key available" };
}

function mcpSnapshot(root) {
    let catalog;
    try {
        catalog = createToolCatalog({ root });
        return { state: "ready", detail: `${catalog.definitions.length} registered tools` };
    } catch (error) {
        return { state: "degraded", detail: error.message };
    } finally {
        catalog?.close();
    }
}

function composeState(row) {
    if (!row) return { state: "stopped", detail: "no container" };
    const state = String(row.State || row.state || "unknown").toLowerCase();
    const health = String(row.Health || row.health || "").toLowerCase();
    if (health === "unhealthy" || ["dead", "exited"].includes(state)) {
        return { state: "degraded", detail: health || state };
    }
    if (state === "running") return { state: "running", detail: health || "container running" };
    return { state: state || "unknown", detail: String(row.Status || row.status || "unknown") };
}

export async function collectStatus({ root = process.env.HETZER_ROOT || process.cwd() } = {}) {
    const resolvedRoot = path.resolve(root);
    const envFile = path.join(resolvedRoot, ".env");
    const fileEnv = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
    const registry = loadModuleRegistry({
        builtinFile: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "builtin.json"),
        root: resolvedRoot,
        disabledModules: environmentValue(fileEnv, "HETZER_DISABLED_MODULES"),
        enabledModules: environmentValue(fileEnv, "HETZER_ENABLED_MODULES"),
    });
    const docker = dockerSnapshot(resolvedRoot, envFile, registry, fileEnv);
    const byService = new Map(docker.rows.map((row) => [row.Service || row.service, row]));

    const services = await Promise.all(registry.services.map(async (service) => {
        const baseUrl = serviceUrl(service, fileEnv);
        const container = composeState(service.composeService ? byService.get(service.composeService) : null);
        const probe = service.healthPath && baseUrl
            ? await probeJson(new URL(service.healthPath, `${baseUrl}/`).href)
            : { state: "n/a", detail: "no direct probe" };
        let observed = container;
        if (probe.state === "ready") observed = { state: "ready", detail: probe.detail };
        else if (container.state === "running" && probe.state === "offline") {
            observed = { state: "degraded", detail: probe.detail };
        } else if (service.external && probe.state !== "n/a") observed = probe;
        return {
            id: service.id,
            label: service.label || service.id,
            endpoint: baseUrl || "N/A",
            state: observed.state,
            detail: observed.detail,
        };
    }));

    return {
        root: resolvedRoot,
        generatedAt: new Date().toISOString(),
        docker: { state: docker.state, detail: docker.detail },
        vault: vaultSnapshot(resolvedRoot, fileEnv),
        mcp: mcpSnapshot(resolvedRoot),
        services,
        warnings: registry.warnings,
    };
}

function colorState(state, enabled) {
    const value = String(state || "unknown").toUpperCase();
    if (!enabled) return value;
    const color = ["READY", "RUNNING"].includes(value)
        ? ANSI.green
        : ["DEGRADED", "LOCKED"].includes(value)
            ? ANSI.yellow
            : ["OFFLINE", "STOPPED", "DEAD", "EXITED"].includes(value)
                ? ANSI.red
                : ANSI.dim;
    return `${color}${value}${ANSI.reset}`;
}

function bounded(value, width) {
    const text = String(value ?? "");
    if (text.length <= width) return text.padEnd(width);
    return `${text.slice(0, Math.max(0, width - 1))}…`;
}

export function renderTui(snapshot, { color = process.stdout.isTTY && !process.env.NO_COLOR } = {}) {
    const serviceLines = snapshot.services.length
        ? snapshot.services.map((service) => {
            const label = bounded(service.label, 20);
            const state = bounded(String(service.state).toUpperCase(), 10);
            const renderedState = colorState(state.trim(), color).padEnd(color ? 19 : 10);
            return `  ${label} ${renderedState} ${bounded(service.endpoint, 32)} ${service.detail}`;
        })
        : ["  No enabled services were discovered."];
    const warningLines = snapshot.warnings.length
        ? ["", "WARNINGS", ...snapshot.warnings.map((warning) => `  ${warning}`)]
        : [];
    const title = color ? `${ANSI.cyan}HETZER // TACTICAL TERMINAL${ANSI.reset}` : "HETZER // TACTICAL TERMINAL";
    return [
        title,
        "Local-first operations view. Values are observed; unavailable values are N/A.",
        "-------------------------------------------------------------------------------",
        `ROOT     ${snapshot.root}`,
        `UPDATED  ${snapshot.generatedAt}`,
        "",
        "CONTROL PLANE",
        `  Docker Compose  ${colorState(snapshot.docker.state, color)}  ${snapshot.docker.detail}`,
        `  Grimoire Vault  ${colorState(snapshot.vault.state, color)}  ${snapshot.vault.detail}`,
        `  MCP Bridge      ${colorState(snapshot.mcp.state, color)}  ${snapshot.mcp.detail}`,
        "",
        "SERVICES",
        "  SERVICE              STATE      ENDPOINT                         OBSERVATION",
        ...serviceLines,
        ...warningLines,
        "",
        "Press q or Ctrl+C to exit. Refresh: 2 seconds.",
    ].join("\n");
}

export async function drawTui(options = {}) {
    let output;
    try {
        output = renderTui(await collectStatus(options), options);
    } catch (error) {
        output = [
            "HETZER // TACTICAL TERMINAL",
            "-------------------------------------------------------------------------------",
            `STATUS   DEGRADED  ${error.message}`,
            "",
            "Press q or Ctrl+C to exit. Refresh: 2 seconds.",
        ].join("\n");
    }
    process.stdout.write(`\x1b[2J\x1b[H${output}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const root = option("--root", process.env.HETZER_ROOT || process.cwd());
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.on("keypress", (_input, key) => {
        if ((key.ctrl && key.name === "c") || key.name === "q") process.exit(0);
    });
    drawTui({ root });
    const timer = setInterval(() => drawTui({ root }), 2000);
    process.on("exit", () => clearInterval(timer));
}
