import { sanitizeStreamOutput } from "../vault/exec.mjs";

const MODERN_VERSION = "2026-07-28";
const LEGACY_VERSION = "2025-11-25";

function modernRequest(request) {
    return request.method === "server/discover"
        || request.params?._meta?.["io.modelcontextprotocol/protocolVersion"] === MODERN_VERSION;
}

function result(id, value) {
    return { jsonrpc: "2.0", id, result: value };
}

function error(id, code, message) {
    return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

export async function handleMcpRequest(request, catalog) {
    if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
        return error(request?.id, -32600, "Invalid Request");
    }
    if (request.id === undefined) return null;
    const modern = modernRequest(request);
    if (request.method === "server/discover") {
        return result(request.id, {
            resultType: "complete",
            supportedVersions: [MODERN_VERSION, LEGACY_VERSION],
            capabilities: { tools: {} },
            _meta: { "io.modelcontextprotocol/serverInfo": { name: "hetzer-fastmcp", version: "0.4.0" } },
            instructions: "Read-only tools expose enabled Hetzer modules and approved local service telemetry.",
            ttlMs: 300000,
            cacheScope: "private",
        });
    }
    if (request.method === "initialize") {
        const requested = request.params?.protocolVersion;
        return result(request.id, {
            protocolVersion: requested === LEGACY_VERSION ? requested : LEGACY_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "hetzer-fastmcp", version: "0.4.0" },
            instructions: "Read-only tools expose enabled Hetzer modules and approved local service telemetry.",
        });
    }
    if (request.method === "ping") return result(request.id, {});
    if (request.method === "tools/list") {
        return result(request.id, modern
            ? { resultType: "complete", tools: catalog.definitions, ttlMs: 300000, cacheScope: "private" }
            : { tools: catalog.definitions });
    }
    if (request.method === "tools/call") {
        const name = request.params?.name;
        if (typeof name !== "string") return error(request.id, -32602, "Tool name is required.");
        try {
            const value = await catalog.call(name, request.params?.arguments || {});
            const rawJson = JSON.stringify(value);
            const sanitizedText = sanitizeStreamOutput(rawJson);
            let sanitizedStructured = value;
            if (sanitizedText !== rawJson) {
                try {
                    sanitizedStructured = JSON.parse(sanitizedText);
                } catch {
                    // Fall back to original value if JSON parse fails
                }
            }
            return result(request.id, {
                ...(modern ? { resultType: "complete" } : {}),
                content: [{ type: "text", text: sanitizedText }],
                structuredContent: sanitizedStructured,
                isError: false,
            });
        } catch (cause) {
            if (String(cause.message).startsWith("Unknown tool")) return error(request.id, -32602, cause.message);
            const sanitizedMessage = sanitizeStreamOutput(cause.message || "Tool execution error");
            return result(request.id, {
                ...(modern ? { resultType: "complete" } : {}),
                content: [{ type: "text", text: sanitizedMessage }],
                isError: true,
            });
        }
    }
    return error(request.id, -32601, `Method not found: ${request.method}`);
}

export function parseError() {
    return error(null, -32700, "Parse error");
}
