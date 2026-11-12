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
