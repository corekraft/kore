import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: infra/catalog/compatibility.md (the Keycloak operator's startup probe, issue 2011)

// The operator Deployment's startupProbe, rendered with the failure threshold
// unset and set (issue 2011). No cluster: helm template only.

const run = promisify(execFile);
const digest = `sha256:${"a".repeat(64)}`;

async function render(...extra: string[]): Promise<string> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "keycloak-operator",
    join(root, "infra/charts/keycloak-operator"),
    "--set",
    `operator.image=quay.io/keycloak/keycloak-operator:26.8.2@${digest}`,
    "--set",
    `keycloak.image=quay.io/keycloak/keycloak:26.8.2@${digest}`,
    ...extra,
  ]);
  return stdout;
}

function deployment(manifests: string): string {
  const found = manifests
    .split(/^---$/m)
    .find((document) => /^kind: Deployment$/m.test(document));
  assert.notEqual(
    found,
    undefined,
    "the chart renders the operator Deployment",
  );
  return found!;
}

function startupProbe(manifests: string): string {
  const text = deployment(manifests);
  const at = text.indexOf("startupProbe:");
  assert.notEqual(at, -1, "the operator Deployment has a startupProbe");
  return text.slice(at, at + 400);
}

test("with the failure threshold unset the startup probe keeps upstream's threshold of 3", async () => {
  assert.match(
    startupProbe(await render()),
    /startupProbe:\n\s+failureThreshold: 3\n/,
  );
});

test("with the failure threshold set the startup probe takes it and keeps upstream's period and delay", async () => {
  const probe = startupProbe(
    await render("--set", "operator.startupProbe.failureThreshold=30"),
  );
  assert.match(probe, /startupProbe:\n\s+failureThreshold: 30\n/);
  assert.match(probe, /initialDelaySeconds: 5\n/);
  assert.match(probe, /periodSeconds: 10\n/);
});

test("the readiness probe keeps its threshold of 3 whatever the startup probe takes", async () => {
  const manifests = await render(
    "--set",
    "operator.startupProbe.failureThreshold=30",
  );
  assert.match(
    deployment(manifests),
    /readinessProbe:\n\s+failureThreshold: 3\n/,
  );
});

test("a threshold that is not a whole number of at least 1 is refused by the chart's schema", async () => {
  await assert.rejects(
    render("--set", "operator.startupProbe.failureThreshold=0"),
    /failureThreshold/,
  );
});
