// Docs: docs/decisions/0028-image-trust-authority.md (validation before any cluster is touched)
import { beforeEach, expect, test, vi } from "vitest";
import { catalogErrors } from "./catalog-errors.js";
import { k3dErrors } from "./k3d-errors.js";
import { imageListErrors } from "./approved.js";
import { overlayErrors } from "./overlay-errors.js";
import { orderedComponents, readinessErrors } from "./order.js";
import { policyErrors } from "./policy-validation.js";
import { registryAddressErrors } from "./registry-address.js";
import { validateRepository } from "./validate.js";
import type {
  Catalog,
  Component,
  Environment,
  Repository,
  Versions,
} from "./types.js";

// Factories, not automocks: the collaborators' real modules never load here.
vi.mock("./approved.js", () => ({ imageListErrors: vi.fn() }));
vi.mock("./catalog-errors.js", () => ({ catalogErrors: vi.fn() }));
vi.mock("./k3d-errors.js", () => ({ k3dErrors: vi.fn() }));
vi.mock("./order.js", () => ({
  orderedComponents: vi.fn(),
  readinessErrors: vi.fn(),
}));
vi.mock("./overlay-errors.js", () => ({ overlayErrors: vi.fn() }));
vi.mock("./policy-validation.js", () => ({ policyErrors: vi.fn() }));
vi.mock("./registry-address.js", () => ({ registryAddressErrors: vi.fn() }));

const sound = {
  name: "kore-registry",
  phase: "core",
  kind: "helm",
  namespace: "kore-system",
  timeout: "5m",
  version: "istio",
  chart: "infra/charts/registry",
  readiness: [{ kind: "deployment", name: "registry" }],
  dependencies: [],
} as unknown as Component;

const soundVersions = {
  kubernetes: "1.31.0",
  tools: { k3d: "5.7.0" },
  components: { istio: "1.23.0" },
} as unknown as Versions;

const soundEnvironment = {
  name: "local",
  provider: "k3d",
  kubeContext: "k3d-kore-local",
} as unknown as Environment;

/** A repository that passes every rule, with overrides applied. */
function repositoryWith(options: {
  components?: Component[];
  versions?: Partial<Versions>;
  environment?: Partial<Environment>;
}): Repository {
  const catalog = {
    components: options.components ?? [sound],
  } as unknown as Catalog;
  return {
    root: "/repo",
    versions: { ...soundVersions, ...options.versions },
    catalog,
    environment: { ...soundEnvironment, ...options.environment },
    approved: { images: [] },
    seeds: { seeds: [] },
    readiness: { version: 1, requirements: [] },
  } as unknown as Repository;
}

/** The message a rejected validation carries, or undefined when it passes. */
async function messageOf(repository: Repository): Promise<string | undefined> {
  try {
    await validateRepository(repository);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

beforeEach(() => {
  vi.mocked(catalogErrors).mockReturnValue([]);
  vi.mocked(k3dErrors).mockReturnValue([]);
  vi.mocked(overlayErrors).mockResolvedValue([]);
  vi.mocked(imageListErrors).mockResolvedValue([]);
  vi.mocked(policyErrors).mockResolvedValue([]);
  vi.mocked(readinessErrors).mockReturnValue([]);
  vi.mocked(registryAddressErrors).mockReturnValue([]);
  vi.mocked(orderedComponents).mockReturnValue([]);
});

test("a repository that passes every rule validates without throwing, and each collaborator checks it once", async () => {
  const repository = repositoryWith({});
  expect(await messageOf(repository)).toBeUndefined();
  expect(vi.mocked(k3dErrors).mock.calls).toEqual([
    [soundEnvironment, soundVersions],
  ]);
  expect(vi.mocked(catalogErrors).mock.calls).toEqual([
    [soundEnvironment, [sound]],
  ]);
  expect(vi.mocked(overlayErrors).mock.calls).toEqual([[repository]]);
  expect(vi.mocked(policyErrors).mock.calls).toEqual([[repository]]);
  expect(vi.mocked(readinessErrors).mock.calls).toEqual([[repository]]);
  expect(vi.mocked(registryAddressErrors).mock.calls).toEqual([[repository]]);
});

test("unsound version pins and sections are reported, each once", async () => {
  const repository = repositoryWith({
    versions: {
      kubernetes: "v1",
      tools: null as unknown as Record<string, string>,
      components: { istio: "latest" },
    },
  });
  expect(await messageOf(repository)).toBe(
    [
      "components.istio must be an exact semantic version",
      "versions.kubernetes must be an exact semantic version",
      "versions.tools must be an object of pinned versions",
    ].join("\n"),
  );
});

test("an invalid environment name, an unknown provider and a missing kube context are each named", async () => {
  const repository = repositoryWith({
    environment: { name: "Local", kubeContext: "" },
  });
  expect(await messageOf(repository)).toBe(
    ["environment.kubeContext is required", "environment.name is invalid"].join(
      "\n",
    ),
  );
});

test("an unknown provider gets the generic message, and a retired minikube one gets the migration message", async () => {
  const unknown = repositoryWith({
    environment: { provider: "gke" as unknown as Environment["provider"] },
  });
  expect(await messageOf(unknown)).toContain(
    "environment.provider must be k3d or managed",
  );
  const retired = repositoryWith({
    environment: { provider: "minikube" as unknown as Environment["provider"] },
  });
  const message = await messageOf(retired);
  expect(message).toContain(
    "environment.provider minikube is no longer supported; set environment.provider to k3d, add environment.k3d and remove environment.cluster (ADR 0076)",
  );
  expect(message).not.toContain("must be k3d or managed");
});

test("a managed environment's cluster below 2 CPUs or 4096 MB is refused, and a k3d overlay is not held to it", async () => {
  const managed = repositoryWith({
    environment: {
      name: "managed-example",
      provider: "managed",
      kubeContext: "managed",
      cluster: { cpus: 1, memoryMB: 2048 },
    } as unknown as Partial<Environment>,
  });
  expect(await messageOf(managed)).toBe(
    [
      "environment.cluster.cpus must be at least 2",
      "environment.cluster.memoryMB must be at least 4096",
    ].join("\n"),
  );
  expect(await messageOf(repositoryWith({}))).toBeUndefined();
});

test("a component with a bad name, phase, kind, namespace or timeout names each problem", async () => {
  const repository = repositoryWith({
    components: [
      {
        ...sound,
        name: "Bad Name",
        phase: "later",
        kind: "chart",
        namespace: "",
        timeout: "soon",
      } as unknown as Component,
    ],
  });
  expect(await messageOf(repository)).toBe(
    [
      "Bad Name: invalid kind",
      "Bad Name: invalid phase",
      "Bad Name: namespace and bounded timeout are required",
      "component has invalid name: Bad Name",
    ].join("\n"),
  );
});

test("a component needs a known version key, a readiness check, and a chart unless it is a manifest", async () => {
  const repository = repositoryWith({
    components: [
      {
        ...sound,
        version: "cilium",
        readiness: [],
        chart: undefined,
      } as unknown as Component,
    ],
  });
  expect(await messageOf(repository)).toBe(
    [
      "kore-registry: at least one readiness check is required",
      "kore-registry: chart is required",
      "kore-registry: unknown version key cilium",
    ].join("\n"),
  );
});

test("a forced conflict or a skipped wait needs a reason, and a manifest takes no helm options", async () => {
  const repository = repositoryWith({
    components: [
      {
        ...sound,
        helm: { forceConflicts: true, wait: false, reason: " " },
      } as unknown as Component,
      {
        ...sound,
        name: "kore-config",
        kind: "manifest",
        source: undefined,
        chart: undefined,
        helm: { wait: true },
      } as unknown as Component,
    ],
  });
  expect(await messageOf(repository)).toBe(
    [
      "kore-config: helm options do not apply to a manifest component",
      "kore-config: manifest source is required",
      "kore-registry: helm.forceConflicts requires a reason",
      "kore-registry: helm.wait false requires a reason",
    ].join("\n"),
  );
});

test("duplicate components, CRDs with two owners, and unknown dependencies are each reported", async () => {
  const repository = repositoryWith({
    components: [
      { ...sound, ownsCRDs: ["widgets.example.com"] } as unknown as Component,
      {
        ...sound,
        ownsCRDs: ["widgets.example.com"],
        dependencies: ["kore-ghost"],
      } as unknown as Component,
    ],
  });
  expect(await messageOf(repository)).toBe(
    [
      "CRD widgets.example.com has multiple owners: kore-registry and kore-registry",
      "duplicate component: kore-registry",
      "kore-registry: unknown dependency kore-ghost",
    ].join("\n"),
  );
});

test("a dependency cycle from the ordering unit is reported as the validation error", async () => {
  vi.mocked(orderedComponents).mockImplementation(() => {
    throw new Error("release dependency cycle includes: a, b");
  });
  expect(await messageOf(repositoryWith({}))).toBe(
    "release dependency cycle includes: a, b",
  );
});

test("the errors of every collaborator are merged, de-duplicated and sorted into one message", async () => {
  vi.mocked(k3dErrors).mockReturnValue(["k3d: bad cluster"]);
  vi.mocked(overlayErrors).mockResolvedValue([
    "overlay: missing file",
    "k3d: bad cluster",
  ]);
  vi.mocked(readinessErrors).mockReturnValue(["readiness: missing check"]);
  vi.mocked(registryAddressErrors).mockReturnValue(["registry: bad address"]);
  vi.mocked(imageListErrors).mockResolvedValue(["image: unpinned"]);
  vi.mocked(policyErrors).mockResolvedValue(["policy: unpromoted"]);
  expect(await messageOf(repositoryWith({}))).toBe(
    [
      "image: unpinned",
      "k3d: bad cluster",
      "overlay: missing file",
      "policy: unpromoted",
      "readiness: missing check",
      "registry: bad address",
    ].join("\n"),
  );
});
