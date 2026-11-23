import {
  enabledComponents,
  signinAwaitsPortal,
  type Repository,
} from "../config/index.js";
import {
  CommandError,
  CommandTimeoutError,
  type Runner,
} from "../runtime/index.js";
import { pollUntil } from "./readiness-poll.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md

/** The release that starts after the delivery and serves the Keycloak the golden-path sign-in needs. */
export const platformKeycloakRelease = "kore-platform-keycloak";

/**
 * True while the golden-path sign-in waits for the platform Keycloak: its flags
 * are on and the platform Keycloak is enabled (issue 1880). Then the Application
 * waits read only the platform Applications, and the golden-path ones wait for
 * the portal. The delivery wait and the component's own check both ask this one
 * question, so they cannot disagree.
 */
export function signinDeferred(repository: Repository): boolean {
  return (
    signinAwaitsPortal(repository.environment) &&
    enabledComponents(repository).some(
      ({ name }) => name === platformKeycloakRelease,
    )
  );
}

/** The catalog readiness entry that stands for every Argo CD Application. */
export const APPLICATIONS = "applications.argoproj.io";

/**
 * The label the golden-path ApplicationSet puts on each Service's Application
 * (ADR 0043, issue 1880). A labelled Application is a golden-path Service.
 */
export const SERVICE_LABEL = "platform.kore.dev/service";

/**
 * Which Applications a wait reads: every one (`all`), only the platform ones
 * that carry no service label (`platform`), or only the golden-path Service
 * ones (`service`). The platform scope never excuses an unlabelled Application.
 */
export type ApplicationScope = "all" | "platform" | "service";

/** What an Argo CD check reads from: the repository, runner and kubectl scope. */
export interface ArgocdContext {
  repository: Repository;
  runner: Runner;
  base: string[];
}

interface Application {
  metadata: { name: string; labels?: Record<string, string> };
  status?: {
    sync?: { status?: string };
    health?: { status?: string; message?: string };
    conditions?: { message?: string }[];
    operationState?: { message?: string };
  };
}

function kubectlArgocd(context: string): string {
  return `kubectl --context ${context} -n argocd`;
}

/** Whether an Application is read by a wait of this scope. */
function inScope({ metadata }: Application, scope: ApplicationScope): boolean {
  if (scope === "all") {
    return true;
  }
  const labelled = metadata.labels?.[SERVICE_LABEL] !== undefined;
  return labelled === (scope === "service");
}

/** Why an Application is not Synced and Healthy, or undefined when it is. */
function problem(
  { metadata, status }: Application,
  context: string,
): string | undefined {
  const sync = status?.sync?.status ?? "Unknown";
  const health = status?.health?.status ?? "Unknown";
  if (sync === "Synced" && health === "Healthy") {
    return undefined;
  }
  const cause = [
    status?.health?.message,
    status?.operationState?.message,
    ...(status?.conditions ?? []).map(({ message }) => message),
  ].find((message) => message);
  const fix = `run ${kubectlArgocd(context)} describe application ${metadata.name}`;
  return `Application ${metadata.name} is ${sync} and ${health}${cause ? `: ${cause}` : ""}; ${fix}`;
}

function named(item: Application | null): boolean {
  return typeof item?.metadata?.name === "string";
}

/** The Applications in kubectl's answer, or undefined when it is not a list. */
function applicationItems(stdout: string): Application[] | undefined {
  try {
    const parsed = JSON.parse(stdout) as { items?: Application[] } | null;
    const items = parsed?.items;
    return Array.isArray(items) && items.every(named) ? items : undefined;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * kubectl could not write its answer to stdout while the host was under memory
 * pressure (#1380). The same read succeeds on a later try, so it is retried.
 */
const STDOUT_BUFFER_FULL = /write \/dev\/stdout: no buffer space available/;

/** Reads after the first one, made only while the stdout error repeats. */
const RETRY_READS = 2;

/**
 * Reads the Application list as JSON. A full stdout buffer is read again up to
 * RETRY_READS times; any other failure is rethrown at once, and a buffer error
 * that outlasts the retries names the command and the cause.
 */
async function readApplications(
  { repository, runner, base }: ArgocdContext,
  resource: string,
): Promise<string> {
  const args = [...base, "get", resource, "--output", "json"];
  let reads = 0;
  while (true) {
    reads += 1;
    try {
      return (await runner.run("kubectl", args, { capture: true })).stdout;
    } catch (error) {
      if (!isStdoutBufferFull(error)) {
        throw error;
      }
      if (reads > RETRY_READS) {
        const { kubeContext } = repository.environment;
        throw new Error(
          `${error.message}; ${reads} reads failed the same way, so Application health is unknown; run ${kubectlArgocd(kubeContext)} get ${resource}`,
          { cause: error },
        );
      }
    }
  }
}

/**
 * kubectl's own failure to write its answer: a CommandError whose stderr carries
 * the text. A timeout is a CommandError too, but it hung rather than failed, so
 * it is never read again.
 */
function isStdoutBufferFull(error: unknown): error is CommandError {
  return (
    error instanceof CommandError &&
    !(error instanceof CommandTimeoutError) &&
    STDOUT_BUFFER_FULL.test(error.result.stderr)
  );
}

/**
 * Every Application in scope that exists must be Synced and Healthy. An
 * unreadable Application list is an error, never a pass, so the gate stays
 * closed.
 */
async function applicationsProblem(
  context: ArgocdContext,
  resource: string,
  scope: ApplicationScope,
): Promise<string | undefined> {
  const { repository } = context;
  const items = applicationItems(await readApplications(context, resource));
  if (items === undefined) {
    const { kubeContext } = repository.environment;
    return `kubectl get ${resource} returned output that is not a JSON Application list, so Application health is unknown; run ${kubectlArgocd(kubeContext)} get ${resource}`;
  }
  const problems = items.flatMap((app) =>
    inScope(app, scope)
      ? (problem(app, repository.environment.kubeContext) ?? [])
      : [],
  );
  return problems.length ? problems.join("; ") : undefined;
}

/**
 * Polls, within `timeout`, until every Application in `scope` that exists is
 * Synced and Healthy. A delivery is asynchronous, so the gate's single read can
 * race it; the failure names the Application that is not ready and its last
 * state. The scope defaults to every Application, the flag-off gate.
 */
export function waitForApplications(
  context: ArgocdContext,
  timeout: string,
  scope: ApplicationScope = "all",
): Promise<void> {
  return pollUntil(timeout, () =>
    applicationsProblem(context, APPLICATIONS, scope),
  );
}

/** The readiness check for the Application collection, if `resource` is it. */
export function argocdApplicationsCheck(
  context: ArgocdContext,
  resource: string,
): { condition: string; run: (timeout: string) => Promise<void> } | undefined {
  if (resource !== APPLICATIONS) {
    return undefined;
  }
  // While the golden-path sign-in waits for the portal, a component's own check
  // reads only the platform Applications, as the delivery wait does (issue 1880).
  const scope: ApplicationScope = signinDeferred(context.repository)
    ? "platform"
    : "all";
  return {
    condition: "every Application Synced and Healthy",
    run: (timeout) =>
      pollUntil(timeout, () => applicationsProblem(context, resource, scope)),
  };
}
