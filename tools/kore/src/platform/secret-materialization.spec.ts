import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../config/config.js";
import { loadRepository } from "../config/index.js";

// Docs: docs/decisions/0013-local-tls-before-gateway.md
// The platform-secrets store contract: the store the environment names is the
// store application charts reference, and the rendered ExternalSecret maps the
// source property to the target Secret key the workload reads.

const run = promisify(execFile);

async function render(chart: string, ...args: string[]): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "proof",
    join(root, chart),
    ...args,
  ]);
  return stdout.split(/^---$/m).filter((doc) => /^kind:/m.test(doc));
}

test("the reference ExternalSecret materializes the API token into the reference-app Secret", async () => {
  const repository = await loadRepository("local");
  const docs = await render(
    "apps/reference/charts/resources",
    "--set",
    `platform.secretStore=${repository.environment.secrets.storeName}`,
  );
  const external = docs.find((doc) => /^kind: ExternalSecret$/m.test(doc))!;
  assert.ok(external, "the resources chart must render an ExternalSecret");
  assert.match(external, /kind: ClusterSecretStore/);
  assert.match(external, /name: "platform-secrets"/);
  assert.match(external, /name: reference-app\n\s+template:/);
  assert.match(external, /secretKey: API_TOKEN/);
  assert.match(
    external,
    /remoteRef: \{ key: reference-app, property: API_TOKEN \}/,
  );
});

test("the workload reads the token from the Secret the ExternalSecret produces", async () => {
  const docs = await render(
    "apps/reference/charts/workload",
    "--set",
    "platform.gateway.hostname=kore.local",
  );
  const workloads = docs.filter((doc) => /^kind: Deployment$/m.test(doc));
  assert.ok(workloads.length > 0);
  for (const doc of workloads) {
    assert.match(
      doc,
      /\{name: API_TOKEN, valueFrom: \{secretKeyRef: \{name: reference-app, key: API_TOKEN\}\}\}/,
    );
  }
});

test("the rendered ExternalSecret and store carry no secret value", async () => {
  const docs = [
    ...(await render("apps/reference/charts/resources")),
    ...(await render(
      "infra/charts/platform-config",
      "--values",
      join(
        await findRoot(),
        "infra/environments/local/values/platform-config.yaml",
      ),
    )),
  ];
  for (const doc of docs) {
    assert.doesNotMatch(doc, /^kind: Secret$/m, "no plaintext Secret object");
    assert.doesNotMatch(doc, /stringData:/);
  }
});

test("the environment's store name is the ClusterSecretStore the platform-config chart creates", async () => {
  const repository = await loadRepository("local");
  const docs = await render(
    "infra/charts/platform-config",
    "--values",
    join(
      repository.root,
      "infra/environments/local/values/platform-config.yaml",
    ),
  );
  const store = docs.find((doc) => /^kind: ClusterSecretStore$/m.test(doc))!;
  assert.ok(store, "platform-config must render the ClusterSecretStore");
  assert.match(
    store,
    new RegExp(`name: ${repository.environment.secrets.storeName}\\n`),
  );
  assert.match(
    store,
    new RegExp(
      `remoteNamespace: ${repository.environment.secrets.sourceNamespace}`,
    ),
  );
});
