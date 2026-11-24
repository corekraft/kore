// Docs: docs/decisions/0031-registry-address-platform-variable.md
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import {
  fakeCatalog,
  fakeComponent,
  fakeEnvironment,
  fakeRepository,
  malformed,
} from "./config-support.js";
import { alertEmailErrors, alertEmailWarnings } from "./alert-email.js";
import { backupTargetErrors } from "./backup-target.js";
import { componentGatedOff } from "./features.js";
import { exists } from "./files.js";
import { providerFlagErrors } from "./provider-flag-errors.js";
import { flagManifestErrors } from "./flag-manifest.js";
import { overlayErrors, overlayWarnings } from "./overlay-errors.js";

vi.mock("node:path");
vi.mock("./alert-email.js");
vi.mock("./backup-target.js", () => ({ backupTargetErrors: vi.fn() }));
vi.mock("./features.js");
vi.mock("./files.js");
vi.mock("./provider-flag-errors.js");
vi.mock("./flag-manifest.js", () => ({ flagManifestErrors: vi.fn() }));

/** Paths in this set do not exist; every other path does. */
let absent = new Set<string>();

beforeEach(() => {
  absent = new Set();
  vi.mocked(join).mockImplementation((...parts: string[]) => parts.join("/"));
  vi.mocked(exists).mockImplementation(async (path) => !absent.has(path));
  vi.mocked(componentGatedOff).mockReturnValue(false);
  vi.mocked(alertEmailErrors).mockReturnValue([]);
  vi.mocked(alertEmailWarnings).mockReturnValue([]);
  vi.mocked(providerFlagErrors).mockReturnValue([]);
  vi.mocked(flagManifestErrors).mockReturnValue([]);
  vi.mocked(backupTargetErrors).mockReturnValue([]);
});

const repository = (
  components: ReturnType<typeof fakeComponent>[],
  environment = fakeEnvironment(),
) => fakeRepository({ environment, catalog: fakeCatalog(components) });

test("an overlay with sound features, sources and values has no errors", async () => {
  const environment = fakeEnvironment({ features: { ingress: false } });
  const component = fakeComponent({
    name: "kore-ui",
    values: ["values/ui.yaml"],
    featureFlag: "ingress",
  });
  expect(await overlayErrors(repository([component], environment))).toEqual([]);
});

test("the backup declaration is checked against the repository, and its errors join the overlay's errors", async () => {
  vi.mocked(backupTargetErrors).mockReturnValue(["backup.target.kind bad"]);
  expect(await overlayErrors(repository([]))).toEqual([
    "backup.target.kind bad",
  ]);
});

test("the features map must be a map of flag names to booleans", async () => {
  const environment = fakeEnvironment({
    features: malformed<Record<string, boolean>>([]),
  });
  expect(await overlayErrors(repository([], environment))).toEqual([
    "environment.features must be a map of flag name to true or false",
  ]);
});

test("a flag name must be lowercase letters, digits and hyphens, starting with a letter", async () => {
  const environment = fakeEnvironment({ features: { Ingress_Flag: false } });
  expect(await overlayErrors(repository([], environment))).toEqual([
    "environment.features name Ingress_Flag must be lowercase letters, digits and hyphens, starting with a letter",
  ]);
});

test("a flag value must be true or false", async () => {
  const environment = fakeEnvironment({
    features: { ingress: malformed<boolean>("yes") },
  });
  expect(await overlayErrors(repository([], environment))).toEqual([
    "environment.features.ingress must be true or false",
  ]);
});

test("a feature flag on a manifest component is refused, since a turned-off flag could not be detected", async () => {
  const manifest = fakeComponent({
    name: "kore-policy",
    kind: "manifest",
    featureFlag: "ingress",
  });
  expect(await overlayErrors(repository([manifest]))).toEqual([
    "kore-policy: featureFlag is not supported on a manifest component; gate a helm or local-chart component instead",
  ]);
});

test("a component's feature flag must be well formed", async () => {
  const component = fakeComponent({ name: "kore-ui", featureFlag: "Ingress" });
  expect(await overlayErrors(repository([component]))).toEqual([
    "kore-ui: featureFlag Ingress must be lowercase letters, digits and hyphens, starting with a letter",
  ]);
});

test("a component's feature flag must be declared in the environment, with the line to add", async () => {
  const component = fakeComponent({ name: "kore-ui", featureFlag: "ingress" });
  expect(await overlayErrors(repository([component]))).toEqual([
    'kore-ui: featureFlag ingress is not declared in environment.features; add "ingress": false to the local environment overlay',
  ]);
});

test("an enabled component may not depend on one that its flag gates off", async () => {
  vi.mocked(componentGatedOff).mockImplementation(
    (_, component) => component.featureFlag === "ingress",
  );
  const enabled = fakeComponent({
    name: "kore-ui",
    dependencies: ["kore-gate"],
  });
  const gated = fakeComponent({ name: "kore-gate", featureFlag: "ingress" });
  const environment = fakeEnvironment({ features: { ingress: false } });
  expect(
    await overlayErrors(repository([enabled, gated], environment)),
  ).toEqual([
    "kore-ui: depends on kore-gate, which feature ingress gates off; gate kore-ui with the same flag or drop the dependency",
  ]);
});

test("a component that its own flag gates off may depend on a gated one, since both are off together", async () => {
  vi.mocked(componentGatedOff).mockReturnValue(true);
  const gated = fakeComponent({ name: "kore-ui", dependencies: ["kore-gate"] });
  expect(await overlayErrors(repository([gated]))).toEqual([]);
});

test("overlay component values must name a component of the catalog", async () => {
  const environment = fakeEnvironment({
    componentValues: { "kore-ghost": ["env/ghost.yaml"] },
  });
  expect(await overlayErrors(repository([], environment))).toEqual([
    "unknown environment component values: kore-ghost",
  ]);
});

test("a component source is only allowed for a manifest component", async () => {
  const environment = fakeEnvironment({
    componentSources: { "kore-ui": "manifests/ui" },
  });
  expect(
    await overlayErrors(
      repository([fakeComponent({ name: "kore-ui" })], environment),
    ),
  ).toEqual([
    "environment component source for a non-manifest component: kore-ui",
  ]);
});

test("a component source that does not exist is reported, naming its path", async () => {
  absent.add("/repo/manifests/policy");
  const manifest = fakeComponent({ name: "kore-policy", kind: "manifest" });
  const environment = fakeEnvironment({
    componentSources: { "kore-policy": "manifests/policy" },
  });
  expect(await overlayErrors(repository([manifest], environment))).toEqual([
    "kore-policy: environment source does not exist: manifests/policy",
  ]);
});

test("a missing values file is reported with its owner, the component or the environment", async () => {
  absent.add("/repo/values/ui.yaml");
  absent.add("/repo/env/kore-ui.yaml");
  const component = fakeComponent({
    name: "kore-ui",
    values: ["values/ui.yaml"],
  });
  const environment = fakeEnvironment({
    componentValues: { "kore-ui": ["env/kore-ui.yaml"] },
  });
  expect(await overlayErrors(repository([component], environment))).toEqual([
    "kore-ui: values file does not exist: values/ui.yaml",
    "kore-ui: environment values file does not exist: env/kore-ui.yaml",
  ]);
});

test("each component's values are checked, so one component's missing file does not hide another's", async () => {
  absent.add("/repo/values/a.yaml");
  const components = [
    fakeComponent({ name: "kore-a", values: ["values/a.yaml"] }),
    fakeComponent({ name: "kore-b", values: ["values/b.yaml"] }),
  ];
  expect(await overlayErrors(repository(components))).toEqual([
    "kore-a: values file does not exist: values/a.yaml",
  ]);
});

test("the alertEmail schema errors are part of the overlay's errors", async () => {
  vi.mocked(alertEmailErrors).mockReturnValue([
    "environment.alertEmail must be an object",
  ]);
  const environment = fakeEnvironment();
  expect(await overlayErrors(repository([], environment))).toEqual([
    "environment.alertEmail must be an object",
  ]);
  expect(alertEmailErrors).toHaveBeenCalledWith(environment);
});

test("the overlay's warnings are the alert email warnings", () => {
  vi.mocked(alertEmailWarnings).mockReturnValue([
    "alerts have no contact point",
  ]);
  const repo = repository([]);
  expect(overlayWarnings(repo)).toEqual(["alerts have no contact point"]);
  expect(alertEmailWarnings).toHaveBeenCalledWith(repo);
});

test("a flag a provider refuses is an overlay error, read from the environment", async () => {
  vi.mocked(providerFlagErrors).mockReturnValue([
    "environment local turns on in-cluster-ca, which creates the cluster's own root CA",
  ]);
  const environment = fakeEnvironment();

  expect(await overlayErrors(repository([], environment))).toEqual([
    "environment local turns on in-cluster-ca, which creates the cluster's own root CA",
  ]);
  expect(providerFlagErrors).toHaveBeenCalledWith(environment);
});

test("the flag manifest's errors for the overlay's flags are overlay errors, reported with the rest", async () => {
  vi.mocked(flagManifestErrors).mockReturnValue([
    "flag ingress has no entry in infra/catalog/flags.yaml",
  ]);
  expect(
    await overlayErrors(repository([fakeComponent({ name: "kore-ui" })])),
  ).toEqual(["flag ingress has no entry in infra/catalog/flags.yaml"]);
});
