import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { findRoot } from "./config.js";

test("OPA authorizer loads the policy file once", async () => {
  const root = await findRoot();
  const template = await readFile(join(root, "infra/charts/opa-authorizer/templates/all.yaml"), "utf8");
  assert.match(template, /- \/policies\/policy\.rego/);
  assert.doesNotMatch(template, /- \/policies\n/);
});
