import { beforeEach, expect, test, vi } from "vitest";
import { enabledComponents } from "../config/index.js";
import { enrollPlatformNamespaces } from "./enrollment.js";
import { managedNamespaces } from "./gated-release.js";
import {
  fakeComponent,
  fakeRepository,
  fakeRunner,
} from "./platform-support.js";

vi.mock("../config/index.js");
vi.mock("./gated-release.js");
vi.mock("./image-inventory.js", () => ({
  enrollmentLabel: "policy.sigstore.dev/include",
}));

// Docs: docs/decisions/0056-platform-image-inventory.md
// Enforce environments label catalog namespaces; audit ones never do.

interface Existing {
  name: string;
  labels?: Record<string, string>;
  /** The field manager that owns a namespace's metadata; helm when not kore's. */
  manager?: string;
}

const inclusion = "policy.sigstore.dev/include";
const ambient = "istio.io/dataplane-mode";
const enforce = fakeRepository({
  imageInventory: "enforce",
  enrollmentExemptions: { "cosign-system": "not signed" },
});
const audit = fakeRepository({ imageInventory: "audit" });

/** The cluster's namespaces, answering the list call with them and every apply with nothing. */
function cluster(existing: Existing[]) {
  return fakeRunner((_command, args) =>
    args.includes("get")
      ? JSON.stringify({
          items: existing.map((ns) => ({
            metadata: {
              name: ns.name,
              labels: ns.labels ?? {},
              managedFields: [{ manager: ns.manager ?? "helm" }],
            },
          })),
        })
      : "",
  );
}

/** Each apply the run made: its arguments and the namespace manifest it sent. */
function applies(run: ReturnType<typeof cluster>["run"]) {
  return run.mock.calls
    .filter(([, args]) => args.includes("apply"))
    .map(([, args, options]) => ({ args, input: options?.input ?? "" }));
}

const appliedName = ({ input }: { input: string }) =>
  /name: (\S+)/.exec(input)![1]!;

beforeEach(() => {
  vi.mocked(managedNamespaces).mockResolvedValue([]);
  vi.mocked(enabledComponents).mockReturnValue([]);
});

test("enforce labels each managed namespace except the exempt ones, with the context and the field manager", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue([
    "cosign-system",
    "kore-system",
    "reference",
  ]);
  const { runner, run } = cluster([
    { name: "cosign-system" },
    { name: "kore-system" },
    { name: "reference" },
  ]);
  await enrollPlatformNamespaces(enforce, runner);
  const applied = applies(run);
  expect(applied.map(appliedName)).toEqual(["kore-system", "reference"]);
  for (const { args, input } of applied) {
    expect(args).toEqual([
      "--context",
      "k3d-kore-local",
      "apply",
      "--server-side",
      "--field-manager=kore-enrollment",
      "--filename",
      "-",
    ]);
    expect(input).toContain(`${inclusion}: "true"`);
  }
});

test("enforce labels only the namespaces the managed list names, so a gated-off namespace is left alone", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue(["kore-system"]);
  const { runner, run } = cluster([
    { name: "kore-system" },
    { name: "gated-off" },
  ]);
  await enrollPlatformNamespaces(enforce, runner);
  expect(applies(run).map(appliedName)).toEqual(["kore-system"]);
});

test("audit never labels a namespace and never asks for the managed list", async () => {
  const { runner, run } = cluster([{ name: "kore-system" }]);
  await enrollPlatformNamespaces(audit, runner);
  expect(applies(run)).toEqual([]);
  expect(managedNamespaces).not.toHaveBeenCalled();
});

test("a second run changes nothing once every namespace is labelled by kore", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue(["kore-system"]);
  const { runner, run } = cluster([
    {
      name: "kore-system",
      labels: { [inclusion]: "true" },
      manager: "kore-enrollment",
    },
  ]);
  await enrollPlatformNamespaces(enforce, runner);
  expect(applies(run)).toEqual([]);
});

test("a namespace that left the managed list loses the label kore applied, and nothing else", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue(["kore-system"]);
  const { runner, run } = cluster([
    {
      name: "kore-system",
      labels: { [inclusion]: "true" },
      manager: "kore-enrollment",
    },
    {
      name: "retired",
      labels: { [inclusion]: "true" },
      manager: "kore-enrollment",
    },
  ]);
  await enrollPlatformNamespaces(enforce, runner);
  const released = applies(run);
  expect(released.map(appliedName)).toEqual(["retired"]);
  expect(released[0]!.input).not.toContain(inclusion);
  expect(released[0]!.args).toContain("--field-manager=kore-enrollment");
});

test("a label another owner set is never released, even on a namespace kore does not manage", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue([]);
  const { runner, run } = cluster([
    { name: "app-ns", labels: { [inclusion]: "true" }, manager: "helm" },
  ]);
  await enrollPlatformNamespaces(enforce, runner);
  expect(applies(run)).toEqual([]);
});

test("a managed namespace that does not exist fails naming it and the fix", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue(["kore-system"]);
  const { runner } = cluster([]);
  await expect(enrollPlatformNamespaces(enforce, runner)).rejects.toThrow(
    /namespace kore-system does not exist.*kore platform up/s,
  );
});

test("a namespace list with no items is an empty cluster, so audit changes nothing", async () => {
  const { runner, run } = fakeRunner(() => "{}");
  await expect(
    enrollPlatformNamespaces(audit, runner),
  ).resolves.toBeUndefined();
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]![1]).toContain("namespaces");
});

test("a mesh-enrolled component's namespace gets the ambient label under its own field manager", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue([]);
  vi.mocked(enabledComponents).mockReturnValue([
    fakeComponent({ namespace: "mesh-system", meshEnrolled: true }),
  ]);
  const { runner, run } = cluster([{ name: "mesh-system" }]);
  await enrollPlatformNamespaces(audit, runner);
  const [mesh] = applies(run);
  expect(appliedName({ input: mesh!.input })).toBe("mesh-system");
  expect(mesh!.input).toContain(`${ambient}: "ambient"`);
  expect(mesh!.args).toContain("--field-manager=kore-mesh-enrollment");
});

test("a mesh namespace that does not exist fails naming it as a mesh enrollment", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue([]);
  vi.mocked(enabledComponents).mockReturnValue([
    fakeComponent({ namespace: "mesh-system", meshEnrolled: true }),
  ]);
  const { runner } = cluster([]);
  await expect(enrollPlatformNamespaces(audit, runner)).rejects.toThrow(
    /mesh-system in the mesh: namespace mesh-system does not exist/,
  );
});

test("a mesh label kore applied is released once its component is no longer mesh-enrolled", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue([]);
  vi.mocked(enabledComponents).mockReturnValue([]);
  const { runner, run } = cluster([
    {
      name: "old-mesh",
      labels: { [ambient]: "ambient" },
      manager: "kore-mesh-enrollment",
    },
  ]);
  await enrollPlatformNamespaces(audit, runner);
  const [released] = applies(run);
  expect(released!.input).not.toContain(ambient);
  expect(released!.args).toContain("--field-manager=kore-mesh-enrollment");
});

// Docs: docs/decisions/0134-the-shared-gateway-admits-routes-only-from-platform-labelled-namespaces.md
// A platform namespace holding a route for the shared Gateway carries the label
// the Gateway's listeners select on, only while platform-shared-gateway is on.

const sharedGateway = "platform.kore.dev/shared-gateway";
const sharedOn = fakeRepository({
  imageInventory: "audit",
  features: { "platform-shared-gateway": true },
});

test("with platform-shared-gateway on, a component that attaches a route to it has its namespace labelled under its own field manager", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue([]);
  vi.mocked(enabledComponents).mockReturnValue([
    fakeComponent({ namespace: "portal", sharedGatewayRoutes: true }),
    fakeComponent({ namespace: "other" }),
  ]);
  const { runner, run } = cluster([{ name: "portal" }, { name: "other" }]);
  await enrollPlatformNamespaces(sharedOn, runner);
  const [applied, ...rest] = applies(run);
  expect(rest).toEqual([]);
  expect(appliedName({ input: applied!.input })).toBe("portal");
  expect(applied!.input).toContain(`${sharedGateway}: "true"`);
  expect(applied!.args).toContain(
    "--field-manager=kore-shared-gateway-enrollment",
  );
});

test("with platform-shared-gateway off, no namespace is labelled for the shared Gateway", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue([]);
  vi.mocked(enabledComponents).mockReturnValue([
    fakeComponent({ namespace: "portal", sharedGatewayRoutes: true }),
  ]);
  const { runner, run } = cluster([{ name: "portal" }]);
  await enrollPlatformNamespaces(
    fakeRepository({
      imageInventory: "audit",
      features: { "platform-shared-gateway": false },
    }),
    runner,
  );
  expect(applies(run)).toEqual([]);
});

test("a shared Gateway namespace that does not exist fails naming it", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue([]);
  vi.mocked(enabledComponents).mockReturnValue([
    fakeComponent({ namespace: "portal", sharedGatewayRoutes: true }),
  ]);
  const { runner } = cluster([]);
  await expect(enrollPlatformNamespaces(sharedOn, runner)).rejects.toThrow(
    /portal for the shared Gateway: namespace portal does not exist/,
  );
});

test("a shared Gateway label kore applied is released once the flag is off again", async () => {
  vi.mocked(managedNamespaces).mockResolvedValue([]);
  vi.mocked(enabledComponents).mockReturnValue([
    fakeComponent({ namespace: "portal", sharedGatewayRoutes: true }),
  ]);
  const { runner, run } = cluster([
    {
      name: "portal",
      labels: { [sharedGateway]: "true" },
      manager: "kore-shared-gateway-enrollment",
    },
  ]);
  await enrollPlatformNamespaces(
    fakeRepository({ imageInventory: "audit" }),
    runner,
  );
  const [released] = applies(run);
  expect(released!.input).not.toContain(sharedGateway);
  expect(released!.args).toContain(
    "--field-manager=kore-shared-gateway-enrollment",
  );
});
