import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { scanText } from "../vault/sniffer.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const gitHookScriptPath = fileURLToPath(import.meta.url);

export function findGitDir(startDir = process.cwd()) {
    let current = path.resolve(startDir);
    while (current) {
        const gitPath = path.join(current, ".git");
        if (fs.existsSync(gitPath)) {
            const stat = fs.statSync(gitPath);
            return stat.isDirectory() ? gitPath : null;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return null;
}

export function checkStagedDiff(root = process.cwd()) {
    const start = performance.now();
    const violations = [];

    // 1. Check if sensitive files (.env) are accidentally staged
    const stagedFilesResult = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
    });

    if (stagedFilesResult.status === 0) {
        const fileNames = stagedFilesResult.stdout.split(/\r?\n/).map((f) => f.trim()).filter(Boolean);
        for (const file of fileNames) {
            const base = path.basename(file);
            if (base === ".env" || (base.startsWith(".env.") && !base.endsWith(".example") && !base.endsWith(".sample"))) {
                violations.push({
                    file,
                    line: 0,
                    type: "RAW_ENV_FILE",
                    label: `Plaintext environment file '${file}' cannot be committed`,
                });
            }
        }
    }

    // 2. Scan added lines in git staged diff
    const diffResult = spawnSync("git", ["diff", "--cached", "-U0", "--no-color"], {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
    });

    if (diffResult.status === 0 && diffResult.stdout) {
        let currentFile = "";
        let currentLine = 0;
        const lines = diffResult.stdout.split(/\r?\n/);

        for (const line of lines) {
            if (line.startsWith("+++ b/")) {
                currentFile = line.slice(6);
                continue;
            }
            if (line.startsWith("@@ ")) {
                const match = line.match(/\+([0-9]+)/);
                if (match) currentLine = parseInt(match[1], 10);
                continue;
            }
            if (line.startsWith("+") && !line.startsWith("+++")) {
                const addedText = line.slice(1).trim();
                if (addedText) {
                    const scan = scanText(addedText);
                    if (scan.hasSecrets) {
                        for (const m of scan.matches) {
                            violations.push({
                                file: currentFile,
                                line: currentLine,
                                type: m.type,
                                label: m.label,
                            });
                        }
                    }
                }
                currentLine++;
            }
        }
    }

    const duration = Math.round((performance.now() - start) * 100) / 100;
    return {
        ok: violations.length === 0,
        violations,
        latencyMs: duration,
    };
}

export function installGitHook(root = process.cwd()) {
    const gitDir = findGitDir(root);
    if (!gitDir) {
        throw new Error(`Direktori .git tidak ditemukan di '${root}'. Pastikan Anda berada dalam repositori Git.`);
    }

    const hooksDir = path.join(gitDir, "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });

    const preCommitFile = path.join(hooksDir, "pre-commit");
    const scriptPathNorm = gitHookScriptPath.replace(/\\/g, "/");

    const hookContent = `#!/bin/sh
# Hetzer Zero-Plaintext Pre-Commit Hook
# Auto-intercepts leaked secrets, API keys, and tokens in < 2ms.

if command -v node >/dev/null 2>&1; then
    node "${scriptPathNorm}" check
    EXIT_CODE=$?
    if [ $EXIT_CODE -ne 0 ]; then
        exit 1
    fi
else
    echo "[!] Node.js not detected in PATH. Skipping Hetzer pre-commit check."
fi
exit 0
`;

    fs.writeFileSync(preCommitFile, hookContent, { encoding: "utf8", mode: 0o755 });
    try { fs.chmodSync(preCommitFile, 0o755); } catch { /* Windows */ }

    return {
        installed: true,
        path: preCommitFile,
    };
}

export function uninstallGitHook(root = process.cwd()) {
    const gitDir = findGitDir(root);
    if (!gitDir) return { uninstalled: false };

    const preCommitFile = path.join(gitDir, "hooks", "pre-commit");
    if (fs.existsSync(preCommitFile)) {
        const content = fs.readFileSync(preCommitFile, "utf8");
        if (content.includes("Hetzer Zero-Plaintext Pre-Commit Hook")) {
            fs.unlinkSync(preCommitFile);
            return { uninstalled: true, path: preCommitFile };
        }
    }
    return { uninstalled: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const action = process.argv[2] || "check";
    const root = process.cwd();

    if (action === "install") {
        try {
            const res = installGitHook(root);
            process.stdout.write("================================================================================\n");
            process.stdout.write("  HETZER - GIT PRE-COMMIT HOOK INSTALLER\n");
            process.stdout.write("================================================================================\n");
            process.stdout.write(`  [v] Hook berhasil dipasang di: ${res.path}\n`);
            process.stdout.write("  [v] Seluruh 'git commit' kini terlindungi oleh sub-2ms Secret Sniffer.\n");
            process.stdout.write("      Setiap token/password/file .env yang bocor akan diblokir otomatis.\n");
            process.stdout.write("================================================================================\n");
            process.exit(0);
        } catch (err) {
            process.stderr.write(`[x] Gagal memasang git hook: ${err.message}\n`);
            process.exit(1);
        }
    }

    if (action === "uninstall") {
        const res = uninstallGitHook(root);
        if (res.uninstalled) {
            process.stdout.write(`[v] Hetzer pre-commit hook berhasil dicopot dari: ${res.path}\n`);
        } else {
            process.stdout.write("[i] Tidak ada Hetzer pre-commit hook yang terpasang.\n");
        }
        process.exit(0);
    }

    if (action === "check") {
        const result = checkStagedDiff(root);
        if (!result.ok) {
            process.stderr.write("\n================================================================================\n");
            process.stderr.write("  🛑 HETZER ARMOR: GIT COMMIT DIBATALKAN (KEBOCORAN TOKEN TERDETEKSI!)\n");
            process.stderr.write("================================================================================\n");
            process.stderr.write(`  Waktu Pindai : ${result.latencyMs} ms\n`);
            process.stderr.write(`  Pelanggaran  : Ditemukan ${result.violations.length} kredensial mentah di staged changes:\n\n`);
            for (const v of result.violations) {
                if (v.line > 0) {
                    process.stderr.write(`  * ${v.file}:${v.line} -> [${v.type}] ${v.label}\n`);
                } else {
                    process.stderr.write(`  * ${v.file} -> [${v.type}] ${v.label}\n`);
                }
            }
            process.stderr.write("\n  CARA MEMPERBAIKI:\n");
            process.stderr.write("  1. Simpan nilai ke Vault: hetzer creds set <id> <nilai>\n");
            process.stderr.write("  2. Ganti token di file Anda dengan: secretRef:<id>\n");
            process.stderr.write("  3. Jika tidak sengaja commit file .env, jalankan: git rm --cached .env\n");
            process.stderr.write("================================================================================\n\n");
            process.exit(1);
        }
        process.stdout.write(`[v] Hetzer Sniffer: Staged changes aman (${result.latencyMs} ms). Commit diizinkan.\n`);
        process.exit(0);
    }
}
