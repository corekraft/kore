import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

// Docs: docs/decisions/0047-autoscaling-metrics-server-then-keda.md
// The golden-path workload chart renders its CPU HorizontalPodAutoscaler only
// while autoscaling-defaults is on, through the autoscaling.enabled parameter
// the golden-path ApplicationSet passes.

const run = promisify(execFile);
const frontend = `ghcr.io/corekraft/kore/static-frontend-template@sha256:${"a".repeat(64)}`;
const bff = `ghcr.io/corekraft/kore/kotlin-bff-template@sha256:${"b".repeat(64)}`;
const golden =
  "tools/kore/integration/config/fixtures/golden-path-workload-default.golden.yaml";

async function render(...extra: string[]): Promise<string[]> {
  const root = await findRoot();
  const { stdout } = await run("helm", [
    "template",
    "golden-path-workload",
    join(root, "infra/charts/golden-path-workload"),
    "--set",
    "service=auth",
    "--set",
    `frontend.image=${frontend}`,
    "--set",
    `bff.image=${bff}`,
    ...extra,
  ]);
  return stdout.split("\n---\n").filter((doc) => /^kind:/m.test(doc));
}

const on = ["--set", "autoscaling.enabled=true"];
const deployments = (docs: string[]) =>
  docs.filter((doc) => /^kind: Deployment$/m.test(doc));
const autoscalers = (docs: string[]) =>
  docs.filter((doc) => /^kind: HorizontalPodAutoscaler$/m.test(doc));

test("with autoscaling off the render is byte-identical to the golden render taken before the autoscaler existed, so no autoscaler and no replica change reach the cluster", async () => {
  const root = await findRoot();
  const docs = await render();
  assert.equal(
    docs.join("\n---\n").trimEnd(),
    (await readFile(join(root, golden), "utf8")).trimEnd(),
  );
  expect(autoscalers(docs)).toHaveLength(0);
  expect(
    deployments(docs).filter((doc) => /^  replicas: 1$/m.test(doc)),
  ).toHaveLength(2);
});

test("with autoscaling on each workload gets a CPU autoscaler of two to five replicas targeting its own Deployment", async () => {
  const docs = await render(...on);
  const found = autoscalers(docs);
  expect(found).toHaveLength(2);
  for (const name of ["auth-bff", "auth-frontend"]) {
    const hpa = found.find((doc) => doc.includes(`name: ${name}\n`));
    expect(hpa, name).toBeDefined();
    expect(hpa).toMatch(
      /scaleTargetRef: \{apiVersion: apps\/v1, kind: Deployment, name: auth-(bff|frontend)\}/,
    );
    expect(hpa).toMatch(/minReplicas: 2/);
    expect(hpa).toMatch(/maxReplicas: 5/);
    expect(hpa).toMatch(/name: cpu/);
    expect(hpa).toMatch(/averageUtilization: 80/);
  }
});

test("with autoscaling on neither Deployment carries a replica count, so the autoscaler is the only owner of it", async () => {
  const docs = await render(...on);
  expect(deployments(docs)).toHaveLength(2);
  for (const doc of deployments(docs)) {
    expect(doc).not.toMatch(/^  replicas:/m);
  }
});

test("with autoscaling on each container requests the CPU the utilisation target is computed against", async () => {
  const docs = await render(...on);
  for (const doc of deployments(docs)) {
    expect(doc).toMatch(/resources:\n\s+requests:\n\s+cpu: "?100m"?/);
  }
});

test("a minimum below two replicas is refused with the fix", async () => {
  await expect(
    render(...on, "--set", "autoscaling.minReplicas=1"),
  ).rejects.toThrow(/at least 2/);
});

test("a maximum below the minimum is refused with the fix", async () => {
  await expect(
    render(...on, "--set", "autoscaling.maxReplicas=1"),
  ).rejects.toThrow(/maxReplicas/);
});

test("autoscaling without a cpu request is refused naming the value", async () => {
  await expect(
    render(...on, "--set", "resources.requests.cpu=null"),
  ).rejects.toThrow(/resources\.requests\.cpu/);
});
