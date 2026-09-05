import fs from "node:fs";
import path from "node:path";

import { analyzeModuleSource } from "../core/reasoner.mjs";

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
    sourceUrl,
    description,
    envVars = [],
    volumes = [],
    healthPath = "/health",
    nonRootUid = null,
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
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(description ? { description } : {}),
        services: [
            {
                id: moduleId,
                label: moduleLabel,
                composeService: moduleId,
                surface,
                urlEnv: `${envPrefix}_URL`,
                portEnv: `${envPrefix}_PORT`,
                fallbackPort: portNum,
                healthPath: healthPath || "/health",
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
    const envEntries = [
        `      SHADOW_INSTANCE_ENV: \${SHADOW_INSTANCE_ENV:-development}`,
    ];
    for (const ev of envVars) {
        if (ev.name && !ev.name.includes("PORT") && !ev.name.includes("URL")) {
            const fallback = ev.isSecret ? "secretRef:" + moduleId + "-" + ev.name.toLowerCase().replace(/_/g, "-") : ev.defaultVal || "";
            envEntries.push(`      ${ev.name}: \${${ev.name}:-${fallback}}`);
        }
    }

    const volumeMounts = volumes.length > 0
        ? volumes.map((v) => `      - ${moduleId}_${v.hostVolume || "data"}:${v.containerPath || "/data"}`)
        : [`      - ${moduleId}_data:/data`];

    const volumeDefs = volumes.length > 0
        ? volumes.map((v) => `  ${moduleId}_${v.hostVolume || "data"}:`)
        : [`  ${moduleId}_data:`];

    const userLine = nonRootUid ? `\n    user: "${nonRootUid}:${nonRootUid}"` : "";

    const composeContent = `services:
  ${moduleId}:
    image: \${${envPrefix}_IMAGE:-${moduleId}:latest}
    profiles: [${moduleId}]
    restart: unless-stopped${userLine}
    environment:
${envEntries.join("\n")}
    ports:
      - "\${SHADOW_BIND_ADDRESS:-127.0.0.1}:\${${envPrefix}_PORT:-${portNum}}:${portNum}"
    volumes:
${volumeMounts.join("\n")}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://127.0.0.1:${portNum}${healthPath} || exit 1"]
      interval: 20s
      timeout: 10s
      retries: 5
      start_period: 30s
    mem_limit: \${${envPrefix}_MEMORY_LIMIT:-2g}
    cpus: \${${envPrefix}_CPU_LIMIT:-1.5}

volumes:
${volumeDefs.join("\n")}
`;

    fs.writeFileSync(
        path.join(moduleDir, `docker-compose.${moduleId}.yml`),
        composeContent,
        "utf8"
    );

    // 3. Generate README.md
    let readmeContent = `# Modul ${moduleLabel} (${moduleId})\n\n`;
    if (description) {
        readmeContent += `${description}\n\n`;
    }
    if (sourceUrl) {
        readmeContent += `## Upstream Source\n- Repository: [${sourceUrl}](${sourceUrl})\n\n`;
    }
    readmeContent += `## Konfigurasi Port & Environment
- Port Binding default: \`127.0.0.1:${portNum}\` (Environment variable: \`${envPrefix}_PORT\`)
- Resource Limit: RAM 2GB, CPU 1.5 core
`;

    if (mcp) {
        readmeContent += `\n## Dukungan MCP (Model Context Protocol)
Modul ini mengekspos endpoint MCP pada path \`/mcp\`.
- Cek tools yang tersedia:
  \`\`\`bash
  shadow mcp tools ${moduleId}
  \`\`\`
- Panggil tool langsung secara lokal:
  \`\`\`bash
  shadow mcp call ${moduleId} <tool_name> '{}'
  \`\`\`
`;
    }

    const secrets = envVars.filter((e) => e.isSecret);
    if (secrets.length > 0) {
        readmeContent += `\n## Pengaturan Kredensial Grimoire Vault\n`;
        for (const s of secrets) {
            const secretKey = `${moduleId}-${s.name.toLowerCase().replace(/_/g, "-")}`;
            readmeContent += `- Atur rahasia untuk \`${s.name}\`:\n  \`\`\`bash\n  shadow creds set ${secretKey}\n  \`\`\`\n`;
        }
    }

    readmeContent += `\n## Cara Menjalankan
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
        sourceUrl: sourceUrl || undefined,
    };
}

export async function createModuleRecipeFromSource({
    root,
    moduleId,
    source,
    label,
    port,
    mcp,
    webUi,
    fetchFn = globalThis.fetch,
}) {
    let sourceContent = "";
    let sourceUrl = "";
    if (source) {
        if (/^https?:\/\//i.test(source)) {
            sourceUrl = source;
            try {
                let fetchUrl = source;
                if (source.includes("github.com") && !source.includes("raw.githubusercontent.com")) {
                    const clean = source.replace(/\/+$/, "").replace(/\.git$/, "");
                    fetchUrl = `${clean.replace("github.com", "raw.githubusercontent.com")}/main/README.md`;
                }
                const res = await fetchFn(fetchUrl);
                if (res.ok) {
                    sourceContent = await res.text();
                } else if (fetchUrl !== source) {
                    const res2 = await fetchFn(source);
                    if (res2.ok) sourceContent = await res2.text();
                }
            } catch {
                // ignore fetch error
            }
        } else if (fs.existsSync(source)) {
            sourceContent = fs.readFileSync(source, "utf8");
            sourceUrl = path.basename(source);
        } else {
            sourceContent = source;
        }
    }

    const analysis = await analyzeModuleSource({
        sourceContent,
        sourceUrl,
        root,
        fetchFn,
    });

    return createModuleRecipe({
        root,
        moduleId,
        label: label || analysis.label,
        port: port || analysis.port,
        mcp: typeof mcp === "boolean" ? mcp : analysis.mcp,
        webUi: typeof webUi === "boolean" ? webUi : analysis.webUi,
        sourceUrl: sourceUrl || analysis.sourceUrl,
        description: analysis.description,
        envVars: analysis.envVars,
        volumes: analysis.volumes,
        healthPath: analysis.healthPath,
        nonRootUid: analysis.nonRootUid,
    });
}
