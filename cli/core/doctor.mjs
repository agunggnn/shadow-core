import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function getOperatingSystemInfo() {
    const platform = process.platform;
    const arch = process.arch;
    let name = platform;
    let isUbuntu = false;

    if (platform === "linux") {
        name = "Linux";
        if (fs.existsSync("/etc/os-release")) {
            try {
                const osRelease = fs.readFileSync("/etc/os-release", "utf8");
                const match = osRelease.match(/^PRETTY_NAME=["']?([^"'\r\n]+)["']?/m);
                if (match) name = match[1];
                if (/ubuntu/i.test(name) || /ubuntu/i.test(osRelease)) isUbuntu = true;
            } catch {
                /* fallback to Linux */
            }
        }
    } else if (platform === "win32") {
        name = `Windows (${os.release()})`;
    } else if (platform === "darwin") {
        name = `macOS (${os.release()})`;
    }

    return { platform, arch, name, isUbuntu };
}

export function checkNodeRuntime() {
    const version = process.version;
    const match = version.match(/^v(\d+)\.(\d+)/);
    const major = match ? parseInt(match[1], 10) : 0;
    const ok = major >= 20;
    let sqliteSupported = true;
    try {
        if (major < 22 && !process.features?.sqlite) {
            sqliteSupported = false;
        }
    } catch {
        sqliteSupported = false;
    }
    return {
        version,
        major,
        ok,
        sqliteSupported,
        message: ok ? `${version} (OK)` : `${version} (Memerlukan Node.js v20+)`,
    };
}

export function checkDockerCli(exec = spawnSync) {
    try {
        const result = exec("docker", ["--version"], { encoding: "utf8", windowsHide: true });
        if (result.status === 0) {
            const versionStr = String(result.stdout || "").trim();
            return { ok: true, version: versionStr };
        }
        return {
            ok: false,
            error: String(result.stderr || result.stdout || "Perintah 'docker' tidak ditemukan di PATH.").trim(),
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

export function checkDockerDaemon(exec = spawnSync, osInfo = getOperatingSystemInfo()) {
    try {
        const result = exec("docker", ["info", "--format", "{{json .ServerVersion}}"], {
            encoding: "utf8",
            windowsHide: true,
        });
        if (result.status === 0) {
            const version = String(result.stdout || "").trim().replace(/^"|"$/g, "");
            return { ok: true, version: version || "Running" };
        }
        const errText = String(result.stderr || result.stdout || "");
        const errLower = errText.toLowerCase();
        const isPermissionDenied = errLower.includes("permission denied") || errLower.includes("dial unix /var/run/docker.sock");
        const isNotRunning = errLower.includes("is the docker daemon running") || errLower.includes("connection refused") || errLower.includes("cannot connect");

        let guide = "";
        let errorSummary = "";

        if (isPermissionDenied) {
            errorSummary = "Izin akses Docker socket ditolak (Permission Denied).";
            const user = os.userInfo().username || "ubuntu";
            guide = osInfo.platform === "linux"
                ? `Di Linux Ubuntu/Debian, user '${user}' perlu dimasukkan ke grup 'docker':\n    sudo usermod -aG docker ${user}\n    newgrp docker\n    (atau log out dan log in kembali)`
                : "Pastikan user Anda memiliki izin untuk mengakses Docker daemon.";
        } else if (isNotRunning) {
            errorSummary = "Docker daemon / service tidak berjalan.";
            guide = osInfo.platform === "linux"
                ? "Jalankan Docker service di Ubuntu/Debian:\n    sudo systemctl start docker\n    sudo systemctl enable docker"
                : "Silakan buka aplikasi Docker Desktop dan pastikan status Engine 'Running'.";
        } else {
            errorSummary = errText.trim() || "Tidak dapat menghubungi Docker daemon.";
            guide = "Pastikan Docker service berjalan.";
        }

        return {
            ok: false,
            isPermissionDenied,
            isNotRunning,
            error: errorSummary,
            rawError: errText.trim(),
            guide,
        };
    } catch (err) {
        return {
            ok: false,
            error: err.message,
            guide: "Pastikan Docker terinstal dan service berjalan.",
        };
    }
}

export function checkDockerCompose(exec = spawnSync, osInfo = getOperatingSystemInfo()) {
    try {
        const result = exec("docker", ["compose", "version"], { encoding: "utf8", windowsHide: true });
        if (result.status === 0) {
            const versionStr = String(result.stdout || "").trim();
            return { ok: true, version: versionStr };
        }
        const guide = osInfo.platform === "linux"
            ? "Docker Compose v2 plugin tidak ditemukan. Di Ubuntu pasang dengan:\n    sudo apt-get update && sudo apt-get install -y docker-compose-plugin"
            : "Docker Compose v2 tidak ditemukan. Pastikan Docker Desktop terinstal dengan benar.";
        return {
            ok: false,
            error: String(result.stderr || result.stdout || "Docker Compose v2 plugin tidak ditemukan.").trim(),
            guide,
        };
    } catch (err) {
        return { ok: false, error: err.message, guide: "Pastikan Docker Compose v2 plugin terpasang." };
    }
}

export function checkFilePermissions(targetPath) {
    if (process.platform === "win32") {
        return { ok: true, mode: "Windows ACL", note: "Dikelola oleh Windows ACL" };
    }
    if (!fs.existsSync(targetPath)) {
        return { ok: true, mode: "N/A", note: "File/folder belum dibuat" };
    }
    try {
        const stat = fs.statSync(targetPath);
        const mode = (stat.mode & 0o777).toString(8);
        const isSecure = ["600", "400", "700"].includes(mode);
        return {
            ok: isSecure,
            mode,
            note: isSecure ? `Aman (${mode})` : `Peringatan: izin ${mode} terlalu terbuka (disarankan 0600 / 0700)`,
        };
    } catch {
        return { ok: true, mode: "unknown", note: "Tidak dapat memeriksa izin" };
    }
}

export function applyDoctorFixes({ root, out = process.stdout }) {
    const fixes = [];
    const envFile = path.join(root, ".env");
    const dataDir = path.join(root, "data");

    // 1. Ensure data directory exists with 0700
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
        try { fs.chmodSync(dataDir, 0o700); } catch { /* Windows */ }
        fixes.push("Membuat direktori data/ dengan izin aman (0700)");
    } else if (process.platform !== "win32") {
        try {
            const stat = fs.statSync(dataDir);
            const mode = (stat.mode & 0o777).toString(8);
            if (mode !== "700") {
                fs.chmodSync(dataDir, 0o700);
                fixes.push(`Memperbaiki izin direktori data/ dari ${mode} ke 0700`);
            }
        } catch { /* ignore */ }
    }

    // 2. Ensure .env permissions are 0600 on Unix
    if (fs.existsSync(envFile) && process.platform !== "win32") {
        try {
            const stat = fs.statSync(envFile);
            const mode = (stat.mode & 0o777).toString(8);
            if (mode !== "600") {
                fs.chmodSync(envFile, 0o600);
                fixes.push(`Memperbaiki izin file .env dari ${mode} ke 0600`);
            }
        } catch { /* ignore */ }
    }

    // 3. Ensure root directory permissions on Unix
    if (fs.existsSync(root) && process.platform !== "win32") {
        try {
            const stat = fs.statSync(root);
            const mode = (stat.mode & 0o777).toString(8);
            if (!["700", "750"].includes(mode)) {
                fs.chmodSync(root, 0o700);
                fixes.push(`Memperbaiki izin workspace root dari ${mode} ke 0700`);
            }
        } catch { /* ignore */ }
    }

    // 4. Missing .env from .env.example
    const envExample = path.join(root, ".env.example");
    if (!fs.existsSync(envFile) && fs.existsSync(envExample)) {
        fs.copyFileSync(envExample, envFile);
        try { fs.chmodSync(envFile, 0o600); } catch { /* Windows */ }
        fixes.push("Menyalin .env dari .env.example (silakan jalankan 'shadow init' untuk mengisi kredensial)");
    }

    if (fixes.length > 0) {
        out.write("--------------------------------------------------------------------------------\n");
        out.write("  PERBAIKAN OTOMATIS (--fix):\n");
        for (const f of fixes) {
            out.write(`  [v] ${f}\n`);
        }
        out.write("--------------------------------------------------------------------------------\n\n");
    }

    return fixes;
}

export function runDoctor({ root, defaultHome, exec = spawnSync, out = process.stdout, fix = false }) {
    if (fix) {
        applyDoctorFixes({ root, out });
    }
    const osInfo = getOperatingSystemInfo();
    const nodeCheck = checkNodeRuntime();
    const cliCheck = checkDockerCli(exec);
    const daemonCheck = checkDockerDaemon(exec, osInfo);
    const composeCheck = checkDockerCompose(exec, osInfo);

    const isGlobal = Boolean(defaultHome && root === defaultHome);
    const envFile = path.join(root, ".env");
    const envExists = fs.existsSync(envFile);
    const permCheck = envExists ? checkFilePermissions(envFile) : checkFilePermissions(root);

    let composeConfigValid = null;
    let composeConfigError = "";
    if (envExists && composeCheck.ok && daemonCheck.ok) {
        try {
            const result = exec(
                "docker",
                ["compose", "--project-directory", root, "--env-file", envFile, "config", "--quiet"],
                { cwd: root, encoding: "utf8", windowsHide: true }
            );
            if (result.status === 0) {
                composeConfigValid = true;
            } else {
                composeConfigValid = false;
                composeConfigError = String(result.stderr || result.stdout || "").trim();
            }
        } catch (err) {
            composeConfigValid = false;
            composeConfigError = err.message;
        }
    }

    out.write("================================================================================\n");
    out.write("  SHADOW CORE - COMPATIBILITY & SYSTEM DOCTOR\n");
    out.write("================================================================================\n");

    // OS
    out.write(`  Operating System  : ${osInfo.name} (${osInfo.arch}) [OK]\n`);

    // Node.js
    const nodeTag = nodeCheck.ok ? "[OK]" : "[FAIL]";
    out.write(`  Node.js Runtime   : ${nodeCheck.message} ${nodeTag}\n`);

    // Docker CLI
    if (cliCheck.ok) {
        out.write(`  Docker CLI        : ${cliCheck.version} [OK]\n`);
    } else {
        out.write(`  Docker CLI        : Tidak terdeteksi [FAIL]\n`);
    }

    // Docker Engine / Daemon
    if (daemonCheck.ok) {
        out.write(`  Docker Engine     : Running (v${daemonCheck.version}) [OK]\n`);
    } else {
        out.write(`  Docker Engine     : GAGAL / Tidak Dapat Dihubungi [FAIL]\n`);
    }

    // Docker Compose
    if (composeCheck.ok) {
        out.write(`  Docker Compose    : ${composeCheck.version} [OK]\n`);
    } else {
        out.write(`  Docker Compose    : Plugin v2 Tidak Ditemukan [FAIL]\n`);
    }

    // Shadow Root & Instance
    const rootLabel = isGlobal ? `${root} (Global User Home)` : `${root} (Workspace Lokal)`;
    out.write(`  Shadow Root       : ${rootLabel}\n`);

    // Instance Status
    if (envExists) {
        out.write(`  Instance Status   : Terinisialisasi (.env aktif) [OK]\n`);
        out.write(`  File Permissions  : ${permCheck.note} ${permCheck.ok ? "[OK]" : "[WARN]"}\n`);
        if (composeConfigValid === true) {
            out.write(`  Compose Config    : Konfigurasi valid [OK]\n`);
        } else if (composeConfigValid === false) {
            out.write(`  Compose Config    : Konfigurasi bermasalah [FAIL]\n`);
        }
    } else {
        out.write(`  Instance Status   : Belum diinisialisasi (Jalankan 'shadow init') [INFO]\n`);
    }

    out.write("================================================================================\n");

    const issues = [];
    if (!nodeCheck.ok) {
        issues.push({
            title: "Versi Node.js Tidak Memenuhi Syarat",
            detail: `Versi Node saat ini (${nodeCheck.version}) di bawah standar minimum v20.x.`,
            solution: "Update Node.js ke versi 20 LTS atau 22 LTS (https://nodejs.org).",
        });
    }
    if (!cliCheck.ok) {
        issues.push({
            title: "Docker CLI Tidak Ditemukan",
            detail: cliCheck.error,
            solution: osInfo.platform === "linux"
                ? "Di Ubuntu jalankan:\n    sudo apt-get update && sudo apt-get install -y docker.io"
                : "Unduh dan pasang Docker Desktop dari https://www.docker.com/products/docker-desktop",
        });
    }
    if (!daemonCheck.ok) {
        issues.push({
            title: daemonCheck.error || "Docker Engine Tidak Terhubung",
            detail: daemonCheck.rawError,
            solution: daemonCheck.guide,
        });
    }
    if (!composeCheck.ok) {
        issues.push({
            title: "Docker Compose v2 Plugin Tidak Ditemukan",
            detail: composeCheck.error,
            solution: composeCheck.guide,
        });
    }
    if (composeConfigValid === false) {
        issues.push({
            title: "Validasi Docker Compose Gagal",
            detail: composeConfigError,
            solution: "Periksa syntax docker-compose.yml atau jalankan 'shadow init' ulang.",
        });
    }

    if (issues.length === 0) {
        out.write("[v] STATUS: Sistem Anda sepenuhnya kompatibel dan siap menjalankan Shadow Core!\n");
        if (!envExists) {
            out.write("[i] Langkah berikutnya: jalankan 'shadow init' untuk membuat kredensial awal.\n");
        }
        return { ok: true, issues: [] };
    }

    out.write(`[!] DITEMUKAN ${issues.length} KENDALA YANG PERLU DIPERBAIKI:\n`);
    for (let i = 0; i < issues.length; i += 1) {
        const issue = issues[i];
        out.write(`\n  ${i + 1}. [KENDALA] ${issue.title}\n`);
        if (issue.detail) {
            out.write(`     Detail : ${issue.detail}\n`);
        }
        out.write(`     Solusi :\n`);
        for (const line of issue.solution.split("\n")) {
            out.write(`       ${line}\n`);
        }
    }
    out.write("\n================================================================================\n");
    return { ok: false, issues };
}
