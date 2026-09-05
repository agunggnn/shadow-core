import { parseEnv } from "./env.mjs";

const IMAGE_DIGEST_PATTERN = /@sha256:[a-f0-9]{64}$/i;

export const BUNDLED_IMAGE_UPDATES = Object.freeze([
    Object.freeze({
        moduleId: "9router",
        serviceId: "9router",
        variable: "NINE_ROUTER_IMAGE",
        version: "0.5.59",
        image: "ghcr.io/decolua/9router@sha256:a510ea0295d39680921c777619f2b476d02db2115426a944eb2785cbc8bd0699",
        replaces: Object.freeze([
            "ghcr.io/decolua/9router@sha256:f00fe389ef41a1999dd0d0275ad0c2955d13d176f7c4c5cb844b2f88c293c471",
        ]),
    }),
]);

function replaceEnvValue(text, name, value) {
    const line = `${name}=${value}`;
    const pattern = new RegExp(`^${name}=.*$`, "m");
    return pattern.test(text) ? text.replace(pattern, line) : `${text.trimEnd()}\n${line}\n`;
}

export function resolveLifecycleTarget(registry, requestedTarget) {
    const target = requestedTarget === "all" ? "*" : requestedTarget;
    if (target === "*") return target;
    if (registry.modules.some((module) => module.id === target)) return target;
    const service = registry.services.find((candidate) => candidate.id === target);
    if (service) return service.module.id;
    throw new Error(`Unknown module or service '${requestedTarget}'. Run 'shadow modules' to list available modules.`);
}

export function moduleIdsForProfiles(registry, profiles) {
    if (profiles.includes("*")) {
        return registry.modules
            .filter((module) => module.lifecycle === "compose")
            .map((module) => module.id);
    }
    const selected = new Set(profiles);
    return registry.modules
        .filter((module) => module.lifecycle === "compose" && selected.has(module.profile))
        .map((module) => module.id);
}

export function migrateBundledImagePins({ envText, moduleIds }) {
    const selected = new Set(moduleIds);
    const values = parseEnv(envText);
    const changes = [];
    const custom = [];
    let text = envText;

    for (const update of BUNDLED_IMAGE_UPDATES) {
        if (!selected.has(update.moduleId)) continue;
        const current = values[update.variable] || "";
        if (current === update.image) continue;
        if (current && !update.replaces.includes(current)) {
            if (!IMAGE_DIGEST_PATTERN.test(current)) {
                throw new Error(`${update.variable} must use an immutable @sha256 digest before it can be updated.`);
            }
            custom.push({ ...update, current });
            continue;
        }
        text = replaceEnvValue(text, update.variable, update.image);
        changes.push(update);
    }
    return { text, changes, custom };
}

export function updateComposeCommands(profiles, waitTimeoutSeconds = 300) {
    return [
        [...profiles, "pull", "--policy", "always", "--ignore-buildable"],
        [...profiles, "up", "-d", "--force-recreate", "--wait", "--wait-timeout", String(waitTimeoutSeconds)],
        [...profiles, "ps", "--all"],
    ];
}
