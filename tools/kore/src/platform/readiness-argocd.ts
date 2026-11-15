import type { Runner } from "../runtime/index.js";
import { pollUntil } from "./readiness-poll.js";

// Docs: docs/decisions/0043-platform-configuration-through-argo-cd.md

/** The catalog readiness entry that stands for every Argo CD Application. */
export const APPLICATIONS = "applications.argoproj.io";

/** What an Argo CD check reads from: the runner and the kubectl scope. */
export interface ArgocdContext {
  runner: Runner;
  base: string[];
}

interface Application {
  metadata: { name: string };
  status?: {
    sync?: { status?: string };
    health?: { status?: string; message?: string };
    conditions?: { message?: string }[];
    operationState?: { message?: string };
  };
}

/** Why an Application is not Synced and Healthy, or undefined when it is. */
function problem({ metadata, status }: Application): string | undefined {
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
  return `Application ${metadata.name} is ${sync} and ${health}${cause ? `: ${cause}` : ""}`;
}

/**
 * Every Application that exists must be Synced and Healthy. An unreadable
 * Application list is an error, never a pass, so the gate stays closed.
 */
async function applicationsProblem(
  { runner, base }: ArgocdContext,
  resource: string,
): Promise<string | undefined> {
  const result = await runner.run(
    "kubectl",
    [...base, "get", resource, "--output", "json"],
    { capture: true },
  );
  const { items } = JSON.parse(result.stdout) as { items?: Application[] };
  const problems = (items ?? []).flatMap((app) => problem(app) ?? []);
  return problems.length ? problems.join("; ") : undefined;
}

/** The readiness check for the Application collection, if `resource` is it. */
export function argocdApplicationsCheck(
  context: ArgocdContext,
  resource: string,
): { condition: string; run: (timeout: string) => Promise<void> } | undefined {
  if (resource !== APPLICATIONS) {
    return undefined;
  }
  return {
    condition: "every Application Synced and Healthy",
    run: (timeout) =>
      pollUntil(timeout, () => applicationsProblem(context, resource)),
  };
}
