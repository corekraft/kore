import type { Component, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";
import { errorMessage } from "./probe.js";

const TLS_READY_TEMPLATE =
  '{{if and (eq .type "kubernetes.io/tls") (index .data "tls.crt") (index .data "tls.key")}}ready{{end}}';
const POLL_MILLISECONDS = 250;

function unitMilliseconds(unit: string | undefined): number {
  if (unit === "h") {
    return 3600000;
  }
  if (unit === "m") {
    return 60000;
  }
  return 1000;
}

function timeoutMilliseconds(value: string): number {
  const match = value.match(/^(\d+)([smh])$/);
  if (!match) {
    return 10 * 60 * 1000;
  }
  return Number(match[1]) * unitMilliseconds(match[2]);
}

function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, POLL_MILLISECONDS));
}

async function waitForTLSSecret(
  runner: Runner,
  base: string[],
  resource: string,
  timeout: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds(timeout);
  let lastError = "Secret is missing tls.crt or tls.key";
  while (Date.now() < deadline) {
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
      if (result.stdout.trim() === "ready") {
        return;
      }
    } catch (error) {
      lastError = errorMessage(error);
    }
    await pause();
  }
  throw new Error(
    `${resource} did not become a complete TLS Secret within ${timeout}: ${lastError}`,
  );
}

const RETRYABLE_CRD_ERROR =
  /not found|no matches for kind|the server doesn't have a resource type/i;

async function waitForCRD(
  repository: Repository,
  runner: Runner,
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
      if (
        !RETRYABLE_CRD_ERROR.test(errorMessage(error)) ||
        Date.now() >= deadline
      ) {
        throw error;
      }
      await pause();
    }
  }
}

function kubectlWaitArgs(resource: string, timeout: string): string[] {
  if (resource.startsWith("gateway/")) {
    return [
      "wait",
      "--for=condition=Programmed",
      resource,
      `--timeout=${timeout}`,
    ];
  }
  if (resource.startsWith("certificate/")) {
    return ["wait", "--for=condition=Ready", resource, `--timeout=${timeout}`];
  }
  return ["rollout", "status", resource, `--timeout=${timeout}`];
}

/** Blocks until every readiness resource and owned CRD of the component is ready. */
export async function waitFor(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<void> {
  const base = [
    "--context",
    repository.environment.kubeContext,
    "--namespace",
    component.namespace,
  ];
  for (const resource of component.readiness) {
    if (resource.startsWith("crd/")) {
      await waitForCRD(repository, runner, resource, component.timeout);
    } else if (resource.startsWith("secret/")) {
      await waitForTLSSecret(runner, base, resource, component.timeout);
    } else {
      await runner.run(
        "kubectl",
        [...base, ...kubectlWaitArgs(resource, component.timeout)],
        { capture: false },
      );
    }
  }
  for (const crd of component.ownsCRDs) {
    await waitForCRD(repository, runner, `crd/${crd}`, component.timeout);
  }
}
