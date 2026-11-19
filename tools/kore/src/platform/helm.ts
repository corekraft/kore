import {
  absolute,
  alertEmailHelmArgs,
  alertForwardingHelmArgs,
  dashboardSidecarHelmArgs,
  componentValues,
  componentVersion,
  expandVersions,
  featureHelmArgs,
  gatewayClassName,
  noMatchPolicy,
  platformHelmArgs,
  registeredServiceHelmArgs,
  registryConsumers,
  registryHelmArgs,
  type Component,
  type Repository,
} from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { applyProbePatches } from "./patches.js";

/** The Helm post-renderer plugin kept in the repository. */
const PATCH_PLUGIN = "kore-patch";

/**
 * The environment for a helm call that renders a component. Helm 4 takes a
 * post-renderer by plugin name, so a component with patches points Helm at the
 * repository's plugin directory instead of installing a plugin into the user's
 * Helm configuration.
 */
export function helmEnv(
  repository: Repository,
  component: Component,
): NodeJS.ProcessEnv | undefined {
  return component.patches?.length
    ? {
        ...process.env,
        HELM_PLUGINS: absolute(repository, "infra/helm-plugins"),
      }
    : undefined;
}

/** Run options carrying `helmEnv`, or none when the component has no patches. */
export function envOption(env: NodeJS.ProcessEnv | undefined): {
  env?: NodeJS.ProcessEnv;
} {
  return env ? { env } : {};
}

function helmTarget(component: Component): string {
  if (component.kind === "local-chart") {
    return component.chart!;
  }
  if (component.repository?.startsWith("oci://")) {
    return component.repository;
  }
  return component.chart!;
}

/** The kore-golden-path-delivery chart's composed values as Helm arguments; none for any other component. */
function goldenPathArgs(
  repository: Repository,
  component: Component,
): string[] {
  const golden = repository.goldenPathDelivery;
  if (component.name !== "kore-golden-path-delivery" || !golden) {
    return [];
  }
  return [
    "--set-string",
    `repoURL=${golden.repoURL}`,
    "--set-string",
    `revision=${golden.revision}`,
    "--set-string",
    `environment=${golden.environment}`,
    "--set-json",
    `templateImages=${JSON.stringify(golden.templateImages)}`,
    "--set-string",
    `ingress.platformDomain=${golden.ingress.platformDomain}`,
    "--set-string",
    `ingress.gatewayClassName=${golden.ingress.gatewayClassName}`,
    // Only while platform-shared-gateway is on, so the flag off passes nothing new.
    ...(golden.sharedGateway ? ["--set", "sharedGateway=true"] : []),
  ];
}

/**
 * The delivery charts, whose closed schemas name no feature flag and whose
 * templates read none: kore passes them no `features.*` value, since Helm
 * refuses a key the schema does not declare.
 */
const featureFreeCharts = new Set([
  "kore-config-delivery",
  "kore-golden-path-delivery",
]);

/** The chart value each release takes the GatewayClass through. */
const gatewayClassKeys: Record<string, string | undefined> = {
  "kore-platform-config": "gateway.className",
  "kore-platform-backstage": "gatewayClassName",
};

/** The arguments a component takes last: its golden-path values, then its alert email and registered Services. */
function trailingArgs(repository: Repository, component: Component): string[] {
  return [
    ...goldenPathArgs(repository, component),
    ...platformHelmArgs(repository.environment, component.name),
    ...alertAndServiceArgs(repository, component),
    ...dashboardSidecarHelmArgs(repository.environment, component.name),
  ];
}

/** The alert email, alert forwarding and registered Service arguments a component takes last. */
function alertAndServiceArgs(
  repository: Repository,
  component: Component,
): string[] {
  return [
    ...alertEmailHelmArgs(repository.environment, component.name),
    ...alertForwardingHelmArgs(repository.environment, component.name),
    ...registeredServiceHelmArgs(
      repository.environment,
      component.name,
      repository.registeredServices ?? [],
    ),
  ];
}

/** The kore-config-delivery chart's composed values as Helm arguments; none for any other component. */
function chartDeliveryArgs(
  repository: Repository,
  component: Component,
): string[] {
  const delivery = repository.chartDelivery;
  if (component.name !== "kore-config-delivery" || !delivery) {
    return [];
  }
  return [
    "--set-json",
    `charts=${JSON.stringify(delivery.charts)}`,
    "--set-json",
    `namespaces=${JSON.stringify(delivery.namespaces)}`,
    "--set-string",
    `gatewayClassName=${delivery.gatewayClassName}`,
    "--set-string",
    `platformDomain=${delivery.platformDomain}`,
    "--set-string",
    `platformHostname=${delivery.platformHostname}`,
    ...(delivery.releaseValues === undefined
      ? []
      : [
          "--set-json",
          `releaseValues=${JSON.stringify(delivery.releaseValues)}`,
        ]),
  ];
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
  if (
    component.kind === "local-chart" &&
    !featureFreeCharts.has(component.name)
  ) {
    args.push(...featureHelmArgs(repository.environment));
  }
  const classKey = gatewayClassKeys[component.name];
  if (classKey) {
    args.push(
      "--set-string",
      `${classKey}=${gatewayClassName(repository.environment)}`,
    );
  }
  if (component.patches?.length) {
    args.push(
      "--post-renderer",
      PATCH_PLUGIN,
      "--post-renderer-args",
      JSON.stringify(component.patches),
    );
  }
  if (component.name === "policy-controller") {
    args.push(
      "--set-string",
      `webhook.configData.no-match-policy=${noMatchPolicy(repository)}`,
    );
  }
  args.push(...chartDeliveryArgs(repository, component));
  args.push(...trailingArgs(repository, component));
  return args;
}

/**
 * Refuses to install kore-config-delivery without its composed values, naming
 * the flag, since Helm's own schema error would not. `kore local up` reaches
 * here without them while the lock flag is not passed through it.
 */
export function assertChartDelivery(
  repository: Repository,
  component: Component,
): void {
  if (component.name === "kore-config-delivery" && !repository.chartDelivery) {
    throw new Error(
      "kore-config-delivery needs the chart lock: run `kore platform up --platform-chart-lock <platform-charts.lock.json>`, the release asset published with the charts (`kore local up` takes the same flag)",
    );
  }
}

/** Refuses to install kore-golden-path-delivery without its composed values, naming the flag. */
export function assertGoldenPathDelivery(
  repository: Repository,
  component: Component,
): void {
  if (
    component.name === "kore-golden-path-delivery" &&
    !repository.goldenPathDelivery
  ) {
    throw new Error(
      "kore-golden-path-delivery needs the template lock: run `kore local up --platform-template-lock <template-images.lock.json>`, the release asset published with the template images",
    );
  }
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
    // Helm 4 turns --rollback-on-failure back into a resource wait, so a
    // component that skips the wait cannot also roll back automatically.
    ...(component.helm?.wait === false ? [] : ["--rollback-on-failure"]),
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

function withoutPostRenderer(args: string[]): string[] {
  const at = args.indexOf("--post-renderer");
  return at < 0 ? args : [...args.slice(0, at), ...args.slice(at + 4)];
}

/**
 * Helm hides a failing post-renderer as "plugin exited with error". When a helm
 * call fails for a component with patches, render the chart without the
 * post-renderer and apply the patches in-process, so the patcher's own error
 * (a moved target, a flow-style probe) is what gets reported. Returns undefined
 * when the patches are not the cause or the chart cannot be rendered. The
 * upgrade output streams to the terminal, so the error text cannot be matched.
 */
export async function patchFailure(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<string | undefined> {
  if (!component.patches?.length) {
    return undefined;
  }
  try {
    const { stdout } = await runner.run(
      "helm",
      withAbsoluteChart(
        repository,
        component,
        withoutPostRenderer(helmTemplateArgs(repository, component)),
      ),
      { capture: true, cwd: repository.root },
    );
    if (stdout.trim() === "") {
      return undefined;
    }
    applyProbePatches(stdout, component.patches);
    return undefined;
  } catch (error) {
    return error instanceof Error && error.message.startsWith("patch target ")
      ? error.message
      : undefined;
  }
}
