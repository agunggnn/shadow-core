import assert from "node:assert/strict";
import test from "node:test";

import { parseEnv } from "./env.mjs";

test("parseEnv handles comments, quotes, empty values, and embedded equals", () => {
    assert.deepEqual(parseEnv(`# ignored\nPORT=20150\nTOKEN="a=b"\nEMPTY=\n`), {
        PORT: "20150",
        TOKEN: "a=b",
        EMPTY: "",
    });
});
