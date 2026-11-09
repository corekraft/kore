import type { Repository } from "../config/index.js";
import {
  admissionGateStatusName,
  assertAdmissionGateOpen,
  imageInventoryStatusName,
  platformStatus,
  waitForHTTPRoute,
} from "../platform/index.js";
import type { Runner } from "../runtime/index.js";

export function deploymentRolloutStatusArgs(name: string): string[] {
  return ["rollout", "status", `deployment/${name}`, "--timeout=10m"];
}

export function deploymentListArgs(): string[] {
  return ["get", "deployment", "--output=name"];
}

export async function assertPlatformReady(
  repository: Repository,
  runner: Runner,
): Promise<void> {
  const platform = await platformStatus(repository, runner);
  const unavailable = platform.filter(
    (component) =>
      component.name !== admissionGateStatusName &&
      // The inventory is checked before the gate opens; the gate is the record.
      component.name !== imageInventoryStatusName &&
      component.status !== "ready",
  );
  if (unavailable.length) {
    throw new Error(
      `platform is not ready: ${unavailable.map((component) => `${component.name} (${component.detail})`).join(", ")}`,
    );
  }
}

/**
 * Refuses application admission unless the gate is open for the current
 * platform generation (ADR 0054); returns the generation to activate under.
 */
export async function assertApplicationAdmission(
  repository: Repository,
  runner: Runner,
): Promise<string> {
  return await assertAdmissionGateOpen(repository, runner);
}

function namespaced(repository: Repository, name: string): string[] {
  return ["--context", repository.environment.kubeContext, "--namespace", name];
}

/** Blocks until the resources release has produced databases and secrets. */
export async function waitForResources(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<void> {
  const scope = namespaced(repository, name);
  await runner.run(
    "kubectl",
    [
      ...scope,
      "wait",
      "--for=condition=Ready",
      "postgresqlinstances.platform.kore.dev",
      "--all",
      "--timeout=15m",
    ],
    { capture: false },
  );
  await runner.run(
    "kubectl",
    [
      ...scope,
      "wait",
      "--for=jsonpath={.data}",
      "secret",
      "--selector",
      `app.kubernetes.io/part-of=${name}`,
      "--timeout=5m",
    ],
    { capture: false },
  );
}

/** Blocks until every workload deployment has finished rolling out. */
export async function waitForRollouts(
  repository: Repository,
  runner: Runner,
  name: string,
): Promise<void> {
  const scope = namespaced(repository, name);
  const deployments = await runner.run(
    "kubectl",
    [...scope, ...deploymentListArgs()],
    { capture: true },
  );
  for (const deployment of deployments.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)) {
    const deploymentName = deployment.replace(/^deployment(?:\.apps)?\//, "");
    await runner.run(
      "kubectl",
      [...scope, ...deploymentRolloutStatusArgs(deploymentName)],
      { capture: false },
    );
  }
}

const MANIFEST_DOCUMENT = /^---\s*$/m;
const HTTP_ROUTE = /^kind:\s*HTTPRoute\s*$/m;
const ROUTE_NAME =
  /^metadata:\s*(?:\{[^}]*?\bname:\s*"?([^",\s}]+)|\n(?:[ \t]+.*\n)*?[ \t]+name:\s*"?([^"\s]+))/m;

function routeName(document: string): string | undefined {
  const match = ROUTE_NAME.exec(document);
  return match?.[1] ?? match?.[2];
}

/** The names of the HTTPRoutes a rendered Helm manifest declares, in order. */
export function httpRouteNames(manifest: string): string[] {
  return manifest
    .split(MANIFEST_DOCUMENT)
    .filter((document) => HTTP_ROUTE.test(document))
    .flatMap((document) => routeName(document) ?? []);
}

/**
 * Blocks until every HTTPRoute the application's releases rendered is Accepted
 * and ResolvedRefs. The routes are read from the installed releases, so a
 * chart may add, rename, or drop routes without a change here.
 */
export async function waitForRoutes(
  repository: Repository,
  runner: Runner,
  name: string,
  timeout = "5m",
): Promise<void> {
  const scope = namespaced(repository, name);
  for (const release of [`${name}-resources`, name]) {
    const { stdout } = await runner.run(
      "helm",
      [
        "get",
        "manifest",
        release,
        "--namespace",
        name,
        "--kube-context",
        repository.environment.kubeContext,
      ],
      { capture: true },
    );
    for (const route of httpRouteNames(stdout)) {
      const resource = `httproute/${route}`;
      try {
        await waitForHTTPRoute(runner, scope, resource, timeout);
      } catch (error) {
        throw new Error(
          `${resource} in namespace ${name} is not ready: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
