import fs from "node:fs";
import path from "node:path";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function toPascalCase(str) {
    return str
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
}

export function createModuleRecipe({
    root,
    moduleId,
    label,
    port = 8080,
    mcp = false,
    webUi = false,
}) {
    if (!moduleId || !ID_PATTERN.test(moduleId)) {
        throw new Error(`ID modul '${moduleId}' tidak valid. Gunakan lowercase kebab-case (contoh: my-service).`);
    }

    const moduleDir = path.resolve(root, "modules", moduleId);
    if (fs.existsSync(moduleDir)) {
        throw new Error(`Direktori modul sudah ada di: ${path.relative(root, moduleDir)}`);
    }

    const envPrefix = moduleId.toUpperCase().replace(/-/g, "_");
    const moduleLabel = label || toPascalCase(moduleId);
    const surface = webUi ? "iframe" : "headless";
    const portNum = parseInt(String(port), 10) || 8080;

    fs.mkdirSync(moduleDir, { recursive: true });

    // 1. Generate module.json
    const manifest = {
        schemaVersion: 1,
        id: moduleId,
        label: moduleLabel,
        version: "1",
        profile: moduleId,
        lifecycle: "compose",
        surface,
        defaultEnabled: false,
        requires: ["core"],
        composeFiles: [`docker-compose.${moduleId}.yml`],
        services: [
            {
                id: moduleId,
                label: moduleLabel,
                composeService: moduleId,
                surface,
                urlEnv: `${envPrefix}_URL`,
                portEnv: `${envPrefix}_PORT`,
                fallbackPort: portNum,
                healthPath: "/health",
                ...(mcp ? {
                    mcpServer: {
                        name: moduleId,
                        transport: "http",
                        path: "/mcp",
                    },
                } : {}),
            },
        ],
    };

    fs.writeFileSync(
        path.join(moduleDir, "module.json"),
        JSON.stringify(manifest, null, 2) + "\n",
        "utf8"
    );

    // 2. Generate docker-compose.<id>.yml
    const composeContent = `services:
  ${moduleId}:
    image: \${${envPrefix}_IMAGE:-${moduleId}:latest}
    profiles: [${moduleId}]
    restart: unless-stopped
    environment:
      SHADOW_INSTANCE_ENV: \${SHADOW_INSTANCE_ENV:-development}
    ports:
      - "\${SHADOW_BIND_ADDRESS:-127.0.0.1}:\${${envPrefix}_PORT:-${portNum}}:${portNum}"
    volumes:
      - ${moduleId}_data:/data
    extra_hosts:
      - "host.docker.internal:host-gateway"
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://127.0.0.1:${portNum}/health || exit 1"]
      interval: 20s
      timeout: 10s
      retries: 5
      start_period: 30s
    mem_limit: \${${envPrefix}_MEMORY_LIMIT:-2g}
    cpus: \${${envPrefix}_CPU_LIMIT:-1.5}

volumes:
  ${moduleId}_data:
`;

    fs.writeFileSync(
        path.join(moduleDir, `docker-compose.${moduleId}.yml`),
        composeContent,
        "utf8"
    );

    // 3. Generate README.md
    const readmeContent = `# Modul ${moduleLabel} (${moduleId})

Modul resep Shadow Core untuk \`${moduleId}\`.

## Konfigurasi Port & Environment
- Port Binding default: \`127.0.0.1:${portNum}\` (Environment variable: \`${envPrefix}_PORT\`)
- Resource Limit: RAM 2GB, CPU 1.5 core

## Cara Menjalankan
1. Validasi resep modul:
   \`\`\`bash
   shadow validate ${moduleId}
   \`\`\`
2. Aktifkan modul:
   \`\`\`bash
   shadow install ${moduleId}
   \`\`\`
3. Jalankan container:
   \`\`\`bash
   shadow up ${moduleId}
   \`\`\`
4. Lihat log & status:
   \`\`\`bash
   shadow logs ${moduleId}
   shadow status
   \`\`\`
`;

    fs.writeFileSync(path.join(moduleDir, "README.md"), readmeContent, "utf8");

    return {
        moduleId,
        moduleDir,
        manifestFile: path.join(moduleDir, "module.json"),
        composeFile: path.join(moduleDir, `docker-compose.${moduleId}.yml`),
        readmeFile: path.join(moduleDir, "README.md"),
    };
}
