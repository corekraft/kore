import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type Phase =
  "bootstrap" | "core" | "observability" | "configuration" | "enforcement";
export type ComponentKind = "helm" | "local-chart" | "manifest";

export interface Versions {
  $schema?: string;
  tools: Record<string, string>;
  kubernetes: string;
  components: Record<string, string>;
  images: Record<string, string>;
}

export interface Component {
  name: string;
  phase: Phase;
  namespace: string;
  kind: ComponentKind;
  repository?: string;
  chart?: string;
  source?: string;
  version: string;
  ownsCRDs: string[];
  dependencies: string[];
  timeout: string;
  values?: string[];
  readiness: string[];
}

export interface Catalog {
  $schema?: string;
  components: Component[];
}

export interface Environment {
  $schema?: string;
  name: string;
  provider: "minikube" | "managed";
  kubeContext: string;
  cluster: {
    profile: string;
    kubernetesVersion: string;
    driver: string;
    containerRuntime: string;
    cpus: number;
    memoryMB: number;
    diskSize: string;
  };
  gateway: { namespace: string; name: string; hostname: string; port: number };
  secrets: { storeName: string; sourceNamespace: string };
  telemetry: { otlpEndpoint: string };
  componentValues?: Record<string, string[]>;
}

export interface Repository {
  root: string;
  versions: Versions;
  catalog: Catalog;
  environment: Environment;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findRoot(start = process.cwd()): Promise<string> {
  if (process.env.KORE_ROOT) return resolve(process.env.KORE_ROOT);
  let candidate = resolve(start);
  while (true) {
    if (await exists(join(candidate, "infra/catalog/components.yaml")))
      return candidate;
    const parent = dirname(candidate);
    if (parent === candidate)
      throw new Error(
        "not inside a Kore repository (set KORE_ROOT to override)",
      );
    candidate = parent;
  }
}

async function loadJSON<T>(path: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    throw new Error(
      `validate ${path}: files must use JSON-compatible YAML: ${String(error)}`,
    );
  }
}

export async function loadRepository(
  environmentName = "local",
  start?: string,
): Promise<Repository> {
  const root = await findRoot(start);
  const [versions, catalog, environment] = await Promise.all([
    loadJSON<Versions>(join(root, "infra/catalog/versions.yaml")),
    loadJSON<Catalog>(join(root, "infra/catalog/components.yaml")),
    loadJSON<Environment>(
      join(root, "infra/environments", environmentName, "environment.yaml"),
    ),
  ]);
  const repository = { root, versions, catalog, environment };
  await validateRepository(repository);
  return repository;
}

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
const phaseOrder: Record<Phase, number> = {
  bootstrap: 0,
  core: 1,
  observability: 2,
  configuration: 3,
  enforcement: 4,
};

export async function validateRepository(
  repository: Repository,
): Promise<void> {
  const { root, versions, catalog, environment } = repository;
  const errors: string[] = [];
  if (!versions.kubernetes || !semver.test(versions.kubernetes))
    errors.push("versions.kubernetes must be an exact semantic version");
  if (!versions.tools || typeof versions.tools !== "object")
    errors.push("versions.tools must be an object of pinned versions");
  for (const [key, value] of Object.entries(versions.tools ?? {}))
    if (!semver.test(value))
      errors.push(`tools.${key} must be an exact semantic version`);
  if (!versions.components || typeof versions.components !== "object")
    errors.push("versions.components must be an object of pinned versions");
  for (const [key, value] of Object.entries(versions.components ?? {}))
    if (!semver.test(value))
      errors.push(`components.${key} must be an exact semantic version`);
  if (!name.test(environment.name)) errors.push("environment.name is invalid");
  if (!new Set(["minikube", "managed"]).has(environment.provider))
    errors.push("environment.provider must be minikube or managed");
  if (!environment.kubeContext)
    errors.push("environment.kubeContext is required");
  if ((environment.cluster?.cpus ?? 0) < 2)
    errors.push("environment.cluster.cpus must be at least 2");
  if ((environment.cluster?.memoryMB ?? 0) < 4096)
    errors.push("environment.cluster.memoryMB must be at least 4096");

  const components = new Map<string, Component>();
  const crdOwners = new Map<string, string>();
  for (const component of catalog.components ?? []) {
    if (!name.test(component.name))
      errors.push(`component has invalid name: ${component.name}`);
    if (components.has(component.name))
      errors.push(`duplicate component: ${component.name}`);
    components.set(component.name, component);
    if (!phases.has(component.phase))
      errors.push(`${component.name}: invalid phase`);
    if (!kinds.has(component.kind))
      errors.push(`${component.name}: invalid kind`);
    if (!component.namespace || !duration.test(component.timeout))
      errors.push(
        `${component.name}: namespace and bounded timeout are required`,
      );
    if (
      component.version !== "local" &&
      !versions.components?.[component.version]
    )
      errors.push(
        `${component.name}: unknown version key ${component.version}`,
      );
    if (component.kind === "manifest" && !component.source)
      errors.push(`${component.name}: manifest source is required`);
    if (component.kind !== "manifest" && !component.chart)
      errors.push(`${component.name}: chart is required`);
    for (const crd of component.ownsCRDs ?? []) {
      const owner = crdOwners.get(crd);
      if (owner)
        errors.push(
          `CRD ${crd} has multiple owners: ${owner} and ${component.name}`,
        );
      crdOwners.set(crd, component.name);
    }
    for (const path of component.values ?? [])
      if (!(await exists(join(root, path))))
        errors.push(`${component.name}: values file does not exist: ${path}`);
    for (const path of environment.componentValues?.[component.name] ?? [])
      if (!(await exists(join(root, path))))
        errors.push(
          `${component.name}: environment values file does not exist: ${path}`,
        );
  }
  for (const component of catalog.components ?? [])
    for (const dependency of component.dependencies ?? []) {
      if (!components.has(dependency))
        errors.push(`${component.name}: unknown dependency ${dependency}`);
    }
  for (const componentName of Object.keys(environment.componentValues ?? {})) {
    if (!components.has(componentName))
      errors.push(`unknown environment component values: ${componentName}`);
  }
  try {
    orderedComponents(catalog);
  } catch (error) {
    errors.push(String(error instanceof Error ? error.message : error));
  }
  if (errors.length) throw new Error([...new Set(errors)].sort().join("\n"));
}

export function orderedComponents(catalog: Catalog): Component[] {
  const byName = new Map(
    catalog.components.map((component) => [component.name, component]),
  );
  const degree = new Map(
    catalog.components.map((component) => [
      component.name,
      component.dependencies.length,
    ]),
  );
  const dependents = new Map<string, string[]>();
  for (const component of catalog.components)
    for (const dependency of component.dependencies) {
      dependents.set(dependency, [
        ...(dependents.get(dependency) ?? []),
        component.name,
      ]);
    }
  const compare = (left: string, right: string): number => {
    const phaseDifference =
      phaseOrder[byName.get(left)?.phase ?? "enforcement"] -
      phaseOrder[byName.get(right)?.phase ?? "enforcement"];
    return phaseDifference || left.localeCompare(right);
  };
  const ready = [...degree.entries()]
    .filter(([, value]) => value === 0)
    .map(([key]) => key)
    .sort(compare);
  const result: Component[] = [];
  while (ready.length) {
    const current = ready.shift()!;
    const component = byName.get(current);
    if (component) result.push(component);
    for (const child of (dependents.get(current) ?? []).sort(compare)) {
      const next = (degree.get(child) ?? 0) - 1;
      degree.set(child, next);
      if (next === 0) {
        ready.push(child);
        ready.sort(compare);
      }
    }
  }
  if (result.length !== catalog.components.length) {
    const cycle = [...degree.entries()]
      .filter(([, value]) => value > 0)
      .map(([key]) => key)
      .sort();
    throw new Error(`release dependency cycle includes: ${cycle.join(", ")}`);
  }
  return result;
}

export function componentVersion(
  repository: Repository,
  component: Component,
): string | undefined {
  if (component.version === "local") return undefined;
  return repository.versions.components[component.version]?.replace(/^v/, "");
}

export function expandVersions(repository: Repository, value: string): string {
  return Object.entries(repository.versions.components).reduce(
    (result, [key, version]) =>
      result.replaceAll(`\${${key}}`, version.replace(/^v/, "")),
    value,
  );
}

export function absolute(repository: Repository, path: string): string {
  return isAbsolute(path) ? path : join(repository.root, path);
}

export function componentValues(
  repository: Repository,
  component: Component,
): string[] {
  return [
    ...(component.values ?? []),
    ...(repository.environment.componentValues?.[component.name] ?? []),
  ];
}
