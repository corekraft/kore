import {
  absolute,
  componentValues,
  componentVersion,
  expandVersions,
  featureHelmArgs,
  gatewayClassName,
  noMatchPolicy,
  registryConsumers,
  registryHelmArgs,
  type Component,
  type Repository,
} from "../config/index.js";

function helmTarget(component: Component): string {
  if (component.kind === "local-chart") {
    return component.chart!;
  }
  if (component.repository?.startsWith("oci://")) {
    return component.repository;
  }
  return component.chart!;
}

function chartSelectionArgs(
  repository: Repository,
  component: Component,
): string[] {
  const args: string[] = [];
  if (
    component.kind === "helm" &&
    component.repository &&
    !component.repository.startsWith("oci://")
  ) {
    args.push("--repo", component.repository);
  }
  const version = componentVersion(repository, component);
  if (version) {
    args.push("--version", version);
  }
  for (const values of componentValues(repository, component)) {
    args.push("--values", absolute(repository, values));
  }
  if (registryConsumers.includes(component.name)) {
    args.push(...registryHelmArgs(repository.environment, component.name));
  }
  if (component.kind === "local-chart") {
    args.push(...featureHelmArgs(repository.environment));
  }
  if (component.name === "kore-platform-config") {
    args.push(
      "--set-string",
      `gateway.className=${gatewayClassName(repository.environment)}`,
    );
  }
  if (component.name === "policy-controller") {
    args.push(
      "--set-string",
      `webhook.configData.no-match-policy=${noMatchPolicy(repository)}`,
    );
  }
  return args;
}

export function helmUpgradeArgs(
  repository: Repository,
  component: Component,
): string[] {
  return [
    "upgrade",
    "--install",
    component.name,
    helmTarget(component),
    "--namespace",
    component.namespace,
    "--create-namespace",
    "--kube-context",
    repository.environment.kubeContext,
    component.helm?.wait === false ? "--wait=hookOnly" : "--wait",
    "--timeout",
    component.timeout,
    "--rollback-on-failure",
    ...(component.helm?.forceConflicts ? ["--force-conflicts"] : []),
    ...chartSelectionArgs(repository, component),
  ];
}

export function helmTemplateArgs(
  repository: Repository,
  component: Component,
): string[] {
  return [
    "template",
    component.name,
    helmTarget(component),
    "--namespace",
    component.namespace,
    "--include-crds",
    ...chartSelectionArgs(repository, component),
  ];
}

/** Resolves a local chart path against the repository root. */
export function withAbsoluteChart(
  repository: Repository,
  component: Component,
  args: string[],
): string[] {
  return args.map((value) =>
    component.kind === "local-chart" && value === component.chart
      ? absolute(repository, value)
      : value,
  );
}

/** A manifest component's source as a URL or an absolute path. */
export function manifestSource(
  repository: Repository,
  component: Component,
): string {
  const expanded = expandVersions(
    repository,
    repository.environment.componentSources?.[component.name] ??
      component.source!,
  );
  return /^https?:\/\//.test(expanded)
    ? expanded
    : absolute(repository, expanded);
}
