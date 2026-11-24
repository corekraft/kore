import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0154-workloads-run-two-replicas-roll-out-one-surge-pod-at-a-time-and-keep-a-disruption-budget.md
// While golden-path-safety-defaults is on, the golden-path ApplicationSet passes
// safetyDefaults=true and each workload renders two replicas (unless sign-in
// keeps the BFF at one), an explicit rolling update, a PodDisruptionBudget, its
// own readiness endpoint, and the termination settings. Off, every render is the
// render it was before.

const run = promisify(execFile);
const frontend = `ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}`;
const bff = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:${"b".repeat(64)}`;
const revision = "c".repeat(40);
const golden =
  "tools/kore/integration/config/fixtures/golden-path-workload-default.golden.yaml";
const flagOnGolden =
  "tools/kore/integration/config/fixtures/golden-path-workload-safety-defaults.golden.yaml";
const lockEntries = JSON.stringify({
  "static-frontend": {
    image: "ghcr.io/corekraft/kore/static-frontend-template",
    digest: `sha256:${"a".repeat(64)}`,
  },
  "kotlin-bff": {
    image: "ghcr.io/corekraft/kore/kotlin-bff-template",
    digest: `sha256:${"b".repeat(64)}`,
  },
});

async function helm(chart: string, ...set: string[]): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    chart,
    join(root, "infra/charts", chart),
    ...set,
  ]);
  return stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc));
}

const workload = (...set: string[]) =>
  helm(
    "golden-path-workload",
    "--set",
    "service=auth",
    "--set",
    `frontend.image=${frontend}`,
    "--set",
    `bff.image=${bff}`,
    ...set,
  );

const delivery = (...set: string[]) =>
  helm(
    "golden-path-delivery",
    "--set",
    "repoURL=https://github.com/corekraft/kore.git",
    "--set",
    `revision=${revision}`,
    "--set",
    "environment=local",
    "--set-json",
    `templateImages=${lockEntries}`,
    ...set,
  );

const safe = ["--set", "safetyDefaults=true"];
const autoscaling = [
  "--set",
  "autoscaling.enabled=true",
  "--set",
  "resources.requests.cpu=100m",
];
const signin = [
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

test("with safety defaults off the workload render is byte-identical to the golden render, so no replica, rollout or budget change reaches the cluster", async () => {
  const root = await findRoot();
  const docs = await workload("--set", "safetyDefaults=false");
  assert.equal(
    docs.join("\n---\n").trimEnd(),
    (await readFile(join(root, golden), "utf8")).trimEnd(),
  );
});

test("with safety defaults on the render is byte-identical to its golden fixture, so a missing budget or probe change cannot recur unnoticed", async () => {
  const root = await findRoot();
  const docs = await workload(...safe);
  assert.equal(
    docs.join("\n---\n").trimEnd(),
    (await readFile(join(root, flagOnGolden), "utf8")).trimEnd(),
  );
});

test("with safety defaults on each Deployment runs two replicas when autoscaling is off", async () => {
  const docs = await workload(...safe);
  for (const name of ["auth-bff", "auth-frontend"]) {
    expect(named(docs, "Deployment", name), name).toContain(
      "\n  replicas: 2\n",
    );
  }
});

test("with safety defaults on each Deployment rolls out with zero unavailable and one surge pod, and paces readiness and its deadline", async () => {
  const docs = await workload(...safe);
  for (const name of ["auth-bff", "auth-frontend"]) {
    const deployment = named(docs, "Deployment", name);
    expect(deployment, name).toContain(
      "\n  minReadySeconds: 10\n  progressDeadlineSeconds: 600\n  strategy:\n    type: RollingUpdate\n    rollingUpdate:\n      maxSurge: 1\n      maxUnavailable: 0\n  selector:",
    );
  }
});

test("with safety defaults on each workload has a PodDisruptionBudget that allows one pod down and selects only its own pods", async () => {
  const docs = await workload(...safe);
  for (const name of ["auth-bff", "auth-frontend"]) {
    const budget = named(docs, "PodDisruptionBudget", name)!;
    expect(budget, name).toContain("apiVersion: policy/v1\n");
    expect(budget, name).toContain(
      `\nspec:\n  maxUnavailable: 1\n  selector:\n    matchLabels:\n      app.kubernetes.io/name: ${name}\n`,
    );
  }
});

test("with safety defaults on the BFF's readiness and liveness are its own health groups, and the frontend keeps /healthz for both", async () => {
  const docs = await workload(...safe);
  const bffDoc = named(docs, "Deployment", "auth-bff")!;
  expect(bffDoc).toContain(
    "readinessProbe:\n            httpGet: { path: /actuator/health/readiness, port: http }\n",
  );
  expect(bffDoc).toContain(
    "livenessProbe:\n            httpGet: { path: /actuator/health/liveness, port: http }\n",
  );
  const frontendDoc = named(docs, "Deployment", "auth-frontend")!;
  expect(frontendDoc).toContain(
    "readinessProbe:\n            httpGet: { path: /healthz, port: http }\n",
  );
  expect(frontendDoc).toContain(
    "livenessProbe:\n            httpGet: { path: /healthz, port: http }\n",
  );
});

test("with safety defaults on each pod has a termination grace period and a preStop sleep, so the gateway drops its endpoint before SIGTERM", async () => {
  const docs = await workload(...safe);
  for (const name of ["auth-bff", "auth-frontend"]) {
    const deployment = named(docs, "Deployment", name)!;
    expect(deployment, name).toContain(
      "\n      terminationGracePeriodSeconds: 30\n",
    );
    expect(deployment, name).toContain(
      "\n          lifecycle:\n            preStop:\n              sleep:\n                seconds: 10\n",
    );
  }
});

test("with safety defaults on and autoscaling on, the Deployments carry no replica count, the autoscaler keeps its minimum of two, and the budget still renders", async () => {
  const docs = await workload(...safe, ...autoscaling);
  for (const name of ["auth-bff", "auth-frontend"]) {
    expect(named(docs, "Deployment", name), name).not.toMatch(/\n  replicas:/);
    expect(named(docs, "HorizontalPodAutoscaler", name), name).toContain(
      "minReplicas: 2",
    );
    expect(named(docs, "PodDisruptionBudget", name), name).toBeDefined();
  }
});

test("with safety defaults on and golden-path-signin on, the BFF runs two replicas like the frontend, since its sign-in session is in the shared database (issue 1841)", async () => {
  const docs = await workload(...safe, ...signin);
  for (const name of ["auth-bff", "auth-frontend"]) {
    expect(named(docs, "Deployment", name), name).toContain(
      "\n  replicas: 2\n",
    );
  }
});

test("with safety defaults on a termination grace period no longer than the preStop sleep is refused, since the pod would be killed mid-sleep", async () => {
  await expect(
    workload(
      ...safe,
      "--set",
      "rolloutDefaults.terminationGracePeriodSeconds=10",
    ),
  ).rejects.toThrow(/terminationGracePeriodSeconds/);
});

test("with safety defaults on a minimum below two replicas is still refused with the fix", async () => {
  await expect(
    workload(...safe, ...autoscaling, "--set", "autoscaling.minReplicas=1"),
  ).rejects.toThrow(/at least 2/);
});

test("the ApplicationSet passes safetyDefaults to each workload only while golden-path-safety-defaults is on", async () => {
  const on = (await delivery("--set", "safetyDefaults=true"))[0]!;
  assert.match(on, /name: safetyDefaults\s+value: "true"/);
  const off = (await delivery())[0]!;
  assert.doesNotMatch(off, /safetyDefaults/);
});
