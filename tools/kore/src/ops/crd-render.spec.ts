import assert from "node:assert/strict";
import { test } from "vitest";
import type { Runner, RunOptions, RunResult } from "../runtime/index.js";
import { chartCrds, helmChartComponents } from "./crd-render.js";

class Recorder implements Runner {
  calls: { command: string; args: readonly string[]; options?: RunOptions }[] =
    [];
  async run(
    command: string,
    args: readonly string[],
    options?: RunOptions,
  ): Promise<RunResult> {
    this.calls.push({ command, args, ...(options ? { options } : {}) });
    if (command === "helm") {
      return { stdout: "rendered: yaml", stderr: "", code: 0 };
    }
    const crd = {
      metadata: { name: "a.example.dev" },
      spec: { group: "example.dev", versions: [] },
    };
    return {
      stdout: `${JSON.stringify(crd)}\n${JSON.stringify({ ...crd, metadata: { name: "b.example.dev" } })}\n`,
      stderr: "",
      code: 0,
    };
  }
}

const component = {
  name: "demo",
  kind: "helm" as const,
  namespace: "demo-system",
  repository: "https://charts.example.dev",
  chart: "demo",
  values: ["infra/environments/common/values/demo.yaml"],
};

test("CRDs are rendered at the requested version with helm template and read with yq", async () => {
  const runner = new Recorder();
  const crds = await chartCrds(runner, "/repo", component, "1.2.3");
  assert.deepEqual(
    crds.map((crd) => crd.metadata.name),
    ["a.example.dev", "b.example.dev"],
  );
  const helm = runner.calls[0]!;
  assert.equal(helm.command, "helm");
  assert.deepEqual(helm.args.slice(0, 3), ["template", "demo", "demo"]);
  for (const flag of [
    "--include-crds",
    "--repo",
    "https://charts.example.dev",
    "--version",
    "1.2.3",
    "/repo/infra/environments/common/values/demo.yaml",
  ]) {
    assert.ok(helm.args.includes(flag), `helm template gets ${flag}`);
  }
  assert.equal(runner.calls[1]!.command, "yq");
  assert.equal(runner.calls[1]!.options?.input, "rendered: yaml");
});

test("only template-style helm commands run, so nothing is installed", async () => {
  const runner = new Recorder();
  await chartCrds(runner, "/repo", component, "1.2.3");
  assert.ok(
    runner.calls
      .filter((c) => c.command === "helm")
      .every((c) => c.args[0] === "template"),
  );
  assert.ok(
    runner.calls.every((c) => c.command === "helm" || c.command === "yq"),
  );
});

test("an OCI chart is addressed by its repository URL without --repo", async () => {
  const runner = new Recorder();
  await chartCrds(
    runner,
    "/repo",
    { ...component, repository: "oci://ghcr.io/x/demo" },
    "1.2.3",
  );
  const args = runner.calls[0]!.args;
  assert.equal(args[2], "oci://ghcr.io/x/demo");
  assert.ok(!args.includes("--repo"));
});

test("only remote helm charts are compared, because local charts change with the repository", () => {
  const picked = helmChartComponents([
    component,
    { ...component, name: "own", kind: "local-chart" as never },
  ]);
  assert.deepEqual(
    picked.map((c) => c.name),
    ["demo"],
  );
});
