export function parseDockerJson(stdout) {
    const source = String(stdout || "").trim();
    if (!source) return [];
    try {
        const value = JSON.parse(source);
        return Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
    } catch {
        return source.split(/\r?\n/).flatMap((line) => {
            try {
                const value = JSON.parse(line);
                return value && typeof value === "object" ? [value] : [];
            } catch {
                return [];
            }
        });
    }
}
