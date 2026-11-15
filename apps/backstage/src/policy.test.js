import assert from "node:assert/strict";
import { test } from "node:test";
import { decide, OPERATORS_GROUP } from "./policy.js";

test("a member of the platform-operators group is allowed", () => {
  assert.equal(decide(["user:default/ada", OPERATORS_GROUP]), "ALLOW");
});

test("a signed-in user outside the group is denied", () => {
  assert.equal(decide(["user:default/ada", "group:default/other"]), "DENY");
});

test("a request with no identity is denied", () => {
  assert.equal(decide(undefined), "DENY");
  assert.equal(decide([]), "DENY");
});

test("a similarly named group is not the operators group", () => {
  assert.equal(decide(["group:default/platform-operators-x"]), "DENY");
  assert.equal(decide(["group:other/platform-operators"]), "DENY");
});
