import assert from "node:assert/strict";
import test from "node:test";

import { verifyModuleDeployment } from "./verifier.mjs";

test("verifyModuleDeployment handles running healthy container", async () => {
    let output = "";
    const mockOut = { write: (c) => { output += c; } };
    const mockExec = (cmd, args) => {
        if (args.includes("inspect")) {
            return {
                status: 0,
                stdout: JSON.stringify([{ State: { Running: true, Status: "running", ExitCode: 0 } }]),
            };
        }
        if (args.includes("logs")) {
            return { status: 0, stdout: "Server running at http://0.0.0.0:8000\n" };
        }
        return { status: 0 };
    };

    const res = await verifyModuleDeployment({
        serviceId: "test-srv",
        exec: mockExec,
        out: mockOut,
        timeoutMs: 10,
    });

    assert.equal(res.ok, true);
    assert.match(output, /berhasil berjalan normal/);
});

test("verifyModuleDeployment detects failure and provides diagnosis", async () => {
    let output = "";
    const mockOut = { write: (c) => { output += c; } };
    const mockExec = (cmd, args) => {
        if (args.includes("inspect")) {
            return {
                status: 0,
                stdout: JSON.stringify([{ State: { Running: false, Status: "exited", ExitCode: 13 } }]),
            };
        }
        if (args.includes("logs")) {
            return { status: 0, stderr: "PermissionError: [Errno 13] Permission denied: '/data'\n" };
        }
        return { status: 0 };
    };

    const res = await verifyModuleDeployment({
        serviceId: "cognee-mcp",
        exec: mockExec,
        out: mockOut,
        timeoutMs: 10,
    });

    assert.equal(res.ok, false);
    assert.match(output, /Terdeteksi kendala saat menjalankan container/);
    assert.match(output, /Penyebab/);
});
