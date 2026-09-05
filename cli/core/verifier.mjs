import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { analyzeContainerFailure } from "./reasoner.mjs";

function inspectContainer(target, exec) {
    try {
        const inspectRes = exec("docker", ["inspect", target], {
            encoding: "utf8",
            windowsHide: true,
        });
        if (inspectRes.status === 0) {
            const arr = JSON.parse(inspectRes.stdout);
            if (arr.length > 0) return arr[0];
        }
    } catch {
        // Container not found by direct name
    }

    try {
        const psRes = exec("docker", ["ps", "-a", "--filter", `name=${target}`, "--format", "{{json .}}"], {
            encoding: "utf8",
            windowsHide: true,
        });
        if (psRes.status === 0 && psRes.stdout.trim()) {
            const line = psRes.stdout.trim().split("\n")[0];
            const psObj = JSON.parse(line);
            const secondInspect = exec("docker", ["inspect", psObj.ID || psObj.Names], {
                encoding: "utf8",
                windowsHide: true,
            });
            if (secondInspect.status === 0) {
                const arr = JSON.parse(secondInspect.stdout);
                if (arr.length > 0) return arr[0];
            }
        }
    } catch {
        // ignore
    }

    return null;
}

function getContainerLogs(target, exec, tail = 60) {
    try {
        const logsRes = exec("docker", ["logs", target, "--tail", String(tail)], {
            encoding: "utf8",
            windowsHide: true,
        });
        const out = String(logsRes.stdout || "") + "\n" + String(logsRes.stderr || "");
        if (logsRes.status === 0) return out;
    } catch {
        // ignore
    }

    // Fallback: search actual container ID via docker ps filter
    try {
        const psRes = exec("docker", ["ps", "-a", "--filter", `name=${target}`, "--format", "{{.ID}}"], {
            encoding: "utf8",
            windowsHide: true,
        });
        if (psRes.status === 0 && psRes.stdout.trim()) {
            const containerId = psRes.stdout.trim().split("\n")[0];
            const logsRes2 = exec("docker", ["logs", containerId, "--tail", String(tail)], {
                encoding: "utf8",
                windowsHide: true,
            });
            return String(logsRes2.stdout || "") + "\n" + String(logsRes2.stderr || "");
        }
    } catch {
        // ignore
    }

    return "";
}

export async function verifyModuleDeployment({
    root = process.cwd(),
    serviceId,
    moduleId,
    composeFile,
    exec = spawnSync,
    out = process.stdout,
    timeoutMs = 60000,
    pollIntervalMs = 1500,
    fetchFn = globalThis.fetch,
    endpointUrl = null,
}) {
    const target = serviceId || moduleId;
    out.write(`[i] Memulai healthcheck & smoketest untuk container '${target}'...\n`);

    const startTime = Date.now();
    let inspectData = null;
    let lastHealthStatus = "";
    let iteration = 0;

    while (Date.now() - startTime < timeoutMs) {
        iteration++;
        inspectData = inspectContainer(target, exec);

        if (inspectData) {
            const state = inspectData.State || {};
            const containerRef = inspectData.Id || target;

            // 1. Cek apakah container sudah mati dengan exit code != 0
            if (state.Running === false && state.ExitCode !== 0) {
                out.write(`[x] Container '${target}' berhenti secara tidak normal (Exit code: ${state.ExitCode}).\n`);
                break;
            }

            // 2. Cek apakah HTTP smoketest sudah responsif
            if (endpointUrl && typeof fetchFn === "function") {
                try {
                    const controller = new AbortController();
                    const timer = setTimeout(() => controller.abort(), 2000);
                    const res = await fetchFn(endpointUrl, { signal: controller.signal });
                    clearTimeout(timer);
                    if (res.ok || res.status === 404 || res.status === 400) {
                        out.write(`[v] Smoketest endpoint HTTP '${endpointUrl}' berhasil merespons (HTTP ${res.status}).\n`);
                        return { ok: true, healthStatus: state.Health?.Status || "running", smoketest: true, target };
                    }
                } catch {
                    // Endpoint belum binding, lanjutkan loop
                }
            }

            // 3. Cek Docker Healthcheck jika didefinisikan
            const healthStatus = state.Health?.Status;
            if (healthStatus) {
                if (healthStatus === "healthy") {
                    out.write(`[v] Healthcheck Docker sukses: '${target}' berstatus HEALTHY.\n`);
                    return { ok: true, healthStatus: "healthy", target };
                }

                if (healthStatus === "unhealthy") {
                    out.write(`[x] Healthcheck Docker melaporkan status UNHEALTHY pada '${target}'.\n`);
                    break;
                }

                if (healthStatus !== lastHealthStatus) {
                    lastHealthStatus = healthStatus;
                    out.write(`[.] Status healthcheck container: ${healthStatus}... menunggu probe selesai.\n`);
                }
            } else if (state.Running === true) {
                // Container tidak memiliki healthcheck bawaan docker
                const currentLogs = getContainerLogs(containerRef, exec, 20);
                const hasFatalLog = currentLogs.includes("Permission denied")
                    || currentLogs.includes("PermissionError")
                    || currentLogs.includes("address already in use")
                    || currentLogs.includes("CrashLoop");

                if (hasFatalLog) {
                    out.write(`[x] Terdeteksi pesan fatal pada log container '${target}'.\n`);
                    break;
                }

                if (iteration >= 2 || timeoutMs <= 5000) {
                    out.write(`[v] Container '${target}' berjalan stabil dalam status RUNNING.\n`);
                    return { ok: true, healthStatus: "running", target };
                }
            }
        }

        // Tunggu sebelum iterasi berikutnya
        const remaining = timeoutMs - (Date.now() - startTime);
        if (remaining > 0) {
            await new Promise((r) => setTimeout(r, Math.min(pollIntervalMs, remaining)));
        }
    }

    // Jika sampai di sini, container mengalami kegagalan atau timeout
    const containerRef = inspectData?.Id || target;
    const logs = getContainerLogs(containerRef, exec, 50);
    const state = inspectData?.State;

    out.write("\n================================================================================\n");
    out.write(`  SHADOW CORE - DIAGNOSIS KEGAGALAN DEPLOYMENT: ${target}\n`);
    out.write("================================================================================\n");
    out.write(`[!] Container '${target}' tidak mencapai status sehat dalam batas waktu ${Math.round(timeoutMs / 1000)} detik.\n`);
    if (state) {
        out.write(`    Status: ${state.Status} (ExitCode: ${state.ExitCode || 0}, Health: ${state.Health?.Status || "none"})\n`);
    }
    out.write("--------------------------------------------------------------------------------\n");
    out.write("  Menganalisis log kegagalan via 9Router Engine...\n");

    let composeText = "";
    if (composeFile && fs.existsSync(composeFile)) {
        try {
            composeText = fs.readFileSync(composeFile, "utf8");
        } catch {
            // ignore
        }
    }

    const diagnosis = await analyzeContainerFailure({
        serviceId: target,
        logs,
        composeContent: composeText,
        root,
    });

    if (diagnosis.ok) {
        out.write(`\n  [x] Analisis Masalah : ${diagnosis.cause}\n`);
        out.write(`  [v] Rekomendasi Solusi:\n`);
        for (const line of diagnosis.suggestion.split("\n")) {
            out.write(`      ${line}\n`);
        }
    } else {
        out.write(`\n  Cuplikan log terakhir:\n`);
        const logLines = logs.trim().split("\n").slice(-8);
        for (const l of logLines) {
            out.write(`      ${l}\n`);
        }
    }
    out.write("================================================================================\n\n");

    return {
        ok: false,
        target,
        state: state?.Status,
        healthStatus: state?.Health?.Status,
        diagnosis,
    };
}
