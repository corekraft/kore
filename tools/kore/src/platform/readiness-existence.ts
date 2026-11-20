import type { Runner } from "../runtime/index.js";
import { pollUntil, timeoutMilliseconds } from "./readiness-poll.js";

// Docs: docs/decisions/0113-run-a-keycloak-for-the-platform-organization-s-operators.md

/** A readiness check: the condition it proves and a bounded evaluation. */
interface Check {
  condition: string;
  run: (timeout: string) => Promise<void>;
}

/**
 * The resources an operator creates after its release is installed. Only the
 * platform Keycloak's StatefulSet is one, and it exists only while
 * `platform-portal` is on, so no other release's readiness changes. A release
 * whose own chart creates its StatefulSet needs no wait.
 */
const OPERATOR_CREATED: readonly string[] = ["statefulset/keycloak"];

/** What the check reads from: the runner, the kubectl scope, and whether output is captured. */
interface ExistenceContext {
  runner: Runner;
  base: string[];
  capture?: boolean;
}

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
 * is not there yet, so the wait first polls until the resource exists, then runs
 * the wrapped check with whatever is left of the same bound, so the two never
 * take longer together than the bound the release declares.
 */
function afterExists(
  { runner, base }: ExistenceContext,
  resource: string,
  check: Check,
): Check {
  return {
    condition: `exists and ${check.condition}`,
    run: async (timeout) => {
      const deadline = Date.now() + timeoutMilliseconds(timeout);
      await pollUntil(timeout, async () => {
        await runner.run(
          "kubectl",
          [...base, "get", resource, "--output", "name"],
          { capture: true },
        );
        return undefined;
      });
      // One bound for both: the check gets only the time the wait left.
      const remaining = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
      await check.run(`${remaining}s`);
    },
  };
}

/**
 * The readiness check for a resource an operator creates a moment after the
 * release that declares it is installed: the Keycloak StatefulSet, which the
 * Keycloak operator makes from the `Keycloak` resource (a rollout wait right
 * after `helm install` hit NotFound after 0.2 s). Undefined for any other
 * resource, whose check is unchanged.
 */
export function existenceCheck(
  context: ExistenceContext,
  resource: string,
): Check | undefined {
  if (!OPERATOR_CREATED.includes(resource)) {
    return undefined;
  }
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
