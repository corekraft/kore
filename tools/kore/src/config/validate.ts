import { registryAddressErrors } from "./registry-address.js";
import { policyErrors } from "./policy-validation.js";
import { catalogErrors } from "./catalog-errors.js";
import { k3dErrors } from "./k3d-errors.js";
import { overlayErrors } from "./overlay-errors.js";
import { imageListErrors } from "./approved.js";
import { orderedComponents, readinessErrors } from "./order.js";
import type {
  Catalog,
  Component,
  ComponentKind,
  Environment,
  Phase,
  Repository,
  Versions,
} from "./types.js";

const semver = /^v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const name = /^[a-z0-9-]+$/;
const duration = /^[1-9]\d*[smh]$/;
const phases = new Set<Phase>([
  "bootstrap",
  "core",
  "observability",
  "configuration",
  "enforcement",
]);
const kinds = new Set<ComponentKind>(["helm", "local-chart", "manifest"]);

interface Rule<T> {
  failed: (value: T) => boolean;
  message: (value: T) => string;
}

function rule<T>(
  message: string | ((value: T) => string),
  failed: (value: T) => boolean,
): Rule<T> {
  return {
    failed,
    message: typeof message === "string" ? () => message : message,
  };
}

function check<T>(rules: Rule<T>[], value: T): string[] {
  return rules.filter((r) => r.failed(value)).map((r) => r.message(value));
}

const isObject = (value: unknown): boolean =>
  Boolean(value) && typeof value === "object";

const versionRules: Rule<Versions>[] = [
  rule(
    "versions.kubernetes must be an exact semantic version",
    (v) => !v.kubernetes || !semver.test(v.kubernetes),
  ),
  rule(
    "versions.tools must be an object of pinned versions",
    (v) => !isObject(v.tools),
  ),
  rule(
    "versions.components must be an object of pinned versions",
    (v) => !isObject(v.components),
  ),
];

const environmentRules: Rule<Environment>[] = [
  rule("environment.name is invalid", (e) => !name.test(e.name)),
  rule(
    "environment.provider must be k3d, minikube or managed",
    (e) => !["k3d", "minikube", "managed"].includes(e.provider),
  ),
  rule("environment.kubeContext is required", (e) => !e.kubeContext),
  rule(
    "environment.imageInventory must be audit or enforce",
    (e) =>
      e.imageInventory !== undefined &&
      !["audit", "enforce"].includes(e.imageInventory),
  ),
  rule(
    "environment.providerOwnedCRDGroups must be a map of API group to reason",
    (e) => {
      const groups: unknown = e.providerOwnedCRDGroups;
      return (
        groups !== undefined && (!isObject(groups) || Array.isArray(groups))
      );
    },
  ),
  rule(
    "environment.cluster.cpus must be at least 2",
    (e) => e.provider !== "k3d" && (e.cluster?.cpus ?? 0) < 2,
  ),
  rule(
    "environment.cluster.memoryMB must be at least 4096",
    (e) => e.provider !== "k3d" && (e.cluster?.memoryMB ?? 0) < 4096,
  ),
];

interface ComponentContext {
  component: Component;
  versions: Versions;
}

const componentRules: Rule<ComponentContext>[] = [
  rule(
    ({ component }) => `component has invalid name: ${component.name}`,
    ({ component }) => !name.test(component.name),
  ),
  rule(
    ({ component }) => `${component.name}: invalid phase`,
    ({ component }) => !phases.has(component.phase),
  ),
  rule(
    ({ component }) => `${component.name}: invalid kind`,
    ({ component }) => !kinds.has(component.kind),
  ),
  rule(
    ({ component }) =>
      `${component.name}: namespace and bounded timeout are required`,
    ({ component }) =>
      !component.namespace || !duration.test(component.timeout),
  ),
  rule(
    ({ component }) =>
      `${component.name}: unknown version key ${component.version}`,
    ({ component, versions }) =>
      component.version !== "local" &&
      !versions.components?.[component.version],
  ),
  rule(
    ({ component }) =>
      `${component.name}: at least one readiness check is required`,
    ({ component }) => !component.readiness?.length,
  ),
  rule(
    ({ component }) =>
      `${component.name}: helm.forceConflicts requires a reason`,
    ({ component }) =>
      component.helm?.forceConflicts === true && !component.helm.reason?.trim(),
  ),
  rule(
    ({ component }) => `${component.name}: helm.wait false requires a reason`,
    ({ component }) =>
      component.helm?.wait === false && !component.helm.reason?.trim(),
  ),
  rule(
    ({ component }) =>
      `${component.name}: helm options do not apply to a manifest component`,
    ({ component }) => component.kind === "manifest" && !!component.helm,
  ),
  rule(
    ({ component }) => `${component.name}: manifest source is required`,
    ({ component }) => component.kind === "manifest" && !component.source,
  ),
  rule(
    ({ component }) => `${component.name}: chart is required`,
    ({ component }) => component.kind !== "manifest" && !component.chart,
  ),
];

function pinErrors(label: string, pins: Record<string, string> | undefined) {
  return Object.entries(pins ?? {})
    .filter(([, value]) => !semver.test(value))
    .map(([key]) => `${label}.${key} must be an exact semantic version`);
}

function versionErrors(versions: Versions): string[] {
  return [
    ...check(versionRules, versions),
    ...pinErrors("tools", versions.tools),
    ...pinErrors("components", versions.components),
  ];
}

function duplicateErrors(components: Component[]): string[] {
  return components
    .filter(
      (component, index) =>
        components.findIndex((other) => other.name === component.name) !==
        index,
    )
    .map((component) => `duplicate component: ${component.name}`);
}

function crdOwnerErrors(components: Component[]): string[] {
  const errors: string[] = [];
  const owners = new Map<string, string>();
  for (const component of components) {
    for (const crd of component.ownsCRDs ?? []) {
      const owner = owners.get(crd);
      if (owner) {
        errors.push(
          `CRD ${crd} has multiple owners: ${owner} and ${component.name}`,
        );
      }
      owners.set(crd, component.name);
    }
  }
  return errors;
}

function dependencyErrors(
  components: Component[],
  names: Set<string>,
): string[] {
  return components.flatMap((component) =>
    (component.dependencies ?? [])
      .filter((dependency) => !names.has(dependency))
      .map(
        (dependency) => `${component.name}: unknown dependency ${dependency}`,
      ),
  );
}

function cycleErrors(catalog: Catalog): string[] {
  try {
    orderedComponents(catalog);
    return [];
  } catch (error) {
    return [String(error instanceof Error ? error.message : error)];
  }
}

export async function validateRepository(
  repository: Repository,
): Promise<void> {
  const { versions, catalog, environment } = repository;
  const components = catalog.components ?? [];
  const names = new Set(components.map((component) => component.name));
  const errors = [
    ...versionErrors(versions),
    ...check(environmentRules, environment),
    ...k3dErrors(environment, versions),
    ...components.flatMap((component) =>
      check(componentRules, { component, versions }),
    ),
    ...duplicateErrors(components),
    ...crdOwnerErrors(components),
    ...catalogErrors(environment, components),
    ...dependencyErrors(components, names),
    ...(await overlayErrors(repository)),
    ...cycleErrors(catalog),
    ...(await imageListErrors(repository)),
    ...(await policyErrors(repository)),
    ...readinessErrors(repository),
    ...registryAddressErrors(repository),
  ];
  if (errors.length) {
    throw new Error([...new Set(errors)].sort().join("\n"));
  }
}
