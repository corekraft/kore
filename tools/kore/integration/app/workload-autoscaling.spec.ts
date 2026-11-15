import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";

const run = promisify(execFile);

async function render(...set: string[]): Promise<string> {
  const chart = join(await findRoot(), "apps/reference/charts/workload");
  return (
    await run("helm", [
      "template",
      "reference",
      chart,
      "--set",
      "platform.gateway.hostname=kore.local",
      ...set,
    ])
  ).stdout;
}

const on = [
  "--set",
  "autoscaling.enabled=true",
  "--set",
  "podDisruptionBudget.enabled=true",
];

test("defaults render no autoscaler or disruption budget and keep one replica", async () => {
  const plain = await render();
  expect(plain).not.toContain("HorizontalPodAutoscaler");
  expect(plain).not.toContain("PodDisruptionBudget");
  expect(plain.match(/^ {2}replicas: 1$/gm)).toHaveLength(2);
});

test("enabled values render a CPU autoscaler of at least two replicas and a budget per component", async () => {
  const out = await render(...on);
  expect(out.match(/kind: HorizontalPodAutoscaler/g)).toHaveLength(2);
  expect(out.match(/kind: PodDisruptionBudget/g)).toHaveLength(2);
  expect(out).toContain("minReplicas: 2");
  expect(out).toMatch(/name: cpu/);
  expect(out).toMatch(/averageUtilization: 80/);
  expect(out).toMatch(/minAvailable: 1/);
});

test("autoscaling leaves the Deployment replica count to the autoscaler", async () => {
  const out = await render(...on);
  expect(out).not.toMatch(/^ {2}replicas:/m);
});

test("a minimum below two replicas is refused with the fix", async () => {
  await expect(
    render(...on, "--set", "autoscaling.minReplicas=1"),
  ).rejects.toThrow(/at least 2/);
});

test("a disruption budget without autoscaling is refused with the fix", async () => {
  await expect(
    render("--set", "podDisruptionBudget.enabled=true"),
  ).rejects.toThrow(/autoscaling\.enabled/);
});

test("a maximum below the minimum is refused with the fix", async () => {
  await expect(
    render(...on, "--set", "autoscaling.maxReplicas=1"),
  ).rejects.toThrow(/maxReplicas/);
});
