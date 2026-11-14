import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { chartCrds, helmChartComponents } from "./crd-render.js";
import { fakeRunner } from "./ops-support.js";

vi.mock("node:path");

const CRDS = [
  JSON.stringify({
    metadata: { name: "a.example.dev" },
    spec: { group: "example.dev", versions: [] },
  }),
  JSON.stringify({
    metadata: { name: "b.example.dev" },
    spec: { group: "example.dev", versions: [] },
  }),
].join("\n");

/** helm renders the chart; yq reads the CRDs out of what helm rendered. */
const cli = () =>
  fakeRunner((command) => (command === "helm" ? "rendered: yaml" : CRDS));

const component = {
  name: "demo",
  kind: "helm" as const,
  namespace: "demo-system",
  repository: "https://charts.example.dev",
  chart: "demo",
  values: ["infra/environments/common/values/demo.yaml"],
};

beforeEach(() => {
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
});

test("CRDs are rendered at the requested version with helm template and read with yq", async () => {
  const { runner, run } = cli();
  const crds = await chartCrds(runner, "/repo", component, "1.2.3");
  expect(crds.map((crd) => crd.metadata.name)).toEqual([
    "a.example.dev",
    "b.example.dev",
  ]);
  expect(run.mock.calls).toEqual([
    [
      "helm",
      [
        "template",
        "demo",
        "demo",
        "--namespace",
        "demo-system",
        "--include-crds",
        "--repo",
        "https://charts.example.dev",
        "--version",
        "1.2.3",
        "--values",
        "/repo/infra/environments/common/values/demo.yaml",
      ],
      { capture: true, cwd: "/repo" },
    ],
    [
      "yq",
      [
        "eval-all",
        "--output-format=json",
        "--indent=0",
        'select(.kind == "CustomResourceDefinition")',
      ],
      { capture: true, input: "rendered: yaml" },
    ],
  ]);
});

test("only template-style helm commands run, so nothing is installed", async () => {
  const { runner, run } = cli();
  await chartCrds(runner, "/repo", component, "1.2.3");
  const commands = run.mock.calls.map(([command, args]) => [command, args[0]]);
  expect(commands).toEqual([
    ["helm", "template"],
    ["yq", "eval-all"],
  ]);
});

test("an OCI chart is addressed by its repository URL without --repo", async () => {
  const { runner, run } = cli();
  await chartCrds(
    runner,
    "/repo",
    { ...component, repository: "oci://ghcr.io/x/demo" },
    "1.2.3",
  );
  const args = run.mock.calls[0]![1];
  expect(args.slice(0, 3)).toEqual([
    "template",
    "demo",
    "oci://ghcr.io/x/demo",
  ]);
  expect(args).not.toContain("--repo");
});

test("only remote helm charts are compared, because local charts change with the repository", () => {
  const picked = helmChartComponents([
    component,
    { ...component, name: "own", kind: "local-chart" as never },
  ]);
  expect(picked.map((c) => c.name)).toEqual(["demo"]);
});
