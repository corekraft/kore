import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, test } from "vitest";
import { findRoot } from "../../src/config/config.js";

// Docs: docs/decisions/0059-identity-policy-evidence.md
// OPA loads the chart bundle with `--bundle /bundle` and exits on a bundle it
// cannot load, so the authorizer pod never becomes ready and the Istio
// provider (failOpen: false) denies the protected route. `opa eval` uses the
// same bundle loader, so these cases prove that load behavior without a cluster.
const run = promisify(execFile);
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

async function copyBundle(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "kore-bundle-"));
  temporary.push(dir);
  await cp(join(await findRoot(), "infra/charts/opa-authorizer/bundle"), dir, {
    recursive: true,
  });
  return dir;
}

async function evaluate(bundle: string, input: unknown) {
  const inputFile = join(bundle, "..", `${bundle.split("/").pop()}.input.json`);
  await writeFile(inputFile, JSON.stringify(input));
  temporary.push(inputFile);
  return run("opa", [
    "eval",
    "--format",
    "json",
    "--bundle",
    bundle,
    "--input",
    inputFile,
    "data.envoy.authz.allow",
  ]);
}

const protectedRequest = (role: string) => ({
  attributes: {
    request: {
      http: {
        path: "/api/protected",
        headers: {
          "x-kore-authenticated-role": role,
          "x-forwarded-client-cert":
            "URI=spiffe://cluster.local/ns/app/sa/reference-frontend",
        },
      },
    },
  },
});

function allowed(stdout: string): unknown {
  const result = JSON.parse(stdout) as {
    result?: { expressions: { value: unknown }[] }[];
  };
  return result.result?.[0]?.expressions[0]?.value;
}

test("the deployed bundle loads and decides: allow, deny, and deny when the input is missing", async () => {
  const bundle = await copyBundle();
  assert.equal(
    allowed((await evaluate(bundle, protectedRequest("developer"))).stdout),
    true,
  );
  assert.equal(
    allowed((await evaluate(bundle, protectedRequest("viewer"))).stdout),
    false,
  );
  assert.equal(allowed((await evaluate(bundle, {})).stdout), false);
});

test("a bundle with invalid Rego fails to load instead of answering", async () => {
  const bundle = await copyBundle();
  await writeFile(
    join(bundle, "policy.rego"),
    "package envoy.authz\nallow if {",
  );
  await assert.rejects(evaluate(bundle, protectedRequest("developer")));
});

test("a bundle whose packages fall outside its manifest roots fails to load", async () => {
  const bundle = await copyBundle();
  await writeFile(
    join(bundle, "extra.rego"),
    "package other\nimport rego.v1\nallow := true\n",
  );
  await assert.rejects(evaluate(bundle, protectedRequest("developer")));
});

test("a bundle that no longer defines the decision denies rather than allows", async () => {
  const bundle = await copyBundle();
  await writeFile(join(bundle, "policy.rego"), "package envoy.authz\n");
  const { stdout } = await evaluate(bundle, protectedRequest("developer"));
  assert.notEqual(allowed(stdout), true);
});
