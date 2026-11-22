import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Context: issue #1747. The BFF keeps its sign-in session in memory, so while
// golden-path-signin is on the BFF runs as one pod with no autoscaler until a
// shared session store lands; the frontend keeps its autoscaling. With sign-in
// off, both Deployments and both autoscalers render as before.

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
  "--set",
  "autoscaling.enabled=true",
  "--set",
  "autoscaling.minReplicas=2",
  "--set",
  "autoscaling.maxReplicas=5",
  "--set",
  "autoscaling.targetCPUUtilizationPercentage=80",
  "--set",
  "resources.requests.cpu=100m",
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
  );

test("with golden-path-signin on the BFF runs as one replica with no autoscaler, and the frontend keeps its autoscaler", async () => {
  const docs = await render(...workload, ...signinOn);
  expect(named(docs, "Deployment", "auth-bff")).toContain("\n  replicas: 1\n");
  expect(named(docs, "HorizontalPodAutoscaler", "auth-bff")).toBeUndefined();
  expect(named(docs, "Deployment", "auth-frontend")).not.toContain("replicas:");
  expect(named(docs, "HorizontalPodAutoscaler", "auth-frontend")).toBeDefined();
});

test("with golden-path-signin off both Deployments carry no replica count and both autoscalers render", async () => {
  const docs = await render(...workload);
  for (const name of ["auth-bff", "auth-frontend"]) {
    expect(named(docs, "Deployment", name)).not.toContain("replicas:");
    expect(named(docs, "HorizontalPodAutoscaler", name)).toBeDefined();
  }
});
