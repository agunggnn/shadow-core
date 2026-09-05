import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { parseEnv } from "../core/env.mjs";
import { promptSecret } from "../vault/creds.mjs";

function setEnvValue(text, name, value) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

function askQuestion(rl, query, defaultValue = "") {
    return new Promise((resolve) => {
        const prompt = defaultValue ? `${query} [${defaultValue}]: ` : `${query}: `;
        rl.question(prompt, (answer) => {
            resolve(answer.trim() || defaultValue);
        });
    });
}

export async function runInstallWizard({
    root,
    envFile,
    moduleId,
    nonInteractive = false,
    input = process.stdin,
    out = process.stdout,
}) {
    if (moduleId !== "cognee") {
        return { configured: true, mode: "standard" };
    }

    let envText = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";

    // If non-interactive or stdin is not TTY, apply 9Router default automatically
    if (nonInteractive || !input.isTTY) {
        envText = setEnvValue(envText, "COGNEE_LLM_PROVIDER", "openai");
        envText = setEnvValue(envText, "COGNEE_LLM_MODEL", "openai/gpt-4o-mini");
        envText = setEnvValue(envText, "COGNEE_LLM_ENDPOINT", "http://host.docker.internal:20140/v1");
        envText = setEnvValue(envText, "COGNEE_LLM_API_KEY", "shadow-default");
        fs.writeFileSync(envFile, envText, "utf8");
        return {
            configured: true,
            mode: "9router-default",
            summary: "Menggunakan default 9Router AI Gateway (http://host.docker.internal:20140/v1).",
        };
    }

    out.write("\n================================================================================\n");
    out.write("  SHADOW CORE - WIZARD INSTALASI MODUL: cognee\n");
    out.write("================================================================================\n");
    out.write("Modul Cognee membutuhkan LLM untuk ekstraksi graf memori & vector embeddings.\n\n");
    out.write("Pilih jalur koneksi LLM untuk Cognee:\n");
    out.write("  [1] (Rekomendasi) 9Router Gateway lokal (http://host.docker.internal:20140/v1)\n");
    out.write("  [2] Ollama Lokal (100% Offline & Gratis di http://host.docker.internal:11434)\n");
    out.write("  [3] Provider Cloud Langsung (OpenAI / OpenRouter / Anthropic)\n\n");

    const rl = readline.createInterface({ input, output: out });

    try {
        const choice = await askQuestion(rl, "Pilih nomor", "1");

        if (choice === "2") {
            out.write("\n-- Konfigurasi Ollama Lokal --\n");
            const model = await askQuestion(rl, "Model Generasi", "llama3.1:8b");
            const embedModel = await askQuestion(rl, "Model Embedding", "nomic-embed-text:latest");

            envText = setEnvValue(envText, "COGNEE_LLM_PROVIDER", "ollama");
            envText = setEnvValue(envText, "COGNEE_LLM_MODEL", model);
            envText = setEnvValue(envText, "COGNEE_LLM_ENDPOINT", "http://host.docker.internal:11434/v1");
            envText = setEnvValue(envText, "COGNEE_LLM_API_KEY", "ollama");
            envText = setEnvValue(envText, "COGNEE_EMBEDDING_PROVIDER", "ollama");
            envText = setEnvValue(envText, "COGNEE_EMBEDDING_MODEL", embedModel);
            envText = setEnvValue(envText, "COGNEE_EMBEDDING_ENDPOINT", "http://host.docker.internal:11434/api/embed");
            envText = setEnvValue(envText, "COGNEE_EMBEDDING_DIMENSIONS", "768");
            fs.writeFileSync(envFile, envText, "utf8");

            return {
                configured: true,
                mode: "ollama",
                summary: `Terkonfigurasi dengan Ollama lokal (${model}, ${embedModel}).`,
            };
        }

        if (choice === "3") {
            out.write("\n-- Konfigurasi Provider Cloud Langsung --\n");
            const provider = await askQuestion(rl, "Provider (openai / openrouter / anthropic)", "openrouter");
            const model = await askQuestion(rl, "Model", provider === "openrouter" ? "openrouter/openai/gpt-4o-mini" : "openai/gpt-4o-mini");
            rl.close();

            const apiKey = await promptSecret(`Masukkan API Key untuk ${provider}: `, { input, output: out });

            envText = setEnvValue(envText, "COGNEE_LLM_PROVIDER", provider);
            envText = setEnvValue(envText, "COGNEE_LLM_MODEL", model);
            if (provider === "openrouter") {
                envText = setEnvValue(envText, "COGNEE_LLM_ENDPOINT", "https://openrouter.ai/api/v1");
            }
            if (apiKey) {
                envText = setEnvValue(envText, "COGNEE_LLM_API_KEY", apiKey);
            }
            fs.writeFileSync(envFile, envText, "utf8");

            return {
                configured: true,
                mode: "cloud",
                summary: `Terkonfigurasi dengan provider ${provider} (${model}).`,
            };
        }

        // Default: 9Router
        out.write("\n-- Menggunakan 9Router Gateway Lokal --\n");
        const model = await askQuestion(rl, "Model di 9Router", "openai/gpt-4o-mini");
        envText = setEnvValue(envText, "COGNEE_LLM_PROVIDER", "openai");
        envText = setEnvValue(envText, "COGNEE_LLM_MODEL", model);
        envText = setEnvValue(envText, "COGNEE_LLM_ENDPOINT", "http://host.docker.internal:20140/v1");
        envText = setEnvValue(envText, "COGNEE_LLM_API_KEY", "shadow-default");
        fs.writeFileSync(envFile, envText, "utf8");

        return {
            configured: true,
            mode: "9router",
            summary: `Terkonfigurasi via 9Router gateway (http://host.docker.internal:20140/v1, model: ${model}).`,
        };
    } finally {
        try { rl.close(); } catch { /* ignore */ }
    }
}
