import { deriveKey, generateMasterKey } from "../cli/vault/hetzer-vault.mjs";
import crypto from "node:crypto";

function encryptSecret(masterKey, plaintext, aad) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(deriveKey(masterKey), "hex"), iv);
    cipher.setAAD(Buffer.from(aad));
    const encrypted = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
    return `${iv.toString("base64")}.${encrypted.toString("base64")}.${cipher.getAuthTag().toString("base64")}`;
}

const key = generateMasterKey();
const iterations = 50000;
const start = process.hrtime.bigint();
for (let i = 0; i < iterations; i++) {
    encryptSecret(key, `secret-value-${i}`, "aad-context");
}
const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
console.log(`${iterations} encrypt+IV+auth-tag ops: ${elapsed.toFixed(1)} ms`);
console.log(`Per-op: ${(elapsed / iterations * 1000).toFixed(2)} µs`);
