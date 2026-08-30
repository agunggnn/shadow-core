#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const [sourceArg, outputArg] = process.argv.slice(2);
if (!sourceArg || !outputArg) {
    console.error("Usage: node vault/snapshot.mjs <source.db> <snapshot.db>");
    process.exit(2);
}

const source = path.resolve(sourceArg);
const output = path.resolve(outputArg);
if (!fs.existsSync(source)) {
    console.error(`Vault database not found: ${source}`);
    process.exit(1);
}
if (fs.existsSync(output)) {
    console.error(`Snapshot target already exists: ${output}`);
    process.exit(1);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
    const escaped = output.replaceAll("'", "''");
    db.exec(`VACUUM INTO '${escaped}'`);
} finally {
    db.close();
}
