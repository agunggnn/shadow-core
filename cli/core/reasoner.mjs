import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "./env.mjs";

function get9RouterBaseUrl(root) {
    const envFile = path.join(root, ".env");
    const fileEnv = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, "utf8")) : {};
    const configured = process.env.NINE_ROUTER_BASE_URL || fileEnv.NINE_ROUTER_BASE_URL;
    if (configured) return configured.replace(/\/+$/, "");
    const port = process.env.NINE_ROUTER_PORT || fileEnv.NINE_ROUTER_PORT || "20140";
    return `http://127.0.0.1:${port}`;
}

export async function checkReasonerStatus({ root, timeoutMs = 3000, fetchFn = globalThis.fetch } = {}) {
    const baseUrl = get9RouterBaseUrl(root || process.cwd());
    const healthUrl = `${baseUrl}/api/health`;

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetchFn(healthUrl, { signal: controller.signal });
            return {
                available: res.ok,
                url: baseUrl,
                status: res.status,
            };
        } finally {
            clearTimeout(timer);
        }
    } catch (err) {
        return {
            available: false,
            url: baseUrl,
            error: err.name === "AbortError" ? "Timeout" : err.message,
        };
    }
}

export async function askReasoner({
    prompt,
    systemPrompt = "You are Shadow Core's DevOps AI assistant. Provide concise, accurate technical advice.",
    root = process.cwd(),
    model = "openai/gpt-4o-mini",
    timeoutMs = 30000,
    fetchFn = globalThis.fetch,
}) {
    const baseUrl = get9RouterBaseUrl(root);
    const chatUrl = `${baseUrl}/v1/chat/completions`;

    const payload = {
        model,
        messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
        ],
        temperature: 0.2,
    };

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        let res;
        try {
            res = await fetchFn(chatUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: "Bearer shadow-default",
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(timer);
        }

        if (!res.ok) {
            return {
                ok: false,
                error: `9Router HTTP ${res.status}: ${res.statusText}`,
            };
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || "";
        return {
            ok: true,
            content,
            model: data.model || model,
        };
    } catch (err) {
        return {
            ok: false,
            error: err.name === "AbortError" ? "9Router timeout" : err.message,
        };
    }
}

export async function analyzeContainerFailure({
    serviceId,
    logs = "",
    composeContent = "",
    root = process.cwd(),
    fetchFn = globalThis.fetch,
}) {
    // 1. Static pattern analyzer (instant fallback if 9Router is offline)
    const staticMatches = [];
    if (logs.includes("Permission denied") || logs.includes("PermissionError")) {
        staticMatches.push({
            cause: "Masalah hak akses izin file / direktori (Permission Denied). Kemungkinan container berjalan sebagai non-root user (UID 1000) dan volume mount berpemilik root.",
            suggestion: "Pastikan volume mount point mengarah ke direktori yang sudah ada dan di-chown di dalam image, atau gunakan volume bawaan upstream.",
        });
    }
    if (logs.includes("address already in use") || logs.includes("bind: address already in use")) {
        staticMatches.push({
            cause: "Port bentrok (Port Conflict). Port yang ingin digunakan sudah dipakai proses lain di host.",
            suggestion: "Ganti port mapping di .env atau docker-compose ke port lain yang masih kosong.",
        });
    }
    if (logs.includes("Set COGNEE_LLM_API_KEY") || logs.includes("API key not set") || logs.includes("KeyError: 'API_KEY'")) {
        staticMatches.push({
            cause: "API key atau environment variable kredensial belum diset.",
            suggestion: "Jalankan 'shadow creds set <id>' untuk menyimpan API key yang dibutuhkan ke Vault.",
        });
    }

    // 2. Check if 9Router is available for deep LLM reasoning
    const reasonerStatus = await checkReasonerStatus({ root, timeoutMs: 2000, fetchFn });
    if (!reasonerStatus.available) {
        if (staticMatches.length > 0) {
            return {
                ok: true,
                source: "static-heuristics",
                cause: staticMatches[0].cause,
                suggestion: staticMatches[0].suggestion,
            };
        }
        return {
            ok: false,
            error: "9Router gateway tidak aktif untuk analisis AI otomatis.",
            source: "none",
        };
    }

    // 3. Ask 9Router AI Engine
    const prompt = `Analisis kegagalan container '${serviceId}':
LOGS TERAKHIR:
"""
${logs.slice(-2000)}
"""

KONFIGURASI COMPOSE:
"""
${composeContent.slice(-1500)}
"""

Berikan analisis dalam format JSON persis seperti ini:
{
  "cause": "Penyebab utama dalam 1-2 kalimat (bahasa Indonesia)",
  "suggestion": "Solusi perbaikan konkret langkah demi langkah (bahasa Indonesia)"
}`;

    const aiRes = await askReasoner({
        prompt,
        systemPrompt: "You are Shadow Core's autonomous DevOps SRE. Return ONLY a valid JSON object with 'cause' and 'suggestion' keys.",
        root,
        fetchFn,
    });

    if (aiRes.ok && aiRes.content) {
        try {
            const jsonMatch = aiRes.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    ok: true,
                    source: "9router-ai",
                    cause: parsed.cause,
                    suggestion: parsed.suggestion,
                };
            }
        } catch {
            // fallback to raw content
            return {
                ok: true,
                source: "9router-ai",
                cause: "Analisis kegagalan terdeteksi.",
                suggestion: aiRes.content,
            };
        }
    }

    if (staticMatches.length > 0) {
        return {
            ok: true,
            source: "static-heuristics",
            cause: staticMatches[0].cause,
            suggestion: staticMatches[0].suggestion,
        };
    }

    return {
        ok: false,
        error: aiRes.error || "Gagal mendapatkan analisis dari AI.",
    };
}
