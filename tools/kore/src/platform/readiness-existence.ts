import type { Runner } from "../runtime/index.js";
import { pollUntil } from "./readiness-poll.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

/** A readiness check: the condition it proves and a bounded evaluation. */
interface Check {
  condition: string;
  run: (timeout: string) => Promise<void>;
}

/** What the check reads from: the runner, the kubectl scope, and whether output is captured. */
interface ExistenceContext {
  runner: Runner;
  base: string[];
  capture?: boolean;
}

/** The platform Keycloak realm, which Crossplane creates once Keycloak answers. */
const REALM_KIND = "realm.realm.keycloak.m.crossplane.io/";

function kubectlCheck(
  { runner, base, capture = false }: ExistenceContext,
  condition: string,
  args: (timeout: string) => string[],
): Check {
  return {
    condition,
    run: async (timeout) => {
      await runner.run("kubectl", [...base, ...args(timeout)], { capture });
    },
  };
}

/**
 * `kubectl rollout status` and `kubectl wait` fail at once on a resource that
 * is not there yet, so the wait first polls until the resource exists, within
 * the same bound, then runs the wrapped check.
 */
function afterExists(
  { runner, base }: ExistenceContext,
  resource: string,
  check: Check,
): Check {
  return {
    condition: `exists and ${check.condition}`,
    run: async (timeout) => {
      await pollUntil(timeout, async () => {
        await runner.run(
          "kubectl",
          [...base, "get", resource, "--output", "name"],
          { capture: true },
        );
        return undefined;
      });
      await check.run(timeout);
    },
  };
}

/**
 * The readiness check for a resource that an operator or controller creates a
 * moment after the release that declares it is installed: the Keycloak
 * StatefulSet, which the Keycloak operator makes from the `Keycloak` resource
 * (a rollout wait right after `helm install` hit NotFound after 0.2 s), and the
 * platform realm, which a client of the realm needs Ready before it starts
 * (ADR 0113). Undefined for any other resource.
 */
export function existenceCheck(
  context: ExistenceContext,
  resource: string,
): Check | undefined {
  if (resource.startsWith("statefulset/")) {
    return afterExists(
      context,
      resource,
      kubectlCheck(context, "rollout complete", (timeout) => [
        "rollout",
        "status",
        resource,
        `--timeout=${timeout}`,
      ]),
    );
  }
  if (resource.startsWith(REALM_KIND)) {
    return afterExists(
      context,
      resource,
      kubectlCheck(context, "Ready", (timeout) => [
        "wait",
        "--for=condition=Ready",
        resource,
        `--timeout=${timeout}`,
      ]),
    );
  }
  return undefined;
}
