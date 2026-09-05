#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
    AGENT_SYSTEM_RULE,
    ANTIGRAVITY_SKILL_CONTENT,
    CLAUDE_RULE_CONTENT,
    CLINE_RULE_CONTENT,
    CURSOR_MDC_CONTENT,
} from "./rules.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliRoot = path.resolve(here, "..");
const shadowBin = path.join(cliRoot, "bin", "shadow.js");

export function getClaudeDesktopConfigPath() {
    if (process.platform === "win32") {
        return path.join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json");
    }
    if (process.platform === "darwin") {
        return path.join(os.homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
    }
    return path.join(os.homedir(), ".config", "Claude", "claude_desktop_config.json");
}

export function getClineSettingsPaths() {
    const results = [];
    const baseDir = process.platform === "win32"
        ? path.join(process.env.APPDATA || "", "Code", "User", "globalStorage")
        : (process.platform === "darwin"
            ? path.join(os.homedir(), "Library", "Application Support", "Code", "User", "globalStorage")
            : path.join(os.homedir(), ".config", "Code", "User", "globalStorage"));

    const plugins = ["saoudrizwan.claude-dev", "rooveterinaryinc.roo-cline"];
    for (const plugin of plugins) {
        const file = path.join(baseDir, plugin, "settings", "cline_mcp_settings.json");
        results.push({ plugin, path: file });
    }
    return results;
}

export function detectPlatforms(root = process.cwd()) {
    const platforms = [];

    // Cursor
    const hasCursorDir = fs.existsSync(path.join(root, ".cursor"));
    const hasCursorRules = fs.existsSync(path.join(root, ".cursorrules"));
    if (hasCursorDir || hasCursorRules || process.env.CURSOR_AGENT) {
        platforms.push({ id: "cursor", name: "Cursor IDE", detected: true });
    } else {
        platforms.push({ id: "cursor", name: "Cursor IDE", detected: false });
    }

    // Claude Desktop
    const claudeConfig = getClaudeDesktopConfigPath();
    platforms.push({
        id: "claude",
        name: "Claude Desktop",
        detected: fs.existsSync(path.dirname(claudeConfig)),
        configPath: claudeConfig,
    });

    // Cline / Roo Code
    const clineSettings = getClineSettingsPaths();
    const hasCline = clineSettings.some((s) => fs.existsSync(path.dirname(s.path)));
    platforms.push({
        id: "cline",
        name: "Cline / Roo Code",
        detected: hasCline || fs.existsSync(path.join(root, ".clinerules")),
    });

    // Antigravity / Gemini CLI
    const geminiDir = path.join(os.homedir(), ".gemini", "skills");
    platforms.push({
        id: "antigravity",
        name: "Google Antigravity CLI",
        detected: fs.existsSync(geminiDir),
    });

    return platforms;
}

export function installToCursor(root = process.cwd()) {
    const created = [];

    // 1. Modern .cursor/rules/shadow-vault.mdc
    const rulesDir = path.join(root, ".cursor", "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    const mdcPath = path.join(rulesDir, "shadow-vault.mdc");
    fs.writeFileSync(mdcPath, CURSOR_MDC_CONTENT, "utf8");
    created.push(mdcPath);

    // 2. Legacy .cursorrules (for backward compatibility)
    const cursorRulesPath = path.join(root, ".cursorrules");
    if (!fs.existsSync(cursorRulesPath)) {
        fs.writeFileSync(cursorRulesPath, AGENT_SYSTEM_RULE, "utf8");
        created.push(cursorRulesPath);
    }

    return created;
}

export function installToClaudeDesktop(root = process.cwd()) {
    const created = [];
    const configFile = getClaudeDesktopConfigPath();
    fs.mkdirSync(path.dirname(configFile), { recursive: true });

    let config = { mcpServers: {} };
    if (fs.existsSync(configFile)) {
        try {
            config = JSON.parse(fs.readFileSync(configFile, "utf8"));
            if (!config.mcpServers) config.mcpServers = {};
        } catch {
            config = { mcpServers: {} };
        }
    }

    config.mcpServers["shadow-vault"] = {
        command: "node",
        args: [shadowBin, "mcp", "serve"],
    };

    fs.writeFileSync(configFile, JSON.stringify(config, null, 2), "utf8");
    created.push(configFile);

    // Also write CLAUDE.md in workspace root
    const claudeMd = path.join(root, "CLAUDE.md");
    if (!fs.existsSync(claudeMd)) {
        fs.writeFileSync(claudeMd, CLAUDE_RULE_CONTENT, "utf8");
        created.push(claudeMd);
    }

    return created;
}

export function installToCline(root = process.cwd()) {
    const created = [];

    // 1. Workspace .clinerules
    const clineRules = path.join(root, ".clinerules");
    fs.writeFileSync(clineRules, CLINE_RULE_CONTENT, "utf8");
    created.push(clineRules);

    // 2. MCP Settings injection
    for (const { path: settingsPath } of getClineSettingsPaths()) {
        if (fs.existsSync(path.dirname(settingsPath))) {
            let settings = { mcpServers: {} };
            if (fs.existsSync(settingsPath)) {
                try {
                    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
                    if (!settings.mcpServers) settings.mcpServers = {};
                } catch {
                    settings = { mcpServers: {} };
                }
            }
            settings.mcpServers["shadow-vault"] = {
                command: "node",
                args: [shadowBin, "mcp", "serve"],
                disabled: false,
                autoApprove: ["shadow_vault_list", "shadow_vault_has", "shadow_sniffer_scan"],
            };
            fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
            created.push(settingsPath);
        }
    }

    return created;
}

export function installToAntigravity(root = process.cwd()) {
    const created = [];
    const skillDir = path.join(os.homedir(), ".gemini", "skills", "shadow-vault");
    fs.mkdirSync(skillDir, { recursive: true });
    const skillFile = path.join(skillDir, "SKILL.md");
    fs.writeFileSync(skillFile, ANTIGRAVITY_SKILL_CONTENT, "utf8");
    created.push(skillFile);
    return created;
}

export function installSkill({ root = process.cwd(), target = "all" } = {}) {
    const installed = [];
    const normalized = String(target).toLowerCase();

    if (["all", "cursor"].includes(normalized)) {
        installed.push(...installToCursor(root));
    }
    if (["all", "claude"].includes(normalized)) {
        installed.push(...installToClaudeDesktop(root));
    }
    if (["all", "cline", "roo"].includes(normalized)) {
        installed.push(...installToCline(root));
    }
    if (["all", "antigravity", "gemini"].includes(normalized)) {
        installed.push(...installToAntigravity(root));
    }

    return installed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const action = args[0] || "install";
    const target = args[1] || "all";
    const root = process.cwd();

    if (action === "status" || action === "list") {
        const detected = detectPlatforms(root);
        process.stdout.write("================================================================================\n");
        process.stdout.write("  SHADOW CORE - AI AGENT SKILL INTEGRATION STATUS\n");
        process.stdout.write("================================================================================\n");
        for (const p of detected) {
            const status = p.detected ? "[v] Terdeteksi" : "[ ] Tidak terdeteksi";
            process.stdout.write(`  ${p.name.padEnd(26)} : ${status}\n`);
        }
        process.stdout.write("================================================================================\n");
        process.stdout.write("Jalankan 'shadow skill install' untuk memasang ke seluruh agent.\n");
        process.exit(0);
    }

    if (action === "install") {
        process.stdout.write("================================================================================\n");
        process.stdout.write("  SHADOW CORE - UNIVERSAL AI AGENT SKILL INSTALLER\n");
        process.stdout.write("================================================================================\n");
        const results = installSkill({ root, target });
        for (const file of results) {
            process.stdout.write(`  [v] Dikonfigurasi: ${path.relative(root, file) || file}\n`);
        }
        process.stdout.write("--------------------------------------------------------------------------------\n");
        process.stdout.write("  [v] Selesai! Agen AI Anda (Cursor/Claude/Cline/Antigravity) kini secara otomatis\n");
        process.stdout.write("      terlindungi oleh Shadow Vault. Token/kredensial tidak akan pernah bocor ke LLM.\n");
        process.stdout.write("================================================================================\n");
        process.exit(0);
    }

    process.stderr.write(`Aksi tidak dikenal: '${action}'. Gunakan 'install' atau 'status'.\n`);
    process.exit(1);
}
