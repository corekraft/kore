import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { findRoot } from "../../src/config/index.js";
import { localPlatform } from "../local-platform-support.js";

const platform = await localPlatform();

const run = promisify(execFile);
const goldenPath =
  "tools/kore/integration/app/fixtures/workload-default-render.golden.yaml";
const regenerate = `helm template reference apps/reference/charts/workload --set platform.gateway.hostname=${platform.domain} | sed 's/${platform.domain}/@PLATFORM_DOMAIN@/g' > ${goldenPath}`;

async function render(...set: string[]): Promise<string> {
  const chart = join(await findRoot(), "apps/reference/charts/workload");
  return (
    await run("helm", [
      "template",
      "reference",
      chart,
      "--set",
      `platform.gateway.hostname=${platform.domain}`,
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

test("a budget that allows no disruption is refused naming both values", async () => {
  for (const minAvailable of ["2", "3"]) {
    await expect(
      render(
        ...on,
        "--set",
        `podDisruptionBudget.minAvailable=${minAvailable}`,
      ),
    ).rejects.toThrow(/minAvailable.*minReplicas/);
  }
});

test("a budget below the minimum replicas renders", async () => {
  const out = await render(
    ...on,
    "--set",
    "autoscaling.minReplicas=3",
    "--set",
    "podDisruptionBudget.minAvailable=2",
  );
  expect(out).toMatch(/minAvailable: 2/);
});

test("maxUnavailable renders alone and must be at least one", async () => {
  const out = await render(
    ...on,
    "--set",
    "podDisruptionBudget.maxUnavailable=1",
  );
  expect(out).toMatch(/maxUnavailable: 1/);
  expect(out).not.toMatch(/minAvailable/);
  await expect(
    render(...on, "--set", "podDisruptionBudget.maxUnavailable=0"),
  ).rejects.toThrow(/maxUnavailable.*at least 1/);
});

test("minAvailable and maxUnavailable together are refused", async () => {
  await expect(
    render(
      ...on,
      "--set",
      "podDisruptionBudget.minAvailable=1",
      "--set",
      "podDisruptionBudget.maxUnavailable=1",
    ),
  ).rejects.toThrow(/minAvailable.*maxUnavailable/);
});

test("autoscaling without a cpu request is refused naming the value", async () => {
  await expect(
    render(...on, "--set", "resources.requests.cpu=null"),
  ).rejects.toThrow(/resources\.requests\.cpu/);
});

test("the default render is byte-identical to the golden render taken before autoscaling existed", async () => {
  // The golden holds the platform domain as a placeholder so it follows the overlay.
  const golden = (
    await readFile(join(await findRoot(), goldenPath), "utf8").catch(() => "")
  ).replaceAll("@PLATFORM_DOMAIN@", platform.domain);
  expect(
    await render(),
    `the default workload render changed; if intended, regenerate with: ${regenerate}`,
  ).toBe(golden);
});
