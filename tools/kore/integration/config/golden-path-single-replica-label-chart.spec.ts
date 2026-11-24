import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Context: issue #1526, decided on its comment 7126300541 (ADR 0154). The BFF is the one
// single-replica app workload while golden-path-signin is on, so the chart writes the label
// platform.kore.dev/single-replica: sign-in-bff on the BFF Deployment, and only then. The
// workload-defaults admission constraint reads that label to exempt the BFF from its replica
// rule alone. With sign-in off no Deployment carries the label.

const run = promisify(execFile);
const frontendImage = `ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}`;
const bff = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:${"b".repeat(64)}`;

async function render(...set: string[]): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "golden-path-workload",
    join(root, "infra/charts/golden-path-workload"),
    ...set,
  ]);
  return stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc));
}

const workload = [
  "--set",
  "service=auth",
  "--set",
  `frontend.image=${frontendImage}`,
  "--set",
  `bff.image=${bff}`,
];
const signinOn = [
  "--set",
  "ingress.host=auth.acme.kore.internal",
  "--set",
  "ingress.gatewayClassName=agentgateway",
  "--set",
  "ingress.issuer=kore-local-ca",
  "--set",
  "signin.enabled=true",
  "--set-string",
  "signin.issuerUri=https://keycloak.kore.internal/realms/platform",
];

const named = (docs: string[], kind: string, name: string) =>
  docs.find(
    (doc) =>
      new RegExp(`^kind: ${kind}$`, "m").test(doc) &&
      doc.includes(`\n  name: ${name}\n`),
  ) ?? "";

const label = "    platform.kore.dev/single-replica: sign-in-bff\n";

test("with golden-path-signin on the BFF Deployment carries the single-replica label, and the frontend does not", async () => {
  const docs = await render(...workload, ...signinOn);
  expect(named(docs, "Deployment", "auth-bff")).toContain(label);
  expect(named(docs, "Deployment", "auth-frontend")).not.toContain(
    "platform.kore.dev/single-replica",
  );
});

test("with golden-path-signin off no Deployment carries the single-replica label", async () => {
  const docs = await render(...workload);
  for (const name of ["auth-bff", "auth-frontend"]) {
    expect(named(docs, "Deployment", name)).not.toContain(
      "platform.kore.dev/single-replica",
    );
  }
});
