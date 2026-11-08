import type { Component, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { errorMessage } from "./probe.js";
import { waitForGateway } from "./readiness-gateway.js";
import { assertIssuerReady, trustRemedy } from "./readiness-issuer.js";
import {
  NOT_YET_THERE,
  pause,
  pollUntil,
  timeoutMilliseconds,
} from "./readiness-poll.js";

const TLS_READY_TEMPLATE =
  '{{if and (eq .type "kubernetes.io/tls") (index .data "tls.crt") (index .data "tls.key")}}ready{{end}}';
const NOT_FOUND = /NotFound|not found/i;
const EXISTENCE_KINDS = [
  "storageclass/",
  "configmap/",
  "clusterrole/",
  "clusterrolebinding/",
];
/** Gatekeeper templates and constraints are proven by existing. */
const GATEKEEPER_OBJECT =
  /^(constrainttemplate\.templates|[a-z0-9]+\.constraints)\.gatekeeper\.sh\//;
/** Bound for each read-only check `kore status` evaluates. */
const STATUS_TIMEOUT = "3s";

interface Context {
  repository: Repository;
  runner: Runner;
  base: string[];
  /** Capture command output instead of streaming it to the terminal. */
  capture: boolean;
}

/** A readiness check: the condition it proves and a bounded evaluation. */
interface Check {
  condition: string;
  run: (timeout: string) => Promise<void>;
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

async function waitForCRD(
  { repository, runner }: Context,
  resource: string,
  timeout: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds(timeout);
  while (true) {
    try {
      await runner.run(
        "kubectl",
        [
          "--context",
          repository.environment.kubeContext,
          "wait",
          "--for=condition=Established",
          resource,
          `--timeout=${timeout}`,
        ],
        { capture: true },
      );
      return;
    } catch (error) {
      if (!NOT_YET_THERE.test(errorMessage(error)) || Date.now() >= deadline) {
        throw error;
      }
      await pause();
    }
  }
}

function nativeCheck(
  { runner, base, capture }: Context,
  condition: string,
  args: (timeout: string) => string[],
): Check {
  return {
    condition,
    run: async (timeout) => {
      await runner.run("kubectl", [...base, ...args(timeout)], {
        capture,
      });
    },
  };
}

function checkFor(context: Context, resource: string): Check {
  if (resource.startsWith("crd/")) {
    return {
      condition: "Established",
      run: (timeout) => waitForCRD(context, resource, timeout),
    };
  }
  if (resource.startsWith("secret/")) {
    return {
      condition: "complete TLS Secret",
      run: (timeout) => waitForTLSSecret(context, resource, timeout),
    };
  }
  if (resource.startsWith("gateway/")) {
    return {
      condition: "Accepted, LoadBalancer address, Programmed, ResolvedRefs",
      run: (timeout) =>
        waitForGateway(context.runner, context.base, resource, timeout),
    };
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
      `--timeout=${timeout}`,
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
  return nativeCheck(context, "rollout complete", (timeout) => [
    "rollout",
    "status",
    resource,
    `--timeout=${timeout}`,
  ]);
}

async function runChecks(
  repository: Repository,
  runner: Runner,
  component: Component,
  timeout: string,
  capture: boolean,
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
      throw new Error(
        `${resource} not ready (${check.condition}) within ${timeout}: ${errorMessage(error)}`,
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
  await runChecks(repository, runner, component, component.timeout, false);
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
    await runChecks(repository, runner, component, STATUS_TIMEOUT, true);
    return undefined;
  } catch (error) {
    return errorMessage(error);
  }
}
