// Docs: infra/plans/2-implementation.md#step-6-repository-and-local-cluster-foundation
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  absolute,
  componentValues,
  componentVersion,
  expandVersions,
  findRoot,
  loadRepository,
  orderedComponents as reexportedOrder,
  validateRepository as reexportedValidate,
} from "./config.js";
import { exists } from "./files.js";
import { orderedComponents } from "./order.js";
import { validateRepository } from "./validate.js";
import {
  fakeComponent,
  fakeEnvironment,
  fakeRepository,
  fakeVersions,
} from "./config-support.js";

vi.mock("node:fs/promises");
vi.mock("node:path");
// Factories, not automocks: the collaborators' real modules never load here.
vi.mock("./files.js", () => ({ exists: vi.fn() }));
vi.mock("./order.js", () => ({ orderedComponents: vi.fn() }));
vi.mock("./validate.js", () => ({ validateRepository: vi.fn() }));
// registryConsumers is a constant list: kept real so the test names its members.
vi.mock("./registry-address.js", () => ({
  registryConsumers: ["kore-registry", "kore-ui"],
}));

const repository = fakeRepository({
  versions: fakeVersions({ istio: "v1.2.0", kube: "1.31.0" }),
});

/** The files a local repository has on disk, by absolute path. */
const localFiles = (): Record<string, string> => ({
  "/repo/infra/catalog/versions.yaml": '{"components":{"istio":"v1.2.0"}}',
  "/repo/infra/catalog/seeds.yaml": '{"seeds":[]}',
  "/repo/infra/catalog/readiness.yaml": '{"checks":[]}',
  "/repo/infra/catalog/approved-images.yaml": '{"images":[]}',
  "/repo/infra/catalog/components.yaml": '{"components":[]}',
  "/repo/infra/environments/local/environment.yaml":
    '{"name":"local","componentValues":{}}',
});

/** The text of each file read in this test; a test edits its own copy. */
let files: Record<string, string> = {};

/** Only the listed paths exist. */
function filesPresent(...present: string[]): void {
  vi.mocked(exists).mockImplementation(async (path) => present.includes(path));
}

beforeEach(() => {
  files = localFiles();
  vi.stubEnv("KORE_ROOT", "");
  vi.mocked(join).mockImplementation((...parts: string[]) =>
    parts.join("/").replace(/\/+/g, "/"),
  );
  vi.mocked(resolve).mockImplementation((path: string) => path);
  vi.mocked(isAbsolute).mockImplementation((path: string) =>
    path.startsWith("/"),
  );
  vi.mocked(dirname).mockImplementation(
    (path: string) => path.slice(0, path.lastIndexOf("/")) || "/",
  );
  // The unit only ever reads string paths, built by join, so the cast is exact.
  vi.mocked(readFile).mockImplementation(async (path) => {
    const text = files[path as string];
    if (text === undefined) {
      throw Object.assign(new Error(`ENOENT ${path as string}`), {
        code: "ENOENT",
      });
    }
    return text;
  });
  vi.mocked(orderedComponents).mockReturnValue([]);
  vi.mocked(validateRepository).mockResolvedValue(undefined);
  filesPresent();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

test("the barrel re-exports the ordering and validation units themselves, not copies", () => {
  expect(reexportedOrder).toBe(orderedComponents);
  expect(reexportedValidate).toBe(validateRepository);
});

test("KORE_ROOT overrides the search and is resolved as given", async () => {
  vi.stubEnv("KORE_ROOT", "/checkout/kore");
  expect(await findRoot("/elsewhere")).toBe("/checkout/kore");
  expect(vi.mocked(exists).mock.calls).toEqual([]);
});

test("the root is the nearest ancestor that holds the component catalog", async () => {
  filesPresent("/work/kore/infra/catalog/components.yaml");
  expect(await findRoot("/work/kore/tools/kore")).toBe("/work/kore");
  expect(vi.mocked(exists).mock.calls).toEqual([
    ["/work/kore/tools/kore/infra/catalog/components.yaml"],
    ["/work/kore/tools/infra/catalog/components.yaml"],
    ["/work/kore/infra/catalog/components.yaml"],
  ]);
});

test("a directory outside any Kore repository fails and says how to point at one", async () => {
  await expect(findRoot("/nowhere/at/all")).rejects.toThrow(
    "not inside a Kore repository (set KORE_ROOT to override)",
  );
});

test("a pinned component version is the catalog version without its leading v; a local one has none", () => {
  const pinned = fakeComponent({ name: "istio", version: "istio" });
  const local = fakeComponent({ name: "kore-ui", version: "local" });
  const unknown = fakeComponent({ name: "kube", version: "kube-missing" });
  expect(componentVersion(repository, pinned)).toBe("1.2.0");
  expect(componentVersion(repository, local)).toBeUndefined();
  expect(componentVersion(repository, unknown)).toBeUndefined();
});

test("every version placeholder in a value is replaced by its catalog version, without its leading v", () => {
  expect(
    expandVersions(repository, "istio:${istio}/kube:${kube}/again:${istio}"),
  ).toBe("istio:1.2.0/kube:1.31.0/again:1.2.0");
  expect(expandVersions(repository, "no placeholders")).toBe("no placeholders");
});

test("an absolute path stays as it is, and a relative path is joined under the repository root", () => {
  expect(absolute(repository, "/etc/kore/values.yaml")).toBe(
    "/etc/kore/values.yaml",
  );
  expect(absolute(repository, "infra/charts/app/values.yaml")).toBe(
    "/repo/infra/charts/app/values.yaml",
  );
});

test("a component's value files are its own, then the environment's for that component, in that order", () => {
  const repo = fakeRepository({
    environment: fakeEnvironment({
      componentValues: { istio: ["infra/environments/local/istio.yaml"] },
    }),
  });
  const component = fakeComponent({
    name: "istio",
    values: ["infra/charts/istio/values.yaml"],
  });
  expect(componentValues(repo, component)).toEqual([
    "infra/charts/istio/values.yaml",
    "infra/environments/local/istio.yaml",
  ]);
  expect(componentValues(repo, fakeComponent({ name: "kube" }))).toEqual([]);
});

test("loading reads the six catalog and overlay files, validates the whole repository, and returns it", async () => {
  filesPresent("/repo/infra/catalog/components.yaml");
  const loaded = await loadRepository("local", "/repo");
  expect(loaded).toMatchObject({
    root: "/repo",
    versions: { components: { istio: "v1.2.0" } },
    environment: { name: "local", componentValues: {} },
    imageTrustValues: undefined,
    registryComponentValues: {},
  });
  expect(vi.mocked(validateRepository).mock.calls).toEqual([[loaded]]);
  expect(vi.mocked(readFile).mock.calls.map(([path]) => path)).toEqual([
    "/repo/infra/catalog/versions.yaml",
    "/repo/infra/catalog/seeds.yaml",
    "/repo/infra/catalog/readiness.yaml",
    "/repo/infra/catalog/approved-images.yaml",
    "/repo/infra/catalog/components.yaml",
    "/repo/infra/environments/local/environment.yaml",
  ]);
});

test("a file that is not JSON-compatible YAML fails loading, naming the file and the format rule", async () => {
  files["/repo/infra/catalog/seeds.yaml"] = "seeds: [unclosed";
  filesPresent("/repo/infra/catalog/components.yaml");
  await expect(loadRepository("local", "/repo")).rejects.toThrow(
    /^validate \/repo\/infra\/catalog\/seeds\.yaml: files must use JSON-compatible YAML/,
  );
  expect(vi.mocked(validateRepository).mock.calls).toEqual([]);
});

test("the image policy overlay is loaded when the environment names an existing file, and not otherwise", async () => {
  files["/repo/infra/environments/local/environment.yaml"] = JSON.stringify({
    name: "local",
    componentValues: { "kore-image-policy": ["infra/trust/local.json"] },
  });
  files["/repo/infra/trust/local.json"] = '{"trust":{"type":"key"}}';
  filesPresent(
    "/repo/infra/catalog/components.yaml",
    "/repo/infra/trust/local.json",
  );
  const loaded = await loadRepository("local", "/repo");
  expect(loaded.imageTrustValues).toEqual({ trust: { type: "key" } });
});

test("a registry consumer's overlays that exist are merged in order, later files winning", async () => {
  files["/repo/infra/environments/local/environment.yaml"] = JSON.stringify({
    name: "local",
    componentValues: {
      "kore-registry": ["infra/a.json", "infra/missing.json", "infra/b.json"],
    },
  });
  files["/repo/infra/a.json"] = '{"port":5000,"host":"a"}';
  files["/repo/infra/b.json"] = '{"host":"b"}';
  filesPresent(
    "/repo/infra/catalog/components.yaml",
    "/repo/infra/a.json",
    "/repo/infra/b.json",
  );
  const loaded = await loadRepository("local", "/repo");
  expect(loaded.registryComponentValues).toEqual({
    "kore-registry": { port: 5000, host: "b" },
  });
});
