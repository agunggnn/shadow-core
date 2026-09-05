import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { analyzeContainerFailure } from "./reasoner.mjs";

export async function verifyModuleDeployment({
    root = process.cwd(),
    serviceId,
    moduleId,
    composeFile,
    exec = spawnSync,
    out = process.stdout,
    timeoutMs = 5000,
}) {
    const target = serviceId || moduleId;
    out.write(`[i] Memverifikasi startup container '${target}'...\n`);

    // Give container a few seconds to run initial scripts
    await new Promise((r) => setTimeout(r, Math.min(timeoutMs, 2500)));

    let inspectData = null;
    try {
        const inspectRes = exec("docker", ["inspect", target], {
            encoding: "utf8",
            windowsHide: true,
        });
        if (inspectRes.status === 0) {
            const arr = JSON.parse(inspectRes.stdout);
            if (arr.length > 0) inspectData = arr[0];
        }
    } catch {
        // Inspection failure
    }

    if (!inspectData) {
        // Container might have compose naming, e.g., shadow-<target>-1
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
                    inspectData = JSON.parse(secondInspect.stdout)[0];
                }
            }
        } catch {
            // ignore
        }
    }

    let logs = "";
    try {
        const logsRes = exec("docker", ["logs", target, "--tail", "50"], {
            encoding: "utf8",
            windowsHide: true,
        });
        logs = String(logsRes.stdout || "") + "\n" + String(logsRes.stderr || "");
    } catch {
        // ignore
    }

    const state = inspectData?.State;
    const isExited = state && state.Running === false && state.ExitCode !== 0;
    const isRestarting = state && state.Restarting === true;
    const hasFatalLog = logs.includes("Permission denied")
        || logs.includes("PermissionError")
        || logs.includes("CrashLoop")
        || logs.includes("address already in use")
        || logs.includes("Traceback (most recent call last):");

    if (isExited || isRestarting || hasFatalLog) {
        out.write("\n================================================================================\n");
        out.write(`  SHADOW CORE - VERIFIKASI DEPLOYMENT CONTAINER: ${target}\n`);
        out.write("================================================================================\n");
        out.write(`[!] Terdeteksi kendala saat menjalankan container '${target}'.\n`);
        if (state) {
            out.write(`    Status: ${state.Status} (ExitCode: ${state.ExitCode})\n`);
        }
        out.write("--------------------------------------------------------------------------------\n");
        out.write("  Menganalisis log kegagalan via 9Router Engine...\n");

        let composeText = "";
        if (composeFile && fs.existsSync(composeFile)) {
            composeText = fs.readFileSync(composeFile, "utf8");
        }

        const diagnosis = await analyzeContainerFailure({
            serviceId: target,
            logs,
            composeContent: composeText,
            root,
        });

        if (diagnosis.ok) {
            out.write(`\n  [x] Penyebab: ${diagnosis.cause}\n`);
            out.write(`  [v] Solusi  :\n`);
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
        return { ok: false, diagnosis };
    }

    out.write(`[v] Container '${target}' berhasil berjalan normal.\n`);
    return { ok: true };
}
