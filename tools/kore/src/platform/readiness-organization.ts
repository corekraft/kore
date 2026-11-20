import type { Runner } from "../runtime/index.js";
import { pollUntil } from "./readiness-poll.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

/** The platform Organization the platform-keycloak chart declares (ADR 0113, issue 1318). */
const ORGANIZATION = "organization.platform.kore.dev/platform";
const NOT_FOUND = /NotFound|not found/i;
const NOT_DECLARED =
  "organization platform does not exist in this cluster; platform-keycloak creates it while platform-portal is on";
/** Prints `ready` only when the Ready condition is True, so the probe reads one token. */
const READY_TEMPLATE =
  '{{range .status.conditions}}{{if and (eq .type "Ready") (eq .status "True")}}ready{{end}}{{end}}';

/** A readiness check: the condition it proves and a bounded evaluation. */
export interface OrganizationCheck {
  condition: string;
  run: (timeout: string) => Promise<void>;
}

/** What the check reads from: the runner and the kubectl scope of the environment. */
export interface OrganizationContext {
  runner: Runner;
  base: string[];
}

interface Condition {
  type?: string;
  status?: string;
  message?: string;
}

interface OrganizationItem {
  status?: { conditions?: Condition[] };
}

/**
 * Proves the platform Organization is Ready, which Crossplane reports once the
 * realm it composes exists. Each poll names the reason it is not ready, so a
 * missing or failing realm ends the wait with that reason, not a bare timeout.
 * Undefined for any other resource.
 */
export function organizationCheck(
  context: OrganizationContext,
  resource: string,
): OrganizationCheck | undefined {
  if (resource !== ORGANIZATION) {
    return undefined;
  }
  return {
    condition: "Ready, with the platform realm composed",
    run: (timeout) => pollUntil(timeout, () => notReadyReason(context)),
  };
}

async function readOrDeclared(
  { runner, base }: OrganizationContext,
  output: string,
): Promise<string | undefined> {
  try {
    const result = await runner.run(
      "kubectl",
      [...base, "get", ORGANIZATION, "--output", output],
      { capture: true },
    );
    return result.stdout.trim();
  } catch (error) {
    if (error instanceof Error && NOT_FOUND.test(error.message)) {
      return undefined;
    }
    throw error;
  }
}

async function notReadyReason(
  context: OrganizationContext,
): Promise<string | undefined> {
  const ready = await readOrDeclared(context, `go-template=${READY_TEMPLATE}`);
  if (ready === undefined) {
    return NOT_DECLARED;
  }
  if (ready === "ready") {
    return undefined;
  }
  const item = JSON.parse(
    (await readOrDeclared(context, "json")) ?? "{}",
  ) as OrganizationItem;
  const condition = item.status?.conditions?.find(
    (candidate) => candidate.type === "Ready",
  );
  if (condition === undefined) {
    return "organization platform has no Ready condition yet";
  }
  return `organization platform is not Ready: ${condition.message || "no reason given"}`;
}
