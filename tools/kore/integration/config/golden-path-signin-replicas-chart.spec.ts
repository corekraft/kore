import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Context: issue #1841 (for #1747). The BFF keeps its sign-in session in the
// database the platform PostgreSQL API claims for it (Spring Session JDBC), so
// with golden-path-signin on the BFF autoscales like the frontend, and the
// two-replica minimum guards it again. With sign-in off, both Deployments and
// both autoscalers render as before.

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

test("with golden-path-signin on both Deployments carry no replica count and both autoscalers render, so the signed-in BFF scales", async () => {
  const docs = await render(...workload, ...signinOn);
  for (const name of ["auth-bff", "auth-frontend"]) {
    expect(named(docs, "Deployment", name)).not.toContain("replicas:");
    expect(named(docs, "HorizontalPodAutoscaler", name)).toBeDefined();
  }
  expect(named(docs, "HorizontalPodAutoscaler", "auth-bff")).toContain(
    "minReplicas: 2\n",
  );
});

test("with golden-path-signin on a BFF autoscaler below two replicas is refused, naming minReplicas", async () => {
  const failure = await render(
    ...workload,
    ...signinOn,
    "--set",
    "autoscaling.minReplicas=1",
  ).then(
    () => "",
    (error: { stderr: string }) => error.stderr,
  );
  expect(failure).toContain("autoscaling.minReplicas must be at least 2");
});

test("with golden-path-signin off both Deployments carry no replica count and both autoscalers render", async () => {
  const docs = await render(...workload);
  for (const name of ["auth-bff", "auth-frontend"]) {
    expect(named(docs, "Deployment", name)).not.toContain("replicas:");
    expect(named(docs, "HorizontalPodAutoscaler", name)).toBeDefined();
  }
});
