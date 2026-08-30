import assert from "node:assert/strict";
import test from "node:test";

import { parseDockerJson } from "./docker.mjs";

test("parseDockerJson accepts arrays and JSON lines", () => {
    assert.deepEqual(parseDockerJson('[{"Service":"one"}]'), [{ Service: "one" }]);
    assert.deepEqual(parseDockerJson('{"Service":"one"}\ninvalid\n{"Service":"two"}'), [
        { Service: "one" },
        { Service: "two" },
    ]);
});
