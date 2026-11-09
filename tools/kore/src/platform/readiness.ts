import type { Component, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { errorMessage } from "./probe.js";
import { gatewayCheck } from "./readiness-gateway.js";
import { assertIssuerReady, trustRemedy } from "./readiness-issuer.js";
import {
  STATUS_BOUNDS,
  type Bounds,
  pollUntil,
  waitForConditions,
} from "./readiness-poll.js";
import { withScheduledPods } from "./readiness-daemonset.js";
import { WEBHOOK_CONFIGURATION, waitForWebhook } from "./readiness-webhook.js";

const TLS_READY_TEMPLATE =
  '{{if and (eq .type "kubernetes.io/tls") (index .data "tls.crt") (index .data "tls.key")}}ready{{end}}';
/** Crossplane composition Function packages report Installed, then Healthy. */
const FUNCTION_PREFIX = "function.pkg.crossplane.io/";
/**
 * Cluster-scoped kinds proven by conditions, waited for in order: CRDs are
 * Established, Functions Installed then Healthy, and Sigstore Policy
 * Controller reports a ClusterImagePolicy Ready once its keys are inlined.
 */
const CONDITION_KINDS: readonly (readonly [string, string[]])[] = [
  ["crd/", ["Established"]],
  [FUNCTION_PREFIX, ["Installed", "Healthy"]],
  ["clusterimagepolicy.policy.sigstore.dev/", ["Ready"]],
];
const NOT_FOUND = /NotFound|not found/i;
const EXISTENCE_KINDS = [
  "storageclass/",
  "configmap/",
  "clusterrole/",
  "clusterrolebinding/",
];
/**
 * `kubectl rollout status` reports a Deployment scaled to zero as rolled out,
 * so a registry or verifier that is down on purpose or by accident would read
 * as ready. A Deployment is also required to have an available replica.
 */
const AVAILABLE_TEMPLATE = "{{if .status.availableReplicas}}available{{end}}";
/** Gatekeeper templates and constraints are proven by existing. */
const GATEKEEPER_OBJECT =
  /^(constrainttemplate\.templates|[a-z0-9]+\.constraints)\.gatekeeper\.sh\//;
interface Context {
  repository: Repository;
  runner: Runner;
  base: string[];
  /** Capture command output instead of streaming it to the terminal. */
  capture: boolean;
  /** `--timeout` for kubectl calls that wait on the server; defaults to the check bound. */
  kubectlTimeout?: string;
}

/** A readiness check: the condition it proves and a bounded evaluation. */
interface Check {
  condition: string;
  run: (timeout: string) => Promise<void>;
  /** The check waits with kubectl's `--timeout`, so a failure names that bound. */
  waitsOnServer?: boolean;
}

async function waitForTLSSecret(
  { repository, runner, base }: Context,
  resource: string,
  timeout: string,
): Promise<void> {
  await pollUntil(timeout, async () => {
    try {
      const result = await runner.run(
        "kubectl",
        [
          ...base,
          "get",
          resource,
          "--output",
          `go-template=${TLS_READY_TEMPLATE}`,
        ],
        { capture: true },
      );
      return result.stdout.trim() === "ready"
        ? undefined
        : "Secret is missing tls.crt or tls.key";
    } catch (error) {
      const message = errorMessage(error);
      if (!NOT_FOUND.test(message)) {
        throw error;
      }
      return `${message}. cert-manager has not issued it; ${trustRemedy(repository)}`;
    }
  });
}

async function waitForExistence(
  { runner, base }: Context,
  resource: string,
  timeout: string,
): Promise<void> {
  await pollUntil(timeout, async () => {
    await runner.run(
      "kubectl",
      [...base, "get", resource, "--output", "name"],
      { capture: true },
    );
    return undefined;
  });
}

function nativeCheck(
  { runner, base, capture }: Context,
  condition: string,
  args: (timeout: string) => string[],
): Check {
  return {
    condition,
    waitsOnServer: true,
    run: async (timeout) => {
      await runner.run("kubectl", [...base, ...args(timeout)], {
        capture,
      });
    },
  };
}

function webhookCheck(context: Context, resource: string): Check {
  return {
    condition: "caBundle injected and Service endpoints ready",
    run: (timeout) =>
      waitForWebhook(
        context.runner,
        context.repository.environment.kubeContext,
        resource,
        timeout,
      ),
  };
}

function checkFor(context: Context, resource: string): Check {
  const conditions = CONDITION_KINDS.find(([prefix]) =>
    resource.startsWith(prefix),
  )?.[1];
  if (conditions) {
    return {
      condition: conditions.join(" and "),
      run: (timeout) =>
        waitForConditions(context, resource, conditions, timeout),
      waitsOnServer: true,
    };
  }
  if (resource.startsWith("secret/")) {
    return {
      condition: "complete TLS Secret",
      run: (timeout) => waitForTLSSecret(context, resource, timeout),
    };
  }
  if (WEBHOOK_CONFIGURATION.test(resource)) {
    return webhookCheck(context, resource);
  }
  const network = gatewayCheck(context.runner, context.base, resource);
  if (network) {
    return network;
  }
  if (
    GATEKEEPER_OBJECT.test(resource) ||
    EXISTENCE_KINDS.some((kind) => resource.startsWith(kind))
  ) {
    return {
      condition: "exists",
      run: (timeout) => waitForExistence(context, resource, timeout),
    };
  }
  if (resource.startsWith("certificate/")) {
    const wait = nativeCheck(context, "Ready", (timeout) => [
      "wait",
      "--for=condition=Ready",
      resource,
      `--timeout=${context.kubectlTimeout ?? timeout}`,
    ]);
    return {
      ...wait,
      run: async (timeout) => {
        await assertIssuerReady(
          context.repository,
          context.runner,
          context.base,
          resource,
        );
        await wait.run(timeout);
      },
    };
  }
  const rollout = nativeCheck(context, "rollout complete", (timeout) => [
    "rollout",
    "status",
    resource,
    `--timeout=${context.kubectlTimeout ?? timeout}`,
  ]);
  const server = (check: Check): Check => ({ ...check, waitsOnServer: true });
  if (resource.startsWith("deployment/")) {
    return server(withAvailableReplica(context, resource, rollout));
  }
  return server(
    resource.startsWith("daemonset/")
      ? withScheduledPods(context, resource, rollout)
      : rollout,
  );
}

function withAvailableReplica(
  { runner, base }: Context,
  resource: string,
  rollout: Check,
): Check {
  return {
    condition: "rollout complete and a replica available",
    run: async (timeout) => {
      await rollout.run(timeout);
      const result = await runner.run(
        "kubectl",
        [
          ...base,
          "get",
          resource,
          "--output",
          `go-template=${AVAILABLE_TEMPLATE}`,
        ],
        { capture: true },
      );
      if (result.stdout.trim() !== "available") {
        throw new Error(
          `${resource} has no available replicas (scaled to zero or none passing readiness)`,
        );
      }
    },
  };
}

async function runChecks(
  repository: Repository,
  runner: Runner,
  component: Component,
  { timeout, capture, kubectlTimeout }: Bounds,
): Promise<void> {
  const context: Context = {
    repository,
    runner,
    base: [
      "--context",
      repository.environment.kubeContext,
      "--namespace",
      component.namespace,
    ],
    capture,
    ...(kubectlTimeout ? { kubectlTimeout } : {}),
  };
  const named = (resource: string) => ({
    resource,
    check: checkFor(context, resource),
  });
  const crds = component.ownsCRDs.map((crd) => `crd/${crd}`);
  for (const { resource, check } of [...component.readiness, ...crds].map(
    named,
  )) {
    try {
      await check.run(timeout);
    } catch (error) {
      const bound = check.waitsOnServer ? (kubectlTimeout ?? timeout) : timeout;
      throw new Error(
        `${resource} not ready (${check.condition}) within ${bound}: ${errorMessage(error)}`,
      );
    }
  }
}

/** Blocks until every readiness resource and owned CRD of the component is ready. */
export async function waitFor(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<void> {
  await runChecks(repository, runner, component, {
    timeout: component.timeout,
    capture: false,
  });
}

/**
 * Evaluates the same readiness checks read-only with a short bound; returns the
 * first failure (naming resource and condition), or undefined when all pass.
 */
export async function readinessFailure(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<string | undefined> {
  try {
    await runChecks(repository, runner, component, STATUS_BOUNDS);
    return undefined;
  } catch (error) {
    return errorMessage(error);
  }
}
