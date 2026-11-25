import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { absolute, orderedComponents } from "../config/index.js";
import {
  envOption,
  helmEnv,
  helmTemplateArgs,
  manifestSource,
  withAbsoluteChart,
} from "./helm.js";
import { redactManifest } from "./render-redaction.js";
import { platformRender } from "./render.js";
import { composeSuborgDelivery } from "./suborg-delivery.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(), writeFile: vi.fn() }));
vi.mock("../config/index.js", () => ({
  absolute: vi.fn(),
  orderedComponents: vi.fn(),
}));
vi.mock("./helm.js", () => ({
  envOption: vi.fn(),
  helmEnv: vi.fn(),
  helmTemplateArgs: vi.fn(),
  manifestSource: vi.fn(),
  withAbsoluteChart: vi.fn(),
}));
vi.mock("./render-redaction.js", () => ({ redactManifest: vi.fn() }));
vi.mock("./suborg-delivery.js", () => ({ composeSuborgDelivery: vi.fn() }));

const repository = fakeRepository({}, "/repo");
const chart = fakeComponent({ name: "reference" });
const manifest = fakeComponent({ name: "crds", kind: "manifest" });

beforeEach(() => {
  vi.mocked(helmTemplateArgs).mockImplementation((_repo, component) => [
    "template",
    component.name,
  ]);
  vi.mocked(withAbsoluteChart).mockImplementation((_repo, _component, args) => [
    ...args,
  ]);
  vi.mocked(helmEnv).mockReturnValue(undefined);
  vi.mocked(envOption).mockReturnValue({});
  vi.mocked(manifestSource).mockReturnValue("/repo/manifests/crds");
  vi.mocked(absolute).mockImplementation((_repo, path) => `/abs/${path}`);
  vi.mocked(composeSuborgDelivery).mockImplementation(async (repo) => repo);
});

test("the render composes the Kore URL before it renders, so a read-only render gives each chart the URL up gives it", async () => {
  const composed = {
    ...repository,
    suborgDelivery: { repoURL: "https://github.com/corekraft/kore.git" },
  };
  vi.mocked(composeSuborgDelivery).mockResolvedValue(composed);
  vi.mocked(orderedComponents).mockReturnValue([chart]);
  const { runner } = fakeRunner(() => "");

  await platformRender(repository, runner);

  expect(composeSuborgDelivery).toHaveBeenCalledWith(repository, runner);
  expect(helmTemplateArgs).toHaveBeenCalledWith(composed, chart);
});

test("a chart is written to the output directory only after it is redacted, with owner-only permissions", async () => {
  vi.mocked(orderedComponents).mockReturnValue([chart]);
  vi.mocked(redactManifest).mockReturnValue("redacted-yaml");
  const { runner, run } = fakeRunner((command) =>
    command === "helm" ? "raw-secret-value" : "",
  );

  await platformRender(repository, runner, "rendered");

  expect(redactManifest).toHaveBeenCalledWith("raw-secret-value");
  expect(mkdir).toHaveBeenCalledWith("/abs/rendered", { recursive: true });
  expect(writeFile).toHaveBeenCalledWith(
    join("/abs/rendered", "reference.yaml"),
    "redacted-yaml",
    { mode: 0o600 },
  );
  expect(run).toHaveBeenLastCalledWith(
    "kubectl",
    ["apply", "--dry-run=client", "--validate=false", "--filename", "-"],
    { capture: true, input: "raw-secret-value" },
  );
});

test("without an output directory a chart is validated and nothing is created or written", async () => {
  vi.mocked(orderedComponents).mockReturnValue([chart]);
  const { runner, run } = fakeRunner();

  await platformRender(repository, runner);

  expect(absolute).not.toHaveBeenCalled();
  expect(mkdir).not.toHaveBeenCalled();
  expect(writeFile).not.toHaveBeenCalled();
  expect(redactManifest).not.toHaveBeenCalled();
  expect(run.mock.calls.map(([command]) => command)).toEqual([
    "helm",
    "kubectl",
  ]);
});

test("a manifest component is validated with a recursive client dry-run and never rendered through Helm", async () => {
  vi.mocked(orderedComponents).mockReturnValue([manifest]);
  const { runner, run } = fakeRunner();

  await platformRender(repository, runner);

  expect(run).toHaveBeenCalledTimes(1);
  expect(run).toHaveBeenCalledWith(
    "kubectl",
    [
      "apply",
      "--dry-run=client",
      "--validate=false",
      "--recursive",
      "--filename",
      "/repo/manifests/crds",
    ],
    { capture: true, cwd: "/repo" },
  );
});

test("every cluster call the render makes is a client dry-run, never an apply", async () => {
  vi.mocked(orderedComponents).mockReturnValue([chart, manifest]);
  const { runner, run } = fakeRunner();

  await platformRender(repository, runner);

  const kubectl = run.mock.calls.filter(([command]) => command === "kubectl");
  expect(kubectl).toHaveLength(2);
  for (const [, args] of kubectl) {
    expect(args).toContain("--dry-run=client");
    expect(args[0]).toBe("apply");
  }
});

test("components are rendered in the order the catalog gives them", async () => {
  const second = fakeComponent({ name: "cnpg" });
  vi.mocked(orderedComponents).mockReturnValue([chart, second]);
  const { runner, run } = fakeRunner();

  await platformRender(repository, runner);

  const helmCalls = run.mock.calls.filter(([command]) => command === "helm");
  expect(helmCalls.map(([, args]) => args)).toEqual([
    ["template", "reference"],
    ["template", "cnpg"],
  ]);
});
