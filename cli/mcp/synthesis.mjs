const EMPTY_SCHEMA = { type: "object", additionalProperties: false };

export function synthesizeServiceTools(service) {
    const definitions = [];
    if (service.healthPath) {
        definitions.push({
            name: `${service.id.replace(/-/g, "_")}_health`,
            title: `${service.label || service.id} health`,
            description: `Check the configured ${service.label || service.id} health endpoint.`,
            path: service.healthPath,
            inputSchema: EMPTY_SCHEMA,
        });
    }
    for (const tool of service.mcpTools || []) {
        definitions.push({
            ...tool,
            inputSchema: tool.inputSchema || EMPTY_SCHEMA,
        });
    }
    return definitions;
}

/**
 * @deprecated — use synthesizeServiceTools(service) with manifest-declared mcpTools.
 * Kept for one release for Cortex callers; logs a warning and delegates to the manifest path.
 */
export function synthesizeTargetTools(targetId) {
    if (typeof process !== "undefined" && process.emitWarning) {
        process.emitWarning(`synthesizeTargetTools('${targetId}') is deprecated — define mcpTools in module.json`, "DeprecationWarning");
    }
    if (["nine-router", "9router"].includes(targetId)) {
        return synthesizeServiceTools({ id: "9router", label: "9Router", healthPath: "/api/health" });
    }
    if (["project-forge", "projectforge"].includes(targetId)) {
        return synthesizeServiceTools({
            id: "projectforge",
            label: "ProjectForge",
            healthPath: "/api/health",
            mcpTools: [{
                name: "projectforge_workforce",
                title: "ProjectForge workforce",
                description: "Read persisted agent roles, assignments, and current execution state from ProjectForge.",
                path: "/api/workforce",
            }],
        });
    }
    if (["n8n", "n8n-automation"].includes(targetId)) {
        return synthesizeServiceTools({
            id: "n8n",
            label: "n8n Automation",
            healthPath: "/healthz",
            mcpTools: [
                {
                    name: "n8n_workflows",
                    title: "n8n workflows",
                    description: "Read active n8n automation workflows and webhook execution triggers.",
                    path: "/api/v1/workflows",
                    inputSchema: EMPTY_SCHEMA,
                },
                {
                    name: "n8n_trigger_webhook",
                    title: "n8n trigger webhook",
                    description: "Trigger an n8n webhook workflow with HTTP method and JSON payload.",
                    path: "/webhook",
                    inputSchema: {
                        type: "object",
                        properties: {
                            path: {
                                type: "string",
                                description: "Webhook path slug or URL suffix (e.g. 'my-webhook' or 'webhook/my-webhook' or 'webhook-test/my-webhook').",
                            },
                            method: {
                                type: "string",
                                enum: ["GET", "POST", "PUT", "PATCH", "DELETE"],
                                default: "POST",
                                description: "HTTP method to invoke the webhook (default: POST).",
                            },
                            payload: {
                                type: "object",
                                description: "Optional JSON payload object to send in the request body.",
                            },
                            headers: {
                                type: "object",
                                additionalProperties: { type: "string" },
                                description: "Optional custom HTTP headers to include with the request.",
                            },
                        },
                        required: ["path"],
                    },
                },
            ],
        });
    }
    return synthesizeServiceTools({ id: targetId, label: targetId, healthPath: "/health" });
}
