import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { composeInvocation } from "./compose-runner.mjs";

const root = path.resolve(".");
const envFile = path.join(root, ".env.example");

test("core Compose invocation excludes the disabled Cognee recipe", () => {
    const invocation = composeInvocation({ root, envFile, composeArgs: ["--profile", "core", "config"] });
    const serialized = invocation.args.join(" ");
    assert.match(serialized, /docker-compose\.yml/);
    assert.doesNotMatch(serialized, /docker-compose\.cognee\.yml/);
    assert.ok(invocation.secretNames.includes("NINE_ROUTER_JWT_SECRET"));
    assert.ok(!invocation.secretNames.includes("COGNEE_LLM_API_KEY"));
});

test("Cognee profile includes only its declared public recipe", () => {
    const invocation = composeInvocation({
        root,
        envFile,
        composeArgs: ["--profile", "core", "--profile", "cognee", "config"],
    });
    assert.match(invocation.args.join(" "), /docker-compose\.cognee\.yml/);
    assert.ok(invocation.secretNames.includes("COGNEE_LLM_API_KEY"));
});
