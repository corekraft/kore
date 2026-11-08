import type { Component, Repository } from "../config/index.js";
import type { Runner } from "../runtime/index.js";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The Helm release status string from `helm status --output json`. */
export function releaseStatusOf(stdout: string): string | undefined {
  const parsed = JSON.parse(stdout) as {
    info?: { status?: string | { status?: string } };
  };
  return typeof parsed.info?.status === "string"
    ? parsed.info.status
    : parsed.info?.status?.status;
}

export async function helmReleaseStatus(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<string | undefined> {
  const release = await runner.run(
    "helm",
    [
      "status",
      component.name,
      "--namespace",
      component.namespace,
      "--kube-context",
      repository.environment.kubeContext,
      "--output",
      "json",
    ],
    { capture: true },
  );
  return releaseStatusOf(release.stdout);
}

/** Throws when any CRD the component owns is absent. */
export async function assertOwnedCrdsExist(
  repository: Repository,
  runner: Runner,
  component: Component,
): Promise<void> {
  for (const crd of component.ownsCRDs) {
    await runner.run(
      "kubectl",
      [
        "--context",
        repository.environment.kubeContext,
        "get",
        `crd/${crd}`,
        "-o",
        "name",
      ],
      { capture: true },
    );
  }
}
