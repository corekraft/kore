// The unit tier starts no process and reads no built bundle (ADR 0098). The chart and
// container checks run real helm and docker, so they live in this integration tier and
// run only when opted in (test:upstream-charts, test:container-smoke). Docs: infra/plans/14-test-tiers.md.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const kore = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const unitSpecs = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return unitSpecs(path);
    }
    return entry.name.endsWith(".spec.ts") &&
      !entry.name.endsWith(".live.spec.ts")
      ? [path]
      : [];
  });

// A unit spec that imports a real child_process, the chart renderer (which runs helm), or
// reads the built harness bundle starts a process or reads the bundle.
const reasons = (text: string): string[] => {
  const found: string[] = [];
  if (
    /^import(?! type)[^;]*from ["'](?:node:)?child_process["']/m.test(text) &&
    !/vi\.mock\(["'](?:node:)?child_process["']/.test(text)
  ) {
    found.push("imports child_process unmocked");
  }
  if (/from ["'][^"']*upstream(?:-support|\.live)(?:\.js)?["']/.test(text)) {
    found.push("imports the chart renderer, which runs helm");
  }
  if (/readFile(?:Sync)?\([^)]*harness\.mjs/.test(text)) {
    found.push("reads the built harness bundle");
  }
  return found;
};

const MOVED_TO_INTEGRATION = [
  "integration/images/approved-images-upstream.spec.ts",
  "integration/platform/container-smoke.docker.spec.ts",
  "integration/platform/crd-ownership-upstream.spec.ts",
  "integration/platform/policy-controller-upstream.spec.ts",
  "integration/platform/probe-patch-upstream.spec.ts",
  "integration/platform/rollout-upstream.spec.ts",
  "integration/platform/ztunnel-render.spec.ts",
];

const LEFT_IN_SRC = [
  "src/images/approved-images-upstream.spec.ts",
  "src/platform/container-smoke.docker.spec.ts",
  "src/platform/crd-ownership-upstream.spec.ts",
  "src/platform/policy-controller-upstream.spec.ts",
  "src/platform/probe-patch-upstream.spec.ts",
  "src/platform/rollout-upstream.spec.ts",
];

it("starts no process and reads no bundle in any unit spec", () => {
  const offenders = unitSpecs(join(kore, "src")).flatMap((file) =>
    reasons(readFileSync(file, "utf8")).map(
      (reason) => `${relative(kore, file)}: ${reason}`,
    ),
  );

  expect(offenders).toEqual([]);
});

it("runs the chart and container checks from the integration tier, opt-in only", () => {
  for (const file of MOVED_TO_INTEGRATION) {
    expect(existsSync(join(kore, file)), file).toBe(true);
  }
  for (const file of LEFT_IN_SRC) {
    expect(existsSync(join(kore, file)), file).toBe(false);
  }
  const scripts = (
    JSON.parse(readFileSync(join(kore, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    }
  ).scripts;

  expect(scripts["test:upstream-charts"]).toMatch(
    /^KORE_CHECK_UPSTREAM_CHARTS=1 vitest run --config vitest\.integration\.config\.ts /,
  );
  expect(scripts["test:container-smoke"]).toBe(
    "KORE_CHECK_CONTAINER_SMOKE=1 vitest run --config vitest.integration.config.ts integration/platform/container-smoke.docker.spec.ts",
  );
  const optIn = `${scripts["test:upstream-charts"]} ${scripts["test:container-smoke"]}`;
  for (const file of MOVED_TO_INTEGRATION) {
    expect(optIn, file).toContain(file);
  }
});
