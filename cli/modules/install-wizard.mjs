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
        envText = setEnvValue(envText, "COGNEE_LLM_API_KEY", "hetzer-default");
        fs.writeFileSync(envFile, envText, "utf8");
        return {
            configured: true,
            mode: "9router-default",
            summary: "Using default 9Router AI Gateway (http://host.docker.internal:20140/v1).",
        };
    }

    out.write("\n================================================================================\n");
    out.write("  HETZER CORE - MODULE INSTALLATION WIZARD: cognee\n");
    out.write("================================================================================\n");
    out.write("The Cognee module requires an LLM for memory graph extraction & vector embeddings.\n\n");
    out.write("Select the LLM connection path for Cognee:\n");
    out.write("  [1] (Recommended) Local 9Router Gateway (http://host.docker.internal:20140/v1)\n");
    out.write("  [2] Local Ollama (100% Offline & Free at http://host.docker.internal:11434)\n");
    out.write("  [3] Direct Cloud Provider (OpenAI / OpenRouter / Anthropic)\n\n");

    const rl = readline.createInterface({ input, output: out });

    try {
        const choice = await askQuestion(rl, "Select option", "1");

        if (choice === "2") {
            out.write("\n-- Local Ollama Configuration --\n");
            const model = await askQuestion(rl, "Generation Model", "llama3.1:8b");
            const embedModel = await askQuestion(rl, "Embedding Model", "nomic-embed-text:latest");

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
                summary: `Configured with local Ollama (${model}, ${embedModel}).`,
            };
        }

        if (choice === "3") {
            out.write("\n-- Direct Cloud Provider Configuration --\n");
            const provider = await askQuestion(rl, "Provider (openai / openrouter / anthropic)", "openrouter");
            const model = await askQuestion(rl, "Model", provider === "openrouter" ? "openrouter/openai/gpt-4o-mini" : "openai/gpt-4o-mini");
            rl.close();

            const apiKey = await promptSecret(`Enter API Key for ${provider}: `, { input, output: out });

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
                summary: `Configured with provider ${provider} (${model}).`,
            };
        }

        // Default: 9Router
        out.write("\n-- Using Local 9Router Gateway --\n");
        const model = await askQuestion(rl, "Model in 9Router", "openai/gpt-4o-mini");
        envText = setEnvValue(envText, "COGNEE_LLM_PROVIDER", "openai");
        envText = setEnvValue(envText, "COGNEE_LLM_MODEL", model);
        envText = setEnvValue(envText, "COGNEE_LLM_ENDPOINT", "http://host.docker.internal:20140/v1");
        envText = setEnvValue(envText, "COGNEE_LLM_API_KEY", "hetzer-default");
        fs.writeFileSync(envFile, envText, "utf8");

        return {
            configured: true,
            mode: "9router",
            summary: `Configured via 9Router gateway (http://host.docker.internal:20140/v1, model: ${model}).`,
        };
    } finally {
        try { rl.close(); } catch { /* ignore */ }
    }
}
