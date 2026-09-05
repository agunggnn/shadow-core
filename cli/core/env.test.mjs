import assert from "node:assert/strict";
import test from "node:test";
import { parseEnv } from "./env.mjs";

test("parseEnv strips quotes and ignores comments", () => {
    const text = `# comment
KEY="value"
SINGLE='hello'
EMPTY=
`;
    const env = parseEnv(text);
    assert.equal(env.KEY, "value");
    assert.equal(env.SINGLE, "hello");
    assert.equal(env.EMPTY, "");
    assert.equal(env.KEY_UNSET, undefined);
});

test("parseEnv handles embedded equals in value", () => {
    const text = `KEY=value=with=equals`;
    const env = parseEnv(text);
    assert.equal(env.KEY, "value=with=equals");
});

test("parseEnv handles spaces around separator", () => {
    const text = `KEY = value`;
    const env = parseEnv(text);
    assert.equal(env.KEY, "value");
});

test("parseEnv handles CRLF line endings", () => {
    const text = `KEY=value\r\nANOTHER=test`;
    const env = parseEnv(text);
    assert.equal(env.KEY, "value");
    assert.equal(env.ANOTHER, "test");
});

test("parseEnv returns empty object for empty/whitespace input", () => {
    assert.deepEqual(parseEnv(""), {});
    assert.deepEqual(parseEnv("   \n\n# comment\n"), {});
});